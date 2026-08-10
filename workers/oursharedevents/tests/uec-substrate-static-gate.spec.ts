/**
 * OSE-322 — UEC Substrate Static Gate (architectural invariant)
 *
 * Fails the build if any source file in `workers/oursharedevents/src/`
 * contains a UEC hex literal OUTSIDE the canonical home at
 * `src/lib/uec/`. The brand promise — "the color IS the instruction" —
 * collapses if hex values leak into handler / page / route code; the
 * consumed copy at `src/lib/uec/uec-codes.ts` and the single lookup
 * surface at `src/lib/uec/index.ts` (`getCode()`, `allCodes()`, ...)
 * must be the ONLY paths through which UEC values enter the runtime.
 *
 * What this catches that other gates don't:
 *   - A future contributor (human OR agent) pasting a brain hex like
 *     `#1A3A8A` (SPONSOR blue) directly into a handler / page / template
 *     instead of calling `getCode('sponsor').scan_hex`. Coincidentally-
 *     correct hex is still a violation — only the identifier-based
 *     pattern passes intent (per OSE-321 implementation clarity note).
 *
 * What this does NOT catch (deferred):
 *   - Brain↔substrate parity drift (OSE-323 drift check is the
 *     mechanism — compares OSE consumed copy against brain canonical)
 *   - Computational WCAG contrast (OSE-324 brain-side gate, already
 *     enforcing as of 2026-05-18 — see ocr-docs-brain/tests/level3_unit.py)
 *
 * Scoping strategy per OSE-322 AC: simple+broad. Scans every .ts source
 * under `src/` (already collected by vitest config into
 * TEST_SOURCE_FILES_JSON), skipping the canonical-home `src/lib/uec/`
 * directory. AST/import-based scoping was considered (per the story's
 * scoping-strategy options) but rejected: today's src/ has zero UEC
 * hex literals (verified pre-PR via grep) — broad-scope adds zero false
 * positives and catches future drift wherever it might appear, not
 * just in QR-named files. CSS / theme files don't exist in this Worker
 * surface; if they're ever added, EXEMPT_PATH_PREFIXES is the hook.
 *
 * Canonical hex set is derived from `src/lib/uec/uec-codes.ts` (the
 * brain consumed copy) at test runtime — never hardcoded here.
 *
 * Per OCR_STANDARD_perStoryTestPyramid: brain-contract architecture
 * gate carries no layer qualifier (UNIT bucket — pure-string static
 * check, runs in <1s).
 *
 * Pattern reference: `tests/architecture.spec.ts` (OSE-205 Invariant #1
 * Anonymous ID gate). Same idioms — TEST_SOURCE_FILES_JSON iteration,
 * Windows backslash normalization, vacuous-pass protection.
 */

import { env as tenvRaw } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { CODES } from '../src/lib/uec';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}

const tenv = () => tenvRaw as unknown as TestEnv;

/** Windows backslash → forward slash (runners are Windows; vitest emits OS-native paths). */
const norm = (p: string) => p.replace(/\\/g, '/');

/**
 * Paths exempted from the gate. Today this is just the canonical home
 * (where UEC hex values legitimately live). Future surfaces that
 * legitimately carry hex (CSS theme tokens, design-system files) can
 * append here with a comment explaining the carve-out.
 */
const EXEMPT_PATH_PREFIXES: ReadonlyArray<string> = [
  'src/lib/uec/', // canonical home — UEC values flow OUT from here only
  '/tests/',      // test files legitimately reference hex literals for assertion purposes
] as const;

/** A violation finding — file, line number, offending hex literal. */
interface Violation {
  path: string;
  line: number;
  hex: string;
  context: string; // the trimmed source line for diagnostic output
}

/**
 * Pure detection function. Exported indirectly for the synthetic
 * positive test that proves the gate fires on a deliberately bad input.
 *
 * @param sources  the source-file dict (path → content)
 * @param uecHexes the canonical set of UEC hex values to flag
 * @param exempt   path prefixes to skip (canonical homes / theme files)
 * @returns        every (path, line, hex, context) triple found
 */
