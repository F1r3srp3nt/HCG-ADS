import { describe, expect, it, afterAll } from "vitest";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HcgServerStorageProvider } from "../src/media/hcg-server-storage.ts";

/**
 * Runs against the REAL HCG Server agent (F1r3srp3nt/HCG-Server, cmd/hcg-agent)
 * when HCG_SERVER_AGENT points at a built binary. Skipped otherwise.
 */
const BIN = process.env.HCG_SERVER_AGENT ?? "";
const run = BIN && existsSync(BIN);
let agent: ChildProcess | null = null;
afterAll(() => agent?.kill());

describe.skipIf(!run)("HCG Server storage adapter (real hcg-agent)", () => {
  it("uploads with verified chunks, reads back, and tombstones deletions inside the approved root", async () => {
    const work = mkdtempSync(join(tmpdir(), "hcg-ads-hcgserver-"));
    const share = join(work, "share");
    mkdirSync(share);
    const flags = ["--data-dir", join(work, "data"), "--credential-store", "file"];
    agent = spawn(BIN, ["run", ...flags, "--admin-listen", "127.0.0.1:7660", "--peer-listen", "127.0.0.1:7661"], { stdio: "ignore" });
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch("http://127.0.0.1:7660/healthz")).ok) break; } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    const added = execFileSync(BIN, ["roots", "add", share, "--name", "HCG ADS", ...flags]).toString();
    const rootId = added.match(/as (root_[a-z0-9]+)/)![1];
    const token = execFileSync(BIN, ["admin-url", ...flags]).toString().split("#token=")[1].trim();

    const s = new HcgServerStorageProvider({ adminUrl: "http://127.0.0.1:7660", tokenFile: "/nonexistent", rootId, basePath: "hcg-ads" }, fetch, token);
    expect((await s.status()).ok).toBe(true);
    const data = Buffer.alloc(9 * 1024 * 1024, 7); // > two 4 MB chunks
    data.write("HCG ADS");
    await s.put("private/med_x/original.png", data, "image/png");
    expect(readFileSync(join(share, "hcg-ads/private/med_x/original.png")).equals(data)).toBe(true);
    expect((await s.get("private/med_x/original.png"))!.equals(data)).toBe(true);
    expect(await s.get("private/med_x/missing.png")).toBeNull();
    await s.delete("private/med_x/original.png");
    expect(readFileSync(join(share, "hcg-ads/private/med_x/original.png")).length).toBe(0);
    expect(() => s.put("../escape", data, "x")).rejects.toThrow(/Unsafe/);
  }, 60_000);
});
