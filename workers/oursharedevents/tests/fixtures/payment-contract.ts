/**
 * OSE-743 (P0) — Frozen payment contract seam.
 *
 * P0 collects sponsor money OUT OF BAND (Stripe Payment Links + Wave invoices),
 * with ZERO code on the money path — nothing in `src/` charges, and no processor
 * dependency is added. This module freezes the small set of constants the future
 * AUTOMATED path (P1 eligibility gate, P2 webhook) must reuse verbatim, so the
 * manual flow and the automated flow agree by construction rather than by luck.
 *
 * INVARIANT #25 (sponsor_share_covenant): the ONLY purchasable dimension is
 * rotation FREQUENCY. Size, slot, placement, and tier are NON-purchasable and
 * must NEVER travel on a payment record into `allocateShares()` (WALL 3 in
 * src/lib/sponsor-allocation.ts). This module names those forbidden dimensions
 * so the ops guard can assert they never leak onto a payment artifact.
 *
 * INVARIANT #9 (tenant_isolation): a payment binds to a brand via a single
 * metadata key, frozen here so P0's manual links and P2's webhook read the same
 * field.
 *
 * This file lives under tests/ (never src/) so it can never be mistaken for a
 * live money-path module by the #6 monetization-inert scan.
 */

/** The payment-record metadata key that binds a payment to a brand (#9). */
export const BRAND_ID_METADATA_KEY = 'brand_id';

/** The ONLY purchasable dimension — the sole input `allocateShares()` consumes (#25 / WALL 3). */
export const PURCHASABLE_DIMENSION = 'rotation_frequency';

/**
 * Rotation-frequency tiers a sponsor may purchase. In P0 each maps 1:1 to a
 * Stripe Payment Link; in P2 each maps to a Price. Ordering is presentation-only
 * and carries NO placement/size weight — placement is uniform (#25).
 */
export const FREQUENCY_TIERS = ['standard', 'frequent', 'headline'] as const;
export type FrequencyTier = (typeof FREQUENCY_TIERS)[number];

/**
 * NON-purchasable dimensions. None of these may ever appear as a metadata key on
 * a payment record — if one reaches the allocation path the #25 wall is breached.
 * The ops guard asserts the manifest carries none of them (born-red TL-059).
 */
export const FORBIDDEN_PURCHASE_DIMENSIONS = [
  'price',
  'amount',
  'tier',
  'sov_tier',
  'slot',
  'size',
  'placement',
  'weight',
  'position',
  'priority',
] as const;

/**
 * Key patterns that would constitute PII on an ops artifact (bounded-PII #8).
 * The ops manifest is committed to the repo; it must carry brand ids and
 * non-secret link references only — never a person, contact, or secret. The ops
 * guard asserts no manifest key matches these (born-red TL-060).
 */
export const PII_KEY_PATTERNS: readonly RegExp[] = [
  /email/i,
  /phone/i,
  /\bip\b/i,
  /ip_address/i,
  /anon(ymous)?_id/i,
  /full.?name/i,
  /first.?name/i,
  /last.?name/i,
  /contact/i,
  /address/i,
  /\bcard\b/i,
  /\bpan\b/i,
  /secret/i,
  /\btoken\b/i,
] as const;
