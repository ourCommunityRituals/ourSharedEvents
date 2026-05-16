/**
 * OSE-307 regression guard for the e2e flow test infrastructure.
 *
 * Locks the wiring so a future change can't accidentally orphan the
 * shared mobile-workability assertion helper or remove the OSE-307
 * provenance trace from a flow spec.
 *
 * Six preconditions asserted:
 *   1. The shared helper exists at expected path
 *   2. Helper exports the five contract-assertion functions + the
 *      bundled `assertMobileWorkable` + `loadAndSettle` + `settle`
 *   3. Helper implements the OCR-42 inline-text-link exemption
 *      (consistent with audit spec — OSE-301 / OSE-305)
 *   4. Helper applies Math.round() precision to touch-target comparisons
 *      (OCR-42 contract 2 refinement)
 *   5. At least one flow spec exists at `tests/playwright/flow-*.spec.ts`
 *      and imports from the shared helper
 *   6. Each flow spec references OSE-307 in change comments (provenance
 *      trace)
 *
 * Lives under tests/unit/ (root-level Node vitest with native fs access).
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const HELPER_PATH = join(
  process.cwd(),
  'tests',
  'playwright',
  '_helpers',
  'mobile-workability-assertions.ts'
);
const FLOW_DIR = join(process.cwd(), 'tests', 'playwright');

function readHelper(): string {
  return readFileSync(HELPER_PATH, 'utf8');
}

function listFlowSpecs(): string[] {
  return readdirSync(FLOW_DIR)
    .filter((f) => f.startsWith('flow-') && f.endsWith('.spec.ts'))
    .map((f) => join(FLOW_DIR, f));
}

describe('OSE-307 e2e flow test infrastructure — regression guard', () => {
  test('shared helper exists at tests/playwright/_helpers/mobile-workability-assertions.ts', () => {
    expect(existsSync(HELPER_PATH), `helper missing at ${HELPER_PATH}`).toBe(true);
  });

  test('helper exports the five contract assertions + bundled assertMobileWorkable + loadAndSettle/settle', () => {
    const src = readHelper();
    const expectedExports = [
      'assertNoHorizontalScroll',
      'assertTouchTargetsClean',
      'assertInputFontSize',
      'assertPrimaryCTAAboveFold',
      'assertViewportAllowsPinchZoom',
      'assertMobileWorkable',
      'loadAndSettle',
      'settle',
    ];
    for (const name of expectedExports) {
      expect(src, `helper missing export: ${name}`).toMatch(
        new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`)
      );
    }
  });

  test('helper implements OCR-42 inline-text-link exemption (same as audit spec)', () => {
    const src = readHelper();
    expect(src).toMatch(/display\s*(===|!==)\s*['"]inline['"]/);
    expect(src).toContain('textFlowParents');
    for (const tag of ['p', 'li', 'dt', 'dd', 'span', 'em', 'strong', 'label']) {
      expect(src, `helper inline-text exemption set missing '${tag}'`).toMatch(
        new RegExp(`['"]${tag}['"]`)
      );
    }
  });

  test('helper applies Math.round() precision to touch-target dimensions (OCR-42)', () => {
    const src = readHelper();
    expect(src).toMatch(/Math\.round\(box\.width\)/);
    expect(src).toMatch(/Math\.round\(box\.height\)/);
  });

  test('at least one flow spec exists and imports the shared helper (OR carries @contract-flow-no-ui exemption)', () => {
    // OSE-312: contract-only flow specs (e.g., the shortlink resolver
    // which is a 302 redirector + JSON 404 — no DOM to measure) carry
    // an explicit `@contract-flow-no-ui` JSDoc marker indicating the
    // OSE-307 helper isn't applicable. The regression guard honors
    // this exemption rather than forcing a vestigial import.
    const flowSpecs = listFlowSpecs();
    expect(
      flowSpecs.length,
      'no tests/playwright/flow-*.spec.ts files found — the flow-test arc has no flow specs yet'
    ).toBeGreaterThan(0);
    for (const specPath of flowSpecs) {
      const src = readFileSync(specPath, 'utf8');
      if (src.includes('@contract-flow-no-ui')) {
        // Exempt: the spec explicitly declares it has no UI to measure.
        // Sanity-check it doesn't ALSO import the helper (that'd be
        // contradictory + dead-import noise).
        expect(
          src,
          `${specPath}: marked @contract-flow-no-ui but ALSO imports the helper — pick one`
        ).not.toMatch(/from\s+['"]\.\/_helpers\/mobile-workability-assertions['"]/);
        continue;
      }
      expect(
        src,
        `${specPath}: does not import from _helpers/mobile-workability-assertions (add the import OR mark the file @contract-flow-no-ui)`
      ).toMatch(/from\s+['"]\.\/_helpers\/mobile-workability-assertions['"]/);
    }
  });

  test('every flow spec references OSE-307 in change comments (provenance trace)', () => {
    const flowSpecs = listFlowSpecs();
    for (const specPath of flowSpecs) {
      const src = readFileSync(specPath, 'utf8');
      expect(src, `${specPath}: missing OSE-307 reference — provenance trace lost`).toContain(
        'OSE-307'
      );
    }
  });
});
