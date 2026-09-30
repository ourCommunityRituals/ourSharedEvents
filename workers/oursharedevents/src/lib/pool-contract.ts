/**
 * OurEventRing pool contract — runtime binding for OCR-docs brain.
 *
 * Source of truth: `OCR-docs/ocr-docs-brain/product-registry.yaml` → `ose` entry.
 * This module mirrors that declaration in code so:
 *
 *   1. Brain conformance (`check_brain_contract.py`) can see the dataset names
 *      and required tags referenced in repo code — not just in `.github/`
 *      scripts (which the checker excludes).
 *   2. Handlers writing to BigQuery have a single, typed home for the dataset
 *      routing and the required-tag contract instead of scattering string
 *      literals across the codebase.
 *
 * When the brain declaration changes, this file changes with it — drift is
 * surfaced by the conformance CI check.
 *
 * Propagation note: this template is duplicated (with product-specific values
 * substituted) into every data-contributing OCR app via the propagate-standards
 * workflow. Shape is stable across apps; only `PRODUCT_ID`,
 * `REGULATORY_POOLS`, `BIGQUERY_DATASETS`, and `IDENTITY_LAYER` vary.
 */

/** Product identifier as declared in the brain registry. */
export const PRODUCT_ID = 'ose' as const;

/**
 * Identity layer for this product. Anonymous products must not introduce
 * named-identity coupling (enforced by `check_identity_layer_contract`).
 */
export const IDENTITY_LAYER = 'anonymous' as const;

/**
 * Regulatory pools this product routes writes to. Every entry must have a
 * corresponding dataset in `BIGQUERY_DATASETS`.
 *
 * OSE-1220 (OCR_STANDARD_declinedRegimes.md): OSE routes to `general` ONLY.
 * HIPAA, COPPA and SOPPA are DECLINED regimes (see {@link DECLINED_REGIMES}) —
 * not tiers OSE matures into. This list is a governance layer; it must never
 * carry a declined regime as an active pool. Mirrored in the brain registry
 * (`product-registry.yaml` → ose → regulatory_pools: [general]).
 */
export const REGULATORY_POOLS = ['general'] as const;
export type RegulatoryPool = (typeof REGULATORY_POOLS)[number];

/**
 * Declined regimes — regimes OSE refuses to participate in, per the ratified
 * `OCR_STANDARD_declinedRegimes.md`. NOT tiers on a roadmap; structurally
 * absent from every active governance layer (pool list, dataset map, routing).
 * `phaseToPool` refuses the clearance tiers that would enter them (4=HIPAA,
 * 5=COPPA); SOPPA is never modeled at all. Health-adjacent business is served
 * in `general` by item-tracking — declining HIPAA does not decline hospital
 * business, but OSE handles no PHI and signs no BAA.
 */
export const DECLINED_REGIMES = ['hipaa', 'coppa', 'soppa'] as const;
export type DeclinedRegime = (typeof DECLINED_REGIMES)[number];

/**
 * BigQuery dataset routing per regulatory pool. Names are authoritative —
 * they are the actual GCP dataset identifiers. Brain conformance verifies
 * these strings appear in repo code. Declined-regime datasets
 * (`oureventring_hipaa` / `oureventring_coppa`) are deliberately absent —
 * OSE never writes to them (OSE-1220).
 */
export const BIGQUERY_DATASETS: Record<RegulatoryPool, string> = {
  general: 'oureventring_general',
} as const;

/**
 * Tags required on every write emitted by this product. The conformance check
 * scans repo code for each tag name; absent tags fail CI.
 *
 * Semantics:
 *   - `corridor_id`     — community/geographic corridor the event belongs to
 *   - `venue_id`        — physical or virtual venue identifier
 *   - `event_type`      — category from the OCR event taxonomy
 *   - `uec_code`        — Universal Electronic Code; one of the 11 standard
 *                         QR-code types and their associated colors (see
 *                         `OCR-docs/ocr-docs-brain/event-taxonomy.yaml`)
 *   - `regulatory_pool` — which pool (general|hipaa|coppa) this row routes to
 *   - `product_id`      — originating product (`ose`, `osm`, ...)
 */
export const REQUIRED_TAGS = [
  'corridor_id',
  'venue_id',
  'event_type',
  'uec_code',
  'regulatory_pool',
  'product_id',
] as const;
export type RequiredTag = (typeof REQUIRED_TAGS)[number];

/**
 * Shape of a tag map carrying every required tag. Use this type on any record
 * that will be forwarded to the OurEventRing pipeline.
 */
export type RequiredTagMap = Record<RequiredTag, string>;

