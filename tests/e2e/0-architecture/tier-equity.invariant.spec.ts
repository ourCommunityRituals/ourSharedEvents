/**
 * INVARIANT 5: Local Sponsor Covenant — display-priority enforcement.
 *
 * Locals first. Always. Regardless of pricing tier.
 *
 * A primary-tier local sponsor appears in display order BEFORE a
 * platinum-tier non-local. A sponsor matching platform that pushes the
 * highest bidder to the top is a standard ad network; OSE's covenant —
 * that the local stays in — is the differentiating brand promise that
 * creates the local-economy flywheel.
 *
 * This invariant is the 0-architecture-suite proof that the covenant
 * holds at the code-shape level. Functional sort behavior is tested in
 * workers/oursharedevents/tests/tier-equity-sort.spec.ts (vitest unit on
 * tierSort()). Together: this file asserts the contract STRUCTURE is
 * in place; the vitest file asserts the contract BEHAVIOR holds for
 * synthetic inputs.
 *
 * Brain Invariant #5 (tier_equity, "Local Sponsor Covenant"):
 *   - status: partial (post-OSE-330 Phase 1); becomes live once OSE-330
 *     Phase 2 (this PR) merges and Phase 3 brain status-flip PR follows
 *   - brain canonical: ocr-docs-brain/sponsor-allocation.yaml
 *   - OSE consumed copy: src/lib/sponsor-allocation.ts
 *   - resolver upgrade: src/lib/sponsor-resolver.ts tierSort()
 *
 * What this invariant catches:
 *   - Anyone (human or agent) removes is_local from SponsorRow → CI fails
 *   - Anyone changes tierSort to compare tier BEFORE is_local → CI fails
 *   - Anyone removes the locals-first level from tierSort → CI fails
 *   - The migration 0036 file disappears or its column rename changes → CI fails
 *
 * The structural assertions read source files from disk (Playwright runs
 * with Node fs access). Pattern reference: tests/e2e/0-architecture/
 * anonymous-id.invariant.spec.ts (same shape — reads source, asserts
 * load-bearing patterns are present).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SPONSOR_RESOLVER_PATH = join(
  REPO_ROOT,
  'workers',
  'oursharedevents',
  'src',
  'lib',
  'sponsor-resolver.ts'
);
const SPONSOR_ALLOCATION_PATH = join(
  REPO_ROOT,
  'workers',
  'oursharedevents',
  'src',
  'lib',
  'sponsor-allocation.ts'
);
const MIGRATION_PATH = join(
  REPO_ROOT,
  'workers',
  'oursharedevents',
  'migrations',
  '0036_add_is_local_to_sponsors.sql'
);

test.describe('Invariant 5: Local Sponsor Covenant — display-priority structure', () => {
  test('OSE-330 | FE | code shape | SponsorRow interface declares is_local', () => {
    expect(existsSync(SPONSOR_RESOLVER_PATH)).toBe(true);
    const resolver = readFileSync(SPONSOR_RESOLVER_PATH, 'utf8');
    // is_local must be declared on the SponsorRow interface. If removed,
    // tierSort would lose its level-1 input and the covenant breaks.
    expect(resolver, 'SponsorRow must declare is_local field').toMatch(
      /interface\s+SponsorRow[^}]*is_local:\s*number/s
    );
  });

  test('OSE-330 | FE | code shape | tierSort checks is_local BEFORE tier priority', () => {
    const resolver = readFileSync(SPONSOR_RESOLVER_PATH, 'utf8');
    // Extract the tierSort function body to assert ordering of comparisons.
    const tierSortMatch = resolver.match(/function\s+tierSort\([^)]*\)[^{]*\{([\s\S]*?)\n\}/);
    expect(tierSortMatch, 'tierSort function must exist in sponsor-resolver.ts').not.toBeNull();
    const body = tierSortMatch![1];
    // is_local comparison MUST appear before the TIER_PRIORITY lookup.
    const isLocalIdx = body.indexOf('is_local');
    const tierPriorityIdx = body.indexOf('TIER_PRIORITY');
    expect(isLocalIdx, 'tierSort must reference is_local').toBeGreaterThan(-1);
    expect(tierPriorityIdx, 'tierSort must reference TIER_PRIORITY').toBeGreaterThan(-1);
    expect(
      isLocalIdx,
      'is_local comparison MUST appear before TIER_PRIORITY in tierSort — otherwise tier could push a non-local above a local, breaking the covenant'
    ).toBeLessThan(tierPriorityIdx);
  });

  test('OSE-330 | FE | code shape | sponsor-allocation.ts (OSE consumed brain copy) exists', () => {
    expect(
      existsSync(SPONSOR_ALLOCATION_PATH),
      'src/lib/sponsor-allocation.ts must exist — mirrors brain canonical per ADR-012'
    ).toBe(true);
    const alloc = readFileSync(SPONSOR_ALLOCATION_PATH, 'utf8');
    // Required exports — drift detection (OSE-336 future) will validate
    // these against brain ocr-docs-brain/sponsor-allocation.yaml.
    expect(alloc).toContain('export const SPONSOR_ALLOCATION');
    expect(alloc).toContain("'locals_first'");
    expect(alloc).toContain("'is_local'");
  });

  test('OSE-330 | FE | code shape | migration 0036 adds is_local column to sponsors', () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
    const migration = readFileSync(MIGRATION_PATH, 'utf8');
    expect(migration).toMatch(/ALTER\s+TABLE\s+sponsors\s+ADD\s+COLUMN\s+is_local/i);
    expect(migration, 'is_local must default to 0 for backward compat').toMatch(/DEFAULT\s+0/i);
  });

  test('OSE-330 | FE | code shape | covenant brand promise is documented in resolver header', () => {
    const resolver = readFileSync(SPONSOR_RESOLVER_PATH, 'utf8');
    // The resolver header MUST explain the covenant so future contributors
    // reading the file understand why is_local takes precedence. If this
    // comment block falls out, the next contributor risks "optimizing"
    // tierSort back to tier-only without knowing why.
    expect(resolver, 'resolver header must reference the Local Sponsor Covenant').toMatch(
      /Local Sponsor Covenant/i
    );
    expect(resolver, 'resolver header must reference Invariant #5').toMatch(/Invariant #5/i);
  });

  test('OSE-330 | FE | code shape | brain canonical is the cited source of truth', () => {
    const alloc = readFileSync(SPONSOR_ALLOCATION_PATH, 'utf8');
    // The OSE consumed copy MUST cite ocr-docs-brain/sponsor-allocation.yaml
    // as its source of truth — this is the per-file marker that drift
    // check (OSE-336) will lock onto when it ships.
    expect(alloc).toMatch(/ocr-docs-brain\/sponsor-allocation\.yaml/);
  });
});
