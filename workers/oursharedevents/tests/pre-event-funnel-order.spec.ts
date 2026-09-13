/**
 * Public event section order lock (pre-event).
 *
 * The pre-event page presents the event as a logical invitation. Order:
 *   WHAT → WHERE → WHO → HOW MUCH → CTA → WHY → HOW
 * front-loading the facts a recipient decides on (what/where/who/cost), then
 * the ask (share + RSVP), with WHY/HOW as the deeper detail below the CTA. This
 * SUPERSEDES the earlier OSE-655 funnel sequence ("WHO leads WHERE — the
 * conversion engine leads location"): the platform is a discovery map, not a
 * persuasion funnel, so the invitation leads with the event's facts. See
 * memory: project_report_not_your_data.
 *
 * Sponsor-strip-at-top position is asserted in
 * public-event-stakeholder-surfaces.spec.ts (that spec seeds active sponsors).
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (
        m.includes('duplicate column') ||
        m.includes('already exists') ||
        m.includes('no such column')
      )
        continue;
      throw e;
    }
  }
}

async function seedFull(id: string): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const start = new Date(Date.now() + 7 * 86400000).toISOString(); // +7d → pre_event
  await tenv.DB.prepare(`DELETE FROM events WHERE id = ?`).bind(id).run();
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, description, location, start_date, end_date,
                         what_short, who_host, why_purpose, how_details, where_address,
                         price_cents, price_model, price_note,
                         created_at, updated_at)
     VALUES (?, 'funnel-test', 'Funnel Order Event', ?, 'active', 'Fallback description', 'The Venue', ?, ?,
             'What it is', 'The host', 'Why it matters', 'How to join', '1 Main St',
             1000, 'fixed', NULL,
             datetime('now'), datetime('now'))`
  )
    .bind(id, id, start, start)
    .run();
}

/** Event with NO host-authored what_short, but a general description. */
async function seedDescriptionOnly(id: string): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const start = new Date(Date.now() + 7 * 86400000).toISOString();
  await tenv.DB.prepare(`DELETE FROM events WHERE id = ?`).bind(id).run();
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, description, location, start_date, end_date,
                         what_short, who_host, why_purpose, how_details, where_address,
                         created_at, updated_at)
     VALUES (?, 'funnel-test', 'Description Fallback Event', ?, 'active',
             'Weekly game night on the Southside', 'The Venue', ?, ?,
             NULL, NULL, NULL, NULL, '1 Main St',
             datetime('now'), datetime('now'))`
  )
    .bind(id, id, start, start)
    .run();
}

beforeAll(applyMigrations);

describe('pre-event section order (WHAT → WHERE → WHO → HOW MUCH → CTA → WHY → HOW)', () => {
  test('facts then the ask — WHO before cost, CTA before WHY/HOW', async () => {
    const id = 'evt_funnel_order';
    await seedFull(id);
    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    const at = (t: string) => html.indexOf(`data-testid="${t}"`);

    for (const t of [
      'event-what',
      'event-where',
      'event-who',
      'event-how-much',
      'event-rsvp',
      'event-why',
      'event-how',
    ]) {
      expect(at(t), `${t} must render`).toBeGreaterThan(-1);
    }
    // WHAT → WHERE → WHO → HOW MUCH → CTA(rsvp) → WHY → HOW
    expect(at('event-what'), 'WHAT leads').toBeLessThan(at('event-where'));
    expect(at('event-where'), 'WHERE before WHO').toBeLessThan(at('event-who'));
    expect(at('event-who'), 'WHO before HOW MUCH').toBeLessThan(at('event-how-much'));
    expect(
      at('event-how-much'),
      'HOW MUCH before the CTA — cost is the last fact weighed before the ask'
    ).toBeLessThan(at('event-rsvp'));
    expect(
      at('event-rsvp'),
      'the CTA precedes WHY/HOW — deeper detail sits below the ask'
    ).toBeLessThan(at('event-why'));
    expect(at('event-why'), 'WHY before HOW').toBeLessThan(at('event-how'));
    // fixed price renders as a compact dollar string
    expect(html).toContain('$10');
  });

  test('the WHAT card falls back to description when what_short is null', async () => {
    const id = 'evt_desc_fallback';
    await seedDescriptionOnly(id);
    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    // The WHAT card renders (not empty) and carries the description text.
    expect(
      html.indexOf('data-testid="event-what"'),
      'WHAT card must render from description'
    ).toBeGreaterThan(-1);
    expect(html).toContain('Weekly game night on the Southside');
  });
});
