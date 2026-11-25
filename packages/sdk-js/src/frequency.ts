/**
 * Privacy-preserving frequency limits. Counters never leave the device; only
 * the ids of campaigns that reached their limit are sent (as `exclude`).
 * With storage consent they persist in localStorage; without it they live in
 * memory for the current page only.
 */
export const FREQUENCY_KEY = "hcg-ads:freq";

interface Entry { n: number; w: number; t: number[] }
type Table = Record<string, Entry>;

export class FrequencyStore {
  private memory: Table = {};

  constructor(private persistent: () => boolean, private storage: () => Storage | null = defaultStorage) {}

  private read(): Table {
    if (!this.persistent()) return this.memory;
    try {
      const raw = this.storage()?.getItem(FREQUENCY_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : {};
      return parsed && typeof parsed === "object" ? (parsed as Table) : {};
    } catch {
      return this.memory;
    }
  }

  private write(t: Table): void {
    if (!this.persistent()) { this.memory = t; return; }
    try {
      this.storage()?.setItem(FREQUENCY_KEY, JSON.stringify(t));
    } catch {
      this.memory = t;
    }
  }

  /** Removes timestamps outside each campaign's window and empty entries. */
  private prune(t: Table, now: number): Table {
    const out: Table = {};
    for (const [id, e] of Object.entries(t)) {
      if (!e || !Array.isArray(e.t) || typeof e.w !== "number" || typeof e.n !== "number") continue;
      const since = now - e.w * 3600_000;
      const kept = e.t.filter((x) => typeof x === "number" && x > since && x <= now + 60_000);
      if (kept.length) out[id] = { n: e.n, w: e.w, t: kept.slice(-200) };
    }
    return out;
  }

  record(campaignId: string, rule: { count: number; windowHours: number } | null, now = Date.now()): void {
    if (!rule) return;
    const t = this.prune(this.read(), now);
    const e = t[campaignId] ?? { n: rule.count, w: rule.windowHours, t: [] };
    t[campaignId] = { n: rule.count, w: rule.windowHours, t: [...e.t, now] };
    this.write(t);
  }

  /** Campaign ids that reached their limit within their window. */
  capped(now = Date.now()): string[] {
    const t = this.prune(this.read(), now);
    this.write(t);
    return Object.entries(t).filter(([, e]) => e.t.length >= e.n).map(([id]) => id);
  }

  /** Consent withdrawn: forget everything stored on the device. */
  clearPersistent(): void {
    try { this.storage()?.removeItem(FREQUENCY_KEY); } catch { /* ignore */ }
  }
}

function defaultStorage(): Storage | null {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}
