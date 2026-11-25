import { createHmac, timingSafeEqual } from "node:crypto";

/** Compact HMAC-signed tokens: base64url(JSON).base64url(HMAC-SHA256). */
export class Signer {
  constructor(private secret: Buffer, private purpose: string) {}

  sign(payload: Record<string, unknown>): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${this.mac(body)}`;
  }

  verify<T = Record<string, unknown>>(token: string): T | null {
    if (typeof token !== "string" || token.length > 4096) return null;
    const [body, mac] = token.split(".");
    if (!body || !mac) return null;
    const expected = Buffer.from(this.mac(body));
    const got = Buffer.from(mac);
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
    try {
      return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    } catch {
      return null;
    }
  }

  private mac(body: string): string {
    return createHmac("sha256", this.secret).update(this.purpose).update(".").update(body).digest("base64url");
  }
}
