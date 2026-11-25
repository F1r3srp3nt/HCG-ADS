import { AppError } from "../core/errors.ts";

/** The zero organisation ID: only a no-organisation placeholder for an active global Founder policy. */
export const FOUNDER_NO_ORG = "00000000-0000-0000-0000-000000000000";

export interface EcosystemMe {
  userId: string;
  email: string | null;
  displayName: string | null;
  organisations: Array<{ orgId: string; slug?: string; name?: string }>;
  founderPolicy: boolean;
}

/**
 * HCG's Ecosystem API (`/api/public/ecosystem/v1`), called server-side with the
 * caller's own bearer token. Fails closed: any non-200, timeout or malformed
 * response is an error, never a permission.
 */
export class EcosystemClient {
  constructor(private base: string, private fetchImpl: typeof fetch = fetch) {}

  private url(path: string) { return `${this.base.replace(/\/$/, "")}/${path}`; }

  private async call(method: string, path: string, token: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url(path), {
        method,
        headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError(503, "hcg_unavailable", "HCG could not be reached to check your access; nothing was allowed.");
    }
    if (res.status === 401) throw new AppError(401, "hcg_session_ended", "HCG no longer accepts this sign-in. Sign in to HCG Connect again.");
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!json || typeof json !== "object") throw new AppError(503, "hcg_unavailable", "HCG returned an unreadable answer; nothing was allowed.");
    return { status: res.status, json };
  }

  async me(token: string): Promise<EcosystemMe> {
    const { status, json } = await this.call("GET", "me", token);
    if (status !== 200) throw new AppError(503, "hcg_unavailable", `HCG could not identify the account (HTTP ${status}); nothing was allowed.`);
    const user = json.user as Record<string, unknown> | undefined;
    if (!user || typeof user.id !== "string") throw new AppError(503, "hcg_unavailable", "HCG returned an unreadable account; nothing was allowed.");
    const orgs = Array.isArray(json.organisations) ? (json.organisations as Array<Record<string, unknown>>) : [];
    const policy = json.product_policy as Record<string, unknown> | undefined;
    return {
      userId: user.id,
      email: typeof user.email === "string" ? user.email : null,
      displayName: typeof user.display_name === "string" ? user.display_name : null,
      organisations: orgs.filter((o) => typeof o.org_id === "string").map((o) => ({ orgId: String(o.org_id), slug: o.slug as string, name: o.name as string })),
      founderPolicy: policy?.active === true,
    };
  }

  /** Only `allowed === true` authorises. 403 is a denial; anything else fails closed. */
  async check(token: string, orgId: string, productId: string, featureKey: string): Promise<boolean> {
    const { status, json } = await this.call("POST", "check", token, { org_id: orgId, product_id: productId, feature_key: featureKey });
    if (status === 200) return json.allowed === true;
    if (status === 403) {
      const code = (json.error as Record<string, unknown> | undefined)?.code;
      if (code === "revoked") throw new AppError(403, "access_revoked", "HCG has withdrawn this access (ERP App Access).");
      return false;
    }
    throw new AppError(503, "hcg_unavailable", `HCG could not check your access (HTTP ${status}); nothing was allowed.`);
  }
}
