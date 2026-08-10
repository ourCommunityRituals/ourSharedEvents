/**
 * Regulatory label unavailable by construction (OSE-380 / Invariant #4).
 *
 * PO ruling (2026-08-10): COPPA (Phase 5) and HIPAA (Phase 4) are NOT supported
 * at launch, so the label must not be OFFERED. "The kid label will not be
 * available, making a mix-up impossible / explicit." Family-friendly is a
 * general-audience attribute (general pool, available now); only events
 * explicitly marketed to / directed at children are COPPA — those verticals
 * (e.g. carnivals) wait until Phase 5 clearance is built. An adult church
 * meeting ships now (general); a carnival waits.
 *
 * The guarantee today is by construction: the event create/update API does not
 * expose `legal_clearance_tier`, so every app-created event takes the DB default
 * (Phase 1 → 'general'/adult pool, migration 0023). This suite locks that so it
 * cannot silently regress when Phase 2+ is built — if someone makes the tier
 * settable without gating it behind the regulatory.phaseN flags, this goes red.
 *
 * Companion backstop: phaseToPool() fails CLOSED on any unrecognized tier
 * (see tests/shared-report-bigquery-export.spec.ts) so even a tier that reaches
 * the DB via seed/migration error is withheld from export, never leaked to
 * the general pool.
 */

import { describe, test, expect } from 'vitest';
import { env } from 'cloudflare:test';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}
const tenv = () => env as unknown as TestEnv;
const normalizePath = (p: string) => p.replace(/\\/g, '/');

function eventsSource(): string {
  const sources = JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
  const key = Object.keys(sources).find((k) => normalizePath(k).includes('handlers/events'));
  expect(key, 'handlers/events.ts must be in TEST_SOURCE_FILES_JSON').toBeDefined();
  return sources[key!]!;
}

describe('Regulatory label unavailable — legal_clearance_tier is not settable via the API', () => {
  // @born-red | method: design-time-negative-assertion | date: 2026-08-10
  test('handleUpdateEvent allowedFields does NOT contain legal_clearance_tier', () => {
    const src = eventsSource();
    const allowedIdx = src.indexOf('const allowedFields');
    expect(allowedIdx, 'allowedFields dict must exist in events.ts').toBeGreaterThan(0);
    const blockStart = src.indexOf('{', allowedIdx);
    const blockEnd = src.indexOf('};', blockStart);
    const allowedBlock = src.slice(blockStart, blockEnd);
    expect(
      allowedBlock.includes('legal_clearance_tier'),
      'legal_clearance_tier must not be settable via update — regulated phases are not offered at launch'
    ).toBe(false);
  });

  test('handleCreateEvent INSERT does NOT set legal_clearance_tier (defaults to Phase 1 / general)', () => {
    const src = eventsSource();
    const createIdx = src.indexOf('export async function handleCreateEvent');
    expect(createIdx, 'handleCreateEvent must exist').toBeGreaterThan(0);
    const updateIdx = src.indexOf('export async function handleUpdateEvent');
    const createBody = src.slice(createIdx, updateIdx > createIdx ? updateIdx : undefined);
    // The INSERT column list in handleCreateEvent must not mention the tier —
    // creation cannot label an event HIPAA (4) or COPPA (5).
    const insertIdx = createBody.indexOf('INSERT INTO events');
    expect(insertIdx, 'handleCreateEvent must INSERT INTO events').toBeGreaterThan(0);
    const insertBlock = createBody.slice(insertIdx, createBody.indexOf('VALUES', insertIdx));
    expect(
      insertBlock.includes('legal_clearance_tier'),
      'legal_clearance_tier must not be set at create — app-created events are Phase 1 (general/adult) by default'
    ).toBe(false);
  });
});
