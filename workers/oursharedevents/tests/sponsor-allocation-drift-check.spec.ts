/**
 * OSE-336 — Sponsor Allocation Drift Check (brain ↔ OSE consumed copy parity gate)
 *
 * Compares the OSE consumed copy at `src/lib/sponsor-allocation.ts`
 * (the `SPONSOR_ALLOCATION` typed const) against the brain canonical
 * artifact at `OCR-docs/ocr-docs-brain/sponsor-allocation.yaml`
 * (loaded by vitest config and injected as TEST_BRAIN_SPONSOR_ALLOCATION_JSON).
 * Fails CI on any drift at the data level. Completes the OSE-330 brain↔
 * substrate enforcement chain:
 *
 *   OSE-330 P1 ✓ Brain canonical exists (sponsor-allocation.yaml)
 *              ✓ Invariant #5 registered (rich form, partial status)
 *              ✓ Level 2 schema check validates artifact shape
 *   OSE-330 P2 ✓ OSE consumes brain via typed module (sponsor-allocation.ts)
 *              ✓ Migration 0036 adds is_local column
 *              ✓ tierSort() two-level covenant enforcement
 *              ✓ Structural + functional invariant test pair
 *   OSE-336    ✓ THIS — brain↔OSE byte-equivalence at data level
 *
 * Drift always resolves toward brain (brain is canonical, OSE is consumer).
 * Failure messages always say "update OSE to match brain — never the
 * reverse." Per ADR-012 (build-time consumption, manually-synced TS module)
 * and ADR-013 (Local Sponsor Covenant via display-priority sort).
 *
 * Strategy:
 *   - Brain artifact loaded at vitest config time via `js-yaml`; injected
 *     as a JSON-stringified env binding (TEST_BRAIN_SPONSOR_ALLOCATION_JSON)
 *   - Local dev: if brain not available (OCR-docs not cloned as sibling),
 *     the test SKIPS with a clear message — developers aren't blocked
 *   - CI: workflow checkout step ALWAYS makes brain available; the skip
 *     path never triggers in CI
 *
 * Per OCR_STANDARD_perStoryTestPyramid: brain-conformance architecture
 * gate carries no layer qualifier (UNIT bucket — pure data comparison,
 * runs in <100ms).
 *
 * Pattern reference: tests/uec-drift-check.spec.ts (OSE-323) — same shape,
 * different artifact.
 */

import { env as tenvRaw } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { SPONSOR_ALLOCATION } from '../src/lib/sponsor-allocation';
import type { SponsorAllocationCanonical, SurfaceAllocation } from '../src/lib/sponsor-allocation';

interface TestEnv {
  TEST_BRAIN_SPONSOR_ALLOCATION_JSON: string;
}

const tenv = () => tenvRaw as unknown as TestEnv;

/**
 * Shape of the brain sponsor-allocation artifact as parsed from
 * sponsor-allocation.yaml. We only model the fields OSE consumes —
 * brain-side enrichment (rationale, drift_detection metadata, notes,
 * provenance) is deliberately not compared because the OSE consumed
 * copy doesn't carry it.
 */
interface BrainSurfaceAllocation {
  cap: number | null;
  local_floor: number;
  rationale: string;
}

interface BrainSponsorAllocationArtifact {
  schema_version?: string;
  version: string;
  classification: {
    field: string;
    type: string;
    default: boolean;
  };
  display_priority: {
    rule: string;
  };
  slot_floor: {
    status: string;
    surfaces: Record<string, BrainSurfaceAllocation>;
  };
  // share_of_voice (OSE-663, Invariant #25). OSE mirrors status/unit/walls/
  // weights; brain-only sub-fields (ratified, redistribution, fail_closed,
  // is_local_derivation, consumed_by, attacked_by) are NOT compared.
  share_of_voice?: {
    status: string;
    unit: string;
    walls: Record<string, number | boolean>;
    weights: Record<string, number>;
    [k: string]: unknown;
  };
  // brain-side-only fields (NOT compared):
  covenant?: unknown;
  drift_detection?: unknown;
  notes?: unknown;
}

