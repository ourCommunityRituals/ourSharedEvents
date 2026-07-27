/**
 * INVARIANT 21: SharedReport Schema Stability
 *
 * Brain Invariant #21 (shared_report_schema_stability):
 *   - status: live (structural gate is the enforcement mechanism)
 *   - group: product_experience
 *   - brain canonical: OCR-docs/ocr-docs-brain/architectural-invariants.yaml
 *
 * The SharedReport surface (/api/v2/events/:id/shared-report and the batch
 * endpoint /api/v2/events/shared-reports/batch) is consumed by enterprise
 * sponsors and organizers. It carries the campaign comparison data that
 * enterprise clients use to evaluate cross-event performance: campaign_summary,
 * campaign_id/title on each sponsor_impressions row, sponsor_tier, is_local,
 * and impressions_by_surface.
 *
 * Without a schema lock, any of these fields could be silently removed from
 * the SharedReport interface in shared-report-builder.ts — the field disappears
 * from every SharedReport response, no compilation error, no API 500, just
 * a silent undefined in every enterprise client that reads it. The campaign
 * comparison feature becomes broken without any observable signal.
 *
 * The snapshot file at:
 *   workers/oursharedevents/src/api-schema-snapshots/shared-report.snapshot.json
 *
 * is the committed minimum interface contract. Removing a field MUST be
 * accompanied by removing it from the snapshot and bumping snapshot.version.
 * Adding new fields to the interface is always safe — this gate is a floor,
 * not a ceiling.
 *
 * What this spec locks:
 *   (a) The snapshot file exists at the canonical path
 *   (b) The snapshot has a version field
 *   (c) Every top_level_field in the snapshot appears in the SharedReport
 *       TypeScript interface definition in shared-report-builder.ts
 *   (d) Every sponsor_impressions_field in the snapshot appears in the
 *       sponsor_impressions array type definition
 *   (e) Every campaign_summary_field in the snapshot appears in the
 *       campaign_summary array type definition
 *   (f) report-depth.ts includes campaign_summary in the mid and premium
 *       depth tiers (enterprise access gate)
 *
 * Pattern reference: api-response-schema.invariant.spec.ts (same L0 structural
 * approach using a committed snapshot as the minimum contract floor).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SNAPSHOT_PATH = join(
  REPO_ROOT,
  'workers',
  'oursharedevents',
  'src',
  'api-schema-snapshots',
  'shared-report.snapshot.json'
);
const BUILDER_PATH = join(
  REPO_ROOT,
  'workers',
  'oursharedevents',
  'src',
  'lib',
  'shared-report-builder.ts'
);
const DEPTH_PATH = join(REPO_ROOT, 'workers', 'oursharedevents', 'src', 'lib', 'report-depth.ts');

/**
 * Extract the content of the SharedReport interface block from the builder
 * source. Returns the raw text between `export interface SharedReport {` and
 * its matching closing brace so field-name presence checks are scoped to
 * the interface definition, not the entire file.
 */
function extractInterfaceBlock(src: string): string {
  const marker = 'export interface SharedReport {';
  const start = src.indexOf(marker);
  if (start === -1) return '';
  let depth = 0;
  let i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return '';
}

