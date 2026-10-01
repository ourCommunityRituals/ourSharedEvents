import type {
  ApplyTierResult,
  FlagRow,
  ListOptions,
  Scope,
  StorageAdapter,
  Tier,
} from '../types.js';

type Statement = {
  run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
};

type SqliteDatabase = {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  transaction<T extends (...args: unknown[]) => unknown>(fn: T): T;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS feature_flags (
  id         TEXT PRIMARY KEY,
  scope      TEXT NOT NULL CHECK (scope IN ('global','event')),
  scope_id   TEXT NOT NULL DEFAULT '',
  flag_key   TEXT NOT NULL,
  enabled    INTEGER NOT NULL CHECK (enabled IN (0,1)),
  updated_at TEXT NOT NULL,
  UNIQUE (scope, scope_id, flag_key)
);
CREATE INDEX IF NOT EXISTS idx_flags_scope ON feature_flags(scope, scope_id);
CREATE INDEX IF NOT EXISTS idx_flags_key   ON feature_flags(flag_key);
`;

function rowToFlagRow(r: Record<string, unknown>): FlagRow {
  return {
    id: String(r.id),
    scope: String(r.scope) as Scope,
    // TEXT column, NULL for global rows: better-sqlite3 yields string | null.
    scope_id: r.scope_id == null ? '' : (r.scope_id as string),
    flag_key: String(r.flag_key),
    enabled: Number(r.enabled) === 1,
    updated_at: String(r.updated_at),
  };
}

let seq = 0;
function newId(): string {
  return `sql_${Date.now().toString(36)}_${(seq++).toString(36)}`;
}

export class SqliteAdapter implements StorageAdapter {
  readonly id = 'sqlite';
  constructor(private db: SqliteDatabase) {
    db.exec(SCHEMA);
  }

  async getEventFlag(flagKey: string, eventId: string): Promise<boolean | null> {
    const row = this.db
      .prepare(
        "SELECT enabled FROM feature_flags WHERE flag_key = ? AND scope = 'event' AND scope_id = ?"
      )
      .get(flagKey, eventId) as { enabled?: number } | undefined;
    return row ? Number(row.enabled) === 1 : null;
  }

  async getGlobalFlag(flagKey: string): Promise<boolean | null> {
    const row = this.db
      .prepare(
        "SELECT enabled FROM feature_flags WHERE flag_key = ? AND scope = 'global' AND scope_id = ''"
      )
      .get(flagKey) as { enabled?: number } | undefined;
    return row ? Number(row.enabled) === 1 : null;
  }

  async resolveAll(eventId?: string): Promise<Map<string, boolean>> {
    const out = new Map<string, boolean>();
    const globals = this.db
      .prepare(
        "SELECT flag_key, enabled FROM feature_flags WHERE scope = 'global' AND scope_id = ''"
      )
      .all() as Array<{ flag_key: string; enabled: number }>;
    for (const r of globals) out.set(r.flag_key, Number(r.enabled) === 1);
    if (eventId) {
      const events = this.db
        .prepare(
          "SELECT flag_key, enabled FROM feature_flags WHERE scope = 'event' AND scope_id = ?"
        )
        .all(eventId) as Array<{ flag_key: string; enabled: number }>;
      for (const r of events) out.set(r.flag_key, Number(r.enabled) === 1);
    }
    return out;
  }

  async listFlags(opts?: ListOptions): Promise<FlagRow[]> {
    let rows: Array<Record<string, unknown>>;
    if (opts?.scope === 'event' && opts.eventId) {
      rows = this.db
        .prepare(
          "SELECT * FROM feature_flags WHERE scope = 'event' AND scope_id = ? ORDER BY flag_key, scope, scope_id"
        )
        .all(opts.eventId) as Array<Record<string, unknown>>;
    } else if (opts?.scope === 'global') {
      rows = this.db
        .prepare(
          "SELECT * FROM feature_flags WHERE scope = 'global' ORDER BY flag_key, scope, scope_id"
        )
        .all() as Array<Record<string, unknown>>;
    } else {
      rows = this.db
        .prepare('SELECT * FROM feature_flags ORDER BY flag_key, scope, scope_id')
        .all() as Array<Record<string, unknown>>;
    }
    return rows.map(rowToFlagRow);
  }

  async setFlag(
    flagKey: string,
    enabled: boolean,
    scope: Scope = 'global',
    scopeId?: string
  ): Promise<void> {
    const resolvedScopeId = scopeId ?? '';
    this.db
      .prepare(
        `INSERT INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope, scope_id, flag_key)
         DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`
      )
      .run(newId(), scope, resolvedScopeId, flagKey, enabled ? 1 : 0, new Date().toISOString());
  }

  async removeEventFlag(eventId: string, flagKey: string): Promise<boolean> {
    const res = this.db
      .prepare("DELETE FROM feature_flags WHERE scope = 'event' AND scope_id = ? AND flag_key = ?")
      .run(eventId, flagKey);
    return res.changes > 0;
  }

  async batchApplyTier(tier: Tier, preset: Record<string, boolean>): Promise<ApplyTierResult> {
    const stmt = this.db.prepare(
      `INSERT INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
       VALUES (?, 'global', '', ?, ?, ?)
       ON CONFLICT(scope, scope_id, flag_key)
       DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`
    );
    const entries = Object.entries(preset);
    const apply = this.db.transaction(() => {
      const ts = new Date().toISOString();
      for (const [key, enabled] of entries) {
        stmt.run(newId(), key, enabled ? 1 : 0, ts);
      }
    });
    apply();
    return { tier, applied: entries.length };
  }
}
