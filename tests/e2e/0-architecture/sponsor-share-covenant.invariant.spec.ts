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
 *   - status: planned (allocateShares + born-red suite land with OSE-663/OSE-662)
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
  expect(existsSync(SPONSOR_ALLOCATION_PATH), 'src/lib/sponsor-allocation.ts must exist').toBe(true);
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
    expect(src, 'allocateShares must be exported').toMatch(/export\s+function\s+allocateShares\s*\(/);
    const body = src.match(/export\s+function\s+allocateShares\([\s\S]*?\n\}/);
    expect(body, 'allocateShares body must be found').not.toBeNull();
    const fn = body![0];
    // WALL 1 — cap enforcement: the function must clamp to a per-sponsor cap.
    expect(fn, 'allocateShares must reference the per-sponsor cap').toMatch(/sovCapOf|_cap_pct|cap/);
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
    expect(shape, 'ShareAllocation must expose sharePct (frequency)').toMatch(/sharePct\s*:\s*number/);
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