test.describe('Invariant 21: SharedReport Schema Stability — structural interface lock', () => {
  test('OSE-INV21 | shared-report | schema | snapshot file exists at canonical path', () => {
    expect(
      existsSync(SNAPSHOT_PATH),
      'workers/oursharedevents/src/api-schema-snapshots/shared-report.snapshot.json must exist — ' +
        'this is the committed minimum SharedReport interface contract; without it every field ' +
        'removal (including campaign_summary, sponsor_tier, is_local) becomes silent'
    ).toBe(true);
  });

  test('OSE-INV21 | shared-report | schema | snapshot has a version field (enables explicit version bumps on breaking changes)', () => {
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
    expect(
      typeof snapshot.version,
      'snapshot must have a version field — bumping version makes breaking field removals visible in PR diffs'
    ).toBe('string');
    expect(snapshot.version.length, 'snapshot version must be non-empty').toBeGreaterThan(0);
  });

  test('OSE-INV21 | shared-report | interface | every top_level_field in the snapshot appears in SharedReport interface', () => {
    expect(existsSync(BUILDER_PATH), 'shared-report-builder.ts must exist').toBe(true);
    const src = readFileSync(BUILDER_PATH, 'utf8');
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));

    const interfaceBlock = extractInterfaceBlock(src);
    expect(
      interfaceBlock.length,
      'SharedReport interface block must be extractable from shared-report-builder.ts — ' +
        'if this fails, the interface was renamed or removed'
    ).toBeGreaterThan(0);

    for (const field of snapshot.top_level_fields as string[]) {
      expect(
        interfaceBlock,
        `SharedReport interface is missing top-level field '${field}' — ` +
          `this field is in the snapshot contract (v${snapshot.version}); ` +
          'removing it silently breaks every consumer that reads this field. ' +
          'To intentionally remove it, also remove it from shared-report.snapshot.json and bump the version.'
      ).toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  test('OSE-INV21 | shared-report | interface | every sponsor_impressions_field appears in the sponsor_impressions type', () => {
    const src = readFileSync(BUILDER_PATH, 'utf8');
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));

    // Extract the sponsor_impressions array type block — starts after
    // `sponsor_impressions: Array<{` and ends at the matching `}>`
    const marker = 'sponsor_impressions: Array<{';
    const start = src.indexOf(marker);
    expect(
      start,
      'sponsor_impressions: Array<{ must appear in shared-report-builder.ts'
    ).toBeGreaterThan(-1);

    const block = src.slice(start, src.indexOf('}>;', start) + 3);

    for (const field of snapshot.sponsor_impressions_fields as string[]) {
      expect(
        block,
        `sponsor_impressions type is missing field '${field}' — ` +
          `this field is in the snapshot contract (v${snapshot.version}); ` +
          'removing it breaks enterprise consumers that read sponsor tier, locality, or campaign data from each impression row'
      ).toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  test('OSE-INV21 | shared-report | interface | every campaign_summary_field appears in the campaign_summary type', () => {
    const src = readFileSync(BUILDER_PATH, 'utf8');
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));

    const marker = 'campaign_summary: Array<{';
    const start = src.indexOf(marker);
    expect(
      start,
      'campaign_summary: Array<{ must appear in shared-report-builder.ts'
    ).toBeGreaterThan(-1);

    const block = src.slice(start, src.indexOf('}>', start) + 2);

    for (const field of snapshot.campaign_summary_fields as string[]) {
      expect(
        block,
        `campaign_summary type is missing field '${field}' — ` +
          `this field is in the snapshot contract (v${snapshot.version}); ` +
          'removing it breaks the enterprise campaign comparison surface'
      ).toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  test('OSE-INV21 | shared-report | depth | campaign_summary is present in both mid and premium depth tiers', () => {
    expect(existsSync(DEPTH_PATH), 'report-depth.ts must exist').toBe(true);
    const src = readFileSync(DEPTH_PATH, 'utf8');

    // Extract the mid section of DEPTH_SECTIONS. The mid block starts after
    // `mid: [` and ends at the next `],`. campaign_summary must appear there.
    const midStart = src.indexOf('mid: [');
    expect(midStart, 'DEPTH_SECTIONS.mid must exist in report-depth.ts').toBeGreaterThan(-1);
    const midBlock = src.slice(midStart, src.indexOf('],', midStart));

    expect(
      midBlock,
      'campaign_summary must be in DEPTH_SECTIONS.mid — ' +
        'enterprise sponsors at the mid depth tier need campaign comparison data; ' +
        'removing it from mid silently hides the entire campaign surface from mid-tier tokens'
    ).toContain("'campaign_summary'");

    const premiumStart = src.indexOf('premium: [');
    expect(premiumStart, 'DEPTH_SECTIONS.premium must exist in report-depth.ts').toBeGreaterThan(
      -1
    );
    const premiumBlock = src.slice(premiumStart, src.indexOf('],', premiumStart));

    expect(
      premiumBlock,
      'campaign_summary must be in DEPTH_SECTIONS.premium — ' +
        'premium-depth tokens must include campaign_summary for full enterprise access'
    ).toContain("'campaign_summary'");
  });
});
