/**
 * Back, the last control on every public page (owner 2026-10-11).
 *
 * "Just looking" on the event page became Back at the foot of the page
 * (event-page-choices.spec.ts covers the event page before and during the
 * event). The owner then asked for Back in the same place everywhere, so a
 * visitor always knows where the way out is: the page after the event, the
 * four form pages and the sponsor card. This spec holds that.
 *
 * Each page: Back is there, it is the last control in <main>, its link (the
 * no-script and nothing-to-go-back-to answer) goes somewhere useful, and its
 * script ships with the page.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { renderBackButton } from '../src/lib/back-button';
import { renderSponsorCardPage } from '../src/lib/sponsor-card-render';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const E = env as unknown as TestEnv;

async function applyAll(db: D1Database, statementsJson: string): Promise<void> {
  for (const stmt of JSON.parse(statementsJson) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (
        m.includes('duplicate column name') ||
        m.includes('already exists') ||
        m.includes('no such column')
      ) {
        continue;
      }
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyAll(E.DB, E.TEST_MIGRATION_STATEMENTS);
  await applyAll(E.FORMS_DB, E.TEST_FORMS_MIGRATION_STATEMENTS);
});

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
let n = 0;

async function seed(start: string, end: string): Promise<string> {
  const id = `back-${Date.now().toString(36)}-${n++}`;
  await E.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date,
                         location, listed_from, qr_verified, created_at, updated_at)
     VALUES (?, 'root', ?, ?, 'active', 1, ?, ?, 'Old Western, Rock Island', ?, 1,
             datetime('now'), datetime('now'))`
  )
    .bind(id, `Back night ${id}`, id, start, end, new Date(Date.now() - 86_400_000).toISOString())
    .run();
  return id;
}

async function page(path: string): Promise<string> {
  const res = await SELF.fetch(`https://localhost${path}`, { redirect: 'manual' });
  expect(res.status, path).toBe(200);
  return res.text();
}

/** The opening tag carrying a test id. */
const tag = (html: string, t: string) =>
  html.match(new RegExp(`<[a-z]+ [^>]*data-testid="${t}"[^>]*>`))?.[0] ?? '';

/** The script that wires one Back button, or '' when it is missing. */
const backScript = (html: string, t: string) =>
  html
    .split(/<script\b/i)
    .map((c) => c.split(/<\/script/i)[0])
    .find((c) => c.includes(`[data-testid="${t}"]`)) ?? '';

/** Back is the last link or button inside <main>. */
function expectLastInMain(html: string, t: string): void {
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  const at = main.indexOf(`data-testid="${t}"`);
  expect(at, `${t} is inside <main>`).toBeGreaterThan(-1);
  expect(main.slice(at), 'nothing to tap after Back').not.toMatch(/<(a|button)[\s>]/);
}

describe('Back on the page after the event', () => {
  test('it is the last control, above the anonymity line, and opens the events list', async () => {
    const id = await seed(inDays(-3), inDays(-2));
    const html = await page(`/events/${id}`);
    expect(tag(html, 'event-back')).toContain('href="/events"');
    expect(html.indexOf('data-testid="event-back"')).toBeLessThan(
      html.indexOf('Never who, only how many.')
    );
    expect(backScript(html, 'event-back')).toContain('history.back()');
  });
});

describe('Back on every form page', () => {
  for (const screen of ['register', 'checkin', 'survey', 'updates']) {
    test(`/${screen}: Back is last, and with nowhere to go back to it opens the event`, async () => {
      const id = await seed(inDays(-1), inDays(1));
      const html = await page(`/events/${id}/${screen}`);
      expect(tag(html, 'form-back')).toContain(`href="/events/${id}"`);
      expectLastInMain(html, 'form-back');
      const script = backScript(html, 'form-back');
      expect(script, 'the Back script ships with the page').toContain('history.back()');
      expect(script).toContain('!document.referrer');
      // The form page's own script tags carry its CSP nonce; Back's does too.
      expect(html).toMatch(
        /<script nonce="[^"]+">\(function\(\)\{var a=document\.querySelector\('\[data-testid="form-back"\]'\)/
      );
    });
  }
});

describe('Back on the sponsor card', () => {
  const card = renderSponsorCardPage({
    id: 'sp_back',
    name: 'Corner Bakery',
    display_name: null,
    address_line: '1 Main St',
    contact_phone: null,
    contact_email: null,
    website_url: 'https://example.com',
    has_logo: false,
  });

  test('it is the last control in the card page, in the hub button style', () => {
    expectLastInMain(card, 'sponsor-card-back');
    expect(tag(card, 'sponsor-card-back')).toContain('class="btn btn-secondary btn-block"');
    expect(tag(card, 'sponsor-card-back')).toContain('href="/events"');
    expect(backScript(card, 'sponsor-card-back')).toContain('history.back()');
  });
});

describe('renderBackButton', () => {
  test('a draft preview shows it switched off: no link, no script', () => {
    const html = renderBackButton({ fallbackHref: '/events', inert: true, testid: 'x-back' });
    expect(tag(html, 'x-back')).toContain('data-preview-inert="true"');
    expect(tag(html, 'x-back')).not.toContain('href=');
    expect(html).not.toMatch(/<script/i);
  });

  test('Spanish reads Volver; the link is escaped', () => {
    const html = renderBackButton({ fallbackHref: '/events/a"b', lang: 'es', testid: 'x-back' });
    expect(html).toContain('>Volver</a>');
    expect(html).toContain('href="/events/a&quot;b"');
  });
});
