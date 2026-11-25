import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MIGRATIONS } from "./schema.ts";

export type Row = Record<string, unknown>;
export type Param = SQLInputValue;

/**
 * Thin wrapper around the built-in SQLite driver (local development database).
 *
 * Everything above this layer talks to `Database`, so the storage engine is
 * interchangeable (e.g. a hosted Postgres in the shared HCG project later).
 */
export class Database {
  readonly raw: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  private migrate(): void {
    this.raw.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    const done = new Set(this.all<{ version: number }>("SELECT version FROM schema_migrations").map((r) => r.version));
    for (const m of MIGRATIONS) {
      if (done.has(m.version)) continue;
      this.tx(() => {
        this.raw.exec(m.sql);
        this.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", m.version, new Date().toISOString());
      });
    }
  }

  all<T = Row>(sql: string, ...params: Param[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  get<T = Row>(sql: string, ...params: Param[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  run(sql: string, ...params: Param[]): { changes: number } {
    const r = this.raw.prepare(sql).run(...params);
    return { changes: Number(r.changes) };
  }

  private depth = 0;
  tx<T>(fn: () => T): T {
    if (this.depth > 0) {
      this.depth++;
      try { return fn(); } finally { this.depth--; }
    }
    this.raw.exec("BEGIN IMMEDIATE");
    this.depth = 1;
    try {
      const out = fn();
      this.raw.exec("COMMIT");
      return out;
    } catch (e) {
      this.raw.exec("ROLLBACK");
      throw e;
    } finally {
      this.depth = 0;
    }
  }

  close(): void {
    this.raw.close();
  }
}

export const json = {
  parse<T>(value: unknown, fallback: T): T {
    if (typeof value !== "string" || value === "") return fallback;
    try { return JSON.parse(value) as T; } catch { return fallback; }
  },
  str(value: unknown): string {
    return JSON.stringify(value ?? null);
  },
};

export const bool = (v: unknown): boolean => v === 1 || v === true || v === "1";
