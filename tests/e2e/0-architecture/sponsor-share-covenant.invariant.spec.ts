/**
 * INVARIANT #25: Sponsor Share Covenant — capped/floored/uniform share-of-voice.
 *
 * The public-URL sponsor rotation allocates a FREQUENCY share per sponsor under
 * three walls: (1) premium cap, (2) local floor, (3) uniform size/slot (only
 * frequency is purchasable). Money buys frequency-share + report depth ONLY —
 * never size, slot, position, or is_local status. is_local is geo-derived, not
 * purchasable.
 *
 * This 0-architecture spec is the code-SHAPE lock: it reads source from disk and
 * asserts the load-bearing structure is present, so a future contributor (human
 * or agent) cannot silently strip the caps, the floor, or the frequency-only
 * return shape. Functional BEHAVIOR (the walls actually hold across demand
 * levels, born-red) is proven in the vitest property suite at
 * workers/oursharedevents/tests/sponsor-share-covenant.spec.ts.
 *
 * Brain Invariant #25 (sponsor_share_covenant):
 *   - status: active (allocateShares live; render seam enforced by WALL-3b below)
 *   - brain canonical: ocr-docs-brain/sponsor-allocation.yaml (share_of_voice block)
 *   - OSE consumed copy: src/lib/sponsor-allocation.ts (allocateShares)
 *   - quantitative complement to Invariant #5 (Local Sponsor Covenant)
 *
 * What this invariant catches:
 *   - Anyone removes the premium_cap / local_floor params → CI fails
 *   - Anyone removes cap clamping or the floor reservation from allocateShares → CI fails
 *   - Anyone adds a size/slot field to the allocation output (breaking WALL 3) → CI fails
 *   - The mirror version drifts from the brain canonical → the OSE-336 drift check fails
 *
 * Pattern reference: tests/e2e/0-architecture/tier-equity.invariant.spec.ts.
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SPONSOR_ALLOCATION_PATH = join(
  REPO_ROOT,
  'workers',
  'oursharedevents',
  'src',
  'lib',
  'sponsor-allocation.ts'
);

function alloc(): string {
  expect(existsSync(SPONSOR_ALLOCATION_PATH), 'src/lib/sponsor-allocation.ts must exist').toBe(
    true
  );
  return readFileSync(SPONSOR_ALLOCATION_PATH, 'utf8');
}

test.describe('Invariant 25: Sponsor Share Covenant — code-shape lock', () => {
  test('OSE-663 | share_of_voice config declares the three walls', () => {
    const src = alloc();
    expect(src, 'share_of_voice block must exist').toMatch(/share_of_voice\s*:/);
    // WALL 1 (cap) + WALL 2 (floor) + min-presence params must be present.
    expect(src, 'premium cap param').toMatch(/premium_cap_pct/);
    expect(src, 'mid cap param').toMatch(/mid_cap_pct/);
    expect(src, 'local floor param').toMatch(/local_floor_pct/);
    // WALL 3 — uniform size/slot is asserted, not computed.
    expect(src, 'uniform_size_slot wall').toMatch(/uniform_size_slot\s*:\s*true/);
  });

  test('OSE-663 | ratified numbers present (floor 30 / cap 40 / mid 20)', () => {
    const src = alloc();
    expect(src).toMatch(/local_floor_pct\s*:\s*30/);
    expect(src).toMatch(/premium_cap_pct\s*:\s*40/);
    expect(src).toMatch(/mid_cap_pct\s*:\s*20/);
  });

  test('OSE-663 | allocateShares() exists and clamps to caps + reserves the floor', () => {
    const src = alloc();
    expect(src, 'allocateShares must be exported').toMatch(
      /export\s+function\s+allocateShares\s*\(/
    );
    const body = src.match(/export\s+function\s+allocateShares\([\s\S]*?\n\}/);
    expect(body, 'allocateShares body must be found').not.toBeNull();
    const fn = body![0];
    // WALL 1 — cap enforcement: the function must clamp to a per-sponsor cap.
    expect(fn, 'allocateShares must reference the per-sponsor cap').toMatch(
      /sovCapOf|_cap_pct|cap/
    );
    // WALL 2 — floor reservation: the function must reserve the local floor.
    expect(fn, 'allocateShares must reserve the local floor').toMatch(/floor/);
    // fail-closed on unknown tier.
    expect(fn, 'allocateShares must fail closed on unknown tier').toMatch(/unknown sponsor tier/i);
  });

  test('OSE-663 | WALL 3 — allocation output is frequency-only (no size/slot/position field)', () => {
    const src = alloc();
    const iface = src.match(/interface\s+ShareAllocation\s*\{[\s\S]*?\}/);
    expect(iface, 'ShareAllocation interface must exist').not.toBeNull();
    const shape = iface![0];
    expect(shape, 'ShareAllocation must expose sharePct (frequency)').toMatch(
      /sharePct\s*:\s*number/
    );
    // The frequency-only wall: no size / slot / position / width / rank field.
    expect(shape, 'ShareAllocation must NOT carry a size/slot/position field').not.toMatch(
      /\b(size|slot|position|width|height|rank|prominence)\b/i
    );
  });

  test('OSE-663 | is_local is documented as geo-derived, non-purchasable', () => {
    const src = alloc();
    // The buy-is_local attack (OSE-662) is defeated by is_local being geo-derived.
    // The contract must be visible in source so it is not "optimized" into a
    // purchasable flag.
    expect(src, 'is_local must be documented geo-derived / non-purchasable').toMatch(
      /geo-derived|corridor-cell|NEVER purchasable|non-purchasable/i
    );
  });

  test('OSE-663 | brain canonical (#25 sponsor-allocation.yaml) is the cited source of truth', () => {
    const src = alloc();
    expect(src).toMatch(/ocr-docs-brain\/sponsor-allocation\.yaml/);
    expect(src, 'must cite Invariant #25').toMatch(/Invariant #25|sponsor_share_covenant/);
  });
});

/**
 * WALL-3b (OSE-835) — #25 proven against the templates that PAINT logos, not just
 * the allocation TypeScript. Until now #25 was a property of an interface; a
 * template could grow `[data-tier="platinum"] img { height: 96px }` and every
 * covenant case above stayed green. This reads the four customer surfaces from
 * disk and fails on any TIER-KEYED sponsor GEOMETRY.
 *
 * Dimensions only. Per the user's 2026-08-18 clarification, #25 constrains sponsor
 * DIMENSIONS (size/slot/position) — colours MAY vary per tier. So this guards
 * height/width/max-width/min-width/font-size/padding, NOT border-color/background.
 *
 * Multi-line aware: real template CSS spans lines (selector list, then `{`, then
 * declarations), so whitespace is collapsed before matching. The naive single-line
 * regex in the ticket would false-green on display.html's multi-line tier blocks.
 */
