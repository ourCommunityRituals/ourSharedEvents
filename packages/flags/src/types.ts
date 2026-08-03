export type Scope = 'global' | 'event';

export type Tier = 'free' | 'mid' | 'enterprise';

export interface FlagRow {
  id: string;
  scope: Scope;
  scope_id: string;
  flag_key: string;
  enabled: boolean;
  updated_at: string;
}

export interface ListOptions {
  scope?: Scope;
  eventId?: string;
}

export interface ApplyTierResult {
  tier: Tier;
  applied: number;
}

export interface ObservabilityEvent {
  kind: 'fail_open' | 'write_audit';
  adapter_id: string;
  level: 'info' | 'warn' | 'error';
  flag_key?: string;
  scope?: Scope;
  scope_id_hash?: string;
  new_value?: boolean;
  error_class?: string;
  event_id_hash?: string;
  actor_hash?: string;
  ts: string;
}

export type ObservabilitySink = (e: ObservabilityEvent) => void;

export interface StorageAdapter {
  readonly id: string;
  getEventFlag(flagKey: string, eventId: string): Promise<boolean | null>;
  getGlobalFlag(flagKey: string): Promise<boolean | null>;
  resolveAll(eventId?: string): Promise<Map<string, boolean>>;
  listFlags(opts?: ListOptions): Promise<FlagRow[]>;
  setFlag(flagKey: string, enabled: boolean, scope?: Scope, scopeId?: string): Promise<void>;
  removeEventFlag(eventId: string, flagKey: string): Promise<boolean>;
  batchApplyTier(tier: Tier, preset: Record<string, boolean>): Promise<ApplyTierResult>;
}

export interface EvaluatorOptions {
  observability?: ObservabilitySink;
}
