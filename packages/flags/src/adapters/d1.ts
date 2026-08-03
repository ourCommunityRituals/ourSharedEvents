import type {
  ApplyTierResult,
  FlagRow,
  ListOptions,
  Scope,
  StorageAdapter,
  Tier,
} from '../types.js';

// Minimal D1 type surface — matches the subset of `@cloudflare/workers-types`
// D1Database this adapter uses. Declared locally so packages/flags stays
// self-contained for TypeScript (no peer-dep resolution required when
// consumers type-check us transitively). Pattern matches sqlite.ts and
// postgres.ts, which define their client shapes inline the same way.
// Consumers pass their real D1Database in and it structurally conforms.
interface D1Result<T = unknown> {
  results: T[];
  meta?: Record<string, unknown>;
  success?: boolean;
}
interface D1RunMeta {
  meta?: { changes?: number };
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<D1RunMeta>;
}
interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

let seq = 0;
function newId(): string {
  return `d1_${Date.now().toString(36)}_${(seq++).toString(36)}`;
}

export class D1Adapter implements StorageAdapter {
  readonly id = 'd1';
  constructor(private db: D1Database) {}

  async getEventFlag(flagKey: string, eventId: string): Promise<boolean | null> {
    const row = await this.db
      .prepare(
        "SELECT enabled FROM feature_flags WHERE flag_key = ? AND scope = 'event' AND scope_id = ?"
      )
      .bind(flagKey, eventId)
      .first<{ enabled: number }>();
    return row ? row.enabled === 1 : null;
  }

  async getGlobalFlag(flagKey: string): Promise<boolean | null> {
    const row = await this.db
      .prepare(
        "SELECT enabled FROM feature_flags WHERE flag_key = ? AND scope = 'global' AND (scope_id IS NULL OR scope_id = '')"
      )
      .bind(flagKey)
      .first<{ enabled: number }>();
    return row ? row.enabled === 1 : null;
  }

  async resolveAll(eventId?: string): Promise<Map<string, boolean>> {
    const out = new Map<string, boolean>();
    if (eventId) {
      const res = await this.db
        .prepare(
          `SELECT scope, scope_id, flag_key, enabled FROM feature_flags
           WHERE (scope = 'global' AND (scope_id IS NULL OR scope_id = ''))
              OR (scope = 'event' AND scope_id = ?)`
        )
        .bind(eventId)
        .all<{ scope: string; scope_id: string | null; flag_key: string; enabled: number }>();
      const globals = new Map<string, boolean>();
      const events = new Map<string, boolean>();
      for (const r of res.results ?? []) {
        if (r.scope === 'event') events.set(r.flag_key, r.enabled === 1);
        else globals.set(r.flag_key, r.enabled === 1);
      }
      for (const [k, v] of globals) out.set(k, v);
      for (const [k, v] of events) out.set(k, v);
    } else {
      const res = await this.db
        .prepare(
          `SELECT flag_key, enabled FROM feature_flags
           WHERE scope = 'global' AND (scope_id IS NULL OR scope_id = '')`
        )
        .all<{ flag_key: string; enabled: number }>();
      for (const r of res.results ?? []) out.set(r.flag_key, r.enabled === 1);
    }
    return out;
  }

  async listFlags(opts?: ListOptions): Promise<FlagRow[]> {
    let stmt;
    if (opts?.scope === 'event' && opts.eventId) {
      stmt = this.db
        .prepare(
          "SELECT * FROM feature_flags WHERE scope = 'event' AND scope_id = ? ORDER BY flag_key, scope, scope_id"
        )
        .bind(opts.eventId);
    } else if (opts?.scope === 'global') {
      stmt = this.db.prepare(
        "SELECT * FROM feature_flags WHERE scope = 'global' ORDER BY flag_key, scope, scope_id"
      );
    } else {
      stmt = this.db.prepare('SELECT * FROM feature_flags ORDER BY flag_key, scope, scope_id');
    }
    const res = await stmt.all<{
      id: string;
      scope: string;
      scope_id: string | null;
      flag_key: string;
      enabled: number;
      updated_at: string;
    }>();
    return (res.results ?? []).map((r) => ({
      id: r.id,
      scope: r.scope as Scope,
      scope_id: r.scope_id ?? '',
      flag_key: r.flag_key,
      enabled: r.enabled === 1,
      updated_at: r.updated_at,
    }));
  }

  async setFlag(
    flagKey: string,
    enabled: boolean,
    scope: Scope = 'global',
    scopeId?: string
  ): Promise<void> {
    const resolvedScopeId = scopeId ?? '';
    await this.db
      .prepare(
        `INSERT INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(scope, scope_id, flag_key)
         DO UPDATE SET enabled = excluded.enabled, updated_at = datetime('now')`
      )
      .bind(newId(), scope, resolvedScopeId, flagKey, enabled ? 1 : 0)
      .run();
  }

  async removeEventFlag(eventId: string, flagKey: string): Promise<boolean> {
    const res = await this.db
      .prepare("DELETE FROM feature_flags WHERE scope = 'event' AND scope_id = ? AND flag_key = ?")
      .bind(eventId, flagKey)
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  async batchApplyTier(tier: Tier, preset: Record<string, boolean>): Promise<ApplyTierResult> {
    const entries = Object.entries(preset);
    const statements = entries.map(([key, enabled]) =>
      this.db
        .prepare(
          `INSERT INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
           VALUES (?, 'global', '', ?, ?, datetime('now'))
           ON CONFLICT(scope, scope_id, flag_key)
           DO UPDATE SET enabled = excluded.enabled, updated_at = datetime('now')`
        )
        .bind(newId(), key, enabled ? 1 : 0)
    );
    await this.db.batch(statements);
    return { tier, applied: entries.length };
  }
}
