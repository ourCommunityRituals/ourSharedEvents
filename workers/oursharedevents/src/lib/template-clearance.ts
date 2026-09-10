/**
 * Template clearance-tier selectability gate (#5 rule) — OSE-728.
 *
 * A template is SELECTABLE during sponsor onboarding only if it has a computed
 * regulatory clearance tier that is within the ceiling the platform currently
 * offers. The tier itself is derived (migration 0057) from the brain-sourced
 * event_type_registry via MAX(legal_clearance_tier); this module is the pure
 * predicate that reads that cached value.
 *
 * Two properties make the gate non-inert on today's uniformly-tier-1 data:
 *   1. NULL is NEVER selectable. `max_clearance_tier IS NULL` means "no mapped
 *      types / not yet computed" and is DISTINCT from tier 1 — a fail-safe so a
 *      template with no registry mapping cannot be chosen.
 *   2. The ceiling is a CONFIG value (`ALLOWED_MAX_TIER`), never a hardcoded
 *      literal inside the predicate. When registry Phase 2+ types (tier > 1)
 *      are seeded, the gate bites with no code change. template-clearance-
 *      gate.spec.ts proves this with a tier-2 fixture.
 *
 * Launch ceiling rationale: OSE-677/678 — only Phase-1 (tier 1) event types are
 * offered at launch; COPPA/HIPAA (higher tiers) are unavailable by construction.
 */

/**
 * The regulatory clearance ceiling offered at launch. Single source of truth —
 * the predicate never inlines a tier literal. Overridable per-environment via
 * `env.ALLOWED_MAX_TIER` (see {@link resolveAllowedMaxTier}) so raising the
 * ceiling is a config change, not a code change.
 */
export const LAUNCH_MAX_CLEARANCE_TIER = 1;

/**
 * The HARD declined-regime ceiling (OSE-1220 / OCR_STANDARD_declinedRegimes.md).
 * Tiers 4 (HIPAA) and 5 (COPPA) are declined regimes; OSE may never offer them.
 * Unlike {@link LAUNCH_MAX_CLEARANCE_TIER} (a raisable launch default), this is
 * a structural cap: {@link resolveAllowedMaxTier} clamps to it, so no
 * `ALLOWED_MAX_TIER` config value can lift OSE above tier 3. The CCR found the
 * exposure was "one env var away, not one PR away" — this closes the env var.
 */
export const DECLINED_REGIME_MAX_TIER = 3;

/** Env shape carrying the optional operator override. */
export interface ClearanceEnv {
  ALLOWED_MAX_TIER?: string;
}

/**
 * Resolve the effective clearance ceiling from config. Reads
 * `env.ALLOWED_MAX_TIER` when present and valid (positive finite number),
 * else falls back to the launch default. Never throws — bad/absent config
 * fails safe to the most restrictive documented ceiling.
 *
 * OSE-1220: the result is CLAMPED to {@link DECLINED_REGIME_MAX_TIER}. Even a
 * config of `ALLOWED_MAX_TIER=5` resolves to 3 — the declined regimes (HIPAA
 * tier 4, COPPA tier 5) are structurally unreachable through config. A build
 * that sets the value above 3 is additionally rejected by the CI gate
 * (`scripts/guard-declined-regimes.mjs`) so the misconfiguration is loud.
 */
export function resolveAllowedMaxTier(env?: ClearanceEnv): number {
  const raw = env?.ALLOWED_MAX_TIER;
  const n = raw == null || raw === '' ? NaN : Number(raw);
  const resolved = Number.isFinite(n) && n > 0 ? n : LAUNCH_MAX_CLEARANCE_TIER;
  return Math.min(resolved, DECLINED_REGIME_MAX_TIER);
}

/** The single clearance field the gate reads. */
export interface TemplateClearance {
  max_clearance_tier: number | null;
}

/**
 * Selectability allowlist predicate (#5). Returns true iff the template has a
 * computed clearance tier (NOT NULL) that is within the allowed ceiling.
 *
 * @param template          row carrying `max_clearance_tier` (0057 recompute)
 * @param allowedMaxTier    ceiling from {@link resolveAllowedMaxTier}; defaults
 *                          to the launch ceiling. Passed in (not inlined) so the
 *                          gate is provably wired for any ceiling value.
 */
export function isTemplateSelectable(
  template: TemplateClearance,
  allowedMaxTier: number = LAUNCH_MAX_CLEARANCE_TIER
): boolean {
  const tier = template.max_clearance_tier;
  return tier != null && tier <= allowedMaxTier;
}

/**
 * SQL fragment for the selectability rule, for callers that filter in the DB
 * rather than in memory. The ceiling is a bound parameter (`?`), never inlined —
 * keeping the "config not literal" guarantee at the query layer too. Bind
 * `resolveAllowedMaxTier(env)` as the single parameter.
 */
export const SELECTABLE_TEMPLATE_SQL_PREDICATE =
  'max_clearance_tier IS NOT NULL AND max_clearance_tier <= ?';
