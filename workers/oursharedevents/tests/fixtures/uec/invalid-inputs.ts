/**
 * OSE-325 — UEC invalid-input fixtures.
 *
 * Inputs that the UEC layer MUST refuse with a friendly error response.
 * Use these in parameterized refusal tests:
 *
 *   for (const input of MISSING_INPUTS) {
 *     test(`refuses missing: ${input}`, async () => {
 *       const res = await SELF.fetch(`/api/v2/uec/resolve?code=${input}`);
 *       assertRefusalResponse(res, 'MISSING_CODE');
 *     });
 *   }
 *
 * Categories:
 *   • MISSING_INPUTS — null/undefined/empty/whitespace-only
 *   • NON_CANONICAL_INPUTS — well-formed strings that aren't canonical
 *   • NON_STRING_INPUTS — type-violation inputs (test the getCode null-safe path)
 *   • MALFORMED_HEX — bad-shape hex strings (for future hex-validation tests)
 */

/** Inputs that resolve to MISSING_CODE refusal (after server-side trim). */
export const MISSING_INPUTS: ReadonlyArray<string> = [
  '', // empty string
  ' ', // single space
  '   ', // multiple spaces
  '\t', // tab
  '\n', // newline
  '\t\n  ', // mixed whitespace
] as const;

/** Inputs that resolve to INVALID_CODE refusal (well-formed but unknown). */
export const NON_CANONICAL_INPUTS: ReadonlyArray<string> = [
  'xyz',
  'VIOLET', // valid color word, not in palette
  'MAGENTA',
  'orange', // intentionally — orange was removed in v1.0→v1.1 (replaced by coral/LIVE)
  'gold', // formerly considered, not adopted
  'foo bar', // multi-word non-canonical
  'enter-sponsor', // hyphenated combo of two real ids — must still refuse
] as const;

/**
 * Inputs that violate the string type. The UEC `getCode()` helper accepts
 * `unknown` and returns null on non-string — these fixtures exercise that
 * defensive path. Tests cast through `as any` deliberately (lint-suppressed).
 */
export const NON_STRING_INPUTS: ReadonlyArray<unknown> = [
  null,
  undefined,
  42,
  0,
  true,
  false,
  {},
  [],
  ['ENTER'], // array containing a valid id is still not a string
  { id: 'ENTER' }, // object with valid id is still not a string
] as const;

/**
 * Malformed hex strings — not used today (the UEC API takes ids/labels,
 * not raw hex), but reserved for future hex-validation tests if/when a
 * surface accepts raw hex input. Catches: wrong length, missing #,
 * non-hex chars, mixed-case ambiguity.
 */
export const MALFORMED_HEX: ReadonlyArray<string> = [
  '1A6B2F', // missing #
  '#1A6B2', // 5 chars, not 6
  '#1A6B2FF', // 7 chars, not 6
  '#XYZ123', // non-hex chars
  '#', // just the hash
  '##FFFFFF', // double hash
  '0x1A6B2F', // 0x-prefixed (JS hex literal form, not CSS)
  'rgb(26, 107, 47)', // RGB function form
] as const;