const TEMPLATE_DIR = join(REPO_ROOT, 'workers', 'oursharedevents', 'src', 'templates');
const COVENANT_SURFACES = ['display.html', 'poster.html', 'public.html', 'shared-report.html'];

// A CSS rule whose selector is tier-keyed AND whose body sets a DIMENSION.
// [^{}]* keeps the selector→brace and brace→decl spans inside a single rule block.
const DIM = 'height|max-width|min-width|width|font-size|padding';
const TIER_ATTR_GEOMETRY = new RegExp(`\\[data-tier[^\\]]*\\][^{}]*\\{[^}]*(?:${DIM})\\s*:`, 'i');
const TIER_CLASS_GEOMETRY = new RegExp(
  `--(?:title|platinum|gold|silver|bronze|primary)[^{}]*\\{[^}]*(?:${DIM})\\s*:`,
  'i'
);

function collapse(css: string): string {
  return css.replace(/\s+/g, ' ');
}

// Return every tier-keyed geometry rule (with a short snippet) found in `css`.
function tierKeyedGeometry(css: string): string[] {
  const flat = collapse(css);
  const hits: string[] = [];
  for (const re of [TIER_ATTR_GEOMETRY, TIER_CLASS_GEOMETRY]) {
    const global = new RegExp(re.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = global.exec(flat)) !== null) {
      hits.push(m[0].slice(0, 160));
    }
  }
  return hits;
}

test.describe('Invariant 25: WALL-3b — uniform sponsor geometry at the template seam (OSE-835)', () => {
  for (const file of COVENANT_SURFACES) {
    test(`${file} carries no tier-keyed sponsor geometry`, () => {
      const path = join(TEMPLATE_DIR, file);
      expect(existsSync(path), `${file} must exist`).toBe(true);
      const hits = tierKeyedGeometry(readFileSync(path, 'utf8'));
      expect(
        hits,
        `#25 violation in ${file}: tier-keyed sponsor DIMENSION(s) found — size/slot/position ` +
          `must be uniform (money buys frequency + report depth only). Offending rule(s):\n` +
          hits.map((h) => `  • ${h}`).join('\n')
      ).toEqual([]);
    });
  }

  test('the guard actually bites — a synthetic tier-keyed height is caught', () => {
    // Regression on the guard itself: if this ever passes empty, the guard is inert.
    expect(
      tierKeyedGeometry(".x[data-tier='platinum'] img {\n  height: 96px;\n}").length
    ).toBeGreaterThan(0);
    expect(tierKeyedGeometry('.s--title img {\n  height: 40px;\n}').length).toBeGreaterThan(0);
    // Colours may vary per tier (#25 dimensions-only) — must NOT be flagged.
    expect(
      tierKeyedGeometry(".x[data-tier='gold'] { border-color: gold; background: #fef; }")
    ).toEqual([]);
  });
});
