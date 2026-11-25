import { createHash, randomBytes } from "node:crypto";
import type { MediaAsset, MediaMetadata, Placement } from "@hcg-ads/contracts";
import type { Database } from "../db/database.ts";
import { json } from "../db/database.ts";
import type { Clock } from "../core/clock.ts";
import type { AuditActor, AuditLog } from "../core/audit.ts";
import { AppError, conflict, invalid, notFound } from "../core/errors.ts";
import { newId } from "../core/ids.ts";
import type { Signer } from "../core/signing.ts";
import type { StorageProvider } from "./storage.ts";
import { inspect } from "./inspect.ts";
import { ext, type MediaProcessor } from "./processor.ts";
import { checkCompatibility } from "../placements/compat.ts";
import type { GovernanceSettings } from "../governance/settings.ts";

interface Row {
  id: string; owner_advertiser_id: string | null; filename: string; bytes: number; sha256: string; visibility: string; status: string;
  storage_provider: string; storage_key: string; public_key: string | null; thumbnail_key: string | null; version: number;
  previous_version_id: string | null; metadata: string; problems: string; created_by: string; created_at: string; deleted_at: string | null;
}

export interface MediaAssetView extends MediaAsset {
  previousVersionId: string | null;
  /** Short-lived signed URL for authenticated administration previews. */
  previewUrl: string;
  thumbnailUrl: string | null;
  /** Only present once approved. */
  publicUrl: string | null;
  derivatives: string[];
}

/**
 * Media Library. Uploads are private by default and are only copied into the
 * public namespace when a reviewer approves the creative that uses them.
 */
export class MediaService {
  constructor(
    private db: Database,
    private clock: Clock,
    private audit: AuditLog,
    private storage: StorageProvider,
    private processor: MediaProcessor,
    private signer: Signer,
    private settings: () => GovernanceSettings,
    private baseUrl: string,
    private placements: () => Placement[],
  ) {}

  get storageName() { return this.storage.name; }
  storageStatus() { return this.storage.status(); }
  storageDescription() { return this.storage.description; }
  processorInfo() { return { name: this.processor.name, capabilities: this.processor.capabilities }; }

  private row(id: string): Row {
    const r = this.db.get<Row>("SELECT * FROM media_assets WHERE id = ?", id);
    if (!r) throw notFound("Media asset");
    return r;
  }

  view(r: Row): MediaAssetView {
    const metadata = json.parse<MediaMetadata>(r.metadata, {} as MediaMetadata);
    const problems = json.parse<string[]>(r.problems, []);
    const exp = Math.floor(this.clock.now().getTime() / 1000) + 3600;
    const sig = (variant: string) => this.signer.sign({ a: r.id, v: variant, exp });
    const compatible = r.deleted_at ? [] : this.placements()
      .filter((p) => checkCompatibility(p, { kind: metadata.kind, width: metadata.width, height: metadata.height, bytes: r.bytes, durationSeconds: metadata.durationSeconds, animated: metadata.animated }).length === 0)
      .map((p) => p.id);
    const derivatives = (json.parse<{ derivatives?: string[] }>(r.metadata, {}).derivatives ?? []);
    return {
      id: r.id,
      ownerAdvertiserId: r.owner_advertiser_id,
      filename: r.filename,
      bytes: r.bytes,
      sha256: r.sha256,
      visibility: r.visibility as MediaAsset["visibility"],
      status: r.status as MediaAsset["status"],
      storageProvider: r.storage_provider,
      version: r.version,
      previousVersionId: r.previous_version_id,
      metadata,
      thumbnailAvailable: !!r.thumbnail_key,
      problems,
      compatiblePlacementIds: compatible,
      createdAt: r.created_at,
      previewUrl: `${this.baseUrl}/admin/v1/media/${r.id}/content?t=${sig("original")}`,
      thumbnailUrl: r.thumbnail_key ? `${this.baseUrl}/admin/v1/media/${r.id}/content?t=${sig("thumbnail")}` : null,
      publicUrl: r.public_key && r.status === "approved" ? `${this.baseUrl}/delivery/v1/media/${r.public_key}` : null,
      derivatives,
    };
  }

  list(opts: { advertiserId?: string; includeDeleted?: boolean } = {}): MediaAssetView[] {
    const where = [opts.includeDeleted ? "1=1" : "deleted_at IS NULL"];
    const params: string[] = [];
    if (opts.advertiserId) { where.push("owner_advertiser_id = ?"); params.push(opts.advertiserId); }
    return this.db.all<Row>(`SELECT * FROM media_assets WHERE ${where.join(" AND ")} ORDER BY created_at DESC`, ...params).map((r) => this.view(r));
  }

  get(id: string): MediaAssetView {
    return this.view(this.row(id));
  }

