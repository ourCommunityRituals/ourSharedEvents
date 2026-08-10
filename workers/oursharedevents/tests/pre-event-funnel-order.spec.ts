/**
 * OSE-655 — Pre-event funnel sequence lock.
 *
 * The pre-event page is a persuasion funnel: the card order IS the design.
 * Sequence = curiosity → connection → location → commitment, i.e.
 * WHAT → WHO → WHERE → HOW. WHO (the conversion engine — "interest in a
 * person converts a forwarded link into a body in the room") MUST precede
 * WHERE. This test fails if the order regresses (e.g. WHERE floats above WHO).
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
      if (m.includes('duplicate column') || m.includes('already exists') || m.includes('no such column')) continue;
      throw e;
    }
  }
}

async function seed(id: string): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const start = new Date(Date.now() + 7 * 86400000).toISOString(); // +7d → pre_event
  await tenv.DB.prepare(`DELETE FROM events WHERE id = ?`).bind(id).run();
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date,
                         what_short, who_host, why_purpose, how_details, where_address,
                         price_cents, price_model, price_note,
                         created_at, updated_at)
     VALUES (?, 'funnel-test', 'Funnel Order Event', ?, 'active', 'The Venue', ?, ?,
             'What it is', 'The host', 'Why it matters', 'How to join', '1 Main St',
             1000, 'fixed', NULL,
             datetime('now'), datetime('now'))`
  )
    .bind(id, id, start, start)
    .run();
}

beforeAll(applyMigrations);

describe('OSE-655 | pre-event funnel order (WHAT → WHO → WHERE → HOW)', () => {
  test('WHO precedes WHERE, and the full curiosity→commitment sequence holds', async () => {
    const id = 'evt_funnel_order';
    await seed(id);
    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    const at = (t: string) => html.indexOf(`data-testid="${t}"`);

    // all present (incl. the HOW MUCH dimension)
    for (const t of ['event-what', 'event-who', 'event-where', 'event-how-much', 'event-how']) {
      expect(at(t), `${t} must render`).toBeGreaterThan(-1);
    }
    // sequence: curiosity → connection → location → decision(cost) → commitment
    expect(at('event-what'), 'WHAT before WHO').toBeLessThan(at('event-who'));
    expect(at('event-who'), 'WHO before WHERE — the conversion engine leads location').toBeLessThan(at('event-where'));
    expect(at('event-where'), 'WHERE before HOW MUCH').toBeLessThan(at('event-how-much'));
    expect(at('event-how-much'), 'HOW MUCH before HOW — cost gates commitment').toBeLessThan(at('event-how'));
    // fixed price renders as a compact dollar string
    expect(html).toContain('$10');
  });
});
