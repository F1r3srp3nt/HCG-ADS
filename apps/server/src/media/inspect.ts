import type { MediaKind, MediaMetadata } from "@hcg-ads/contracts";
import { aspectRatio } from "../placements/compat.ts";

/**
 * Pure TypeScript media inspection. The file type is decided by its content
 * (magic bytes), never by its name or the uploader's claimed type. Anything
 * that is not one of the supported raster images or videos is refused, which
 * excludes SVG, HTML, scripts and other executable advertising formats.
 */

export type Detected = { mime: string; kind: MediaKind } | null;

export function detectType(b: Buffer): Detected {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG") return { mime: "image/png", kind: "image" };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", kind: "image" };
  if (b.toString("ascii", 0, 6) === "GIF87a" || b.toString("ascii", 0, 6) === "GIF89a") return { mime: "image/gif", kind: "image" };
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return { mime: "image/webp", kind: "image" };
  if (b.toString("ascii", 4, 8) === "ftyp") {
    const brand = b.toString("ascii", 8, 12);
    if (/^(isom|iso2|iso4|iso5|iso6|mp41|mp42|avc1|dash|M4V |MSNV|NDAS|3gp)/.test(brand)) return { mime: "video/mp4", kind: "video" };
    if (/^(qt  )/.test(brand)) return { mime: "video/quicktime", kind: "video" };
    return null;
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { mime: "video/webm", kind: "video" };
  return null;
}

export interface Inspection {
  metadata: MediaMetadata;
  problems: string[];
}

function base(mime: string, kind: MediaKind): MediaMetadata {
  return { mime, kind, width: null, height: null, aspectRatio: null, durationSeconds: null, animated: false, frameCount: null, videoCodec: null, hasAudio: null };
}

export function inspect(b: Buffer): Inspection {
  const t = detectType(b);
  if (!t) {
    return {
      metadata: base("application/octet-stream", "image"),
      problems: ["Unsupported file type. Upload PNG, JPEG, WebP, GIF, MP4 or WebM. Scripts, SVG and HTML are never accepted."],
    };
  }
  const m = base(t.mime, t.kind);
  const problems: string[] = [];
  try {
    switch (t.mime) {
      case "image/png": png(b, m); break;
      case "image/jpeg": jpeg(b, m); break;
      case "image/gif": gif(b, m); break;
      case "image/webp": webp(b, m); break;
      case "video/mp4":
      case "video/quicktime": mp4(b, m); break;
      case "video/webm": break; // dimensions and duration come from ffprobe when available
    }
  } catch {
    problems.push("The file is damaged or truncated.");
  }
  if (m.animated) m.kind = "animated-image";
  if (t.mime === "video/quicktime") problems.push("QuickTime (.mov) is not delivered to browsers. Export MP4 (H.264) or WebM.");
  m.aspectRatio = aspectRatio(m.width, m.height);
  return { metadata: m, problems };
}

function png(b: Buffer, m: MediaMetadata) {
  m.width = b.readUInt32BE(16);
  m.height = b.readUInt32BE(20);
  // APNG: an acTL chunk before the first IDAT.
  let off = 8;
  while (off + 8 <= b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString("ascii", off + 4, off + 8);
    if (type === "acTL") {
      const frames = b.readUInt32BE(off + 8);
      m.frameCount = frames;
      m.animated = frames > 1;
      break;
    }
    if (type === "IDAT" || type === "IEND") break;
    off += 12 + len;
  }
}

function jpeg(b: Buffer, m: MediaMetadata) {
  let off = 2;
  while (off + 4 < b.length) {
    if (b[off] !== 0xff) { off++; continue; }
    const marker = b[off + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue; }
    const len = b.readUInt16BE(off + 2);
    // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      m.height = b.readUInt16BE(off + 5);
      m.width = b.readUInt16BE(off + 7);
      return;
    }
    off += 2 + len;
  }
  throw new Error("no SOF");
}

