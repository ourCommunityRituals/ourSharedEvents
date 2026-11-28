/**
 * The landing's Type row is the event-type CATEGORIES (owner 2026-11-09):
 * "Event Types should be Categories. When clicked you get all the event types
 * under this category".
 *
 * Over HTTP against the migrated D1, so the chips come from the real catalog
 * (event_type_category_registry + event_type_registry, migrations 0024/0076),
 * read the way the Create Event picker reads it. The renderer's own cases are in
 * tests/landing-area.spec.ts; the browser click is in
 * tests/playwright/landing-categories.spec.ts.
 *
 * @born-red landing-categories | method: the handler's catalog read removed (no
 *   typeCategories: every event "Other", no Type row) and the card tagged by
 *   event_type_id instead of its category — each turned a test red | date: 2026-11-09
 */
import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
}

// Two types under one bucket (Music & Shows), one under another (Learn & Connect),
// one event with no type at all. Since migration 0126 the row shows the 9 buckets
// by their short names (owner approval 2026-11-28).
const EVENTS = [
  { id: 'cat-test-music', title: 'Category Test Music Night', type: 'etr-art-music' },
  { id: 'cat-test-gallery', title: 'Category Test Gallery Walk', type: 'etr-art-gallery' },
  { id: 'cat-test-mixer', title: 'Category Test Business Mixer', type: 'etr-biz-mixer' },
  { id: 'cat-test-untyped', title: 'Category Test Untyped', type: null },
] as const;

async function seed(id: string, title: string, type: string | null): Promise<void> {
  const db = (env as unknown as TestEnv).DB;
  await db.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  await db
    .prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, is_published, location,
                           start_date, timezone, event_type_id, created_at, updated_at)
       VALUES (?, 'root', ?, ?, 'active', 1, 'A hall', ?, 'America/Chicago', ?,
               datetime('now'), datetime('now'))`
    )
    .bind(id, title, id, inDays(4), type)
    .run();
}

let body = '';

beforeAll(async () => {
  await applyMigrations();
  for (const e of EVENTS) await seed(e.id, e.title, e.type);
  const res = await SELF.fetch('https://t.test/');
  expect(res.status).toBe(200);
  body = await res.text();
});

const typeRow = () =>
  body.match(/data-testid="toggle-type">([\s\S]*?)<div class="icon-slider-nav"/)?.[1] ?? '';
const chips = () =>
  [
    ...typeRow().matchAll(
      /<label class="icon-slider-item" for="([^"]+)"[^>]*><svg[\s\S]*?<\/svg><span class="icon-slider-text">([^<]*)<\/span><\/label>/g
    ),
  ].map((m) => ({
    id: m[1],
    label: m[2],
  }));
/** The class list of an event's card on the landing, by event id. */
const cardClassOf = (id: string) =>
  body.match(
    new RegExp(`<article class="([^"]*)" data-testid="area-card" data-event-id="${id}"`)
  )?.[1] ?? '';

describe('GET / Type row: one chip per category, named from the catalog', () => {
  test('All types first, then each category with listed events in catalog order, Other last', () => {
    expect(chips()[0]).toEqual({ id: 'type-all', label: 'All types' });
    const labels = chips().map((c) => c.label);
    // Bucket display_order: Music & Shows (30) before Learn (70); "Other" last.
    expect(labels.indexOf('Music &amp; Shows')).toBeGreaterThan(0);
    expect(labels.indexOf('Learn')).toBeGreaterThan(labels.indexOf('Music &amp; Shows'));
    expect(labels[labels.length - 1]).toBe('Other');
    // All types is the default.
    expect(body).toContain('id="type-all" class="toggle-radio" checked');
  });

  test('no chip is a raw type id or a single type', () => {
    for (const { label } of chips()) {
      expect(label).not.toMatch(/^Etr\b/i);
      expect(label).not.toMatch(/^etr-/);
    }
    const labels = chips().map((c) => c.label);
    expect(labels).not.toContain('Art Show &amp; Gallery Opening');
    expect(labels).not.toContain('Live Music Event');
    expect(labels.filter((l) => l.startsWith('Music')).length).toBe(1);
  });

  test('a category with no listed event has no chip', () => {
    // Nothing seeded here is a sport, a fundraiser or a book club.
    const labels = chips().map((c) => c.label);
    expect(labels).not.toContain('Sports &amp; Rec');
    expect(labels).not.toContain('Give Back');
    expect(labels).not.toContain('Bargains');
  });

  test('both types under Music & Shows carry its class, and its rule keeps exactly that class', () => {
    expect(cardClassOf('cat-test-music')).toContain('cat-shw');
    expect(cardClassOf('cat-test-gallery')).toContain('cat-shw');
    expect(cardClassOf('cat-test-mixer')).toContain('cat-lrn');
    expect(cardClassOf('cat-test-mixer')).not.toContain('cat-shw');
    expect(cardClassOf('cat-test-untyped')).toContain('cat-other');
    const css = body.match(/<style data-testid="area-type-css">([\s\S]*?)<\/style>/)?.[1] ?? '';
    expect(css).toContain(
      '#cat-shw:checked ~ .area .event-card:not(.cat-shw),#cat-shw:checked ~ .area .amap-f:not(.cat-shw){display:none}'
    );
  });

  test('still CSS-only: no script in the area and no cookie', async () => {
    const area = body.slice(body.indexOf('data-testid="area-toggles"'));
    expect(area.slice(0, area.indexOf('data-testid="area"'))).not.toContain('<script');
    const res = await SELF.fetch('https://t.test/');
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
