/**
 * OSE-1438 — a sponsor gets a card_url only when its card renders.
 *
 * The public card (GET /sponsors/:id) renders only for a sponsor that is on
 * show: an active placement, accepted by both sides, on an active event. The
 * resolver used to hand EVERY sponsor a card_url, so with Path 2 (template +
 * geo auto-match, ADR-019, dark at launch) on, a matched business with no
 * accepted placement anywhere got a tap that landed on a 404.
 *
 * Both now read one rule, SPONSOR_ON_SHOW_SQL (lib/sponsor-card.ts), so the
 * link and the page cannot disagree. Every case below asserts the pair:
 * card_url present ⟺ the card answers 200.
 *
 * @born-red OSE-1438 | method: spec run against origin/main (79de722) with
 *   src unchanged — the Path 2 no-placement case and the draft-only case got
 *   a card_url whose card 404s (red); green with the change | date: 2026-10-01
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { seedSplitSponsor } from './helpers/seed-sponsor';
import { resolveSponsorsForEvent } from '../src/lib/sponsor-resolver';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes('duplicate column name') || m.includes('already exists')) continue;
      throw e;
    }
  }
}

const BRAND = 'ose1438';
const TEMPLATE = 'bar_night'; // seeded by migration 0014 (FK target)
const EVENT = 'ose1438-evt'; // active, has the template: where Path 2 resolves
const OTHER = 'ose1438-other'; // active, no template: a real accepted placement
const DRAFT = 'ose1438-draft'; // draft: a placement here is not "on show"

async function seedEvent(id: string, status: string, templateId: string | null) {
  await env.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, template_id)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`
  )
    .bind(id, BRAND, `Event ${id}`, id, status, templateId)
    .run();
}

/** A pool business: subscribed to the template, no placement of its own. */
async function seedPoolBusiness(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sponsor_business (id, brand_id, name, website_url) VALUES (?, ?, ?, NULL)`
  )
    .bind(id, BRAND, `Pool ${id}`)
    .run();
  await subscribe(id);
}

async function subscribe(id: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO sponsor_event_types (id, sponsor_id, template_id) VALUES (?, ?, ?)'
  )
    .bind(`set_${id}`, id, TEMPLATE)
    .run();
}

async function cardStatus(id: string): Promise<number> {
  const res = await SELF.fetch(`https://t.test/sponsors/${encodeURIComponent(id)}`);
  return res.status;
}

async function resolved(id: string) {
  const rows = await resolveSponsorsForEvent(env.DB, EVENT, { geoMatchEnabled: true });
  const row = rows.find((r) => r.id === id);
  expect(row, `${id} should resolve on ${EVENT}`).toBeDefined();
  return row!;
}

beforeAll(async () => {
  await applyMigrations();
  await seedEvent(EVENT, 'active', TEMPLATE);
  await seedEvent(OTHER, 'active', null);
  await seedEvent(DRAFT, 'draft', null);

  // Path 2, no placement anywhere → no card.
  await seedPoolBusiness('sp1438-pool');

  // Path 2 here, but accepted on another active event → on show, card works.
  await seedSplitSponsor(env.DB, { id: 'sp1438-placed', eventId: OTHER, websiteUrl: null });
  await subscribe('sp1438-placed');

  // Path 2 here, accepted only on a draft event → not on show, no card.
  await seedSplitSponsor(env.DB, { id: 'sp1438-draftonly', eventId: DRAFT, websiteUrl: null });
  await subscribe('sp1438-draftonly');

  // Path 1: an accepted placement on THIS event → card works.
  await seedSplitSponsor(env.DB, { id: 'sp1438-direct', eventId: EVENT, websiteUrl: null });

  // A sponsor-initiated request (ADR-019 amendment): active, sponsor said yes,
  // organizer has NOT answered. Silence is not consent for this source, so no
  // card, matching the resolver and the logo route (Copilot review on #716).
  await seedSplitSponsor(env.DB, {
    id: 'sp1438-request',
    eventId: OTHER,
    websiteUrl: null,
    source: 'sponsor_request',
  });
  // The seed helper maps organizerAccepted null → 1, so set "not answered" here.
  await env.DB.prepare(
    'UPDATE sponsor_placement SET organizer_accepted = NULL WHERE sponsor_business_id = ?'
  )
    .bind('sp1438-request')
    .run();
  await subscribe('sp1438-request');
});

describe('OSE-1438 | card_url ⟺ the card renders', () => {
  test('Path 2 with no placement anywhere: no card_url, and the card is a 404', async () => {
    const row = await resolved('sp1438-pool');
    expect(row.card_url).toBeUndefined();
    expect(await cardStatus('sp1438-pool')).toBe(404);
  });

  test('Path 2 placed on another active event: keeps its card_url, and the card renders', async () => {
    const row = await resolved('sp1438-placed');
    expect(row.card_url).toBe('/sponsors/sp1438-placed');
    expect(await cardStatus('sp1438-placed')).toBe(200);
  });

  test('Path 2 placed only on a draft event: no card_url, and the card is a 404', async () => {
    const row = await resolved('sp1438-draftonly');
    expect(row.card_url).toBeUndefined();
    expect(await cardStatus('sp1438-draftonly')).toBe(404);
  });

  test('Path 1 on this active event: card_url, and the card renders', async () => {
    const row = await resolved('sp1438-direct');
    expect(row.card_url).toBe('/sponsors/sp1438-direct');
    expect(await cardStatus('sp1438-direct')).toBe(200);
  });

  test('a sponsor_request the organizer has not answered: no card_url, and the card is a 404', async () => {
    const row = await resolved('sp1438-request');
    expect(row.card_url).toBeUndefined();
    expect(await cardStatus('sp1438-request')).toBe(404);
  });

  test('the internal has_card flag never leaves the resolver', async () => {
    const rows = await resolveSponsorsForEvent(env.DB, EVENT, { geoMatchEnabled: true });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r, r.id).not.toHaveProperty('has_card');
  });

  test('with Path 2 off (the launch default) the pool business does not resolve at all', async () => {
    const rows = await resolveSponsorsForEvent(env.DB, EVENT);
    expect(rows.map((r) => r.id)).not.toContain('sp1438-pool');
    expect(rows.find((r) => r.id === 'sp1438-direct')?.card_url).toBe('/sponsors/sp1438-direct');
  });
});
