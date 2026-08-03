import type {
  ApplyTierResult,
  FlagRow,
  ListOptions,
  Scope,
  StorageAdapter,
  Tier,
} from '../types.js';

type QueryResult<R> = { rows: R[]; rowCount: number | null };

type PgClient = {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<R>>;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS feature_flags (
  id         TEXT PRIMARY KEY,
  scope      TEXT NOT NULL CHECK (scope IN ('global','event')),
  scope_id   TEXT NOT NULL DEFAULT '',
  flag_key   TEXT NOT NULL,
  enabled    BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scope, scope_id, flag_key)
);
CREATE INDEX IF NOT EXISTS idx_flags_scope ON feature_flags(scope, scope_id);
CREATE INDEX IF NOT EXISTS idx_flags_key   ON feature_flags(flag_key);
`;

let seq = 0;
function newId(): string {
  return `pg_${Date.now().toString(36)}_${(seq++).toString(36)}`;
}

export interface PostgresAdapterOptions {
  autoCreateTable?: boolean;
}

export class PostgresAdapter implements StorageAdapter {
  readonly id = 'postgres';
  private ready: Promise<void>;

  constructor(
    private client: PgClient,
    opts?: PostgresAdapterOptions
  ) {
    this.ready =
      opts?.autoCreateTable === false
        ? Promise.resolve()
        : this.client.query(SCHEMA).then(() => undefined);
  }

  private async q<R>(sql: string, params?: unknown[]): Promise<QueryResult<R>> {
    await this.ready;
    return this.client.query<R>(sql, params);
  }

  async getEventFlag(flagKey: string, eventId: string): Promise<boolean | null> {
    const res = await this.q<{ enabled: boolean }>(
      "SELECT enabled FROM feature_flags WHERE flag_key = $1 AND scope = 'event' AND scope_id = $2",
      [flagKey, eventId]
    );
    return res.rows[0] ? res.rows[0].enabled : null;
  }

  async getGlobalFlag(flagKey: string): Promise<boolean | null> {
    const res = await this.q<{ enabled: boolean }>(
      "SELECT enabled FROM feature_flags WHERE flag_key = $1 AND scope = 'global' AND scope_id = ''",
      [flagKey]
    );
    return res.rows[0] ? res.rows[0].enabled : null;
  }

  async resolveAll(eventId?: string): Promise<Map<string, boolean>> {
    const out = new Map<string, boolean>();
    const globals = await this.q<{ flag_key: string; enabled: boolean }>(
      "SELECT flag_key, enabled FROM feature_flags WHERE scope = 'global' AND scope_id = ''"
    );
    for (const r of globals.rows) out.set(r.flag_key, r.enabled);
    if (eventId) {
      const events = await this.q<{ flag_key: string; enabled: boolean }>(
        "SELECT flag_key, enabled FROM feature_flags WHERE scope = 'event' AND scope_id = $1",
        [eventId]
      );
      for (const r of events.rows) out.set(r.flag_key, r.enabled);
    }
    return out;
  }

  async listFlags(opts?: ListOptions): Promise<FlagRow[]> {
    let sql: string;
    let params: unknown[] = [];
    if (opts?.scope === 'event' && opts.eventId) {
      sql =
        "SELECT * FROM feature_flags WHERE scope = 'event' AND scope_id = $1 ORDER BY flag_key, scope, scope_id";
      params = [opts.eventId];
    } else if (opts?.scope === 'global') {
      sql = "SELECT * FROM feature_flags WHERE scope = 'global' ORDER BY flag_key, scope, scope_id";
    } else {
      sql = 'SELECT * FROM feature_flags ORDER BY flag_key, scope, scope_id';
    }
    const res = await this.q<{
      id: string;
      scope: string;
      scope_id: string;
      flag_key: string;
      enabled: boolean;
      updated_at: Date | string;
    }>(sql, params);
    return res.rows.map((r) => ({
      id: r.id,
      scope: r.scope as Scope,
      scope_id: r.scope_id,
      flag_key: r.flag_key,
      enabled: r.enabled,
      updated_at: typeof r.updated_at === 'string' ? r.updated_at : r.updated_at.toISOString(),
    }));
  }

  async setFlag(
    flagKey: string,
    enabled: boolean,
    scope: Scope = 'global',
    scopeId?: string
  ): Promise<void> {
    await this.q(
      `INSERT INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (scope, scope_id, flag_key)
       DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
      [newId(), scope, scopeId ?? '', flagKey, enabled]
    );
  }

  async removeEventFlag(eventId: string, flagKey: string): Promise<boolean> {
    const res = await this.q(
      "DELETE FROM feature_flags WHERE scope = 'event' AND scope_id = $1 AND flag_key = $2",
      [eventId, flagKey]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async batchApplyTier(tier: Tier, preset: Record<string, boolean>): Promise<ApplyTierResult> {
    const entries = Object.entries(preset);
    for (const [key, enabled] of entries) {
      await this.q(
        `INSERT INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
         VALUES ($1, 'global', '', $2, $3, NOW())
         ON CONFLICT (scope, scope_id, flag_key)
         DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
        [newId(), key, enabled]
      );
    }
    return { tier, applied: entries.length };
  }
}
