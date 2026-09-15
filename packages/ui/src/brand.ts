/**
 * @ocr/ui — White-label token designation (OSE-1328 / white-label ADR)
 *
 * A brand may override only DESIGNATED-CUSTOMIZABLE semantic tokens, via a Tier-3
 * `[data-brand="x"]` block fed by the OSM pipeline (intake → processor → batch
 * OSM API, OCR-employees-only via Bruno). LOCKED tokens — the colorblind-safe +
 * status semantics — can NEVER be brand-overridden, so a white-label instance
 * can't quietly break the accessibility/meaning guarantees.
 *
 * Every semantic token must be in exactly one set (completeness is gated by
 * tests/brand.test.ts against semanticDark) — a new token can't go un-designated.
 */

/** Brand may re-map these (their own palette + surfaces). */
export const BRAND_CUSTOMIZABLE = [
  '--accent',
  '--accent-hover',
  '--bg',
  '--surface',
  '--surface-hover',
  '--border',
  '--text',
  '--text-muted',
] as const;

/** Never brand-overridden — colorblind-safe + status semantics stay fixed. */
export const BRAND_LOCKED = [
  '--danger',
  '--danger-hover',
  '--error',
  '--live',
  '--live-hover',
  '--warn',
  '--info',
] as const;

export type CustomizableToken = (typeof BRAND_CUSTOMIZABLE)[number];

/** Every semantic token, classified customizable | locked. */
export const DESIGNATION: Record<string, 'customizable' | 'locked'> = {
  ...Object.fromEntries(BRAND_CUSTOMIZABLE.map((t) => [t, 'customizable' as const])),
  ...Object.fromEntries(BRAND_LOCKED.map((t) => [t, 'locked' as const])),
};

export interface BrandOverrideViolation {
  token: string;
  reason: 'locked' | 'unknown';
}

/**
 * Validate a brand override set (the token→value pairs an OSM `[data-brand]`
 * block would set). Returns a violation for any token that is LOCKED or unknown —
 * only designated-customizable tokens may be branded. An empty array = the set
 * is safe to emit. The OSM processor MUST run this before producing a brand block.
 */
export function validateBrandOverride(overrides: Record<string, string>): BrandOverrideViolation[] {
  const violations: BrandOverrideViolation[] = [];
  for (const token of Object.keys(overrides)) {
    const designation = DESIGNATION[token];
    if (designation === undefined) violations.push({ token, reason: 'unknown' });
    else if (designation === 'locked') violations.push({ token, reason: 'locked' });
  }
  return violations;
}
