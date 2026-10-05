/**
 * INVARIANT 7: Aggregate-Only Reporting
 *
 * SharedReport endpoints must return aggregates only — never individual
 * attendee records or raw anonymous identifiers. This closes the privacy
 * story on the output side: Invariant #1 (Anonymous ID) guards the data
 * at rest and in transit; this invariant guards what the reports actually
 * surface.
 *
 * Brain Invariant #7 (aggregate_only_reporting):
 *   - status: partial (gate in 0-architecture suite — promotes to live
 *     once this file ships green)
 *   - brain canonical: OCR-docs/ocr-docs-brain/architectural-invariants.yaml
 *   - companion tests:
 *     workers/oursharedevents/tests/shared-report-pipeline-invariants.spec.ts
 *     (Gate 1: no FORMS_DB; Gate 4: cron-only materialization)
 *     workers/oursharedevents/tests/shared-report-read.spec.ts
 *     (behavioural integration — read API auth + response shape)
 *
 * Pyramid coverage for this invariant:
 *   L0 STATIC (this file)     — code shape: anon_id_hash never projected;
 *                               SharedReport interface has no raw identity
 *                               fields; min-sample suppression guard exists;
 *                               corridor map suppression exists
 *   L1 IN-PROCESS             — shared-report-pipeline-invariants.spec.ts
 *                               (no FORMS_DB reads, cron-only write path)
 *                               shared-report-read.spec.ts (response shape)
 *   T4 DEPLOYED (planned)     — aggregate-only.invariant.spec.ts expansion
 *                               once staging is live (verify no anon_id_hash
 *                               surfaces in a real HTTP response)
 *
 * What this invariant catches:
 *   - A future refactor adds `SELECT anon_id_hash, ...` to a builder query
 *     → CI fails (anon_id_hash projection regex matches) → raw identity leak
 *     prevented before PR merges
 *   - Someone weakens the return_rate gate below the platform floor K, or
 *     brings back a private threshold constant
 *     → CI fails (gate check fails) → de-anonymization via small-sample
 *     percentages would slip through (e.g., return_rate=50% with 2 attendees
 *     narrows a returner to one of two specific people)
 *   - A suppression detail starts printing an observed count (OSE-1421)
 *   - A new field is added to SharedReport that includes raw identity data
 *     (e.g., an email, a raw hash) → the interface scan catches it
 *   - The corridor map suppression below-minimum-privacy-floor is removed
 *     → CI fails (suppression regex misses)
 *
 * Pattern reference: pii-retention.invariant.spec.ts (same readFileSync
 * L0 structural approach using Playwright with Node fs access).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const BUILDER_PATH = join(
  REPO_ROOT,
  'workers',
  'oursharedevents',
  'src',
  'lib',
  'shared-report-builder.ts'
);
const REPORT_DEPTH_PATH = join(
  REPO_ROOT,
  'workers',
  'oursharedevents',
  'src',
  'lib',
  'report-depth.ts'
);

test.describe('Invariant 7: Aggregate-Only Reporting — structural code-shape lock', () => {
  test('OSE-INV7 | privacy | existence | shared-report-builder.ts exists', () => {
    expect(
      existsSync(BUILDER_PATH),
      'workers/oursharedevents/src/lib/shared-report-builder.ts must exist — ' +
        'deleting it removes the aggregate-only enforcement layer'
    ).toBe(true);
  });

  test('OSE-INV7 | privacy | anon_id | anon_id_hash is never a SELECT projection in the builder', () => {
    const src = readFileSync(BUILDER_PATH, 'utf8');

    // Any pattern that looks like: SELECT [anything,] anon_id_hash [anything]
    // would project the raw hash into query results and violate the invariant.
    // Legitimate uses: COUNT(DISTINCT anon_id_hash), WHERE anon_id_hash IN (...),
    // AND a.anon_id_hash IN (...) — these do NOT project the value.
    //
    // The regex matches: SELECT<anything>anon_id_hash that is NOT inside COUNT(...)
    // We do this by checking for the pattern outside a COUNT context.
    // Conservative assertion: anon_id_hash must NEVER appear after SELECT as
    // a bare column reference (without being wrapped in COUNT or IN).
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip lines that are comments
      if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
      // Flag any SELECT line that mentions anon_id_hash as a projection.
      // Allowed: COUNT(DISTINCT anon_id_hash), IN (...anon_id_hash...), WHERE anon_id_hash
      // Disallowed: SELECT anon_id_hash ..., , anon_id_hash, ...
      if (/\bSELECT\b[^;]*\banon_id_hash\b/i.test(line)) {
        // It's OK if it's inside COUNT(DISTINCT ...) — that's an aggregate.
        // Handle table-aliased forms like COUNT(DISTINCT a.anon_id_hash).
        const countPattern = /COUNT\s*\(\s*DISTINCT\s+(?:\w+\.)?anon_id_hash\s*\)/i;
        const inSubqueryPattern = /IN\s*\(\s*SELECT\s+(?:\w+\.)?anon_id_hash\s+FROM/i;
        if (countPattern.test(line) || inSubqueryPattern.test(line)) continue;
        // Also OK if anon_id_hash appears only in a subquery SELECT within a WHERE clause
        // (the outer SELECT does not project it — the subquery returns it for IN matching)
        // Check if the whole query context is a subquery for IN
        // We look a few lines ahead/behind for context
        const context = lines.slice(Math.max(0, i - 3), i + 4).join('\n');
        if (/\bIN\s*\(\s*SELECT\s+anon_id_hash/i.test(context)) continue;
        expect
          .soft(
            false,
            `Line ${i + 1}: anon_id_hash appears as a SELECT projection — ` +
              `this would expose a raw anon identifier in the report output:\n  ${line.trim()}\n` +
              `Invariant #7 requires aggregate-only output. Use COUNT(DISTINCT anon_id_hash) instead.`
          )
          .toBe(true);
      }
    }
  });

  test('OSE-INV7 | privacy | interface | SharedReport TypeScript interface has no raw identity fields', () => {
    const src = readFileSync(BUILDER_PATH, 'utf8');
    // The exported SharedReport interface must not include fields that could
    // carry raw identity data. If anyone adds `anon_id_hash: string` or
    // `email: string` to the interface, this gate fails.
    const interfaceMatch = src.match(/export\s+interface\s+SharedReport\s*\{([\s\S]*?)\n\}/);
    expect(
      interfaceMatch,
      'SharedReport interface must be defined and exported from shared-report-builder.ts'
    ).not.toBeNull();

    const interfaceBody = interfaceMatch![1];
    expect(
      interfaceBody,
      'SharedReport interface must not contain anon_id_hash field — ' +
        'raw identifier would bypass the aggregate-only guarantee'
    ).not.toMatch(/\banon_id_hash\b/);
    expect(
      interfaceBody,
      'SharedReport interface must not contain email field — ' +
        'PII must not surface in aggregate reports'
    ).not.toMatch(/\bemail\b/);
    expect(
      interfaceBody,
      'SharedReport interface must not contain anon_id field — ' + 'raw identifier field variant'
    ).not.toMatch(/\banon_id\b(?!_hash)/);
  });

  test('OSE-INV7 | privacy | suppression | return_rate gates at the platform floor K >= 5, not a private constant', () => {
    const src = readFileSync(BUILDER_PATH, 'utf8');
    // A return_rate percentage is only safe to publish when the sample is large
    // enough that it cannot narrow down a single individual (50% over 2 attendees
    // names one specific returner). OSE-1421: the gate was a private
    // RETURN_RATE_MIN_SAMPLE = 3, below the platform floor every other aggregate
    // uses. It now reads CORRIDOR_MAP_MIN_COUNT (K), so there is ONE floor.
    expect(
      src,
      'a private RETURN_RATE_MIN_SAMPLE constant must not come back: return_rate shares the platform floor'
    ).not.toMatch(/RETURN_RATE_MIN_SAMPLE\s*=/);
    expect(
      src,
      'builder must gate return_rate computation on `distinctAnonsHere >= CORRIDOR_MAP_MIN_COUNT` — ' +
        'a missing or weaker guard lets small-sample percentages expose de-anonymizing data'
    ).toMatch(/if\s*\(\s*distinctAnonsHere\s*>=\s*CORRIDOR_MAP_MIN_COUNT\s*\)/);

    const floorSrc = readFileSync(
      join(REPO_ROOT, 'workers', 'oursharedevents', 'src', 'lib', 'shared-report.ts'),
      'utf8'
    );
    const floor = floorSrc.match(/export const CORRIDOR_MAP_MIN_COUNT\s*=\s*(\d+)/);
    expect(floor, 'CORRIDOR_MAP_MIN_COUNT must be exported from shared-report.ts').not.toBeNull();
    expect(
      parseInt(floor![1], 10),
      'the platform floor K must stay >= 5 (return_rate and every other aggregate share it)'
    ).toBeGreaterThanOrEqual(5);
  });

  test('OSE-INV7 | privacy | suppression | return_rate is suppressed (nulled) when below the floor', () => {
    const src = readFileSync(BUILDER_PATH, 'utf8');
    // The guard must result in suppression being recorded (push to suppression array)
    expect(
      src,
      'builder must push a suppression reason when distinctAnonsHere < CORRIDOR_MAP_MIN_COUNT'
    ).toMatch(/field:\s*'return_rate'[\s\S]{0,80}below_min_sample_size/);
  });

  test('OSE-INV7 | privacy | suppression | a suppression detail never interpolates an observed count', () => {
    const src = readFileSync(BUILDER_PATH, 'utf8');
    // A suppression string that prints the count it hides is the count (OSE-1421).
    // A detail may name a floor constant, never a per-event observation.
    const details = [...src.matchAll(/detail:\s*`([^`]*)`/g)].map((m) => m[1]);
    expect(details.length, 'builder carries suppression details').toBeGreaterThan(0);
    for (const d of details) {
      const interpolations = [...d.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1].trim());
      for (const expr of interpolations) {
        expect(
          /^(CORRIDOR_MAP_MIN_COUNT|CORRIDOR_BASELINE_MIN_SAMPLE)$/.test(expr),
          `suppression detail \`${d}\` interpolates \`${expr}\` — only the published floors may appear, never an observed count`
        ).toBe(true);
      }
    }
  });

  test('OSE-INV7 | privacy | suppression | corridor_map applies privacy floor (cell suppression)', () => {
    const src = readFileSync(BUILDER_PATH, 'utf8');
    // The corridor map renders H3 cells with scan densities. A cell with
    // very few scans could expose that a single person was at a specific
    // location. The renderCorridorMap() function takes a suppressed[] array
    // and the builder records suppressed cells in _meta.suppression_reasons.
    // If this suppression is removed, low-density cells expose location data.
    expect(
      src,
      'builder must record suppressed corridor map cells in suppression reasons — ' +
        'missing suppression means low-density cells expose attendee location data'
    ).toMatch(/suppressedCells/);

    expect(
      src,
      'suppressed corridor map cells must be pushed to the suppression array — ' +
        'consumers must be informed which cells were withheld'
    ).toMatch(/suppression\.push\s*\(\s*\{[\s\S]*?corridor_map/);
  });

  test('OSE-INV7 | privacy | suppression | corridor_density.this_event_count is K-anon floored, not raw (DS-01)', () => {
    const src = readFileSync(BUILDER_PATH, 'utf8');
    // DS-01 (Critical): corridor_density.this_event_count is derived from
    // COUNT(DISTINCT anon_id_hash) at this event — a raw small-cohort count that
    // can be 1–4. It MUST route through the same uniform K-anon floor
    // (applyCountFloor, K = CORRIDOR_MAP_MIN_COUNT = 5) that every other aggregate
    // in this report uses; otherwise the SharedReport publishes an exact sub-K
    // count that the corridor map, return_rate, and count-floor doctrine all hide.
    //
    // The raw assignment `thisEventCount = distinctAnonsHere` (no floor) is the
    // leak. This gate is born-red against that reversion: it asserts the RAW
    // assignment is absent AND the floored assignment is present.
    expect(
      src,
      'DS-01: this_event_count must NOT be assigned the raw distinctAnonsHere — ' +
        'that publishes an exact sub-K distinct-anon count with no privacy floor. ' +
        'Assign it from applyCountFloor(distinctAnonsHere).count instead.'
    ).not.toMatch(/thisEventCount\s*=\s*distinctAnonsHere\s*;/);

    // The floored assignment must be present: thisEventCount is set from an
    // applyCountFloor result whose .count is null below K.
    expect(
      src,
      'DS-01: this_event_count must be derived from applyCountFloor(distinctAnonsHere) — ' +
        'sub-K counts must be suppressed (null), >= K counts exact.'
    ).toMatch(/applyCountFloor\s*\(\s*distinctAnonsHere\s*\)/);

    // density_ratio must not re-expose the raw numerator when the count is
    // suppressed: the ratio computation must be guarded on thisEventCount being
    // non-null (raw = ratio * baseline would otherwise recover the exact sub-K
    // numerator). Reverting the guard to the unconditional
    // `densityRatio3?d = thisEventCount / baseline.window_?d_count` makes this fail.
    expect(
      src,
      'DS-01: density_ratio_30d must be null when this_event_count is suppressed — ' +
        'guard the ratio on `thisEventCount !== null` so it cannot divide out the raw sub-K count.'
    ).toMatch(
      /densityRatio30d\s*=\s*\r?\n?\s*thisEventCount\s*!==\s*null\s*\?\s*thisEventCount\s*\/\s*baseline\.window_30d_count\s*:\s*null/
    );
    expect(
      src,
      'DS-01: density_ratio_90d must be null when this_event_count is suppressed — ' +
        'guard the ratio on `thisEventCount !== null`.'
    ).toMatch(
      /densityRatio90d\s*=\s*\r?\n?\s*thisEventCount\s*!==\s*null\s*\?\s*thisEventCount\s*\/\s*baseline\.window_90d_count\s*:\s*null/
    );
  });

  test('OSE-INV7 | privacy | interface | report-depth.ts exists (tier-gated access control)', () => {
    // filterReportByDepth() gates which report sections are surfaced based
    // on the token's depth claim. This is a product-tier gate, not a privacy
    // gate, but its presence confirms that premium-only sections (corridor_map)
    // are not accidentally exposed to local-tier consumers.
    expect(
      existsSync(REPORT_DEPTH_PATH),
      'workers/oursharedevents/src/lib/report-depth.ts must exist — ' +
        'deleting it removes the premium-tier depth filter on SharedReport access'
    ).toBe(true);

    const src = readFileSync(REPORT_DEPTH_PATH, 'utf8');
    expect(
      src,
      'filterReportByDepth must be exported from report-depth.ts — ' +
        'this function gates corridor_map to premium consumers only'
    ).toMatch(/export\s+(function|const)\s+filterReportByDepth/);
  });

  test('OSE-INV7 | privacy | queries | all anon_id_hash SQL usages are aggregate or WHERE-only', () => {
    const src = readFileSync(BUILDER_PATH, 'utf8');
    // Enumerate all SQL template literals in the builder and check that
    // anon_id_hash only appears in:
    //   - COUNT(DISTINCT anon_id_hash)   — aggregate
    //   - WHERE anon_id_hash IN (...)    — filter predicate
    //   - AND a.anon_id_hash IN (...)    — join predicate
    // These are the only sanctioned uses. A SELECT anon_id_hash projection
    // or a GROUP BY anon_id_hash (which would enumerate identities) fails.
    const templateLiterals = src.match(/`[^`]+`/g) ?? [];
    for (const literal of templateLiterals) {
      if (!literal.includes('anon_id_hash')) continue;
      // Check for forbidden patterns: anon_id_hash as a SELECT column alias
      // e.g. "SELECT anon_id_hash," or "SELECT ..., anon_id_hash FROM"
      const selectProjection =
        /SELECT\s+(?:(?!COUNT\s*\().)*\banon_id_hash\b(?!\s*\))/i.test(literal) &&
        !/COUNT\s*\(\s*DISTINCT\s+anon_id_hash\s*\)/i.test(literal) &&
        !/IN\s*\(\s*SELECT\s+anon_id_hash\s+FROM/i.test(literal);

      expect
        .soft(
          selectProjection,
          'SQL template literal projects anon_id_hash as a column — violates aggregate-only ' +
            `invariant:\n  ${literal.slice(0, 200)}...`
        )
        .toBe(false);

      // GROUP BY anon_id_hash would enumerate unique identities — forbidden
      expect
        .soft(
          literal,
          'SQL template literal uses GROUP BY anon_id_hash — this enumerates individual ' +
            'identities and violates aggregate-only invariant'
        )
        .not.toMatch(/GROUP\s+BY\s+[^;]*\banon_id_hash\b/i);
    }
  });
});

// ── Digital tap counts are K-floored wherever they are aggregated ─────────────
// PO, 2026-09-30 (OSE-1357 poster tiers): the K=5 floor on digital reach is an
// INVARIANT, not a per-screen choice — so it is asserted as a PROPERTY over
// every src module that aggregates short-link taps (SUM(clicks)), derived by
// walking the tree (see this directory's README: property-asserting gates).
// A new module that sums taps is covered the day it is written. Each subject
// must route the counts through the one shared floor (applyCountFloor,
// lib/count-floor.ts) and must not carry its own numeric threshold.
// Physical placement scans are out of scope here: they are the organizer's
// own posters and stay exact for the organizer (event-stats.ts, OSE-896).

const WORKER_SRC = join(REPO_ROOT, 'workers', 'oursharedevents', 'src');
const SUMS_TAPS = /SUM\(\s*(?:\w+\.)?clicks\s*\)/i;
const LOCAL_THRESHOLD = /[<>]=?\s*5\b(?!\d)/;

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkTs(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test.describe('Invariant 7: digital tap counts are floored through applyCountFloor (property)', () => {
  test('OSE-INV7 | privacy | taps | negative control: the parser sees a tap aggregate', () => {
    expect(SUMS_TAPS.test('SELECT COALESCE(SUM(clicks), 0) AS cnt FROM shortlinks')).toBe(true);
    expect(SUMS_TAPS.test('SELECT SUM(s.clicks) FROM shortlinks s')).toBe(true);
    expect(SUMS_TAPS.test('UPDATE shortlinks SET clicks = clicks + 1')).toBe(false);
    expect(LOCAL_THRESHOLD.test('if (n < 5) return')).toBe(true);
    expect(LOCAL_THRESHOLD.test('if (n < 50) return')).toBe(false);
  });

  test('OSE-INV7 | privacy | taps | every module that sums taps floors them (derived subjects)', () => {
    const subjects = walkTs(WORKER_SRC)
      .map((p) => [p, stripComments(readFileSync(p, 'utf8'))] as const)
      .filter(([, src]) => SUMS_TAPS.test(src));
    // A derived gate that finds nothing is indistinguishable from one that
    // looks at nothing: the tree has at least the pre-event card, the poster
    // reach picture and the SharedReport sponsor clicks today.
    expect(subjects.length, 'no tap aggregates found — the parser is blind').toBeGreaterThanOrEqual(
      3
    );
    for (const [p, src] of subjects) {
      const rel = p
        .slice(REPO_ROOT.length + 1)
        .split('\\')
        .join('/');
      expect(
        src,
        `${rel} aggregates short-link taps but never calls applyCountFloor — ` +
          'a digital count must pass the shared K=5 floor before it leaves the module'
      ).toMatch(/applyCountFloor\s*\(/);
      expect(
        src.match(LOCAL_THRESHOLD)?.[0] ?? null,
        `${rel} carries its own numeric floor — use applyCountFloor (one K, one place)`
      ).toBeNull();
    }
  });
});
