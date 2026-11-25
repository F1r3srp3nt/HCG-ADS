import { randomBytes, randomUUID } from "node:crypto";

/** Prefixed, stable identifiers: e.g. cmp_9f2c… */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/** Public, non-secret placement key. */
export function newPublicKey(prefix = "plc"): string {
  return `${prefix}_pub_${randomBytes(12).toString("base64url")}`;
}
