/**
 * OSE-325 — UEC edge-case input fixtures.
 *
 * Inputs that LOOK like they might fail but actually MUST resolve cleanly
 * to their canonical code — case variations, whitespace tolerance, multi-
 * word labels. These are the inputs that surfaced from real human usage
 * and are encoded in the UEC v1.1 contract as MUST-accept.
 *
 * Use in parameterized happy-path tests:
 *
 *   for (const { input, expectedId } of CASE_VARIATIONS) {
 *     test(`${input} → ${expectedId}`, () => {
 *       expect(getCode(input)?.id).toBe(expectedId);
 *     });
 *   }
 */

export interface EdgeCaseInput {
  input: string;
  expectedId: string;
  why: string;
}

/** Case insensitivity — every code resolvable by id in any case. */
export const CASE_VARIATIONS: ReadonlyArray<EdgeCaseInput> = [
  { input: 'ENTER', expectedId: 'ENTER', why: 'canonical uppercase id (baseline)' },
  { input: 'enter', expectedId: 'ENTER', why: 'lowercase id' },
  { input: 'Enter', expectedId: 'ENTER', why: 'titlecase id' },
  { input: 'EnTeR', expectedId: 'ENTER', why: 'mixed-case id' },
  { input: 'GREEN', expectedId: 'ENTER', why: 'uppercase label (label-lookup case)' },
  { input: 'green', expectedId: 'ENTER', why: 'lowercase label — the OSE-320 AC example' },
  { input: 'Green', expectedId: 'ENTER', why: 'titlecase label' },
  { input: 'SPONSOR', expectedId: 'SPONSOR', why: 'sponsor uppercase id' },
  { input: 'blue', expectedId: 'SPONSOR', why: 'sponsor lowercase label' },
  { input: 'Coral', expectedId: 'LIVE', why: 'LIVE coral via label' },
  { input: 'CORAL', expectedId: 'LIVE', why: 'LIVE coral uppercase label' },
] as const;

/** Whitespace tolerance — leading/trailing/embedded whitespace stripped. */
export const WHITESPACE_VARIATIONS: ReadonlyArray<EdgeCaseInput> = [
  { input: ' green ', expectedId: 'ENTER', why: 'leading + trailing single space' },
  { input: '  SPONSOR  ', expectedId: 'SPONSOR', why: 'leading + trailing double space' },
  { input: '\tENTER\n', expectedId: 'ENTER', why: 'leading tab + trailing newline' },
  { input: '\n\tgreen\t\n', expectedId: 'ENTER', why: 'mixed whitespace padding' },
  { input: ' check-in ', expectedId: 'CHECK-IN', why: 'padded hyphenated id' },
] as const;

/** Multi-word labels — must resolve as the whole phrase, not just the first word. */
export const MULTI_WORD_LABELS: ReadonlyArray<EdgeCaseInput> = [
  { input: 'Dark Teal', expectedId: 'SHOP', why: 'space-separated multi-word label' },
  { input: 'dark teal', expectedId: 'SHOP', why: 'lowercase multi-word label' },
  { input: 'DARK TEAL', expectedId: 'SHOP', why: 'uppercase multi-word label' },
] as const;

/** Hyphenated ids (CHECK-IN) — must resolve as the whole id, hyphen preserved. */
export const HYPHENATED_IDS: ReadonlyArray<EdgeCaseInput> = [
  { input: 'CHECK-IN', expectedId: 'CHECK-IN', why: 'canonical hyphenated id' },
  { input: 'check-in', expectedId: 'CHECK-IN', why: 'lowercase hyphenated id' },
  { input: 'Check-In', expectedId: 'CHECK-IN', why: 'titlecase hyphenated id' },
];

/** Union of all edge-case variations — for sweeping tests. */
export const ALL_EDGE_CASES: ReadonlyArray<EdgeCaseInput> = [
  ...CASE_VARIATIONS,
  ...WHITESPACE_VARIATIONS,
  ...MULTI_WORD_LABELS,
  ...HYPHENATED_IDS,
];
