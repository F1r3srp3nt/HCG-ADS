import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { z } from "zod";

/**
 * HCG ADS server configuration.
 *
 * Sources, in order: built-in development defaults → config/*.json → environment.
 * No production endpoint, client id or credential is built in.
 */

const HcgConnectSchema = z.object({
  contractVersion: z.literal("hcg.ads.connect/1"),
  /** HCG Connect token issuer (the shared HCG identity project). */
  issuer: z.string().url(),
  jwksEndpoint: z.string().url(),
  /** HCG website hosting the Ecosystem API (ERP App Access checks). */
  apiBaseUrl: z.string().url(),
  ecosystemApiPath: z.string().startsWith("/"),
  /** ERP App Access product key HCG issues for HCG ADS. Never defaulted. */
  productId: z.string().min(1),
  /** Role → ERP feature key. Unmapped roles are never granted. */
  roleFeatures: z.record(z.string(), z.string().min(1)),
  /** HCG Connect OAuth client ids whose tokens are accepted. */
  trustedClientIds: z.array(z.string()).default([]),
  organisationId: z.string().nullable().default(null),
  /**
   * The HCG ADS web application's own dedicated client (ERP → App Integrations → hcg.ads →
   * Dedicated app login registration). Public PKCE S256 client, no secret. Never defaulted:
   * until HCG issues it, web sign-in is unavailable and the command center says so.
   */
  webClient: z.object({
    clientId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "clientId must be the UUID HCG issued"),
    redirectUri: z.string().url(),
  }).strict().nullable().default(null),
}).strict();
export type HcgConnectConfig = z.infer<typeof HcgConnectSchema>;

const HcgNewsSchema = z.object({
  environment: z.string(),
  projectURL: z.string().url(),
  publicClientKey: z.string().min(20),
  publicationURL: z.string().url(),
  approvedByFounder: z.literal(true),
});
export type HcgNewsConfig = z.infer<typeof HcgNewsSchema>;

const HcgServerStorageSchema = z.object({
  /** HCG Server administration API (loopback on the same computer). */
  adminUrl: z.string().url(),
  /** File holding the local admin token (never committed). */
  tokenFile: z.string(),
  /** Approved HCG Server storage root id to place HCG ADS media in. */
  rootId: z.string(),
  /** Folder inside the root. */
  basePath: z.string().default("hcg-ads"),
});
export type HcgServerStorageConfig = z.infer<typeof HcgServerStorageSchema>;

export interface ServerConfig {
  env: "development" | "test" | "production";
  host: string;
  port: number;
  publicBaseUrl: string;
  adminOrigins: string[];
  dataDir: string;
  deliverySecret: Buffer;
  identity: { mode: "development" } | { mode: "hcg-connect"; hcgConnect: HcgConnectConfig };
  hcgConnectProblems: string[];
  storage: { provider: "local" } | { provider: "hcg-server"; hcgServer: HcgServerStorageConfig };
  hcgNews: HcgNewsConfig | null;
  hcgNewsProblems: string[];
  /** Pinned shared-HCG project refs; configuration for any other project is refused. */
  knownProjectRefs: string[];
  syncIntervalMs: number;
  adminStaticDir: string | null;
}

const KNOWN_PROJECT_REFS = ["qggdyzoydveafkmjgkpq"];

function readJson(path: string): unknown | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8"));
}

const FORBIDDEN_KEY = /(secret|password|private|service_role)/i;
function forbiddenKeys(value: unknown, path = ""): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
    ...(FORBIDDEN_KEY.test(k) ? [path + k] : []),
    ...forbiddenKeys(v, `${path}${k}.`),
  ]);
}

function anonKeyProblem(key: string, ref: string): string | null {
  if (key.startsWith("sb_secret_")) return "publicClientKey is a secret key; only the public (anon) key is accepted.";
  if (key.startsWith("sb_publishable_")) return null;
  const parts = key.split(".");
  if (parts.length !== 3) return "publicClientKey is not a recognised public client key.";
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (claims.role !== "anon") return "publicClientKey is not an anon key. Privileged keys are refused.";
    if (claims.ref && claims.ref !== ref) return "publicClientKey belongs to a different project.";
  } catch {
    return "publicClientKey could not be read.";
  }
  return null;
}

