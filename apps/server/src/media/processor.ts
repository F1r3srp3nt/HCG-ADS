import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { MediaMetadata } from "@hcg-ads/contracts";
import { aspectRatio } from "../placements/compat.ts";

/**
 * Media processing is interchangeable. The ffmpeg processor (when ffmpeg and
 * ffprobe are installed) adds probing of every video format, thumbnails,
 * image optimisation and transcoding; the basic processor relies on the pure
 * TypeScript inspection only and says what it cannot do.
 */
export interface MediaProcessor {
  readonly name: string;
  readonly capabilities: { probe: boolean; thumbnails: boolean; optimize: boolean; transcode: boolean };
  probe(data: Buffer, base: MediaMetadata): Promise<MediaMetadata>;
  thumbnail(data: Buffer, meta: MediaMetadata): Promise<Buffer | null>;
  /** Re-encodes an image without changing its dimensions; null when not smaller. */
  optimizeImage(data: Buffer, meta: MediaMetadata): Promise<Buffer | null>;
  /** Produces an H.264/AAC MP4 derivative for broad playback compatibility. */
  transcodeVideo(data: Buffer, meta: MediaMetadata): Promise<Buffer | null>;
}

export class BasicProcessor implements MediaProcessor {
  readonly name = "basic";
  readonly capabilities = { probe: false, thumbnails: false, optimize: false, transcode: false };
  async probe(_d: Buffer, base: MediaMetadata) { return base; }
  async thumbnail() { return null; }
  async optimizeImage() { return null; }
  async transcodeVideo() { return null; }
}

function run(cmd: string, args: string[], timeoutMs = 60_000): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve({ stdout })));
  });
}

export class FfmpegProcessor implements MediaProcessor {
  readonly name = "ffmpeg";
  readonly capabilities = { probe: true, thumbnails: true, optimize: true, transcode: true };

  constructor(private ffmpeg = "ffmpeg", private ffprobe = "ffprobe") {}

  static async available(): Promise<boolean> {
    try {
      await run("ffprobe", ["-version"], 5000);
      await run("ffmpeg", ["-version"], 5000);
      return true;
    } catch {
      return false;
    }
  }

  private async withFile<T>(data: Buffer, ext: string, fn: (path: string, dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), "hcg-ads-media-"));
    const path = join(dir, `input.${ext}`);
    try {
      await writeFile(path, data);
      return await fn(path, dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async probe(data: Buffer, base: MediaMetadata): Promise<MediaMetadata> {
    return this.withFile(data, ext(base.mime), async (path) => {
      const { stdout } = await run(this.ffprobe, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", path], 30_000);
      const info = JSON.parse(stdout) as { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> };
      const video = info.streams?.find((s) => s.codec_type === "video");
      const out = { ...base };
      if (base.kind === "video") {
        if (video) {
          out.width = Number(video.width) || out.width;
          out.height = Number(video.height) || out.height;
          out.videoCodec = String(video.codec_name ?? out.videoCodec ?? "") || null;
        }
        const d = Number(info.format?.duration ?? video?.duration);
        if (Number.isFinite(d) && d > 0) out.durationSeconds = Math.round(d * 100) / 100;
        out.hasAudio = !!info.streams?.some((s) => s.codec_type === "audio");
      } else if (video && (!out.width || !out.height)) {
        out.width = Number(video.width) || null;
        out.height = Number(video.height) || null;
      }
      out.aspectRatio = aspectRatio(out.width, out.height);
      return out;
    });
  }

  async thumbnail(data: Buffer, meta: MediaMetadata): Promise<Buffer | null> {
    return this.withFile(data, ext(meta.mime), async (path, dir) => {
      const outPath = join(dir, "thumb.jpg");
      const seek = meta.kind === "video" ? ["-ss", String(Math.min(1, (meta.durationSeconds ?? 0) / 2))] : [];
      // Scale down only, preserving the aspect ratio (never stretched).
      await run(this.ffmpeg, ["-v", "error", ...seek, "-i", path, "-frames:v", "1", "-vf", "scale='min(480,iw)':-2", "-q:v", "4", "-y", outPath], 60_000);
      return readFile(outPath);
    });
  }

  async optimizeImage(data: Buffer, meta: MediaMetadata): Promise<Buffer | null> {
    if (meta.kind !== "image" || meta.mime === "image/gif") return null;
    return this.withFile(data, ext(meta.mime), async (path, dir) => {
      const outPath = join(dir, `opt.${ext(meta.mime)}`);
      const args = meta.mime === "image/jpeg" ? ["-q:v", "3"] : meta.mime === "image/png" ? ["-compression_level", "9"] : ["-quality", "85"];
      await run(this.ffmpeg, ["-v", "error", "-i", path, ...args, "-y", outPath], 60_000);
      const out = await readFile(outPath);
      return out.length < data.length * 0.95 ? out : null;
    });
  }

  async transcodeVideo(data: Buffer, meta: MediaMetadata): Promise<Buffer | null> {
    if (meta.kind !== "video" || (meta.mime === "video/mp4" && /^(avc1|h264)$/i.test(meta.videoCodec ?? ""))) return null;
    return this.withFile(data, ext(meta.mime), async (path, dir) => {
      const outPath = join(dir, "compat.mp4");
      await run(this.ffmpeg, ["-v", "error", "-i", path, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-movflags", "+faststart", "-y", outPath], 300_000);
      return readFile(outPath);
    });
  }
}

export function ext(mime: string): string {
  return ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" } as Record<string, string>)[mime] ?? "bin";
}