/**
 * Thrown when an event's `legal_clearance_tier` cannot be resolved to a known
 * regulatory pool. Callers at the export boundary catch this and WITHHOLD the
 * row (fail closed) rather than leaking it to the least-protected pool.
 */
export class PoolRoutingError extends Error {
  readonly phase: unknown;
  constructor(phase: unknown) {
    super(
      `[pool-contract] refusing legal_clearance_tier=${JSON.stringify(
        phase
      )} — tiers 4 (HIPAA) and 5 (COPPA) are DECLINED regimes and malformed tiers are fail-closed; OSE routes to 'general' only (OSE-1220 / OSE-380 / Invariant #4)`
    );
    this.name = 'PoolRoutingError';
    this.phase = phase;
  }
}

/**
 * Map an event's `legal_clearance_tier` (Phase 1-3 per migration 0023) to the
 * regulatory pool it belongs to:
 *
 *   Phase 1-3 → 'general' (community/recreational, commerce, licensed)
 *   Phase 4   → REFUSED    (HIPAA — declined regime)
 *   Phase 5   → REFUSED    (COPPA — declined regime)
 *
 * OSE-1220 (OCR_STANDARD_declinedRegimes.md): tiers 4 (HIPAA) and 5 (COPPA) are
 * DECLINED regimes. `phaseToPool` REFUSES them — it throws `PoolRoutingError`
 * rather than routing to `oureventring_hipaa` / `oureventring_coppa`. The
 * previous behavior *routed* 4→hipaa / 5→coppa; that made a declined regime one
 * seeded event type away from receiving writes. Refusal makes the decline
 * structural: there is no pool to route to, so the function cannot produce one.
 *
 * FAIL-CLOSED (OSE-380 / Invariant #4). `null`/`undefined` is the documented
 * default meaning Phase 1 (matches the router's `legal_clearance_tier ?? 1`)
 * and maps to 'general'. Any other value — NaN, non-finite, non-integer, or a
 * phase outside 1-3 (which now includes the declined 4 and 5) — THROWS rather
 * than silently falling through to 'general'. A value we cannot classify, and a
 * value that names a declined regime, must never be treated as least-sensitive.
 *
 * Brain conformance verifies the mapping appears in repo code.
 */
export function phaseToPool(phase: number | null | undefined): RegulatoryPool {
  // Documented default: an unset tier means Phase 1 (community/recreational),
  // matching the router's `legal_clearance_tier ?? 1`. Phases 1-3 → general.
  if (phase === null || phase === undefined) return 'general';
  // Tiers 4 (HIPAA) and 5 (COPPA) are declined regimes — refuse, never route.
  // Out-of-range / malformed values are refused for the same fail-closed reason.
  if (!Number.isInteger(phase) || phase < 1 || phase > 3) {
    throw new PoolRoutingError(phase);
  }
  return 'general'; // phases 1-3
}

/**
 * Resolve the target BigQuery dataset for a given regulatory pool.
 * Throws if the pool is not in this product's allowed set — callers are
 * expected to have already validated the pool belongs to the product.
 *
 * OSE-1416: the names in `BIGQUERY_DATASETS` are PRODUCTION datasets, and OER
 * reads them. Staging and production share one GCP project, so a staging run
 * writing the same name would put test events beside real community data.
 * Only `WORKER_ENV === 'production'` gets the bare name; staging gets `_stg`
 * and every other value (development, test, unset) gets `_dev`. Fail closed:
 * an env that is not explicitly production can never resolve a production name.
 * `workerEnv` is required so every caller has to pass it.
 */
export function datasetForPool(pool: RegulatoryPool, workerEnv: string | undefined): string {
  const dataset = BIGQUERY_DATASETS[pool];
  if (!dataset) {
    throw new Error(
      `[pool-contract] unknown regulatory_pool "${pool}" for product_id "${PRODUCT_ID}"`
    );
  }
  if (workerEnv === 'production') return dataset;
  return `${dataset}${workerEnv === 'staging' ? '_stg' : '_dev'}`;
}

/**
 * Assert that a tag map carries every required tag with a non-empty value.
 * Intended for use at pipeline-entry points before emitting to BigQuery.
 */
export function assertRequiredTags(
  tags: Partial<Record<string, string>>
): asserts tags is RequiredTagMap {
  const missing: string[] = [];
  for (const tag of REQUIRED_TAGS) {
    const value = tags[tag];
    if (typeof value !== 'string' || value.length === 0) {
      missing.push(tag);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `[pool-contract] missing required tags for ${PRODUCT_ID}: ${missing.join(', ')}`
    );
  }
}
