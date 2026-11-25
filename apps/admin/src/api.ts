/** HCG ADS administration API client (/admin/v1). Relative URLs: same origin, or the Vite proxy in development. */

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
  /** Problems list when the server sent one (e.g. not_ready). */
  get problems(): string[] {
    return Array.isArray(this.details) && this.details.every((d) => typeof d === "string") ? (this.details as string[]) : [];
  }
}

/**
 * Sign-in is a server-owned HCG Connect session (HttpOnly cookie): this app never sees or
 * stores an HCG token. State-changing requests echo the session's CSRF token, which the
 * server returns from GET /admin/v1/session and keeps only in memory here.
 */
let csrfToken: string | null = null;
export function setCsrf(token: string | null) { csrfToken = token; }

export interface AuthStatus { mode: string; configured: boolean; signInAvailable?: boolean; label: string; problems: string[] }
export async function authStatus(): Promise<AuthStatus | null> {
  try { const r = await fetch("/auth/status", { credentials: "same-origin" }); return r.ok ? ((await r.json()) as AuthStatus) : null; } catch { return null; }
}
export function signIn() {
  const back = "/" + (window.location.hash || "#/command-center");
  window.location.assign(`/auth/login?return=${encodeURIComponent(back)}`);
}
export async function signOut() {
  await fetch("/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
  csrfToken = null;
  window.location.reload();
}

type Listener = () => void;
const mutationListeners = new Set<Listener>();
/** Pages subscribe to refresh after any successful write. */
export function onMutation(fn: Listener) { mutationListeners.add(fn); return () => { mutationListeners.delete(fn); }; }

async function request<T>(method: string, path: string, body?: unknown, init: { form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (method !== "GET" && csrfToken) headers["x-hcg-ads-csrf"] = csrfToken;
  let payload: BodyInit | undefined;
  if (init.form) payload = init.form;
  else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  let res: Response;
  try {
    res = await fetch(`/admin/v1${path}`, { method, headers, body: payload, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "network", "HCG ADS could not be reached. Is the server running?");
  }
  if (res.status === 204) { if (method !== "GET") mutationListeners.forEach((l) => l()); return undefined as T; }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? "http_" + res.status, e?.message ?? `Request failed (HTTP ${res.status}).`, e?.details);
  }
  if (method !== "GET") mutationListeners.forEach((l) => l());
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  del: <T = void>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, undefined, { form }),
};

/** Upload with progress (XMLHttpRequest exposes upload progress; fetch does not). */
export function uploadWithProgress<T>(path: string, form: FormData, onProgress: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/admin/v1${path}`);
    xhr.withCredentials = true;
    if (csrfToken) xhr.setRequestHeader("x-hcg-ads-csrf", csrfToken);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onerror = () => reject(new ApiError(0, "network", "The upload could not reach HCG ADS."));
    xhr.onload = () => {
      let data: { error?: { code?: string; message?: string; details?: unknown } } | null = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* not json */ }
      if (xhr.status >= 200 && xhr.status < 300) { mutationListeners.forEach((l) => l()); resolve(data as T); }
      else reject(new ApiError(xhr.status, data?.error?.code ?? "http_" + xhr.status, data?.error?.message ?? `Upload failed (HTTP ${xhr.status}).`, data?.error?.details));
    };
    xhr.send(form);
  });
}

// ---- Formatting helpers ----------------------------------------------------

export const fmt = {
  int: (n: number | null | undefined) => (n ?? 0).toLocaleString("en-GB"),
  pct: (n: number | null | undefined) => `${(n ?? 0).toFixed(2)}%`,
  bytes: (n: number | null | undefined) => {
    const v = n ?? 0;
    if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(1)} GB`;
    if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(1)} MB`;
    if (v >= 1024) return `${Math.round(v / 1024)} KB`;
    return `${v} B`;
  },
  date: (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"),
  dateTime: (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"),
  money: (minor: number | null | undefined, currency = "NOK") => `${((minor ?? 0) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`,
  state: (s: string) => s.replace(/_/g, " "),
  size: (w: number | null | undefined, h: number | null | undefined) => (w && h ? `${w} × ${h}` : "Responsive"),
};

/** ISO datetime-local input value → ISO string with offset (or null). */
export function localToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
export function isoToLocal(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
