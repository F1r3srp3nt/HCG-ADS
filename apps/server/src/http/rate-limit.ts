import { createHash, randomBytes } from "node:crypto";

/**
 * In-memory fixed-window limiter for abuse protection. Addresses are hashed
 * with a salt that rotates on every restart and are never written to disk.
 */
export class RateLimiter {
  private salt = randomBytes(16);
  private windows = new Map<string, { start: number; count: number }>();

  constructor(private limit: number, private windowMs: number, private now: () => number = Date.now) {}

  allow(address: string): boolean {
    const key = createHash("sha256").update(this.salt).update(address).digest("base64url").slice(0, 16);
    const t = this.now();
    const w = this.windows.get(key);
    if (!w || t - w.start >= this.windowMs) {
      this.windows.set(key, { start: t, count: 1 });
      if (this.windows.size > 50_000) this.sweep(t);
      return true;
    }
    w.count++;
    return w.count <= this.limit;
  }

  private sweep(t: number) {
    for (const [k, w] of this.windows) if (t - w.start >= this.windowMs) this.windows.delete(k);
  }
}
