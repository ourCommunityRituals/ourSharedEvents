/**
 * Event cards show a picture (owner 2026-10-11): the event's poster art when it
 * has one, else the OSE default image.
 *
 * Poster art is the R2 upload admin's "Poster art" card stores in
 * events.cover_image_url (/api/v2/uploads/…). The pages' CSP allows images
 * from the site only, so anything else in that column (it is free text) gets
 * the default, never an outside address.
 *
 * Covers: the card markup on /events and on the landing, the rule for which
 * value is shown, the default image route, and the swap for a picture that
 * fails to load.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { renderEventList } from '../src/lib/event-list';
import {
  EVENT_DEFAULT_THUMB_PATH,
  EVENT_DEFAULT_THUMB_SVG,
  eventThumbSrc,
  injectEventThumbSwap,
} from '../src/lib/event-thumb';

const E = env as unknown as { DB: D1Database; TEST_MIGRATION_STATEMENTS: string };

beforeAll(async () => {
  for (const stmt of JSON.parse(E.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await E.DB.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes('duplicate column') || m.includes('already exists')) continue;
      throw e;
    }
  }
});

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const ART = '/api/v2/uploads/events/evt_thumb_art/poster.png';

async function seed(id: string, cover: string | null): Promise<void> {
  await E.DB.prepare(
    `INSERT OR REPLACE INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date,
            location, cover_image_url, listed_from, qr_verified, created_at, updated_at)
     VALUES (?, 'root', ?, ?, 'active', 1, ?, ?, 'Rock Island Public House', ?, ?, 1,
             datetime('now'), datetime('now'))`
  )
    .bind(
      id,
      `Thumb ${id}`,
      id,
      inDays(4),
      inDays(4),
      cover,
      new Date(Date.now() - 86_400_000).toISOString()
    )
    .run();
}

/** The src of the card picture for one event in a page. */
function thumbOf(html: string, id: string): string | null {
  const at = html.indexOf(`data-event-id="${id}"`);
  if (at < 0) return null;
  const card = html.slice(at, html.indexOf('</article>', at));
  return card.match(/<img class="event-thumb" src="([^"]*)"/)?.[1] ?? null;
}

describe('which picture a card shows', () => {
  test('poster art (an upload on this site) is shown', () => {
    expect(eventThumbSrc(ART)).toBe(ART);
  });

  test('no poster art, an outside address or anything else: the default', () => {
    for (const v of [
      null,
      undefined,
      '',
      'https://example.com/a.png',
      '//evil.test/a.png',
      'javascript:alert(1)',
      '/api/v2/uploads/../admin',
      '/api/v2/uploads/a"b',
      42,
    ]) {
      expect(eventThumbSrc(v), String(v)).toBe(EVENT_DEFAULT_THUMB_PATH);
    }
  });
});

describe('the card markup', () => {
  test('every card has a decorative picture, 64px, lazily loaded, before the name', () => {
    const { html } = renderEventList([
      {
        id: 'a',
        name: 'With art',
        startDateISO: inDays(2),
        phase: 'pre_event',
        cover_image_url: ART,
      },
      { id: 'b', name: 'No art', startDateISO: inDays(3), phase: 'pre_event' },
    ]);
    expect(thumbOf(html, 'a')).toBe(ART);
    expect(thumbOf(html, 'b')).toBe(EVENT_DEFAULT_THUMB_PATH);
    const img = html.match(/<img class="event-thumb"[^>]*>/)?.[0] ?? '';
    expect(img).toContain('alt=""');
    expect(img).toContain('width="64"');
    expect(img).toContain('height="64"');
    expect(img).toContain('loading="lazy"');
    const card = html.slice(html.indexOf('data-event-id="a"'));
    expect(card.indexOf('event-thumb')).toBeLessThan(
      card.indexOf('data-testid="public-event-name"')
    );
  });

  test('the card list itself carries no script; the page adds the swap', () => {
    const { html } = renderEventList([
      {
        id: 'a',
        name: 'With art',
        startDateISO: inDays(2),
        phase: 'pre_event',
        cover_image_url: ART,
      },
    ]);
    expect(html).not.toMatch(/<script/i);
    const page = injectEventThumbSwap('<html><body><main>x</main></body></html>');
    const script = page.slice(page.indexOf('<script'), page.indexOf('</body>'));
    expect(script).toContain(`'${EVENT_DEFAULT_THUMB_PATH}'`);
    expect(script).toContain('img.event-thumb');
    expect(script).toContain('naturalWidth===0');
  });
});

describe('on the served pages', () => {
  test('/events: the poster art and the default, each on its own card', async () => {
    await seed('evt_thumb_art', ART);
    await seed('evt_thumb_none', null);
    await seed('evt_thumb_outside', 'https://example.com/outside.png');
    const html = await (await SELF.fetch('https://t.test/events')).text();
    expect(thumbOf(html, 'evt_thumb_art')).toBe(ART);
    expect(thumbOf(html, 'evt_thumb_none')).toBe(EVENT_DEFAULT_THUMB_PATH);
    expect(thumbOf(html, 'evt_thumb_outside')).toBe(EVENT_DEFAULT_THUMB_PATH);
    expect(html).not.toContain('https://example.com/outside.png');
    // The swap script carries the page's CSP nonce.
    expect(html).toMatch(
      /<script nonce="[^"]+">\(function\(\)\{var d='\/event-default-thumb\.svg'/
    );
  });

  test('the landing cards show the same picture', async () => {
    await seed('evt_thumb_land', ART);
    const html = await (await SELF.fetch('https://t.test/')).text();
    const at = html.indexOf('data-event-id="evt_thumb_land"');
    expect(at, 'the landing lists the event').toBeGreaterThan(-1);
    const card = html.slice(at, html.indexOf('</article>', at));
    expect(card).toContain(`src="${ART}"`);
    expect(card).toContain('data-testid="area-card-thumb"');
    expect(html).toMatch(
      /<script nonce="[^"]+">\(function\(\)\{var d='\/event-default-thumb\.svg'/
    );
  });
});

describe('the default image', () => {
  test('is served from the site, as an SVG, cached a day, locked down', async () => {
    const res = await SELF.fetch(`https://t.test${EVENT_DEFAULT_THUMB_PATH}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('image/svg+xml');
    expect(res.headers.get('Cache-Control')).toContain('max-age=86400');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await res.text()).toBe(EVENT_DEFAULT_THUMB_SVG);
  });

  test('is the Ring: five stages, no script, no outside reference', () => {
    expect(EVENT_DEFAULT_THUMB_SVG.match(/<circle /g)).toHaveLength(6); // the ring + five stages
    expect(EVENT_DEFAULT_THUMB_SVG).not.toMatch(/<script|href=|url\(/i);
  });
});