export function findUecHexViolations(
  sources: Record<string, string>,
  uecHexes: ReadonlyArray<string>,
  exempt: ReadonlyArray<string> = EXEMPT_PATH_PREFIXES
): Violation[] {
  const violations: Violation[] = [];
  // Build a case-insensitive regex once. Hex literals are 6-digit; we match
  // them case-insensitively because '#1A6B2F' and '#1a6b2f' are the same
  // color and CI must catch both. Word boundary on left to avoid matching
  // hex substrings inside other identifiers.
  const hexSet = new Set(uecHexes.map((h) => h.toUpperCase()));
  for (const [rawPath, content] of Object.entries(sources)) {
    const path = norm(rawPath);
    // Skip exempt paths (canonical homes etc.)
    if (exempt.some((prefix) => path.includes(prefix))) continue;
    // Line-by-line scan so violations carry an accurate line number
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Quick fail-fast — most lines have no '#' at all
      if (!line.includes('#')) continue;
      // Match every 6-digit hex literal in the line
      const matches = line.match(/#[0-9a-fA-F]{6}\b/g);
      if (!matches) continue;
      for (const match of matches) {
        if (hexSet.has(match.toUpperCase())) {
          violations.push({
            path,
            line: i + 1, // 1-indexed for human-readable error output
            hex: match,
            context: line.trim().slice(0, 120),
          });
        }
      }
    }
  }
  return violations;
}

// ─────────────────────────────────────────────────────────────────────────────
// Derive the canonical UEC hex set from the consumed copy. NEVER hardcode —
// when brain corrects hex values (OSE-324 pattern), this set updates
// automatically as soon as uec-codes.ts mirrors the brain.
// ─────────────────────────────────────────────────────────────────────────────
const UEC_CANONICAL_HEXES: ReadonlyArray<string> = Array.from(
  new Set([...CODES.map((c) => c.scan_hex), ...CODES.map((c) => c.display_hex)])
);

