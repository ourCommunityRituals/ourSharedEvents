/**
 * OSE-325 — UEC canonical-code fixtures.
 *
 * Re-exports the OSE consumed UEC artifact (src/lib/uec) with curated
 * views convenient for tests. Fixtures derive from the typed CODES
 * array — never hardcoded — so v1.2 (and beyond) automatically flow
 * through. The drift check (OSE-323) ensures the consumed copy stays
 * byte-equivalent with brain canonical, so these fixtures stay
 * canonical-truth too.
 *
 * Design principles (per OSE-325 AC):
 *   • Survive UEC version bumps (v1.2 must not break v1.1 fixtures)
 *   • Typed (TypeScript) — fixture shape changes are caught at tsc time
 *   • Small, single-purpose, composable
 *   • Documented inline + in fixtures/uec/README.md
 */

import { CODES, type UECCode, type WcagGrade } from '../../../src/lib/uec';

/** All 11 canonical UEC codes — full metadata, brain-equivalent at data level. */
export const ALL_CODES = CODES;

/** The 7 core codes (01-07) — present in every event vertical. */
export const CORE_CODES: ReadonlyArray<UECCode> = CODES.filter((c) => !c.extension_priority);

/** The 4 extension codes (08-11) — vertical-scoped + carry extension_priority. */
export const EXTENSION_CODES: ReadonlyArray<UECCode> = CODES.filter((c) => !!c.extension_priority);

/**
 * Codes carrying the requires_alt_print carve-out (added OSE-324, 2026-05-18).
 * Today: just ALERT yellow (#B8960A computes 2.84:1 on white, below AA).
 * Tests that exercise the alt-print path should iterate this list, not
 * hardcode 'ALERT' so future additions (if any) are covered automatically.
 */
export const ALT_PRINT_CODES: ReadonlyArray<UECCode> = CODES.filter(
  (c) => c.requires_alt_print === true
);

/** Codes by WCAG grade — useful for parameterized contrast tests. */
export const CODES_BY_GRADE: Readonly<Record<WcagGrade, ReadonlyArray<UECCode>>> = {
  AAA: CODES.filter((c) => c.wcag_grade === 'AAA'),
  AA: CODES.filter((c) => c.wcag_grade === 'AA'),
};

/**
 * Get a code by id with a thrown-error guarantee — useful in test setup
 * where a missing code is a test-author bug, not a runtime concern.
 * Tests calling this can `getCanonical('ENTER').scan_hex` safely without
 * null-check noise.
 */
export function getCanonical(id: string): UECCode {
  const code = CODES.find((c) => c.id === id);
  if (!code) {
    throw new Error(
      `[fixtures/uec] No canonical code with id="${id}". ` +
        `Valid ids: ${CODES.map((c) => c.id).join(', ')}.`
    );
  }
  return code;
}

/** Convenience: the canonical ENTER code (most-used in tests). */
export const ENTER = getCanonical('ENTER');
/** Convenience: the canonical SPONSOR code (the load-bearing revenue pixel). */
export const SPONSOR = getCanonical('SPONSOR');
/** Convenience: the canonical LIVE code (peak-event pattern). */
export const LIVE = getCanonical('LIVE');
/** Convenience: the canonical ALERT code (the requires_alt_print carve-out). */
export const ALERT = getCanonical('ALERT');
