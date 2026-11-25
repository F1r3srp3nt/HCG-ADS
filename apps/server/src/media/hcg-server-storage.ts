import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { HcgServerStorageConfig } from "../config.ts";
import { assertSafeKey, type StorageProvider } from "./storage.ts";

/**
 * HCG Server storage adapter.
 *
 * Uses HCG Server's documented v1 file API (docs/API.md in F1r3srp3nt/HCG-Server):
 * resumable staged uploads with per-chunk and whole-file SHA-256, atomic
 * no-clobber commit, allocation limits and `os.Root` confinement, on a storage
 * root the owner approved. HCG ADS talks to the administration API on loopback
 * (same computer), authenticated with the local admin token read from a file.
 *
 * HCG Server is not a public CDN: approved public assets are still served to
 * readers through HCG ADS's delivery routes, never by exposing the computer.
 */
export class HcgServerStorageProvider implements StorageProvider {
  readonly name = "hcg-server";
  readonly description = "HCG Server (approved storage root, verified uploads)";
  static readonly CHUNK = 4 * 1024 * 1024;

  constructor(private cfg: HcgServerStorageConfig, private fetchImpl: typeof fetch = fetch, private tokenOverride?: string) {}

  private token(): string {
    return this.tokenOverride ?? readFileSync(this.cfg.tokenFile, "utf8").trim();
  }

  private url(path: string, q: Record<string, string> = {}): string {
    const u = new URL(`/api/v1/devices/local/files/${path}`, this.cfg.adminUrl);
    for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
    return u.toString();
  }

  private async call(method: string, url: string, body?: BodyInit, headers: Record<string, string> = {}): Promise<Response> {
    return this.fetchImpl(url, {
      method,
      body,
      headers: { authorization: `Bearer ${this.token()}`, ...headers },
      signal: AbortSignal.timeout(60_000),
    });
  }

  private filePath(key: string): string {
    assertSafeKey(key);
    return `${this.cfg.basePath.replace(/\/$/, "")}/${key}`;
  }

  async status() {
    try {
      const res = await this.fetchImpl(new URL("/healthz", this.cfg.adminUrl), { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { ok: false, message: `HCG Server answered HTTP ${res.status}` };
      const h = (await res.json()) as { apiVersion?: string; agentVersion?: string };
      if (h.apiVersion !== "v1") return { ok: false, message: `Unsupported HCG Server API version ${h.apiVersion}` };
      return { ok: true, message: `HCG Server ${h.agentVersion ?? ""} reachable; root ${this.cfg.rootId}` };
    } catch (e) {
      return { ok: false, message: `HCG Server is not reachable: ${(e as Error).message}` };
    }
  }

  private async mkdirs(path: string) {
    const parts = path.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const res = await this.call("POST", this.url("mkdir"), JSON.stringify({ root: this.cfg.rootId, path: parts.slice(0, i).join("/") }), { "content-type": "application/json" });
      if (!res.ok && res.status !== 409) throw new Error(`HCG Server mkdir failed: HTTP ${res.status}`);
    }
  }

  async put(key: string, data: Buffer, _contentType?: string): Promise<void> {
    const path = this.filePath(key);
    await this.mkdirs(path);
    const sha256 = createHash("sha256").update(data).digest("hex");
    const created = await this.call("POST", this.url("uploads"), JSON.stringify({ root: this.cfg.rootId, path, size: data.length, sha256, overwrite: true }), { "content-type": "application/json" });
    if (!created.ok) throw new Error(`HCG Server refused the upload: ${await errorText(created)}`);
    const { id } = (await created.json()) as { id: string };
    // A zero-byte file commits without any chunk (HCG Server requires Content-Length on every PUT).
    for (let offset = 0; offset < data.length; offset += HcgServerStorageProvider.CHUNK) {
      const chunk = data.subarray(offset, offset + HcgServerStorageProvider.CHUNK);
      const res = await this.call("PUT", this.url(`uploads/${id}`, { offset: String(offset) }), chunk, {
        "content-type": "application/octet-stream",
        "x-hcg-chunk-sha256": createHash("sha256").update(chunk).digest("hex"),
      });
      if (!res.ok) {
        await this.call("DELETE", this.url(`uploads/${id}`)).catch(() => undefined);
        throw new Error(`HCG Server chunk upload failed: ${await errorText(res)}`);
      }
    }
    const commit = await this.call("POST", this.url(`uploads/${id}/commit`));
    if (!commit.ok) throw new Error(`HCG Server commit failed: ${await errorText(commit)}`);
  }

  async get(key: string): Promise<Buffer | null> {
    const res = await this.call("GET", this.url("content", { root: this.cfg.rootId, path: this.filePath(key), hash: "1" }));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HCG Server download failed: ${await errorText(res)}`);
    const data = Buffer.from(await res.arrayBuffer());
    const declared = res.headers.get("x-hcg-sha256");
    if (declared && createHash("sha256").update(data).digest("hex") !== declared.toLowerCase()) {
      throw new Error("HCG Server download failed its integrity check.");
    }
    return data;
  }

  async delete(key: string): Promise<void> {
    // HCG Server v1 has no file-delete endpoint yet; retention is recorded and the
    // file is replaced by an empty tombstone so it is no longer servable.
    await this.put(key, Buffer.alloc(0));
  }

  async usage() {
    return null;
  }
}

async function errorText(res: Response): Promise<string> {
  try {
    const b = (await res.json()) as { error?: string; code?: string };
    return `${b.code ?? res.status}: ${b.error ?? ""}`.trim();
  } catch {
    return `HTTP ${res.status}`;
  }
}
