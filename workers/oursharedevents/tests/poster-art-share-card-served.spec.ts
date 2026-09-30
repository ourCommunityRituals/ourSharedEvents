/**
 * OSE-1370 + OSE-1371 — served routes: a D1 row with poster art reaches the
 * public surfaces, and the event page shares its /s/ short link as a card.
 *
 * Layer: integration (miniflare D1 + the real router). The renderer-level
 * matrix and the share script run in jsdom live in poster-art-public.spec.ts.
 * Assertions read attributes with regexes over single tags only (workerd has no
 * jsdom); no text is sliced around inline scripts.
 *
 * @born-red OSE-1370/OSE-1371 | method: run against origin/main's src (tagged
 *   stash of the src change, tests kept): the event SELECT never read
 *   cover_image_url (no hero, no og:image), the cards had no thumb and the
 *   landing card no date, and the share used /events/:id even with a public
 *   /s/ code on file | date: 2026-09-30
 */
import { env, SELF, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { route, type RouterEnv } from '../src/router';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const db = () => (env as unknown as TestEnv).DB;

const ART_ID = 'ose1370-art';
const PLAIN_ID = 'ose1370-plain';
const HOSTILE_ID = 'ose1370-hostile';
const DRAFT_ID = 'ose1370-draft';
const ART = `/api/v2/uploads/events/${ART_ID}/1727700000000-bocce.png`;
const CODE = 'Pa1370';
const ADMIN = 'ose1370-admin@example.com';
const BRAND = 'brand-ose1370';

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function applyMigrations(): Promise<void> {
  for (const stmt of JSON.parse(
    (env as unknown as TestEnv).TEST_MIGRATION_STATEMENTS
  ) as string[]) {
    try {
      await db().prepare(stmt).run();
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

async function seed(
  id: string,
  cover: string | null,
  opts: { status?: string; brand?: string } = {}
): Promise<void> {
  await db().prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  await db()
    .prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, is_published, location, where_address,
                           start_date, end_date, timezone, what_short, cover_image_url,
                           created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 'Eagles Bowl', '100 Red Arrow Hwy', ?, ?, 'America/Chicago',
               'Rolling on the green.', ?, datetime('now'), datetime('now'))`
    )
    .bind(
      id,
      opts.brand ?? 'root',
      `Bocce ${id}`,
      id,
      opts.status ?? 'active',
      inDays(4),
      inDays(4),
      cover
    )
    .run();
}

const page = async (path: string) => (await SELF.fetch(`https://t.test${path}`)).text();
/** The first tag matching `re` (a single tag — attributes only). */
const tag = (html: string, re: RegExp) => html.match(re)?.[0] ?? '';
const attr = (t: string, name: string) => t.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

beforeAll(async () => {
  await applyMigrations();
  await seed(ART_ID, ART);
  await seed(PLAIN_ID, null);
  await seed(HOSTILE_ID, 'javascript:alert(1)');
  await seed(DRAFT_ID, `/api/v2/uploads/events/${DRAFT_ID}/1-d.png`, {
    status: 'draft',
    brand: BRAND,
  });
  await db().prepare('DELETE FROM shortlinks WHERE code = ?').bind(CODE).run();
  await db()
    .prepare(
      `INSERT INTO shortlinks (code, event_id, target_url, kind, created_at)
       VALUES (?, ?, ?, 'public', datetime('now'))`
    )
    .bind(CODE, ART_ID, `https://t.test/events/${ART_ID}`)
    .run();
  (env as unknown as { ADMIN_BRAND_MEMBERSHIP?: string }).ADMIN_BRAND_MEMBERSHIP = JSON.stringify({
    [ADMIN]: [BRAND],
  });
});

describe('OSE-1370 | /events/:id — hero + og:image from the D1 row', () => {
  test('art → hero img from our upload path, og:image absolute on our origin, large card', async () => {
    const html = await page(`/events/${ART_ID}`);
    const hero = tag(html, /<img [^>]*data-testid="event-hero-img"[^>]*>/);
    expect(attr(hero, 'src')).toBe(ART);
    expect(attr(hero, 'alt')).toBe(`Bocce ${ART_ID}`);
    expect(html).toContain(`<meta property="og:image" content="https://t.test${ART}" />`);
    expect(html).toContain(`<meta name="twitter:image" content="https://t.test${ART}" />`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    const desc = attr(tag(html, /<meta property="og:description"[^>]*>/), 'content') ?? '';
    expect(desc).toContain('Eagles Bowl');
    expect(desc).toMatch(/(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day, /);
  });

  test('no art → no hero, no og:image, small card; hostile art never reaches an src', async () => {
    for (const id of [PLAIN_ID, HOSTILE_ID]) {
      const html = await page(`/events/${id}`);
      expect(html).not.toContain('data-testid="event-hero"');
      expect(html).not.toContain('property="og:image"');
      expect(html).toContain('<meta name="twitter:card" content="summary" />');
      expect(html).not.toContain('javascript:alert');
    }
  });
});

describe('OSE-1371 | the share uses the public /s/ short link, read-only', () => {
  test('a public code on file → data-share-url is /s/<code>; body carries it; nothing minted', async () => {
    const before = await db()
      .prepare('SELECT COUNT(*) AS n FROM shortlinks WHERE event_id = ?')
      .bind(ART_ID)
      .first<{ n: number }>();
    const html = await page(`/events/${ART_ID}`);
    const btn = tag(html, /<button [^>]*data-testid="share-btn"[^>]*>/);
    expect(attr(btn, 'data-share-url')).toBe(`https://t.test/s/${CODE}`);
    expect(attr(btn, 'data-share-text')).toContain(`Details and RSVP: https://t.test/s/${CODE}`);
    expect(attr(btn, 'data-share-text')).not.toContain('/q/');
    const mail = tag(html, /<a [^>]*data-testid="share-email"[^>]*>/);
    expect(attr(mail, 'href')).toMatch(/^mailto:\?subject=/);
    const after = await db()
      .prepare('SELECT COUNT(*) AS n FROM shortlinks WHERE event_id = ?')
      .bind(ART_ID)
      .first<{ n: number }>();
    expect(after?.n).toBe(before?.n); // a page render never mints
  });

  test('no code on file → the canonical /events/:id', async () => {
    const html = await page(`/events/${PLAIN_ID}`);
    const btn = tag(html, /<button [^>]*data-testid="share-btn"[^>]*>/);
    expect(attr(btn, 'data-share-url')).toBe(`https://t.test/events/${PLAIN_ID}`);
  });
});

describe('OSE-1370 | listing cards carry the thumbnail (and the landing card the date)', () => {
  test('/events: thumb for art, tile otherwise, hostile never in an src', async () => {
    const html = await page('/events');
    const art = tag(html, new RegExp(`<img [^>]*src="${ART.replace(/\//g, '\\/')}"[^>]*>`));
    expect(attr(art, 'data-testid')).toBe('public-event-thumb');
    expect(html).toContain('data-testid="public-event-thumb-fallback"');
    expect(html).not.toContain('javascript:alert');
  });

  test('/ (landing): thumb for art + a date in the card meta', async () => {
    const html = await page('/');
    const art = tag(html, new RegExp(`<img [^>]*src="${ART.replace(/\//g, '\\/')}"[^>]*>`));
    expect(attr(art, 'data-testid')).toBe('area-card-thumb');
    expect(html).toContain('data-testid="area-card-date"');
    expect(html).not.toContain('javascript:alert');
  });
});

describe('OSE-1355 holds | admin draft preview with art stays inert + noindex', () => {
  test('noindex headers + meta, share switched off, no share text or Email', async () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ email: ADMIN, iat: now - 10, exp: now + 3600 })}.sig`;
    const ctx = createExecutionContext();
    const res = await route(
      new Request(`https://ose.test/api/v2/admin/events/${DRAFT_ID}/preview`, {
        headers: { 'Cf-Access-Jwt-Assertion': jwt },
      }),
      env as unknown as RouterEnv,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Robots-Tag')).toMatch(/noindex/);
    const html = await res.text();
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    const btn = tag(html, /<button [^>]*data-testid="share-btn"[^>]*>/);
    expect(btn).toContain('disabled');
    expect(btn).not.toContain('data-share-text');
    expect(html).not.toContain('data-testid="share-email"');
    expect(html).not.toContain('navigator.share');
  });
});
