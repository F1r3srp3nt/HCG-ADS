import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

/** AES-256-GCM sealing for secrets at rest (tokens). The key is derived per purpose with HKDF. */
export class Sealer {
  private key: Buffer;
  constructor(secret: Buffer, purpose: string) {
    this.key = Buffer.from(hkdfSync("sha256", secret, Buffer.from("hcg-ads"), Buffer.from(purpose), 32));
  }
  seal(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
  }
  open(sealed: string): string {
    const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
    const d = createDecipheriv("aes-256-gcm", this.key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString("utf8");
  }
}

export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
