/**
 * OSE-323 — UEC Drift Check (brain ↔ OSE consumed copy parity gate)
 *
 * Compares the OSE consumed copy at `src/lib/uec/uec-codes.ts` (loaded
 * as typed CODES) against the brain canonical artifact at
 * `OCR-docs/ocr-docs-brain/uec-codes.yaml` (loaded by vitest config and
 * injected as TEST_BRAIN_UEC_JSON). Fails CI on any drift at the data
 * level. Closes the final enforcement gap of the UEC arc:
 *
 *   OSE-318 ✓ Brain canonical exists
 *   OSE-319 ✓ Invariant registered (rich form)
 *   OSE-320 ✓ OSE consumes brain via typed module
 *   OSE-322 ✓ No hex literals outside canonical home (static gate)
 *   OSE-324 ✓ WCAG contrast computed against declared grade (brain-side)
 *   OSE-323 ✓ THIS — brain↔OSE byte-equivalence at data level
 *
 * Drift always resolves toward brain (brain is canonical, OSE is consumer).
 * Failure messages always say "update OSE to match brain — never the
 * reverse." Per ADR-012 (build-time consumption, manually-synced TS module).
 *
 * Strategy:
 *   - Loaded at vitest config time via `js-yaml`; injected as a
 *     JSON-stringified env binding (TEST_BRAIN_UEC_JSON)
 *   - Local dev: if brain not available (OCR-docs not cloned as sibling),
 *     the test SKIPS with a clear "drift check skipped; CI will catch"
 *     message — developers aren't blocked
 *   - CI: workflow checkout step ALWAYS makes brain available; the skip
 *     path never triggers in CI
 *
 * Per OCR_STANDARD_perStoryTestPyramid: brain-conformance architecture
 * gate carries no layer qualifier (UNIT bucket — pure data comparison,
 * runs in <100ms).
 *
 * Pattern reference: tests/uec-substrate-static-gate.spec.ts (OSE-322).
 */

import { env as tenvRaw } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { CODES, VERSION, VERTICALS } from '../src/lib/uec';
import type { UECCode } from '../src/lib/uec';

interface TestEnv {
  TEST_BRAIN_UEC_JSON: string;
}

const tenv = () => tenvRaw as unknown as TestEnv;

/**
 * Shape of the brain UEC artifact as parsed from uec-codes.yaml. We only
 * model the fields OSE consumes — brain-side enrichment (rationale,
 * data_generated, depends_on, etc.) is deliberately not compared because
 * the OSE consumed copy doesn't carry it.
 */
interface BrainUecCode {
  id: string;
  num: string;
  label: string;
  scan_hex: string;
  display_hex: string;
  semantics: string;
  description: string;
  url_path: string;
  phase: string;
  verticals: ReadonlyArray<string>;
  status: string;
  wcag_grade: string;
  extension_priority?: string;
  requires_alt_print?: boolean;
  // brain-side-only fields (NOT compared):
  rationale?: unknown;
  data_generated?: unknown;
  depends_on?: unknown;
}

interface BrainUecArtifact {
  schema_version?: string;
  version: string;
  verticals: ReadonlyArray<string>;
  codes: ReadonlyArray<BrainUecCode>;
  // brain-side-only fields (NOT compared):
  description?: unknown;
  provenance?: unknown;
  palette_usage?: unknown;
  changelog?: unknown;
  notes?: unknown;
}

/** Fields compared per code. Anything outside this list is brain-only or OSE-only and intentionally not compared. */
const COMPARED_FIELDS: ReadonlyArray<keyof UECCode> = [
  'id',
  'num',
  'label',
  'scan_hex',
  'display_hex',
  'semantics',
  'description',
  'url_path',
  'phase',
  'status',
  'wcag_grade',
] as const;

/** A drift finding — what differs between brain and OSE, with explicit direction. */
interface DriftFinding {
  scope: 'top-level' | string; // 'top-level' OR a code id like 'ENTER'
  field: string;
  brain_value: unknown;
  ose_value: unknown;
}

/**
 * Pure detection function. Exported indirectly so the synthetic positive
 * test can call it with fabricated inputs and prove the detector fires
 * on deliberately-divergent data without needing real drift to exist.
 */