function gif(b: Buffer, m: MediaMetadata) {
  m.width = b.readUInt16LE(6);
  m.height = b.readUInt16LE(8);
  const flags = b[10];
  let off = 13;
  if (flags & 0x80) off += 3 * (1 << ((flags & 0x07) + 1));
  let frames = 0;
  while (off < b.length) {
    const block = b[off];
    if (block === 0x2c) {
      frames++;
      const lflags = b[off + 9];
      off += 10;
      if (lflags & 0x80) off += 3 * (1 << ((lflags & 0x07) + 1));
      off++; // LZW min code size
      while (off < b.length && b[off] !== 0) off += b[off] + 1;
      off++;
    } else if (block === 0x21) {
      off += 2;
      while (off < b.length && b[off] !== 0) off += b[off] + 1;
      off++;
    } else break; // 0x3b trailer
  }
  m.frameCount = frames;
  m.animated = frames > 1;
}

function webp(b: Buffer, m: MediaMetadata) {
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    const flags = b[20];
    m.animated = (flags & 0x02) !== 0;
    m.width = 1 + b.readUIntLE(24, 3);
    m.height = 1 + b.readUIntLE(27, 3);
  } else if (chunk === "VP8 ") {
    m.width = b.readUInt16LE(26) & 0x3fff;
    m.height = b.readUInt16LE(28) & 0x3fff;
  } else if (chunk === "VP8L") {
    const bits = b.readUInt32LE(21);
    m.width = (bits & 0x3fff) + 1;
    m.height = ((bits >> 14) & 0x3fff) + 1;
  } else throw new Error("unknown webp");
}

/** Minimal ISO-BMFF walk: mvhd duration, video track tkhd size, handler types. */
function mp4(b: Buffer, m: MediaMetadata) {
  const walk = (start: number, end: number, trackType: { v: string | null }, onTrack?: (s: number, e: number) => void) => {
    let off = start;
    while (off + 8 <= end) {
      let size = b.readUInt32BE(off);
      const type = b.toString("ascii", off + 4, off + 8);
      let header = 8;
      if (size === 1) { size = Number(b.readBigUInt64BE(off + 8)); header = 16; }
      if (size === 0) size = end - off;
      if (size < header || off + size > end) break;
      const body = off + header;
      if (type === "moov" || type === "mdia" || type === "minf") walk(body, off + size, trackType, onTrack);
      else if (type === "trak") onTrack?.(body, off + size);
      else if (type === "mvhd") {
        const v = b[body];
        const timescale = v === 1 ? b.readUInt32BE(body + 20) : b.readUInt32BE(body + 12);
        const duration = v === 1 ? Number(b.readBigUInt64BE(body + 24)) : b.readUInt32BE(body + 16);
        if (timescale) m.durationSeconds = Math.round((duration / timescale) * 100) / 100;
      } else if (type === "hdlr") trackType.v = b.toString("ascii", body + 8, body + 12);
      else if (type === "tkhd") {
        const v = b[body];
        const wOff = body + (v === 1 ? 88 : 76);
        const w = b.readUInt32BE(wOff) / 65536, h = b.readUInt32BE(wOff + 4) / 65536;
        (trackType as { v: string | null; w?: number; h?: number }).w = w;
        (trackType as { v: string | null; w?: number; h?: number }).h = h;
      } else if (type === "stsd" && trackType.v === "vide") {
        m.videoCodec = b.toString("ascii", body + 12, body + 16).trim();
      }
      off += size;
    }
  };
  m.hasAudio = false;
  walk(0, b.length, { v: null }, (s, e) => {
    const t: { v: string | null; w?: number; h?: number } = { v: null };
    walk(s, e, t);
    // The tkhd/hdlr order inside a trak is tkhd first; re-walk to pick up stsd once hdlr is known.
    if (t.v === "vide") {
      walk(s, e, t);
      if (t.w && t.h) { m.width = Math.round(t.w); m.height = Math.round(t.h); }
    }
    if (t.v === "soun") m.hasAudio = true;
  });
}
