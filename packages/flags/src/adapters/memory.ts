import type {
  ApplyTierResult,
  FlagRow,
  ListOptions,
  Scope,
  StorageAdapter,
  Tier,
} from '../types.js';

type Key = `${Scope}:${string}:${string}`;

function k(scope: Scope, scopeId: string, flagKey: string): Key {
  return `${scope}:${scopeId}:${flagKey}`;
}

export class MemoryAdapter implements StorageAdapter {
  readonly id = 'memory';
  private store = new Map<Key, FlagRow>();
  private seq = 0;

  async getEventFlag(flagKey: string, eventId: string): Promise<boolean | null> {
    const row = this.store.get(k('event', eventId, flagKey));
    return row ? row.enabled : null;
  }

  async getGlobalFlag(flagKey: string): Promise<boolean | null> {
    const row = this.store.get(k('global', '', flagKey));
    return row ? row.enabled : null;
  }

  async resolveAll(eventId?: string): Promise<Map<string, boolean>> {
    const out = new Map<string, boolean>();
    for (const row of this.store.values()) {
      if (row.scope === 'global' && row.scope_id === '') out.set(row.flag_key, row.enabled);
    }
    if (eventId) {
      for (const row of this.store.values()) {
        if (row.scope === 'event' && row.scope_id === eventId) out.set(row.flag_key, row.enabled);
      }
    }
    return out;
  }

  async listFlags(opts?: ListOptions): Promise<FlagRow[]> {
    const rows: FlagRow[] = [];
    for (const row of this.store.values()) {
      if (opts?.scope === 'event' && opts.eventId) {
        if (row.scope === 'event' && row.scope_id === opts.eventId) rows.push(row);
      } else if (opts?.scope === 'global') {
        if (row.scope === 'global') rows.push(row);
      } else {
        rows.push(row);
      }
    }
    rows.sort(
      (a, b) =>
        a.flag_key.localeCompare(b.flag_key) ||
        a.scope.localeCompare(b.scope) ||
        a.scope_id.localeCompare(b.scope_id)
    );
    return rows;
  }

  async setFlag(
    flagKey: string,
    enabled: boolean,
    scope: Scope = 'global',
    scopeId?: string
  ): Promise<void> {
    const resolvedScopeId = scopeId ?? '';
    const key = k(scope, resolvedScopeId, flagKey);
    const existing = this.store.get(key);
    this.store.set(key, {
      id: existing?.id ?? `mem_${++this.seq}`,
      scope,
      scope_id: resolvedScopeId,
      flag_key: flagKey,
      enabled,
      updated_at: new Date().toISOString(),
    });
  }

  async removeEventFlag(eventId: string, flagKey: string): Promise<boolean> {
    return this.store.delete(k('event', eventId, flagKey));
  }

  async batchApplyTier(tier: Tier, preset: Record<string, boolean>): Promise<ApplyTierResult> {
    let applied = 0;
    for (const [flagKey, enabled] of Object.entries(preset)) {
      await this.setFlag(flagKey, enabled, 'global', '');
      applied++;
    }
    return { tier, applied };
  }
}
