/**
 * INVARIANT 16: API Response Schema Stability
 *
 * Brain Invariant #16 (api_response_schema_stability):
 *   - status: live (structural gate is the enforcement mechanism)
 *   - brain canonical: OCR-docs/ocr-docs-brain/architectural-invariants.yaml
 *
 * The public OSE API endpoints (GET /api/v2/events, GET /api/v2/events/:id)
 * are consumed by mobile clients, the five MVP surfaces, and external
 * integrations. A field removed from the SELECT without a conscious schema
 * version bump causes silent breakage: the mobile app sends a request,
 * receives a 200, and renders nothing because the field it depended on is
 * absent from the payload.
 *
 * The snapshot file at:
 *   workers/oursharedevents/src/api-schema-snapshots/public-events.snapshot.json
 *
 * is the committed minimum contract. Removing a field from the SELECT MUST
 * be accompanied by removing it from the snapshot and bumping snapshot.version.
 * Adding new fields to the SELECT is always safe — this gate is a floor, not
 * a ceiling. The version bump surfaces the break in a PR diff rather than
 * silently shipping broken mobile clients.
 *
 * What this spec locks:
 *   (a) The snapshot file exists at the canonical path
 *   (b) The snapshot has a version field
 *   (c) Every projected_column in the snapshot appears in the handleListEvents
 *       SELECT statement (public list endpoint)
 *   (d) Every projected_column in the snapshot appears in the handleGetEvent
 *       SELECT statement (public detail endpoint)
 *   (e) The public list handler returns the `items` envelope key
 *   (f) The public detail handler returns the `item` envelope key
 *   (g) enrichWithPhase is called on the list and detail results (so computed
 *       fields like `phase` are present on every response row)
 *
 * Pattern reference: slug-permanence.invariant.spec.ts (same L0 structural
 * approach reading source files via node:fs and asserting code shape).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');

const WORKER_SRC = join(REPO_ROOT, 'workers', 'oursharedevents', 'src');

/**
 * Locate `enrichWithPhase` by scanning the worker source.
 *
 * The canonical field mapping (OSE-844) is a property of the codebase, not of
 * one file. Searching for it means the gate survives the function moving —
 * which it did, in OSE-1243, and it moved for a good reason: making it a shared
 * module is what stopped the server-rendered page from skipping the enrichment
 * and serving nameless cards.
 */
function findEnrichWithPhase(): { src: string; where: string | null } {
  const stack = [WORKER_SRC];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      const src = readFileSync(full, 'utf8');
      if (src.includes('function enrichWithPhase')) return { src, where: full };
    }
  }
  return { src: '', where: null };
}
const SNAPSHOT_PATH = join(
  REPO_ROOT,
  'workers',
  'oursharedevents',
  'src',
  'api-schema-snapshots',
  'public-events.snapshot.json'
);
const EVENTS_HANDLER = join(
  REPO_ROOT,
  'workers',
  'oursharedevents',
  'src',
  'handlers',
  'events.ts'
);
// The public read path (handleListEvents / handleGetEvent) delegates to the
// DataProvider — the actual list/detail SELECT (and therefore the projected
// column contract) lives in fetchEvents / fetchEvent here. The column-schema
// checks below read this file; the envelope/enrichWithPhase checks still read
// EVENTS_HANDLER (those shapes stayed in the handler).
const DATA_PROVIDER = join(
  REPO_ROOT,
  'workers',
  'oursharedevents',
  'src',
  'lib',
  'data-provider.ts'
);
const POSTER_BUNDLE_HANDLER = join(
  REPO_ROOT,
  'workers',
  'oursharedevents',
  'src',
  'handlers',
  'poster-bundle.ts'
);