export function findUecDrift(
  brain: BrainUecArtifact,
  oseCodes: ReadonlyArray<UECCode>,
  oseVersion: string,
  oseVerticals: ReadonlyArray<string>
): DriftFinding[] {
  const findings: DriftFinding[] = [];

  // ── Top-level comparisons ──────────────────────────────────────────────
  if (brain.version !== oseVersion) {
    findings.push({
      scope: 'top-level',
      field: 'version',
      brain_value: brain.version,
      ose_value: oseVersion,
    });
  }
  if (
    brain.verticals.length !== oseVerticals.length ||
    !brain.verticals.every((v, i) => v === oseVerticals[i])
  ) {
    findings.push({
      scope: 'top-level',
      field: 'verticals',
      brain_value: brain.verticals,
      ose_value: oseVerticals,
    });
  }

  // ── Code count comparison ──────────────────────────────────────────────
  const brainIds = brain.codes.map((c) => c.id);
  const oseIds = oseCodes.map((c) => c.id);
  if (brainIds.length !== oseIds.length) {
    findings.push({
      scope: 'top-level',
      field: 'codes.length',
      brain_value: brainIds.length,
      ose_value: oseIds.length,
    });
  }

  // Codes in brain but not in OSE (missing on consumer side)
  const oseIdSet = new Set(oseIds);
  for (const brainId of brainIds) {
    if (!oseIdSet.has(brainId)) {
      findings.push({
        scope: brainId,
        field: '<entire code>',
        brain_value: 'present',
        ose_value: 'MISSING — OSE consumed copy is missing this code',
      });
    }
  }

  // Codes in OSE but not in brain (consumer added something — also drift)
  const brainIdSet = new Set(brainIds);
  for (const oseId of oseIds) {
    if (!brainIdSet.has(oseId)) {
      findings.push({
        scope: oseId,
        field: '<entire code>',
        brain_value: 'MISSING — brain canonical does not declare this code',
        ose_value: 'present',
      });
    }
  }

  // ── Per-code field-by-field comparison ─────────────────────────────────
  for (const brainCode of brain.codes) {
    const oseCode = oseCodes.find((c) => c.id === brainCode.id);
    if (!oseCode) continue; // already reported above

    // Compare each canonical field
    for (const field of COMPARED_FIELDS) {
      const brainValue = (brainCode as unknown as Record<string, unknown>)[field];
      const oseValue = (oseCode as unknown as Record<string, unknown>)[field];
      if (brainValue !== oseValue) {
        findings.push({
          scope: brainCode.id,
          field,
          brain_value: brainValue,
          ose_value: oseValue,
        });
      }
    }

    // Compare verticals (array order matters because canonical order matters)
    const brainV = brainCode.verticals;
    const oseV = oseCode.verticals;
    if (brainV.length !== oseV.length || !brainV.every((v, i) => v === oseV[i])) {
      findings.push({
        scope: brainCode.id,
        field: 'verticals',
        brain_value: brainV,
        ose_value: oseV,
      });
    }

    // Compare extension_priority (both must be absent OR both present + equal)
    const brainExt = brainCode.extension_priority;
    const oseExt = oseCode.extension_priority;
    if (brainExt !== oseExt) {
      findings.push({
        scope: brainCode.id,
        field: 'extension_priority',
        brain_value: brainExt,
        ose_value: oseExt,
      });
    }

    // Compare requires_alt_print (added 2026-05-18 — OSE-324 / OSE-332)
    const brainAlt = brainCode.requires_alt_print;
    const oseAlt = oseCode.requires_alt_print;
    if (brainAlt !== oseAlt) {
      findings.push({
        scope: brainCode.id,
        field: 'requires_alt_print',
        brain_value: brainAlt,
        ose_value: oseAlt,
      });
    }
  }

  return findings;
}