  async upload(input: { filename: string; data: Buffer; advertiserId: string | null; previousVersionId?: string }, actor: AuditActor): Promise<MediaAssetView> {
    const s = this.settings();
    const { data } = input;
    const filename = input.filename.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "upload";
    if (data.length === 0) throw invalid("The file is empty.");

    const inspected = inspect(data);
    if (inspected.problems.some((p) => p.startsWith("Unsupported"))) throw new AppError(415, "unsupported_media", inspected.problems[0]);
    const limit = inspected.metadata.kind === "video" ? s.maxVideoBytes : s.maxImageBytes;
    if (data.length > limit) throw new AppError(413, "too_large", `The file is ${(data.length / 1048576).toFixed(1)} MB; the limit for this type is ${(limit / 1048576).toFixed(0)} MB.`);

    if (input.advertiserId) {
      const adv = this.db.get<{ storage_quota_bytes: number }>("SELECT storage_quota_bytes FROM advertisers WHERE id = ?", input.advertiserId);
      if (!adv) throw notFound("Advertiser");
      const used = this.db.get<{ n: number }>("SELECT COALESCE(SUM(bytes),0) n FROM media_assets WHERE owner_advertiser_id = ? AND deleted_at IS NULL", input.advertiserId)?.n ?? 0;
      if (used + data.length > adv.storage_quota_bytes) throw new AppError(507, "quota_exceeded", "This upload would exceed the advertiser's storage quota.");
    }

    let metadata = inspected.metadata;
    const problems = [...inspected.problems];
    try {
      metadata = await this.processor.probe(data, metadata);
    } catch {
      if (metadata.kind === "video") problems.push("The video could not be read. It may be damaged or use an unsupported codec.");
    }
    if (metadata.kind === "video") {
      if (metadata.durationSeconds == null) problems.push("The video duration could not be verified.");
      else if (metadata.durationSeconds > s.maxVideoSeconds) problems.push(`The video is ${metadata.durationSeconds}s; the maximum is ${s.maxVideoSeconds}s.`);
    }
    if (!metadata.width || !metadata.height) problems.push("The resolution could not be determined.");

    let version = 1;
    if (input.previousVersionId) {
      const prev = this.row(input.previousVersionId);
      if (prev.deleted_at) throw conflict("A deleted asset cannot get a new version.");
      version = prev.version + 1;
    }

    const id = newId("med");
    const sha256 = createHash("sha256").update(data).digest("hex");
    const key = `private/${id}/original.${ext(metadata.mime)}`;
    await this.storage.put(key, data, metadata.mime);

    let thumbnailKey: string | null = null;
    const derivatives: string[] = [];
    try {
      const thumb = await this.processor.thumbnail(data, metadata);
      if (thumb) { thumbnailKey = `private/${id}/thumbnail.jpg`; await this.storage.put(thumbnailKey, thumb, "image/jpeg"); }
      const optimized = await this.processor.optimizeImage(data, metadata);
      if (optimized) { await this.storage.put(`private/${id}/optimized.${ext(metadata.mime)}`, optimized, metadata.mime); derivatives.push("optimized"); }
      if (metadata.kind === "video" && problems.length === 0) {
        const mp4 = await this.processor.transcodeVideo(data, metadata);
        if (mp4) { await this.storage.put(`private/${id}/compat.mp4`, mp4, "video/mp4"); derivatives.push("compat-mp4"); }
      }
    } catch {
      problems.push("Thumbnail or derivative generation failed; the original is kept unchanged.");
    }

    const status = problems.length ? "rejected" : "ready";
    this.db.run(
      `INSERT INTO media_assets (id, owner_advertiser_id, filename, bytes, sha256, visibility, status, storage_provider, storage_key, thumbnail_key, version,
        previous_version_id, metadata, problems, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'private', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, input.advertiserId, filename, data.length, sha256, status, this.storage.name, key, thumbnailKey, version,
      input.previousVersionId ?? null, json.str({ ...metadata, derivatives }), json.str(problems), actor.subject, this.clock.now().toISOString(),
    );
    this.audit.record(actor, "media.upload", "media", id, `Uploaded ${filename} (${metadata.mime}, ${metadata.width ?? "?"}×${metadata.height ?? "?"}, v${version}) — ${status}`, { problems });
    return this.get(id);
  }

  /** Authenticated preview of private media through a signed, expiring URL. */
  async readSigned(id: string, token: string): Promise<{ data: Buffer; mime: string }> {
    const claims = this.signer.verify<{ a: string; v: string; exp: number }>(token);
    if (!claims || claims.a !== id || claims.exp < this.clock.now().getTime() / 1000) throw new AppError(403, "invalid_signature", "This preview link has expired.");
    const r = this.row(id);
    if (r.deleted_at) throw notFound("Media asset");
    const meta = json.parse<MediaMetadata>(r.metadata, {} as MediaMetadata);
    const key = claims.v === "thumbnail" ? r.thumbnail_key : r.storage_key;
    if (!key) throw notFound("Media variant");
    const data = await this.storage.get(key);
    if (!data) throw notFound("Media file");
    return { data, mime: claims.v === "thumbnail" ? "image/jpeg" : meta.mime };
  }

  /** Copies an approved asset into the public namespace under an unguessable key. */
  async approve(id: string, actor: AuditActor): Promise<MediaAssetView> {
    const r = this.row(id);
    if (r.deleted_at) throw conflict("Deleted media cannot be approved.");
    if (r.status === "rejected") throw conflict("This media failed validation and cannot be approved.");
    if (r.status === "approved" && r.public_key) return this.get(id);
    const meta = json.parse<MediaMetadata & { derivatives?: string[] }>(r.metadata, {} as MediaMetadata);
    const publicKey = `${randomBytes(18).toString("base64url")}.${ext(meta.mime)}`;
    const data = await this.storage.get(r.storage_key);
    if (!data) throw notFound("Media file");
    await this.storage.put(`public/${publicKey}`, data, meta.mime);
    if (r.thumbnail_key) {
      const thumb = await this.storage.get(r.thumbnail_key);
      if (thumb) await this.storage.put(`public/${publicKey}.poster.jpg`, thumb, "image/jpeg");
    }
    this.db.run("UPDATE media_assets SET status = 'approved', visibility = 'public', public_key = ? WHERE id = ?", publicKey, id);
    this.audit.record(actor, "media.approve", "media", id, `Approved ${r.filename} for public delivery`);
    return this.get(id);
  }

  async readPublic(publicKey: string): Promise<{ data: Buffer; mime: string } | null> {
    const poster = publicKey.endsWith(".poster.jpg");
    const baseKey = poster ? publicKey.slice(0, -".poster.jpg".length) : publicKey;
    const r = this.db.get<Row>("SELECT * FROM media_assets WHERE public_key = ? AND status = 'approved' AND deleted_at IS NULL", baseKey);
    if (!r) return null;
    const data = await this.storage.get(`public/${publicKey}`);
    if (!data) return null;
    return { data, mime: poster ? "image/jpeg" : json.parse<MediaMetadata>(r.metadata, {} as MediaMetadata).mime };
  }

  publicUrlFor(id: string): { url: string; posterUrl: string | null } | null {
    const r = this.db.get<Row>("SELECT * FROM media_assets WHERE id = ? AND status = 'approved' AND deleted_at IS NULL", id);
    if (!r || !r.public_key) return null;
    return {
      url: `${this.baseUrl}/delivery/v1/media/${r.public_key}`,
      posterUrl: r.thumbnail_key ? `${this.baseUrl}/delivery/v1/media/${r.public_key}.poster.jpg` : null,
    };
  }

  /** Deletion withdraws the public copy immediately; the private original is purged after retention. */
  async delete(id: string, actor: AuditActor): Promise<void> {
    const r = this.row(id);
    if (r.deleted_at) return;
    const inUse = this.db.all<{ id: string; state: string }>(
      `SELECT c.id, c.state FROM creatives cr JOIN campaigns c ON c.id = cr.campaign_id
       WHERE cr.variants LIKE ? AND c.state IN ('active','scheduled','approved','pending_approval')`, `%"${id}"%`);
    if (inUse.length) throw conflict(`This media is used by ${inUse.length} live or pending campaign(s). Pause or archive them first.`, inUse);
    if (r.public_key) {
      await this.storage.delete(`public/${r.public_key}`);
      await this.storage.delete(`public/${r.public_key}.poster.jpg`).catch(() => undefined);
    }
    const now = this.clock.now();
    const purge = new Date(now.getTime() + this.settings().mediaRetentionDays * 86400_000).toISOString();
    this.db.run("UPDATE media_assets SET deleted_at = ?, purge_after = ?, status = 'deleted', visibility = 'private' WHERE id = ?", now.toISOString(), purge, id);
    this.audit.record(actor, "media.delete", "media", id, `Deleted ${r.filename}; purged from storage after ${purge.slice(0, 10)}`);
  }

  /** Retention: purges deleted originals whose retention period has passed. */
  async purgeExpired(actor: AuditActor): Promise<number> {
    const due = this.db.all<Row>("SELECT * FROM media_assets WHERE deleted_at IS NOT NULL AND purge_after <= ? AND storage_key != ''", this.clock.now().toISOString());
    for (const r of due) {
      await this.storage.delete(r.storage_key);
      if (r.thumbnail_key) await this.storage.delete(r.thumbnail_key);
      this.db.run("UPDATE media_assets SET storage_key = '', thumbnail_key = NULL WHERE id = ?", r.id);
    }
    if (due.length) this.audit.record(actor, "media.purge", "media", null, `Purged ${due.length} deleted media file(s) after retention`);
    return due.length;
  }
}