/** Extract the SELECT column list between a handler/method definition and its FROM clause. */
function extractSelectColumns(src: string, handlerName: string): string[] {
  // Find the function OR method definition — supports both
  // `async function handleListEvents(` and `private async fetchEvents(`.
  const fnMatch = src.match(new RegExp(`async\\s+(?:function\\s+)?${handlerName}\\s*\\(`));
  const fnIdx = fnMatch ? (fnMatch.index as number) : -1;
  if (fnIdx === -1) return [];

  // Find the first SELECT after the function definition
  const selectIdx = src.indexOf('SELECT', fnIdx);
  if (selectIdx === -1) return [];

  // Extract up to the FROM clause (the SELECT column list ends at FROM)
  const fromIdx = src.indexOf('\n       FROM', selectIdx);
  if (fromIdx === -1) return [];

  const columnBlock = src.slice(selectIdx + 'SELECT'.length, fromIdx);

  // Parse comma-separated column names (may have whitespace and newlines)
  return columnBlock
    .split(',')
    .map((col) => col.replace(/`/g, '').trim())
    .filter(Boolean);
}

test.describe('Invariant 16: API Response Schema Stability — structural code-shape lock', () => {
  test('OSE-INV16 | api | schema | snapshot file exists at canonical path', () => {
    expect(
      existsSync(SNAPSHOT_PATH),
      'workers/oursharedevents/src/api-schema-snapshots/public-events.snapshot.json must exist — ' +
        'this is the committed minimum API contract; delete it and every column removal becomes silent'
    ).toBe(true);
  });

  test('OSE-INV16 | api | schema | snapshot has a version field (enables explicit version bumps on breaking changes)', () => {
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
    expect(
      typeof snapshot.version,
      'snapshot must have a version field — version bumps make breaking column removals visible in PR diffs'
    ).toBe('string');
    expect(snapshot.version.length, 'snapshot version must be non-empty').toBeGreaterThan(0);
  });

  test('OSE-INV16 | api | schema | every snapshot column is present in the public list SELECT (DataProvider.fetchEvents)', () => {
    expect(existsSync(DATA_PROVIDER), 'lib/data-provider.ts must exist').toBe(true);
    const src = readFileSync(DATA_PROVIDER, 'utf8');
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));

    const listEndpoint = snapshot.endpoints['GET /api/v2/events'];
    expect(listEndpoint, 'snapshot must define GET /api/v2/events endpoint').toBeTruthy();

    // handleListEvents delegates to DataProvider.listEvents → fetchEvents, which
    // holds the actual public list SELECT.
    const selectCols = extractSelectColumns(src, 'fetchEvents');
    expect(
      selectCols.length,
      'public list SELECT (DataProvider.fetchEvents) must project at least 10 columns — if this fails, the column extractor regex needs updating'
    ).toBeGreaterThan(9);

    for (const col of listEndpoint.projected_columns as string[]) {
      expect(
        selectCols,
        `public list SELECT is missing '${col}' — ` +
          `this field is in the snapshot contract (v${snapshot.version}); ` +
          'removing it breaks public list consumers. To intentionally remove it, ' +
          'also remove it from public-events.snapshot.json and bump the version.'
      ).toContain(col);
    }
  });

  test('OSE-INV16 | api | schema | every snapshot column is present in the public detail SELECT (DataProvider.fetchEvent)', () => {
    const src = readFileSync(DATA_PROVIDER, 'utf8');
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));

    const detailEndpoint = snapshot.endpoints['GET /api/v2/events/:id'];
    expect(detailEndpoint, 'snapshot must define GET /api/v2/events/:id endpoint').toBeTruthy();

    // handleGetEvent delegates to DataProvider.getEvent → fetchEvent, which
    // holds the actual public detail SELECT.
    const selectCols = extractSelectColumns(src, 'fetchEvent');
    expect(
      selectCols.length,
      'public detail SELECT (DataProvider.fetchEvent) must project at least 10 columns — if this fails, the column extractor regex needs updating'
    ).toBeGreaterThan(9);

    for (const col of detailEndpoint.projected_columns as string[]) {
      expect(
        selectCols,
        `handleGetEvent SELECT is missing '${col}' — ` +
          `this field is in the snapshot contract (v${snapshot.version}); ` +
          'removing it breaks public detail consumers. To intentionally remove it, ' +
          'also remove it from public-events.snapshot.json and bump the version.'
      ).toContain(col);
    }
  });

  test('OSE-INV16 | api | envelope | handleListEvents returns items envelope key', () => {
    const src = readFileSync(EVENTS_HANDLER, 'utf8');
    // The public list response is { ok, status, items }. If `items` is renamed
    // (e.g. to `events` or `data`), every consumer that reads `.items` breaks.
    const fnIdx = src.indexOf('async function handleListEvents');
    const fnBlock = src.slice(fnIdx, fnIdx + 3000);
    expect(
      fnBlock,
      "handleListEvents must return an 'items' key in the response envelope — " +
        'renaming this key silently breaks every consumer of the public list endpoint'
    ).toMatch(/items['":\s]/);
  });

  // OSE-2042. `items` / `item` were the only envelope keys a gate held. Two
  // siblings sit beside them and consumers read both: `sponsor_titles` (the TV's
  // "also coming up") and `series` (ourWKRP's showcase build). The snapshot now
  // lists them, and each listed key must be written by its handler's success
  // response.
  //
  // @born-red OSE-2042 | method: `series` taken out of the list response, then
  // `sponsor_titles`, then `series` out of the detail response; then a sibling
  // taken out of the snapshot's list | date: 2026-11-14
  const ENVELOPES: Array<[string, string, string[]]> = [
    [
      'GET /api/v2/events',
      'handleListEvents',
      ['ok', 'status', 'items', 'sponsor_titles', 'series'],
    ],
    ['GET /api/v2/events/:id', 'handleGetEvent', ['ok', 'status', 'item', 'series']],
  ];

  /** The object literal of a handler's success response: from `ok: true` to its headers. */
  function successEnvelope(src: string, handler: string): string {
    const fnIdx = src.indexOf(`async function ${handler}`);
    const next = src.indexOf('\nexport async function ', fnIdx + 1);
    const fn = src.slice(fnIdx, next === -1 ? undefined : next);
    const at = fn.indexOf('ok: true');
    const end = fn.indexOf('headers:', at);
    return at === -1 || end === -1 ? '' : fn.slice(at, end);
  }

  for (const [endpoint, handler, expected] of ENVELOPES) {
    test(`OSE-INV16 | api | envelope | ${endpoint} snapshot lists its sibling keys`, () => {
      const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
      expect(
        snapshot.endpoints[endpoint].envelope_keys,
        'envelope_keys is the locked list of top-level response keys. To remove a key, remove it ' +
          'here, in the snapshot, and bump snapshot.version in the same change.'
      ).toEqual(expected);
    });

    test(`OSE-INV16 | api | envelope | ${handler} writes every envelope key in the snapshot`, () => {
      const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
      const envelope = successEnvelope(readFileSync(EVENTS_HANDLER, 'utf8'), handler);
      expect(envelope, `${handler} success response not found`).not.toBe('');
      const missing = (snapshot.endpoints[endpoint].envelope_keys as string[]).filter(
        (key) => !new RegExp(`(^|[\\s{,])${key}\\s*[:,}\\n]`).test(envelope)
      );
      expect(
        missing,
        `${handler} no longer writes these envelope keys (snapshot v${snapshot.version}). A ` +
          'consumer reads each one. To remove one on purpose, remove it from the snapshot and ' +
          'bump the version.'
      ).toEqual([]);
    });
  }

  test('OSE-INV16 | api | envelope | handleGetEvent returns item envelope key', () => {
    const src = readFileSync(EVENTS_HANDLER, 'utf8');
    // The public detail response is { ok, status, item }. If `item` is renamed,
    // every consumer that reads `.item` breaks.
    const fnIdx = src.indexOf('async function handleGetEvent');
    const fnBlock = src.slice(fnIdx, fnIdx + 2000);
    expect(
      fnBlock,
      "handleGetEvent must return an 'item' key in the response envelope — " +
        'renaming this key silently breaks every consumer of the public detail endpoint'
    ).toMatch(/\bitem['":\s]/);
  });

  test('OSE-INV16 | api | computed | enrichWithPhase is called on both list and detail results', () => {
    const src = readFileSync(EVENTS_HANDLER, 'utf8');
    // enrichWithPhase injects the `phase` computed field (EventPhase enum) that
    // all five surfaces use for lifecycle rendering. If it stops being called,
    // the phase field disappears from responses — surface rendering breaks silently.
    const listFnIdx = src.indexOf('async function handleListEvents');
    const listBlock = src.slice(listFnIdx, listFnIdx + 1500);
    expect(
      listBlock,
      'handleListEvents must call enrichWithPhase on items — ' +
        'this injects the computed phase field that all five surfaces depend on for lifecycle rendering'
    ).toMatch(/enrichWithPhase/);

    const detailFnIdx = src.indexOf('async function handleGetEvent');
    const detailBlock = src.slice(detailFnIdx, detailFnIdx + 2000);
    expect(
      detailBlock,
      'handleGetEvent must call enrichWithPhase on the result row — ' +
        'this injects the computed phase field'
    ).toMatch(/enrichWithPhase/);
  });

  // OSE-844 (X-10) — canonical field-name mapping. The DB columns are
  // title/start_date/location; every surface template reads name/startDateISO/
  // venue. enrichWithPhase is the single seam that bridges the two. This gate is
  // the object whose job is to go red if that mapping is deleted and the drift
  // returns (which is what silently rendered "Untitled Event" on the TV before).
  test('OSE-INV16 | api | fieldmap | enrichWithPhase maps title→name, start_date→startDateISO, location→venue', () => {
    // OSE-1246 — finds the function WHEREVER it lives, rather than naming a file.
    //
    // This gate previously read handlers/events.ts and asserted
    // `enrichWithPhase must exist in events.ts`. When OSE-1243 extracted the
    // function to lib/event-enrich.ts — so a second consumer could not skip it,
    // which was the whole point — this went red for a refactor that strictly
    // improved the thing it guards. The invariant is that THE MAPPING EXISTS
    // somewhere in the worker's source, not that a particular file holds it.
    //
    // The failure was benign, but the shape is not: a gate that a correct
    // refactor breaks is a gate people learn to route around.
    const { src, where } = findEnrichWithPhase();
    const fnIdx = src.indexOf('function enrichWithPhase');
    // Bound the read to the function body (up to the next top-level declaration).
    const body = src.slice(fnIdx, fnIdx + 1200);
    expect(where, 'enrichWithPhase must exist somewhere in the worker source').toBeTruthy();
    expect(
      body,
      'enrichWithPhase must emit `name` mapped from the `title` column — ' +
        'templates read `name`; without this the display featured card falls back to "Untitled Event"'
    ).toMatch(/name:\s*typeof row\.title/);
    expect(
      body,
      'enrichWithPhase must emit `startDateISO` mapped from the `start_date` column — ' +
        'templates read `startDateISO`; without this the date renders empty'
    ).toMatch(/startDateISO:\s*[\s\S]*row\.start_date/);
    expect(
      body,
      'enrichWithPhase must emit `venue` mapped from the `location` column — ' +
        'templates read `venue`; without this the venue and the display ticker render empty'
    ).toMatch(/venue:\s*typeof row\.location/);
  });

  test('OSE-INV16 | api | fieldmap | snapshot declares name/startDateISO/venue as computed fields on both endpoints', () => {
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
    for (const ep of ['GET /api/v2/events', 'GET /api/v2/events/:id']) {
      const computed = (snapshot.endpoints[ep]?.computed_fields ?? []) as string[];
      for (const field of ['name', 'startDateISO', 'venue']) {
        expect(
          computed,
          `${ep} must declare '${field}' in computed_fields — ` +
            'the API emits it (mapped in enrichWithPhase) and the contract snapshot must record it (v1.1.0, OSE-844)'
        ).toContain(field);
      }
    }
  });

  // OSE-842 (X-9) — poster-bundle's `status` used to mean two things: a numeric
  // HTTP status on the 404/403 error paths and the event-state string ('active',
  // …) on the success path. That polymorphism forced every consumer to know which
  // path it was on. The success envelope now emits a numeric `status` and moves
  // the event-state string to `eventStatus`, so `status` means exactly one thing
  // (the HTTP status) on every path. This gate keeps the collision from returning.
  test('OSE-INV16 | poster-bundle | status | success envelope reserves numeric status and moves event-state to eventStatus (OSE-842)', () => {
    expect(existsSync(POSTER_BUNDLE_HANDLER), 'handlers/poster-bundle.ts must exist').toBe(true);
    const src = readFileSync(POSTER_BUNDLE_HANDLER, 'utf8');

    // The event-state string must live under `eventStatus`.
    expect(
      src,
      'poster-bundle success envelope must emit `eventStatus: row.status` — the event-state ' +
        'string may not sit under `status` (that field is the numeric HTTP status on every path)'
    ).toMatch(/eventStatus:\s*row\.status/);

    // The collision must be gone: `status` must never be bound to the event-state string.
    expect(
      src,
      'poster-bundle must not bind `status` to the event-state string `row.status` — ' +
        'use `eventStatus` for the state and reserve `status` for the numeric HTTP code'
    ).not.toMatch(/\bstatus:\s*row\.status/);

    // The success path must emit a numeric status, matching the 404/403 error paths.
    expect(
      src,
      'poster-bundle success envelope must emit a numeric `status: 200` so `status` is the ' +
        'HTTP status on every path'
    ).toMatch(/status:\s*200/);
  });
});