export function validateHcgNewsConfig(raw: unknown, knownRefs = KNOWN_PROJECT_REFS): { config: HcgNewsConfig | null; problems: string[] } {
  if (raw === undefined) return { config: null, problems: ["config/hcg-news.json is not installed."] };
  const forbidden = forbiddenKeys(raw);
  if (forbidden.length) return { config: null, problems: [`The HCG News configuration contains credential fields (${forbidden.join(", ")}).`] };
  const parsed = HcgNewsSchema.safeParse(raw);
  if (!parsed.success) return { config: null, problems: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const c = parsed.data;
  const problems: string[] = [];
  const u = new URL(c.projectURL);
  const ref = u.hostname.split(".")[0];
  if (u.protocol !== "https:" || !u.hostname.endsWith(".supabase.co")) problems.push("projectURL must be https://<project>.supabase.co.");
  else if (!knownRefs.includes(ref)) problems.push("projectURL is not the shared HCG project.");
  const keyProblem = anonKeyProblem(c.publicClientKey, ref);
  if (keyProblem) problems.push(keyProblem);
  const pub = new URL(c.publicationURL);
  if (pub.protocol !== "https:" || !(pub.hostname === "hakmicapitalgroup.com" || pub.hostname.endsWith(".hakmicapitalgroup.com"))) {
    problems.push("publicationURL must be an HTTPS HCG host.");
  }
  return problems.length ? { config: null, problems } : { config: c, problems: [] };
}

export function validateHcgConnectConfig(raw: unknown): { config: HcgConnectConfig | null; problems: string[] } {
  if (raw === undefined) return { config: null, problems: ["config/hcg-connect.json is not installed: HCG Connect sign-in is not configured."] };
  const forbidden = forbiddenKeys(raw);
  if (forbidden.length) return { config: null, problems: [`The HCG Connect configuration contains credential fields (${forbidden.join(", ")}). It must hold no secrets.`] };
  const parsed = HcgConnectSchema.safeParse(raw);
  if (!parsed.success) return { config: null, problems: parsed.error.issues.map((i) => `${i.path.join(".") || "file"}: ${i.message}`) };
  const c = parsed.data;
  const problems: string[] = [];
  for (const u of [c.issuer, c.jwksEndpoint, c.apiBaseUrl]) {
    const url = new URL(u);
    if (url.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(url.hostname)) problems.push(`${u} must use https://.`);
  }
  if (c.webClient) {
    const r = new URL(c.webClient.redirectUri);
    const loopback = ["127.0.0.1", "localhost"].includes(r.hostname);
    if (r.protocol !== "https:" && !(loopback && r.protocol === "http:")) problems.push("webClient.redirectUri must be https:// (or loopback http for development).");
    if (r.pathname !== "/auth/callback" || r.search || r.hash) problems.push("webClient.redirectUri must be exactly <origin>/auth/callback.");
  }
  if (c.productId.includes("<") || Object.values(c.roleFeatures).some((v) => v.includes("<"))) {
    problems.push("productId and roleFeatures still contain placeholders. HCG has to issue the ERP App Access keys for HCG ADS.");
  }
  return problems.length ? { config: null, problems } : { config: c, problems: [] };
}

function loadSecret(dataDir: string): Buffer {
  const fromEnv = process.env.HCG_ADS_DELIVERY_SECRET;
  if (fromEnv && fromEnv.length >= 32) return Buffer.from(fromEnv);
  const path = join(dataDir, "delivery-secret.key");
  if (existsSync(path)) return Buffer.from(readFileSync(path, "utf8").trim(), "base64");
  mkdirSync(dataDir, { recursive: true });
  const key = randomBytes(32);
  writeFileSync(path, key.toString("base64"), { mode: 0o600 });
  return key;
}

export function loadConfig(root = process.cwd(), overrides: Partial<ServerConfig> = {}): ServerConfig {
  const configDir = resolve(root, process.env.HCG_ADS_CONFIG_DIR ?? "config");
  const env = (process.env.HCG_ADS_ENV ?? "development") as ServerConfig["env"];
  const host = process.env.HCG_ADS_HOST ?? "127.0.0.1";
  const port = Number(process.env.HCG_ADS_PORT ?? 7800);
  const dataDir = resolve(root, process.env.HCG_ADS_DATA_DIR ?? "data");
  const publicBaseUrl = (process.env.HCG_ADS_PUBLIC_URL ?? `http://${host}:${port}`).replace(/\/$/, "");

  const news = validateHcgNewsConfig(readJson(join(configDir, "hcg-news.json")));
  const connect = validateHcgConnectConfig(readJson(join(configDir, "hcg-connect.json")));

  const requestedIdentity = process.env.HCG_ADS_IDENTITY ?? (env === "production" ? "hcg-connect" : "development");
  let identity: ServerConfig["identity"];
  if (requestedIdentity === "hcg-connect") {
    if (!connect.config) {
      // Fails closed: every administration request is refused until HCG Connect is configured.
      identity = { mode: "hcg-connect", hcgConnect: null as unknown as HcgConnectConfig };
    } else identity = { mode: "hcg-connect", hcgConnect: connect.config };
  } else {
    identity = { mode: "development" };
  }

  const storageRaw = readJson(join(configDir, "storage.json")) as { provider?: string; hcgServer?: unknown } | undefined;
  let storage: ServerConfig["storage"] = { provider: "local" };
  if (storageRaw?.provider === "hcg-server") {
    storage = { provider: "hcg-server", hcgServer: HcgServerStorageSchema.parse(storageRaw.hcgServer) };
  }

  const config: ServerConfig = {
    env,
    host,
    port,
    publicBaseUrl,
    adminOrigins: (process.env.HCG_ADS_ADMIN_ORIGINS ?? "http://127.0.0.1:5173,http://localhost:5173").split(",").filter(Boolean),
    dataDir,
    deliverySecret: Buffer.alloc(0),
    identity,
    hcgConnectProblems: connect.problems,
    storage,
    hcgNews: news.config,
    hcgNewsProblems: news.problems,
    knownProjectRefs: KNOWN_PROJECT_REFS,
    syncIntervalMs: Number(process.env.HCG_ADS_SYNC_INTERVAL_MS ?? 10 * 60 * 1000),
    adminStaticDir: existsSync(resolve(root, "apps/admin/dist")) ? resolve(root, "apps/admin/dist") : null,
    ...overrides,
  };
  if (config.deliverySecret.length === 0) config.deliverySecret = loadSecret(config.dataDir);
  assertSafe(config);
  return config;
}

/** Refuses configurations that would expose development shortcuts. */
export function assertSafe(c: ServerConfig): void {
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(c.host);
  if (c.identity.mode === "development" && c.env === "production") {
    throw new Error("The development identity provider cannot be used in production. Configure HCG Connect.");
  }
  if (c.env === "production" && !c.publicBaseUrl.startsWith("https://")) {
    throw new Error("Production requires an https:// public URL (HCG_ADS_PUBLIC_URL): session cookies are Secure-only.");
  }
  if (c.identity.mode === "development" && !loopback) {
    throw new Error("The development identity provider only listens on loopback (127.0.0.1). Do not expose this computer.");
  }
}
