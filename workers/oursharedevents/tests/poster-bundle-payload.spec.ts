/**
 * OSE-867 (PO-3) — poster-bundle is the poster's whole payload.
 *
 * Before: the bundle returned `eventName` and nothing else about the event, so
 * the poster ran a three-call waterfall (`/api/v2/events` → `sponsor-bundle` →
 * `poster-bundle`) and still could not print the date or the venue from the
 * call named for it.
 *
 * After: one call carries the event under the SAME public projection
 * `GET /api/v2/events/:id` emits (OSE-1247 allowlist + OSE-844 names — `name`,
 * `start_date`/`starts_at`/`timezone`, `venue`), the poster sponsor strip, and
 * the organizer's QR slots. One name per value: `eventName` is gone because
 * `event.name` is the value.
 *
 * Pyramid:
 *   L2 Integration — SELF.fetch against migrated D1.
 *   L1 Static      — poster.html no longer fetches sponsor-bundle and reads the
 *                    event from the bundle on the scoped path.
 * The request-count assertion (T4d) lives in the component tier:
 *   tests/e2e/2-pages/poster-print.spec.ts › "One Data Call (OSE-867)".
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { seedSplitSponsor } from './helpers/seed-sponsor';
import { PUBLIC_EVENT_FIELDS } from '../src/lib/public-event-projection';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}
const tenv = () => env as unknown as TestEnv;

const EVENT_ID = 'pb-payload-evt';

async function applyMigrations(db: D1Database, json: string): Promise<void> {
  for (const stmt of JSON.parse(json) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyMigrations(tenv().DB, tenv().TEST_MIGRATION_STATEMENTS);
  await applyMigrations(tenv().FORMS_DB, tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  try {
    await tenv()
      .DB.prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, timezone, starts_at)
         VALUES (?, 'pb-brand', 'Bocce at Eagles', 'bocce-at-eagles', 'active', 'Eagles Hall',
                 '2026-10-24', 'America/Chicago', '2026-10-24T23:00:00.000Z')`
      )
      .bind(EVENT_ID)
      .run();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes('UNIQUE constraint failed')) throw e;
  }
  try {
    await seedSplitSponsor(tenv().DB, {
      id: 'pb-spon',
      eventId: EVENT_ID,
      brandId: 'pb-brand',
      name: 'Corner Bakery',
    });
  } catch {
    /* already seeded */
  }
});

