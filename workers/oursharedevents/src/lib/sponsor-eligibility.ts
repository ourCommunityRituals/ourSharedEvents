/**
 * Sponsor promotion eligibility reducer (OSE-744 / P1) — pure, zero-I/O.
 *
 * The single decision the promotion seam (`promoteSponsorDraft`) consults to
 * decide whether a covenant-acknowledged draft may become a live sponsor, or is
 * turned away with `402 PAYMENT_REQUIRED`. It composes ordered eligibility
 * SOURCES and returns a boolean admit/deny + which source granted.
 *
 * CRITICAL (Invariant #25 sponsor_share_covenant): eligibility is a boolean
 * admit/deny. It carries **no tier/price/weight** — nothing here can become a
 * dimension `allocateShares()` weights by. Promotion still server-forces the
 * covenant base tier regardless of how eligibility was granted.
 *
 * CRITICAL (Invariant #1 reducer purity): this function performs NO I/O
 * (no D1, no fetch, no logging). Callers gather the source facts, then call it.
 *
 * Fail-closed: any missing/unknown input resolves to NOT eligible.
 */

/** The ordered eligibility sources. Precedence is the array order — first wins. */
export type EligibilitySource = 'free_tier' | 'comp' | 'subscription' | 'store_credit';

/**
 * The source facts the caller resolves (each a plain boolean the reducer never
 * re-derives). `subscription` and `store_credit` are typed `false` stubs until
 * OSE-745 (webhook + ledger) fills them — they exist now so the precedence and
 * the tests are forward-compatible.
 */
export interface EligibilityInputs {
  /** Server-set community-benefit / free-tier grant on the draft (0061). */
  free_tier: boolean;
  /** A verified, brand-bound, single-use comp/prepaid invite claim. */
  comp: boolean;
  /** Active paid rotation subscription. STUB (false) until OSE-745. */
  subscription?: boolean;
  /** Refund store-credit covering this placement. STUB (false) until OSE-745. */
  store_credit?: boolean;
}

export type EligibilityResult =
  { eligible: true; source: EligibilitySource } | { eligible: false; source: null };

/** Fixed precedence — first truthy source wins. */
const PRECEDENCE: readonly EligibilitySource[] = [
  'free_tier',
  'comp',
  'subscription',
  'store_credit',
];

/**
 * Resolve promotion eligibility. Pure + deterministic + fail-closed.
 * Unknown/extra keys on the input are ignored (forward-compat for OSE-745).
 */
export function resolveSponsorEligibility(inputs: EligibilityInputs): EligibilityResult {
  const facts: Record<EligibilitySource, boolean> = {
    free_tier: inputs.free_tier === true,
    comp: inputs.comp === true,
    subscription: inputs.subscription === true,
    store_credit: inputs.store_credit === true,
  };
  for (const source of PRECEDENCE) {
    if (facts[source]) return { eligible: true, source };
  }
  return { eligible: false, source: null };
}
