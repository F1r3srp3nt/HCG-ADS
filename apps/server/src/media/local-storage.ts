import { mkdir, readFile, rm, writeFile, rename, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { assertSafeKey, type StorageProvider } from "./storage.ts";

/**
 * Local development storage provider. Files live under the HCG ADS data folder
 * on this computer and are only served through HCG ADS's own routes (private
 * uploads need a signed admin URL; only approved assets are public).
 * It is not exposed to the internet.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";
  readonly description = "Local development storage (this computer, served only through HCG ADS)";
  private root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    assertSafeKey(key);
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error("Storage key escapes the media folder.");
    return p;
  }

  async status() {
    await mkdir(this.root, { recursive: true });
    return { ok: true, message: `Local development storage at ${this.root}` };
  }

  async put(key: string, data: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.${randomBytes(6).toString("hex")}.part`;
    await writeFile(tmp, data, { mode: 0o600 });
    await rename(tmp, p);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.path(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async usage() {
    let bytes = 0, objects = 0;
    const walk = async (dir: string) => {
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else { bytes += (await stat(p)).size; objects++; }
      }
    };
    await walk(this.root);
    return { bytes, objects };
  }
}
