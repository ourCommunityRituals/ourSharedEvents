/**
 * Share-card contract for /events/:id — the most-shared page on the platform.
 *
 * OSE-1211 named a verification hole: no automated check can confirm this page
 * renders correctly, because the only OG assertion in the suite lives in a UI
 * smoke test that runs against a deployed target — and that target is behind an
 * intermittent Cloudflare challenge. This spec closes that hole from the other
 * side: in-process (miniflare), so it needs no network and cannot be challenged.
 *
 * @born-red OSE-1211 | method: summary_large_image declared with no image
 * | date: 2026-09-04
 *
 * The defect it was written against: buildOgMeta() hard-coded
 * twitter:card = "summary_large_image" on the pre-event and event-live phases
 * while emitting no og:image and no twitter:image anywhere — PublicEventRow does
 * not even carry cover_image_url. A large-image card with no image is an invalid
 * declaration: X drops or degrades the preview, Slack unfurls a thin text card.
 * The card size is now derived from whether an image actually exists.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

/** Same bootstrap the sibling stakeholder spec uses — miniflare starts empty. */
async function applyMigrations(): Promise<void> {
  const stmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such column')
      )
        continue;
      throw e;
    }
  }
}

async function seedEvent(
  id: string,
  opts: { startOffsetDays: number; endOffsetDays: number; title?: string }
): Promise<void> {
  const now = Date.now();
  const start = new Date(now + opts.startOffsetDays * 86400000).toISOString();
  const end = new Date(now + opts.endOffsetDays * 86400000).toISOString();
  await tenv().DB.prepare(`DELETE FROM events WHERE id = ?`).bind(id).run();
  await tenv()
    .DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date, what_short, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .bind(
      id,
      'ose',
      opts.title ?? 'Bocce Night at Open Outcry',
      id,
      'active',
      'Open Outcry',
      start,
      end,
      'Tuesday league, all levels, $5 at the door'
    )
    .run();
}

/** The three lifecycle phases, each seeded to the window that produces it. */
const PHASES = [
  { name: 'pre-event', id: 'evt_og_pre', startOffsetDays: 7, endOffsetDays: 8 },
  { name: 'event-live', id: 'evt_og_live', startOffsetDays: -1 / 24, endOffsetDays: 1 / 24 },
  { name: 'post-event', id: 'evt_og_post', startOffsetDays: -8, endOffsetDays: -7 },
] as const;

async function fetchHead(id: string): Promise<string> {
  const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
  const head = html.slice(0, html.indexOf('</head>'));
  expect(head.length, 'response must contain a <head>').toBeGreaterThan(0);
  return head;
}

describe('share card | /events/:id emits a valid OpenGraph + Twitter card', () => {
  beforeAll(async () => {
    await applyMigrations();
    for (const p of PHASES) {
      await seedEvent(p.id, { startOffsetDays: p.startOffsetDays, endOffsetDays: p.endOffsetDays });
    }
  });

  for (const p of PHASES) {
    describe(p.name, () => {
      test('carries the core OpenGraph properties', async () => {
        const head = await fetchHead(p.id);
        for (const prop of ['og:title', 'og:description', 'og:url', 'og:type', 'og:site_name']) {
          expect(head, `${p.name} must declare ${prop}`).toContain(`property="${prop}"`);
        }
        expect(head).toContain('name="twitter:title"');
        expect(head).toContain('name="twitter:description"');
      });

      test('never declares summary_large_image without an image', async () => {
        const head = await fetchHead(p.id);
        const declaresLarge = head.includes('content="summary_large_image"');
        const hasImage = head.includes('property="og:image"');
        expect(
          declaresLarge && !hasImage,
          `${p.name} declares a large-image card but emits no og:image — X drops the ` +
            `preview and Slack unfurls a thin text card`
        ).toBe(false);
      });

      test('declares a twitter:card of exactly one known kind', async () => {
        const head = await fetchHead(p.id);
        const cards = [...head.matchAll(/name="twitter:card"\s+content="([^"]+)"/g)].map(
          (m) => m[1]
        );
        expect(cards, `${p.name} must declare exactly one twitter:card`).toHaveLength(1);
        expect(['summary', 'summary_large_image']).toContain(cards[0]);
      });

      test('og:image and twitter:image agree — either both present or both absent', async () => {
        const head = await fetchHead(p.id);
        expect(head.includes('property="og:image"')).toBe(head.includes('name="twitter:image"'));
      });

      test('the title survives into the card, HTML-escaped', async () => {
        const head = await fetchHead(p.id);
        expect(head).toContain('Bocce Night at Open Outcry');
      });
    });
  }

  test('a title carrying a quote cannot break out of the content attribute', async () => {
    const id = 'evt_og_inject';
    await seedEvent(id, {
      startOffsetDays: 7,
      endOffsetDays: 8,
      title: 'Quiz " onerror="alert(1)" x="',
    });
    const head = await fetchHead(id);
    // The raw quote must never reach the attribute unescaped.
    expect(head).not.toContain('onerror="alert(1)"');
    expect(head).toContain('&quot;');
  });
});