async function bundle(): Promise<Record<string, unknown>> {
  const res = await SELF.fetch(`https://t.test/api/v2/events/${EVENT_ID}/poster-bundle`);
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

function sourceFile(suffix: string): string {
  const files: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
  const key = Object.keys(files).find((k) => k.replace(/\\/g, '/').endsWith(suffix));
  return key ? files[key] : '';
}

describe('OSE-867 L2: poster-bundle carries the three facts a poster prints', () => {
  test('event title, start and venue arrive under the canonical X-10 names', async () => {
    const b = await bundle();
    const event = b.event as Record<string, unknown>;
    expect(event).toBeTypeOf('object');
    expect(event.id).toBe(EVENT_ID);
    expect(event.name).toBe('Bocce at Eagles');
    expect(event.start_date).toBe('2026-10-24');
    expect(event.startDateISO).toBe('2026-10-24');
    expect(event.starts_at).toBe('2026-10-24T23:00:00.000Z');
    expect(event.timezone).toBe('America/Chicago');
    expect(event.venue).toBe('Eagles Hall');
  });

  test('the event is the SAME public projection GET /api/v2/events/:id emits — no wider, no different', async () => {
    const b = await bundle();
    const event = b.event as Record<string, unknown>;
    for (const key of Object.keys(event)) {
      expect(
        PUBLIC_EVENT_FIELDS.has(key),
        `bundle.event.${key} is outside the public allowlist`
      ).toBe(true);
    }
    const res = await SELF.fetch(`https://t.test/api/v2/events/${EVENT_ID}`);
    const item = ((await res.json()) as { item: Record<string, unknown> }).item;
    for (const k of [
      'id',
      'name',
      'start_date',
      'startDateISO',
      'starts_at',
      'timezone',
      'venue',
      'phase',
    ]) {
      expect(event[k], `bundle.event.${k} disagrees with GET /events/:id`).toEqual(item[k]);
    }
  });

  test('one name per value: the retired `eventName` duplicate is not emitted', async () => {
    const b = await bundle();
    expect(b).not.toHaveProperty('eventName');
    // `status` stays the numeric HTTP status (OSE-842), event state is `eventStatus`.
    expect(b.status).toBe(200);
    expect(b.eventStatus).toBe('active');
  });

  test('the poster sponsor strip rides in the bundle (same set sponsor-bundle?surface=poster serves)', async () => {
    const b = await bundle();
    const sponsors = b.sponsors as Array<Record<string, unknown>>;
    expect(Array.isArray(sponsors)).toBe(true);
    expect(sponsors.map((s) => s.name)).toContain('Corner Bakery');

    const res = await SELF.fetch(
      `https://t.test/api/v2/events/${EVENT_ID}/sponsor-bundle?surface=poster`
    );
    const sb = (await res.json()) as {
      bundle: { surface_sponsors: { posterTop: Array<{ id: string }> } };
    };
    expect(sponsors.map((s) => s.id)).toEqual(
      sb.bundle.surface_sponsors.posterTop.map((s) => s.id)
    );
  });

  test('print carries no impression beacon: sponsors in the poster bundle have no beacon_token', async () => {
    const b = await bundle();
    for (const s of b.sponsors as Array<Record<string, unknown>>) {
      expect(s).not.toHaveProperty('beacon_token');
    }
  });

  test('the QR slots the poster prints are still present (event page first)', async () => {
    const b = await bundle();
    const slots = b.slots as Array<Record<string, unknown>>;
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].kind).toBe('public');
    expect(String(slots[0].qr)).toMatch(/^data:image\/png;base64,/);
  });
});

describe('CCR PR701 F1: a sponsor failure never takes the poster down', () => {
  test('sponsor lookup error → 200 with the QR codes and an empty sponsor strip', async () => {
    // Before OSE-867 the strip was its own call, so a sponsor error only
    // emptied the strip. Folding it into the bundle must not turn that into a
    // poster with no codes: the QR codes are the poster's job, sponsors are not.
    const db = tenv().DB;
    await db.prepare('ALTER TABLE sponsor_placement RENAME TO sponsor_placement_ccr_off').run();
    try {
      const res = await SELF.fetch(`https://t.test/api/v2/events/${EVENT_ID}/poster-bundle`);
      expect(res.status).toBe(200);
      const b = (await res.json()) as Record<string, unknown>;
      expect(b.sponsors).toEqual([]);
      expect((b.slots as unknown[]).length).toBeGreaterThan(0);
      expect((b.event as Record<string, unknown>).name).toBe('Bocce at Eagles');
    } finally {
      await db.prepare('ALTER TABLE sponsor_placement_ccr_off RENAME TO sponsor_placement').run();
    }
  });
});

describe('OSE-867 L1: poster.html reads the bundle, not a waterfall', () => {
  test('poster.html never calls sponsor-bundle — sponsors come from poster-bundle', () => {
    const html = sourceFile('src/templates/poster.html');
    expect(html).not.toBe('');
    expect(html).not.toContain('/sponsor-bundle');
  });

  test('the scoped path renders the poster from bundle.event (no list fetch needed)', () => {
    const html = sourceFile('src/templates/poster.html');
    expect(html).toContain('data.event');
    expect(html).toContain('data.sponsors');
  });

  test('no dual-read fallback for title, start or venue', () => {
    const html = sourceFile('src/templates/poster.html');
    expect(html).not.toMatch(/\.name\s*\|\|\s*[a-z]+\.title/);
    expect(html).not.toMatch(/\.venue\s*\|\|\s*[a-z]+\.location/);
    expect(html).not.toMatch(/\.startDateISO\s*\|\|\s*[a-z]+\.start_date/);
  });
});