describe('OSE-322 — UEC substrate static gate', () => {
  test('OSE-322 | canonical UEC hex set | derived from CODES, non-empty, all valid #RRGGBB', () => {
    // Vacuous-pass guard — if CODES is empty for any reason, the gate
    // would trivially pass. Assert the set is the size we expect (11 codes
    // × 2 palettes = up to 22 unique; in practice ~18 unique because some
    // codes have scan_hex == display_hex).
    expect(UEC_CANONICAL_HEXES.length).toBeGreaterThan(10);
    for (const hex of UEC_CANONICAL_HEXES) {
      expect(hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  test('OSE-322 | sources dict | TEST_SOURCE_FILES_JSON contains the worker entry + at least one handler', () => {
    // Second vacuous-pass guard — confirm we're actually scanning files.
    const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
    const paths = Object.keys(sources).map(norm);
    expect(paths.some((p) => p.endsWith('src/index.ts'))).toBe(true);
    expect(paths.some((p) => p.includes('src/handlers/'))).toBe(true);
    expect(paths.some((p) => p.includes('src/lib/uec/'))).toBe(true);
  });

  test('OSE-322 | exempt paths | src/lib/uec/ is exempted (canonical home)', () => {
    // Exemption logic must hold — otherwise the canonical home would
    // self-flag and the gate would always fail.
    expect(EXEMPT_PATH_PREFIXES).toContain('src/lib/uec/');
  });

  test('OSE-322 | src/ outside src/lib/uec/ | zero UEC hex literals (the gate)', () => {
    const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
    const violations = findUecHexViolations(sources, UEC_CANONICAL_HEXES);
    if (violations.length > 0) {
      // Build a readable error message so CI output is actionable.
      const summary = violations
        .map((v) => `  • ${v.path}:${v.line}  hex=${v.hex}\n      ${v.context}`)
        .join('\n');
      throw new Error(
        `OSE-322 substrate static gate FAILED — ${violations.length} UEC hex literal(s) found outside src/lib/uec/:\n${summary}\n\n` +
          `Fix: replace the literal hex with a call to getCode('<id>').scan_hex (or display_hex). ` +
          `The brand promise "the color IS the instruction" requires UEC values to flow ONLY through src/lib/uec/. ` +
          `See ADR-012 + brain Invariant #3 (uec_encoding) for the contract.`
      );
    }
    expect(violations).toEqual([]);
  });
});

describe('OSE-322 — UEC substrate static gate (detector unit tests)', () => {
  // Synthetic positive tests that prove the detector fires on bad inputs
  // WITHOUT requiring us to commit a real violation to src/.
  test('OSE-322 | detector | flags SPONSOR scan_hex in a handler file', () => {
    const fakeSources = {
      'src/handlers/sponsor-card.ts':
        'export const c = "#1A3A8A"; // SPONSOR blue — a forbidden literal',
    };
    const violations = findUecHexViolations(fakeSources, ['#1A3A8A']);
    expect(violations).toHaveLength(1);
    expect(violations[0].path).toBe('src/handlers/sponsor-card.ts');
    expect(violations[0].line).toBe(1);
    expect(violations[0].hex).toBe('#1A3A8A');
  });

  test('OSE-322 | detector | EXEMPTS src/lib/uec/ canonical home', () => {
    const fakeSources = {
      'src/lib/uec/uec-codes.ts': 'export const ENTER_HEX = "#1A6B2F";',
    };
    const violations = findUecHexViolations(fakeSources, ['#1A6B2F']);
    expect(violations).toEqual([]);
  });

  test('OSE-322 | detector | matches case-insensitively (#1a6b2f same as #1A6B2F)', () => {
    const fakeSources = {
      'src/handlers/x.ts': 'const c = "#1a6b2f"; // lowercase ENTER',
    };
    const violations = findUecHexViolations(fakeSources, ['#1A6B2F']);
    expect(violations).toHaveLength(1);
    expect(violations[0].hex).toBe('#1a6b2f');
  });

  test('OSE-322 | detector | accurate line numbers (1-indexed) for diagnostics', () => {
    const fakeSources = {
      'src/handlers/multi.ts': [
        'export const a = 1;',
        'export const b = 2;',
        'export const c = "#1A6B2F"; // line 3',
        'export const d = 4;',
      ].join('\n'),
    };
    const violations = findUecHexViolations(fakeSources, ['#1A6B2F']);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(3);
  });

  test('OSE-322 | detector | flags MULTIPLE hex literals in a single file', () => {
    const fakeSources = {
      'src/handlers/bad.ts': [
        'export const sponsor = "#1A3A8A";',
        'export const enter = "#1A6B2F";',
      ].join('\n'),
    };
    const violations = findUecHexViolations(fakeSources, ['#1A3A8A', '#1A6B2F']);
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.hex).sort()).toEqual(['#1A3A8A', '#1A6B2F']);
  });

  test('OSE-322 | detector | IGNORES non-UEC hex literals (e.g., #FFFFFF white)', () => {
    const fakeSources = {
      'src/handlers/styling.ts': 'export const bg = "#FFFFFF"; const fg = "#000000";',
    };
    // Empty hex set → nothing flagged even though the file has hex literals
    const violations = findUecHexViolations(fakeSources, []);
    expect(violations).toEqual([]);
  });

  test('OSE-322 | detector | handles Windows backslash paths correctly (exemption still applies)', () => {
    // vitest config emits OS-native paths; on Bloodraven (Windows) that's
    // backslash-separated. Confirm exemption applies via norm().
    const fakeSources = {
      'src\\lib\\uec\\uec-codes.ts': 'export const X = "#1A6B2F";',
    };
    const violations = findUecHexViolations(fakeSources, ['#1A6B2F']);
    expect(violations).toEqual([]);
  });

  test('OSE-322 | detector | handles CRLF line endings (Windows-style)', () => {
    const fakeSources = {
      'src/handlers/crlf.ts': 'line1\r\nconst c = "#1A6B2F";\r\nline3',
    };
    const violations = findUecHexViolations(fakeSources, ['#1A6B2F']);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(2);
  });
});
