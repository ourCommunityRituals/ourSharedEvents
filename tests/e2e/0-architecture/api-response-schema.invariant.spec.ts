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
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
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

/** Extract the SELECT column list between a handler function and its FROM clause. */
function extractSelectColumns(src: string, handlerName: string): string[] {
  // Find the handler function definition
  const fnIdx = src.indexOf(`async function ${handlerName}`);
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

  test('OSE-INV16 | api | schema | every snapshot column is present in handleListEvents SELECT (public list)', () => {
    expect(existsSync(EVENTS_HANDLER), 'handlers/events.ts must exist').toBe(true);
    const src = readFileSync(EVENTS_HANDLER, 'utf8');
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));

    const listEndpoint = snapshot.endpoints['GET /api/v2/events'];
    expect(listEndpoint, 'snapshot must define GET /api/v2/events endpoint').toBeTruthy();

    const selectCols = extractSelectColumns(src, 'handleListEvents');
    expect(
      selectCols.length,
      'handleListEvents SELECT must project at least 10 columns — if this fails, the column extractor regex needs updating'
    ).toBeGreaterThan(9);

    for (const col of listEndpoint.projected_columns as string[]) {
      expect(
        selectCols,
        `handleListEvents SELECT is missing '${col}' — ` +
          `this field is in the snapshot contract (v${snapshot.version}); ` +
          'removing it breaks public list consumers. To intentionally remove it, ' +
          'also remove it from public-events.snapshot.json and bump the version.'
      ).toContain(col);
    }
  });

  test('OSE-INV16 | api | schema | every snapshot column is present in handleGetEvent SELECT (public detail)', () => {
    const src = readFileSync(EVENTS_HANDLER, 'utf8');
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));

    const detailEndpoint = snapshot.endpoints['GET /api/v2/events/:id'];
    expect(detailEndpoint, 'snapshot must define GET /api/v2/events/:id endpoint').toBeTruthy();

    const selectCols = extractSelectColumns(src, 'handleGetEvent');
    expect(
      selectCols.length,
      'handleGetEvent SELECT must project at least 10 columns — if this fails, the column extractor regex needs updating'
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
});