/** A drift finding — what differs between brain and OSE, with explicit direction. */
interface DriftFinding {
  scope: 'top-level' | 'classification' | 'display_priority' | 'slot_floor' | string;
  field: string;
  brain_value: unknown;
  ose_value: unknown;
}

/**
 * Pure detection function. Exported so the synthetic positive tests below
 * can fabricate adversarial inputs and prove the detector fires on
 * deliberately-divergent data without requiring real drift to exist.
 */
export function findSponsorAllocationDrift(
  brain: BrainSponsorAllocationArtifact,
  ose: SponsorAllocationCanonical
): DriftFinding[] {
  const findings: DriftFinding[] = [];

  // ── Top-level: version ─────────────────────────────────────────────────
  if (brain.version !== ose.version) {
    findings.push({
      scope: 'top-level',
      field: 'version',
      brain_value: brain.version,
      ose_value: ose.version,
    });
  }

  // ── classification block ───────────────────────────────────────────────
  if (brain.classification.field !== ose.classification.field) {
    findings.push({
      scope: 'classification',
      field: 'field',
      brain_value: brain.classification.field,
      ose_value: ose.classification.field,
    });
  }
  if (brain.classification.type !== ose.classification.type) {
    findings.push({
      scope: 'classification',
      field: 'type',
      brain_value: brain.classification.type,
      ose_value: ose.classification.type,
    });
  }
  if (brain.classification.default !== ose.classification.default) {
    findings.push({
      scope: 'classification',
      field: 'default',
      brain_value: brain.classification.default,
      ose_value: ose.classification.default,
    });
  }

  // ── display_priority block ─────────────────────────────────────────────
  if (brain.display_priority.rule !== ose.display_priority.rule) {
    findings.push({
      scope: 'display_priority',
      field: 'rule',
      brain_value: brain.display_priority.rule,
      ose_value: ose.display_priority.rule,
    });
  }

  // ── slot_floor block — top-level status ────────────────────────────────
  if (brain.slot_floor.status !== ose.slot_floor.status) {
    findings.push({
      scope: 'slot_floor',
      field: 'status',
      brain_value: brain.slot_floor.status,
      ose_value: ose.slot_floor.status,
    });
  }

  // ── slot_floor.surfaces — per-surface comparison ───────────────────────
  const brainSurfaceNames = Object.keys(brain.slot_floor.surfaces).sort();
  const oseSurfaceNames = Object.keys(ose.slot_floor.surfaces).sort();

  // Surface set parity (surfaces present on one side only)
  const brainSet = new Set(brainSurfaceNames);
  const oseSet = new Set(oseSurfaceNames);
  for (const name of brainSurfaceNames) {
    if (!oseSet.has(name)) {
      findings.push({
        scope: `slot_floor.surfaces.${name}`,
        field: '<entire surface>',
        brain_value: 'present',
        ose_value: 'MISSING — OSE consumed copy is missing this surface',
      });
    }
  }
  for (const name of oseSurfaceNames) {
    if (!brainSet.has(name)) {
      findings.push({
        scope: `slot_floor.surfaces.${name}`,
        field: '<entire surface>',
        brain_value: 'MISSING — brain canonical does not declare this surface',
        ose_value: 'present',
      });
    }
  }

  // Per-surface field-by-field comparison
  for (const surfaceName of brainSurfaceNames) {
    const brainSurface = brain.slot_floor.surfaces[surfaceName];
    const oseSurface = ose.slot_floor.surfaces[surfaceName] as SurfaceAllocation | undefined;
    if (!oseSurface) continue; // already reported above

    if (brainSurface.cap !== oseSurface.cap) {
      findings.push({
        scope: `slot_floor.surfaces.${surfaceName}`,
        field: 'cap',
        brain_value: brainSurface.cap,
        ose_value: oseSurface.cap,
      });
    }
    if (brainSurface.local_floor !== oseSurface.local_floor) {
      findings.push({
        scope: `slot_floor.surfaces.${surfaceName}`,
        field: 'local_floor',
        brain_value: brainSurface.local_floor,
        ose_value: oseSurface.local_floor,
      });
    }
    if (brainSurface.rationale !== oseSurface.rationale) {
      findings.push({
        scope: `slot_floor.surfaces.${surfaceName}`,
        field: 'rationale',
        brain_value: brainSurface.rationale,
        ose_value: oseSurface.rationale,
      });
    }
  }

  // ── share_of_voice block (OSE-663, Invariant #25) ──────────────────────────
  // Compare ONLY the fields the OSE mirror consumes: status, unit, walls,
  // weights. Brain-only enrichment (ratified, redistribution, fail_closed,
  // is_local_derivation, consumed_by, attacked_by) is intentionally skipped.
  const brainSov = brain.share_of_voice;
  const oseSov = ose.share_of_voice as unknown as
    | { status: string; unit: string; walls: Record<string, unknown>; weights: Record<string, unknown> }
    | undefined;
  if (brainSov && oseSov) {
    if (brainSov.status !== oseSov.status) {
      findings.push({ scope: 'share_of_voice', field: 'status', brain_value: brainSov.status, ose_value: oseSov.status });
    }
    if (brainSov.unit !== oseSov.unit) {
      findings.push({ scope: 'share_of_voice', field: 'unit', brain_value: brainSov.unit, ose_value: oseSov.unit });
    }
    const wallsB = brainSov.walls as Record<string, unknown>;
    const wallsO = oseSov.walls;
    for (const k of ['local_floor_pct', 'premium_cap_pct', 'mid_cap_pct', 'min_presence_pct', 'uniform_size_slot']) {
      if (wallsB[k] !== wallsO[k]) {
        findings.push({ scope: 'share_of_voice.walls', field: k, brain_value: wallsB[k], ose_value: wallsO[k] });
      }
    }
    const weightsB = brainSov.weights as Record<string, unknown>;
    const weightsO = oseSov.weights;
    for (const k of ['base', 'mid', 'premium']) {
      if (weightsB[k] !== weightsO[k]) {
        findings.push({ scope: 'share_of_voice.weights', field: k, brain_value: weightsB[k], ose_value: weightsO[k] });
      }
    }
  } else if (brainSov && !oseSov) {
    findings.push({ scope: 'share_of_voice', field: '<entire block>', brain_value: 'present', ose_value: 'MISSING — OSE consumed copy is missing share_of_voice' });
  } else if (!brainSov && oseSov) {
    findings.push({ scope: 'share_of_voice', field: '<entire block>', brain_value: 'MISSING — brain canonical does not declare share_of_voice', ose_value: 'present' });
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
    `OSE-336 drift check FAILED — ${findings.length} divergence(s) between brain and OSE:\n${lines.join('\n')}\n\n` +
    `Fix direction: update OSE consumed copy (src/lib/sponsor-allocation.ts) to match brain canonical ` +
    `(OCR-docs/ocr-docs-brain/sponsor-allocation.yaml). Never the reverse — brain is the source of truth ` +
    `for the Local Sponsor Covenant (ADR-013, Invariant #5). Pattern reference: tests/uec-drift-check.spec.ts (OSE-323).`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// THE GATE — runs against the real brain artifact loaded by vitest config.
// Skips locally when brain isn't available; CI always populates it.
// ─────────────────────────────────────────────────────────────────────────────
describe('OSE-336 — sponsor-allocation drift check (brain ↔ OSE consumed copy)', () => {
  const brainJson = tenv().TEST_BRAIN_SPONSOR_ALLOCATION_JSON;
  const brainAvailable = brainJson !== '' && brainJson !== undefined;

  test.skipIf(!brainAvailable)(
    'OSE-336 | drift gate | OSE consumed copy is byte-equivalent with brain canonical at data level',
    () => {
      const brain = JSON.parse(brainJson) as BrainSponsorAllocationArtifact;
      const findings = findSponsorAllocationDrift(brain, SPONSOR_ALLOCATION);
      if (findings.length > 0) {
        throw new Error(formatFindings(findings));
      }
      expect(findings).toEqual([]);
    }
  );

  test('OSE-336 | brain availability signal | local dev gets clear message when brain missing', () => {
    // Documents the skip behavior so future contributors understand it.
    if (!brainAvailable) {
      // eslint-disable-next-line no-console
      console.info(
        '[OSE-336] brain sponsor-allocation artifact not loaded — drift check SKIPPED locally. ' +
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
// Per OSE-336 AC: "Adversarial smoke: hand-edit the OSE consumed copy locally
// → run drift-check → fails with a clear field-level error message"
// ─────────────────────────────────────────────────────────────────────────────
describe('OSE-336 — sponsor-allocation drift detector (synthetic positive tests)', () => {
  // Minimal brain fixture — mirrors the real artifact's shape with two surfaces
  // for compact tests. Real brain has 4 surfaces; the detector handles N.
  function fakeBrain(
    overrides: Partial<BrainSponsorAllocationArtifact> = {}
  ): BrainSponsorAllocationArtifact {
    return {
      schema_version: '1.0.0',
      version: '1.0',
      share_of_voice: {
        status: 'planned',
        unit: 'percent_of_rotation_impressions',
        walls: { local_floor_pct: 30, premium_cap_pct: 40, mid_cap_pct: 20, min_presence_pct: 2, uniform_size_slot: true },
        weights: { base: 1, mid: 3, premium: 7 },
      },
      classification: { field: 'is_local', type: 'boolean', default: false },
      display_priority: { rule: 'locals_first' },
      slot_floor: {
        status: 'scaffolded',
        surfaces: {
          posterTop: {
            cap: null,
            local_floor: 1,
            rationale: 'Poster surface; locals guaranteed first slot when cap > 0.',
          },
          mobileBanner: {
            cap: null,
            local_floor: 0,
            rationale: 'Single-impression surface; sort already handles locals-first.',
          },
        },
      },
      ...overrides,
    };
  }

  function fakeOse(
    overrides: Partial<SponsorAllocationCanonical> = {}
  ): SponsorAllocationCanonical {
    return {
      version: '1.0',
      share_of_voice: {
        status: 'planned',
        unit: 'percent_of_rotation_impressions',
        walls: { local_floor_pct: 30, premium_cap_pct: 40, mid_cap_pct: 20, min_presence_pct: 2, uniform_size_slot: true },
        weights: { base: 1, mid: 3, premium: 7 },
      },
      classification: { field: 'is_local', type: 'boolean', default: false },
      display_priority: { rule: 'locals_first' },
      slot_floor: {
        status: 'scaffolded',
        surfaces: {
          posterTop: {
            cap: null,
            local_floor: 1,
            rationale: 'Poster surface; locals guaranteed first slot when cap > 0.',
          },
          mobileBanner: {
            cap: null,
            local_floor: 0,
            rationale: 'Single-impression surface; sort already handles locals-first.',
          },
        },
      },
      ...overrides,
    };
  }

  test('OSE-336 | detector | identical brain + OSE → zero findings (no drift)', () => {
    expect(findSponsorAllocationDrift(fakeBrain(), fakeOse())).toEqual([]);
  });

  test('OSE-336 | detector | version drift (brain bumped to 1.1) → flagged at top-level', () => {
    const findings = findSponsorAllocationDrift(fakeBrain({ version: '1.1' }), fakeOse());
    expect(findings).toHaveLength(1);
    expect(findings[0].scope).toBe('top-level');
    expect(findings[0].field).toBe('version');
    expect(findings[0].brain_value).toBe('1.1');
    expect(findings[0].ose_value).toBe('1.0');
  });

  test('OSE-336 | detector | classification.field drift (is_local → is_local_business) → flagged', () => {
    const findings = findSponsorAllocationDrift(
      fakeBrain({
        classification: { field: 'is_local_business', type: 'boolean', default: false },
      }),
      fakeOse()
    );
    expect(findings.some((f) => f.scope === 'classification' && f.field === 'field')).toBe(true);
  });

  test('OSE-336 | detector | display_priority.rule drift (locals_first → highest_bidder) → flagged — covenant-violating drift', () => {
    // THE adversarial test: a contributor "optimizes" the covenant out by
    // changing the rule. The drift check is the last line of defense before
    // brain ↔ OSE divergence makes Invariant #5 silently rotten.
    const findings = findSponsorAllocationDrift(
      fakeBrain({ display_priority: { rule: 'highest_bidder' } }),
      fakeOse()
    );
    const violation = findings.find((f) => f.scope === 'display_priority' && f.field === 'rule');
    expect(violation).toBeDefined();
    expect(violation?.brain_value).toBe('highest_bidder');
    expect(violation?.ose_value).toBe('locals_first');
  });

  test('OSE-336 | detector | slot_floor.status drift (scaffolded → active without update) → flagged', () => {
    const findings = findSponsorAllocationDrift(
      fakeBrain({
        slot_floor: {
          status: 'active',
          surfaces: fakeBrain().slot_floor.surfaces,
        },
      }),
      fakeOse()
    );
    expect(findings.some((f) => f.scope === 'slot_floor' && f.field === 'status')).toBe(true);
  });

  test('OSE-336 | detector | per-surface local_floor drift (posterTop 1 → 2 in brain) → flagged', () => {
    const findings = findSponsorAllocationDrift(
      fakeBrain({
        slot_floor: {
          status: 'scaffolded',
          surfaces: {
            posterTop: {
              cap: null,
              local_floor: 2,
              rationale: 'Poster surface; locals guaranteed first slot when cap > 0.',
            },
            mobileBanner: fakeBrain().slot_floor.surfaces.mobileBanner,
          },
        },
      }),
      fakeOse()
    );
    const violation = findings.find(
      (f) => f.scope === 'slot_floor.surfaces.posterTop' && f.field === 'local_floor'
    );
    expect(violation).toBeDefined();
    expect(violation?.brain_value).toBe(2);
    expect(violation?.ose_value).toBe(1);
  });

  test('OSE-336 | detector | surface missing from OSE (brain added one) → flagged', () => {
    const findings = findSponsorAllocationDrift(
      fakeBrain({
        slot_floor: {
          status: 'scaffolded',
          surfaces: {
            ...fakeBrain().slot_floor.surfaces,
            tvSide: {
              cap: null,
              local_floor: 2,
              rationale: 'TV sidebar; double local floor.',
            },
          },
        },
      }),
      fakeOse()
    );
    expect(
      findings.some(
        (f) => f.scope === 'slot_floor.surfaces.tvSide' && f.field === '<entire surface>'
      )
    ).toBe(true);
  });

  test('OSE-336 | detector | surface in OSE but not brain (consumer added rogue surface) → flagged', () => {
    const findings = findSponsorAllocationDrift(
      fakeBrain(),
      fakeOse({
        slot_floor: {
          status: 'scaffolded',
          surfaces: {
            ...fakeOse().slot_floor.surfaces,
            rogueSurface: {
              cap: null,
              local_floor: 99,
              rationale: 'should not exist',
            },
          },
        },
      })
    );
    expect(
      findings.some(
        (f) => f.scope === 'slot_floor.surfaces.rogueSurface' && f.field === '<entire surface>'
      )
    ).toBe(true);
  });

  test('OSE-336 | detector | rationale drift on a surface → flagged (rationale is canonical, not commentary)', () => {
    // Rationale is part of the brain contract because future contributors will
    // read it to understand WHY a specific floor was chosen. Drift here would
    // mean OSE and brain disagree on the architectural reasoning even when
    // numbers match.
    const findings = findSponsorAllocationDrift(
      fakeBrain({
        slot_floor: {
          status: 'scaffolded',
          surfaces: {
            posterTop: {
              cap: null,
              local_floor: 1,
              rationale: 'Updated reasoning landed in brain after a debate.',
            },
            mobileBanner: fakeBrain().slot_floor.surfaces.mobileBanner,
          },
        },
      }),
      fakeOse()
    );
    expect(
      findings.some((f) => f.scope === 'slot_floor.surfaces.posterTop' && f.field === 'rationale')
    ).toBe(true);
  });

  test('OSE-336 | detector | share_of_voice premium_cap drift (brain 40 → OSE 50) → flagged — Invariant #25 cap divergence', () => {
    // THE #25 adversarial test: the ratified premium cap silently diverges
    // between brain and the OSE mirror. Without this comparison, a cap change
    // in one file and not the other would ship undetected.
    const findings = findSponsorAllocationDrift(
      fakeBrain(),
      fakeOse({
        share_of_voice: {
          status: 'planned',
          unit: 'percent_of_rotation_impressions',
          walls: { local_floor_pct: 30, premium_cap_pct: 50, mid_cap_pct: 20, min_presence_pct: 2, uniform_size_slot: true },
          weights: { base: 1, mid: 3, premium: 7 },
        },
      })
    );
    const v = findings.find((f) => f.scope === 'share_of_voice.walls' && f.field === 'premium_cap_pct');
    expect(v).toBeDefined();
    expect(v?.brain_value).toBe(40);
    expect(v?.ose_value).toBe(50);
  });

  test('OSE-336 | detector | share_of_voice local_floor drift (brain 30 → OSE 20) → flagged', () => {
    const findings = findSponsorAllocationDrift(
      fakeBrain(),
      fakeOse({
        share_of_voice: {
          status: 'planned',
          unit: 'percent_of_rotation_impressions',
          walls: { local_floor_pct: 20, premium_cap_pct: 40, mid_cap_pct: 20, min_presence_pct: 2, uniform_size_slot: true },
          weights: { base: 1, mid: 3, premium: 7 },
        },
      })
    );
    expect(findings.some((f) => f.scope === 'share_of_voice.walls' && f.field === 'local_floor_pct')).toBe(true);
  });

  test('OSE-336 | detector | share_of_voice weight drift (premium 7 → 5) → flagged', () => {
    const findings = findSponsorAllocationDrift(
      fakeBrain(),
      fakeOse({
        share_of_voice: {
          status: 'planned',
          unit: 'percent_of_rotation_impressions',
          walls: { local_floor_pct: 30, premium_cap_pct: 40, mid_cap_pct: 20, min_presence_pct: 2, uniform_size_slot: true },
          weights: { base: 1, mid: 3, premium: 5 },
        },
      })
    );
    const v = findings.find((f) => f.scope === 'share_of_voice.weights' && f.field === 'premium');
    expect(v).toBeDefined();
    expect(v?.brain_value).toBe(7);
    expect(v?.ose_value).toBe(5);
  });

  test('OSE-336 | detector | share_of_voice identical → zero findings (no false positive)', () => {
    expect(findSponsorAllocationDrift(fakeBrain(), fakeOse())).toEqual([]);
  });

  test('OSE-336 | detector | brain-only enrichment ignored (covenant + drift_detection + notes)', () => {
    // Brain artifact carries narrative fields (covenant text, drift_detection
    // metadata, notes) that the OSE typed const intentionally doesn't mirror.
    // The detector must skip these.
    const findings = findSponsorAllocationDrift(
      fakeBrain({
        covenant: { promise: 'locals stay in', anti_pattern: 'pay-to-rank' },
        drift_detection: { tracked: true, story: 'OSE-336' },
        notes: 'Future expansion lives here',
      }),
      fakeOse()
    );
    expect(findings).toEqual([]);
  });

  test('OSE-336 | formatter | error message names fix direction explicitly', () => {
    const findings = findSponsorAllocationDrift(
      fakeBrain({ display_priority: { rule: 'highest_bidder' } }),
      fakeOse()
    );
    const msg = formatFindings(findings);
    expect(msg).toContain('display_priority');
    expect(msg).toContain('rule');
    expect(msg).toContain('highest_bidder');
    expect(msg).toContain('locals_first');
    expect(msg).toMatch(/update OSE.*to match brain|brain.*source of truth/i);
    expect(msg).not.toMatch(/update brain/i); // must NOT suggest reverse direction
    expect(msg).toMatch(/ADR-013|Invariant #5/); // anchors to the architectural source
  });
});
