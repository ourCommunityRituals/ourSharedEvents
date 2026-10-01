import type { StorageAdapter, ObservabilitySink, EvaluatorOptions, Tier } from './types.js';
import { ALL_FLAG_KEYS, type FlagKey } from './generated/flag-keys.js';
import { TIER_PRESETS } from './generated/presets.js';

function emit(
  sink: ObservabilitySink | undefined,
  adapter_id: string,
  error: unknown,
  flag_key?: string
): void {
  if (!sink) return;
  sink({
    kind: 'fail_open',
    adapter_id,
    level: 'warn',
    // exactOptionalPropertyTypes: omit the key rather than set it to undefined.
    ...(flag_key !== undefined ? { flag_key } : {}),
    error_class: error instanceof Error ? error.constructor.name : typeof error,
    ts: new Date().toISOString(),
  });
}

export async function isFeatureEnabled(
  adapter: StorageAdapter,
  flagKey: string,
  eventId?: string,
  opts?: EvaluatorOptions
): Promise<boolean> {
  try {
    if (eventId) {
      const event = await adapter.getEventFlag(flagKey, eventId);
      if (event !== null) return event;
    }
    const global = await adapter.getGlobalFlag(flagKey);
    if (global !== null) return global;
    return true;
  } catch (err) {
    emit(opts?.observability, adapter.id, err, flagKey);
    return true;
  }
}

export async function resolveFlags(
  adapter: StorageAdapter,
  eventId?: string,
  opts?: EvaluatorOptions
): Promise<Record<FlagKey, boolean>> {
  const out: Record<string, boolean> = {};
  try {
    const resolved = await adapter.resolveAll(eventId);
    for (const key of ALL_FLAG_KEYS) {
      out[key] = resolved.has(key) ? resolved.get(key)! : true;
    }
    return out;
  } catch (err) {
    emit(opts?.observability, adapter.id, err);
    for (const key of ALL_FLAG_KEYS) out[key] = true;
    return out;
  }
}

export async function detectCurrentTier(
  adapter: StorageAdapter,
  opts?: EvaluatorOptions
): Promise<Tier> {
  const resolved = await resolveFlags(adapter, undefined, opts);
  const ordered: Tier[] = ['enterprise', 'mid', 'free'];
  for (const tier of ordered) {
    const preset = TIER_PRESETS[tier];
    const match = ALL_FLAG_KEYS.every((k) => resolved[k] === preset[k]);
    if (match) return tier;
  }
  return 'free';
}

export async function applyTier(
  adapter: StorageAdapter,
  tier: Tier
): Promise<{ tier: Tier; applied: number }> {
  const preset = TIER_PRESETS[tier];
  const plain: Record<string, boolean> = {};
  for (const k of ALL_FLAG_KEYS) plain[k] = preset[k];
  const res = await adapter.batchApplyTier(tier, plain);
  return { tier, applied: res.applied };
}