/** Build a readable error message that names exactly what drifted. */
function formatFindings(findings: DriftFinding[]): string {
  const lines = findings.map((f) => {
    const brain = JSON.stringify(f.brain_value);
    const ose = JSON.stringify(f.ose_value);
    return `  • [${f.scope}] field=${f.field}\n      brain:  ${brain}\n      OSE:    ${ose}`;
  });
  return (
    `OSE-323 drift check FAILED — ${findings.length} divergence(s) between brain and OSE:\n${lines.join('\n')}\n\n` +
    `Fix direction: update OSE consumed copy (src/lib/uec/uec-codes.ts) to match brain canonical ` +
    `(OCR-docs/ocr-docs-brain/uec-codes.yaml). Never the reverse — brain is the source of truth. ` +
    `Pattern reference: OSE-332 (the sync after OSE-324's brain corrections).`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// THE GATE — runs against the real brain artifact loaded by vitest config.
// Skips locally when brain isn't available; CI always populates it.
// ─────────────────────────────────────────────────────────────────────────────
describe('OSE-323 — UEC drift check (brain ↔ OSE consumed copy)', () => {
  const brainJson = tenv().TEST_BRAIN_UEC_JSON;
  const brainAvailable = brainJson !== '' && brainJson !== undefined;

  test.skipIf(!brainAvailable)(
    'OSE-323 | drift gate | OSE consumed copy is byte-equivalent with brain canonical at data level',
    () => {
      const brain = JSON.parse(brainJson) as BrainUecArtifact;
      const findings = findUecDrift(brain, CODES, VERSION, VERTICALS);
      if (findings.length > 0) {
        throw new Error(formatFindings(findings));
      }
      expect(findings).toEqual([]);
    }
  );

  test('OSE-323 | brain availability signal | local dev gets clear message when brain missing', () => {
    // Documents the skip behavior so future contributors understand it.
    if (!brainAvailable) {
      // eslint-disable-next-line no-console
      console.info(
        '[OSE-323] brain UEC artifact not loaded — drift check SKIPPED locally. ' +
          'Set BRAIN_DIR or clone OCR-docs as sibling to enable. CI always populates this.'
      );
    }
    // This test always passes — it's a documentation surface, not an assertion.
    expect(true).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DETECTOR UNIT TESTS — prove the detector fires on deliberately-divergent
// synthetic inputs WITHOUT requiring real drift to exist in the codebase.
// Per OSE-323 AC: "Test fixture proves the gate fires when OSE copy is
// deliberately mutated to diverge from brain."
// ─────────────────────────────────────────────────────────────────────────────
describe('OSE-323 — UEC drift detector (synthetic positive tests)', () => {
  // Minimal brain fixture — just enough shape to exercise the comparison logic.
  // Real brain has 11 codes; we use 2 for compact tests.
  function fakeBrain(overrides: Partial<BrainUecArtifact> = {}): BrainUecArtifact {
    return {
      schema_version: '1.1.0',
      version: '1.1',
      verticals: ['Sports', 'Civic'],
      codes: [
        {
          id: 'ENTER',
          num: '01',
          label: 'Green',
          scan_hex: '#1A6B2F',
          display_hex: '#2D6A4F',
          semantics: 'Go',
          description: 'Entry',
          url_path: '/enter',
          phase: 'Arrival',
          verticals: ['Sports', 'Civic'],
          status: 'CHANGE',
          wcag_grade: 'AA',
        },
        {
          id: 'SPONSOR',
          num: '03',
          label: 'Blue',
          scan_hex: '#1A3A8A',
          display_hex: '#1D3557',
          semantics: 'Trust',
          description: 'Sponsor',
          url_path: '/sponsor',
          phase: 'During',
          verticals: ['Sports', 'Civic'],
          status: 'KEEP',
          wcag_grade: 'AAA',
        },
      ],
      ...overrides,
    };
  }

  function fakeOseCodes(overrides: Array<Partial<UECCode>> = []): UECCode[] {
    const baseline: UECCode[] = [
      {
        id: 'ENTER',
        num: '01',
        label: 'Green',
        scan_hex: '#1A6B2F',
        display_hex: '#2D6A4F',
        semantics: 'Go',
        description: 'Entry',
        url_path: '/enter',
        phase: 'Arrival',
        verticals: ['Sports', 'Civic'],
        status: 'CHANGE',
        wcag_grade: 'AA',
      },
      {
        id: 'SPONSOR',
        num: '03',
        label: 'Blue',
        scan_hex: '#1A3A8A',
        display_hex: '#1D3557',
        semantics: 'Trust',
        description: 'Sponsor',
        url_path: '/sponsor',
        phase: 'During',
        verticals: ['Sports', 'Civic'],
        status: 'KEEP',
        wcag_grade: 'AAA',
      },
    ];
    for (const o of overrides) {
      const target = baseline.find((c) => c.id === o.id);
      if (target) Object.assign(target, o);
      else baseline.push(o as UECCode);
    }
    return baseline;
  }

  test('OSE-323 | detector | identical brain + OSE → zero findings (no drift)', () => {
    const brain = fakeBrain();
    const ose = fakeOseCodes();
    const findings = findUecDrift(brain, ose, '1.1', ['Sports', 'Civic']);
    expect(findings).toEqual([]);
  });

  test('OSE-323 | detector | scan_hex drift on ENTER → flagged with brain + OSE values', () => {
    const brain = fakeBrain();
    const ose = fakeOseCodes([{ id: 'ENTER', scan_hex: '#FF0000' }]);
    const findings = findUecDrift(brain, ose, '1.1', ['Sports', 'Civic']);
    expect(findings).toHaveLength(1);
    expect(findings[0].scope).toBe('ENTER');
    expect(findings[0].field).toBe('scan_hex');
    expect(findings[0].brain_value).toBe('#1A6B2F');
    expect(findings[0].ose_value).toBe('#FF0000');
  });

  test('OSE-323 | detector | wcag_grade drift on ENTER (AA→AAA) → flagged', () => {
    const brain = fakeBrain();
    const ose = fakeOseCodes([{ id: 'ENTER', wcag_grade: 'AAA' }]);
    const findings = findUecDrift(brain, ose, '1.1', ['Sports', 'Civic']);
    expect(findings).toHaveLength(1);
    expect(findings[0].field).toBe('wcag_grade');
    expect(findings[0].brain_value).toBe('AA');
    expect(findings[0].ose_value).toBe('AAA');
  });

  test('OSE-323 | detector | code missing from OSE (brain added one) → flagged', () => {
    const brain = fakeBrain({
      codes: [
        ...fakeBrain().codes,
        {
          id: 'NEWCODE',
          num: '12',
          label: 'Magenta',
          scan_hex: '#FF00FF',
          display_hex: '#FF00FF',
          semantics: 'Test',
          description: 'New code in brain',
          url_path: '/newcode',
          phase: 'Anytime',
          verticals: ['Sports'],
          status: 'ADD',
          wcag_grade: 'AA',
        },
      ],
    });
    const ose = fakeOseCodes(); // 2 codes, brain has 3
    const findings = findUecDrift(brain, ose, '1.1', ['Sports', 'Civic']);
    // Should flag: codes.length mismatch + NEWCODE missing from OSE
    expect(findings.some((f) => f.field === 'codes.length')).toBe(true);
    expect(findings.some((f) => f.scope === 'NEWCODE' && f.field === '<entire code>')).toBe(true);
  });

  test('OSE-323 | detector | code in OSE but not brain → flagged (consumer added something)', () => {
    const brain = fakeBrain();
    const ose = fakeOseCodes([
      {
        id: 'ROGUE',
        num: '99',
        label: 'RogueColor',
        scan_hex: '#123456',
        display_hex: '#123456',
        semantics: 'Rogue',
        description: 'Not in brain',
        url_path: '/rogue',
        phase: 'Anytime',
        verticals: ['Sports'],
        status: 'ADD',
        wcag_grade: 'AA',
      },
    ]);
    const findings = findUecDrift(brain, ose, '1.1', ['Sports', 'Civic']);
    expect(findings.some((f) => f.scope === 'ROGUE')).toBe(true);
  });

  test('OSE-323 | detector | requires_alt_print drift on ALERT-like code → flagged', () => {
    // OSE-324 added requires_alt_print to brain ALERT. If OSE drops the flag,
    // drift check must catch it. Synthetic test using ENTER for compact setup.
    const brain = fakeBrain({
      codes: [
        {
          ...fakeBrain().codes[0],
          requires_alt_print: true,
        },
        fakeBrain().codes[1],
      ],
    });
    const ose = fakeOseCodes(); // ENTER has NO requires_alt_print
    const findings = findUecDrift(brain, ose, '1.1', ['Sports', 'Civic']);
    expect(findings.some((f) => f.field === 'requires_alt_print')).toBe(true);
  });

  test('OSE-323 | detector | top-level version drift (brain bumped to 1.2, OSE still 1.1) → flagged', () => {
    const brain = fakeBrain({ version: '1.2' });
    const ose = fakeOseCodes();
    const findings = findUecDrift(brain, ose, '1.1', ['Sports', 'Civic']);
    expect(findings.some((f) => f.scope === 'top-level' && f.field === 'version')).toBe(true);
  });

  test('OSE-323 | detector | verticals order drift → flagged (canonical order matters)', () => {
    const brain = fakeBrain({ verticals: ['Sports', 'Civic'] });
    const ose = fakeOseCodes();
    // Same codes; just reverse top-level verticals on OSE side
    const findings = findUecDrift(brain, ose, '1.1', ['Civic', 'Sports']);
    expect(findings.some((f) => f.scope === 'top-level' && f.field === 'verticals')).toBe(true);
  });

  test('OSE-323 | detector | rationale field ignored (brain-only enrichment)', () => {
    const brain = fakeBrain({
      codes: [
        {
          ...fakeBrain().codes[0],
          rationale: { psychology: 'green is go', why: 'safety', contexts: [], verdict: 'lock' },
        },
        fakeBrain().codes[1],
      ],
    });
    const ose = fakeOseCodes(); // OSE has no rationale
    const findings = findUecDrift(brain, ose, '1.1', ['Sports', 'Civic']);
    // rationale is intentionally NOT compared — OSE consumed copy doesn't carry it
    expect(findings).toEqual([]);
  });

  test('OSE-323 | formatter | error message names fix direction explicitly', () => {
    const brain = fakeBrain();
    const ose = fakeOseCodes([{ id: 'ENTER', scan_hex: '#FF0000' }]);
    const findings = findUecDrift(brain, ose, '1.1', ['Sports', 'Civic']);
    const msg = formatFindings(findings);
    // Must include: scope, field, both values, fix direction
    expect(msg).toContain('ENTER');
    expect(msg).toContain('scan_hex');
    expect(msg).toContain('#1A6B2F');
    expect(msg).toContain('#FF0000');
    expect(msg).toMatch(/update OSE.*to match brain|brain.*source of truth/i);
    expect(msg).not.toMatch(/update brain/i); // must NOT suggest the reverse direction
  });
});
