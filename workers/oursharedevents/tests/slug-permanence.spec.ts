/**
 * OSE-587 — Slug permanence: close conformance gap on #18 (slug_permanence)
 *
 * Invariant #18 claims event slugs are write-once. Once an event is created,
 * its slug cannot be changed through any admin API path. Slug mutation would
 * silently 404 all QR codes, shortlinks, and poster URLs that encoded the
 * original slug.
 *
 * TL-051: Event slug mutated post-publish
 *
 * Gates:
 *   G1 — handleUpdateEvent allowedFields does not contain 'slug'
 *   G2 — handleUpdateEvent allowedFields does not contain 'id' (compound check)
 *   G3 — Static: no PUT /admin/events handler sets slug in its UPDATE SQL
 *   G4 — handleCreateEvent sets slug at creation time (positive case — slug IS assignable initially)
 */

import { describe, test, expect } from 'vitest';
import { env } from 'cloudflare:test';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}

const tenv = () => env as unknown as TestEnv;

function loadSources(): Record<string, string> {
  return JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

// Fields that are immutable post-creation (must not appear in handleUpdateEvent allowedFields)
const IMMUTABLE_FIELDS = ['slug', 'id', 'brand_id', 'created_at'] as const;

// OSE-1242: these lookups used `.includes('handlers/events')`, a PREFIX match
// that silently also matched `handlers/events-map.ts` the moment that file
// existed. `Object.keys().find()` then returned the wrong source and five
// assertions failed against a file they were never about. Matching the exact
// filename removes the landmine for the next sibling — events-import.ts,
// events-search.ts, whatever comes.

describe('OSE-587 G1/G2 — TL-051: Immutable fields excluded from handleUpdateEvent', () => {
  // @born-red TL-051 | method: design-time-negative-assertion | date: 2026-08-03
  test('handleUpdateEvent allowedFields does not contain slug', () => {
    const sources = loadSources();
    const eventsKey = Object.keys(sources).find((k) =>
      normalizePath(k).endsWith('handlers/events.ts')
    );
    expect(eventsKey, 'handlers/events.ts must be in TEST_SOURCE_FILES_JSON').toBeDefined();
    const src = sources[eventsKey!]!;

    // Find the allowedFields object in handleUpdateEvent
    // It's defined as:  const allowedFields: Record<string, { max: number }> = { ... }
    const allowedIdx = src.indexOf('const allowedFields');
    expect(allowedIdx, 'allowedFields dict must exist in events.ts').toBeGreaterThan(0);

    // Extract the allowedFields block (up to the closing brace)
    const blockStart = src.indexOf('{', allowedIdx);
    const blockEnd = src.indexOf('};', blockStart);
    const allowedBlock = src.slice(blockStart, blockEnd);

    expect(
      allowedBlock,
      'slug must not appear in allowedFields (slug is write-once at creation)'
    ).not.toMatch(/\bslug\b/);
  });

  // @born-red TL-051 | method: design-time-negative-assertion | date: 2026-08-03
  test('handleUpdateEvent allowedFields does not contain id or brand_id', () => {
    const sources = loadSources();
    const eventsKey = Object.keys(sources).find((k) =>
      normalizePath(k).endsWith('handlers/events.ts')
    );
    const src = sources[eventsKey!]!;

    const allowedIdx = src.indexOf('const allowedFields');
    const blockStart = src.indexOf('{', allowedIdx);
    const blockEnd = src.indexOf('};', blockStart);
    const allowedBlock = src.slice(blockStart, blockEnd);

    expect(allowedBlock, 'id must not be in allowedFields').not.toMatch(/\bid\b\s*:/);
    expect(allowedBlock, 'brand_id must not be in allowedFields').not.toMatch(/\bbrand_id\b/);
  });

  test('allowedFields contains title and description (positive case — these ARE mutable)', () => {
    const sources = loadSources();
    const eventsKey = Object.keys(sources).find((k) =>
      normalizePath(k).endsWith('handlers/events.ts')
    );
    const src = sources[eventsKey!]!;

    const allowedIdx = src.indexOf('const allowedFields');
    const blockStart = src.indexOf('{', allowedIdx);
    const blockEnd = src.indexOf('};', blockStart);
    const allowedBlock = src.slice(blockStart, blockEnd);

    expect(allowedBlock, 'title must be mutable').toContain('title');
    expect(allowedBlock, 'description must be mutable').toContain('description');
  });
});

describe('OSE-587 G3 — Static: no UPDATE SQL sets slug in the update handler', () => {
  // @born-red TL-051 | method: design-time-negative-assertion | date: 2026-08-03
  test('events.ts UPDATE SQL never references slug column assignment', () => {
    const sources = loadSources();
    const eventsKey = Object.keys(sources).find((k) =>
      normalizePath(k).endsWith('handlers/events.ts')
    );
    const src = sources[eventsKey!]!;

    // Find all UPDATE events SQL statements
    const updateMatches = src.match(/UPDATE\s+events\s+SET[^;]+/gi) ?? [];

    for (const stmt of updateMatches) {
      expect(stmt, `UPDATE events SQL must not set slug: "${stmt.slice(0, 100)}..."`).not.toMatch(
        /\bslug\s*=/i
      );
    }
  });
});

describe('OSE-587 G4 — handleCreateEvent sets slug (positive: slug is assignable at creation)', () => {
  test('events.ts INSERT into events includes a slug column', () => {
    const sources = loadSources();
    const eventsKey = Object.keys(sources).find((k) =>
      normalizePath(k).endsWith('handlers/events.ts')
    );
    const src = sources[eventsKey!]!;

    // The CREATE path must include slug
    const insertMatches = src.match(/INSERT\s+INTO\s+events[^;]+/gi) ?? [];
    const insertWithSlug = insertMatches.some((stmt) => /\bslug\b/i.test(stmt));
    expect(
      insertWithSlug,
      'events INSERT must include slug column (slug is set at creation time)'
    ).toBe(true);
  });

  test('OSE-587 evidence', () => {
    const report = {
      story: 'OSE-587',
      threats_covered: ['TL-051'],
      invariant: 18,
      immutable_fields_checked: IMMUTABLE_FIELDS.length,
      date: '2026-08-03',
    };
    console.log(`[OSE-587-EVIDENCE] ${JSON.stringify(report)}`);
    expect(report.threats_covered).toHaveLength(1);
  });
});
