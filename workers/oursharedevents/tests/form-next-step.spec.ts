/**
 * F5.3 — the form flow closes the loop.
 *
 *   S-5.3.1 (OSE-479) Registration → next-step card. The register page carries
 *   the card its confirmation shows: Add to calendar (the existing server
 *   .ics route, plus the Google Calendar deep link the event page already
 *   offers for Android), a link back to the event page, and one line on how
 *   check-in works. No count, no echo of what the person typed.
 *
 *   S-5.3.2 (OSE-480) Email signup → immediate payoff. The email-signup page
 *   carries "Next at this venue", read by the same query as the event page and
 *   its recap (lib/next-at-venue.ts): same brand, live, listed, past the grace
 *   window, future, never this event. None → no card, a link to /events.
 *
 * The confirmation is drawn in the browser after the POST succeeds, so the page
 * ships the card in an inert <template id="form-next-step"> and the success
 * script moves it in. This spec reads the template the server sends; the DOM
 * side (the card appears only after success) is tests/form-next-step-dom.spec.ts.
 *
 * Also here: the .ics the card links to folds its long lines on whole
 * characters (RFC 5545 §3.1: 75 octets, never inside a UTF-8 sequence) and
 * turns a lone carriage return into an escaped newline.
 *
 * @born-red OSE-479 / OSE-480 | method: ran against form-pages.ts and
 * calendar.ts as on main be0ba4c — no template on either page, an emoji at the
 * fold came out as two U+FFFD, a lone CR passed through raw | date: 2026-10-09
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const BRAND = 'ose479-test';

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const stmts: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such column')
      ) {
        continue;
      }
      throw e;
    }
  }
}

function dayFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function seedEvent(opts: {
  id: string;
  title?: string;
  brand?: string;
  status?: string;
  isPublished?: number;
  location?: string | null;
  startDate?: string | null;
  listedFrom?: string | null;
  description?: string | null;
}): Promise<void> {
  const db = (env as unknown as TestEnv).DB;
  await db.prepare(`DELETE FROM shortlinks WHERE event_id = ?`).bind(opts.id).run();
  await db.prepare(`DELETE FROM events WHERE id = ?`).bind(opts.id).run();
  await db
    .prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, is_published, location, description,
                           start_date, timezone, listed_from, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'America/Chicago', ?, datetime('now'), datetime('now'))`
    )
    .bind(
      opts.id,
      opts.brand ?? BRAND,
      opts.title ?? `Event ${opts.id}`,
      opts.id,
      opts.status ?? 'active',
      opts.isPublished ?? 1,
      opts.location === undefined ? 'Ose479 Hall' : opts.location,
      opts.description ?? null,
      opts.startDate === undefined ? dayFromNow(10) : opts.startDate,
      opts.listedFrom ?? null
    )
    .run();
}

async function seedShortlink(eventId: string, code: string): Promise<void> {
  await (env as unknown as TestEnv).DB.prepare(
    `INSERT INTO shortlinks (code, event_id, kind, clicks, created_at)
       VALUES (?, ?, 'public', 0, datetime('now'))`
  )
    .bind(code, eventId)
    .run();
}

async function formPage(eventId: string, query = ''): Promise<string> {
  const res = await SELF.fetch(`https://t.test/forms/${eventId}${query}`);
  expect(res.status).toBe(200);
  return res.text();
}

/** The inert card the success script moves into the confirmation, or null. */
function nextStepTemplate(html: string): string | null {
  const m =
    /<template id="form-next-step" data-testid="form-next-step">([\s\S]*?)<\/template>/.exec(html);
  return m ? m[1] : null;
}

/** What a reader sees: the card's text with tags and attributes removed. */
function visibleText(fragment: string): string {
  return fragment
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

beforeAll(async () => {
  await applyMigrations();
});

describe('S-5.3.1 registration → next-step card', () => {
  test('the register page carries a card with Add to calendar, the event page and a check-in line', async () => {
    const id = 'evt_ose479_reg_card';
    await seedEvent({ id });
    const tpl = nextStepTemplate(await formPage(id));
    expect(tpl, 'the register page ships the next-step card').not.toBeNull();
    expect(tpl).toContain('data-testid="register-next-step"');
    expect(tpl).toMatch(
      new RegExp(`data-testid="register-next-calendar"[^>]*href="/events/${id}/calendar\\.ics"`)
    );
    expect(tpl).toMatch(/data-testid="register-next-calendar"[^>]*\bdownload\b/);
    expect(tpl).toContain('data-testid="register-next-calendar-google"');
    expect(tpl).toContain('https://calendar.google.com/calendar/render');
    expect(tpl).toMatch(
      new RegExp(`data-testid="register-next-event-page"[^>]*href="/events/${id}"`)
    );
    expect(tpl).toMatch(/data-testid="register-next-checkin"[^>]*>[^<]*check in[^<]*</i);
  });

  test('the calendar link is the existing .ics route and it answers with the event', async () => {
    const id = 'evt_ose479_reg_ics';
    await seedEvent({ id, title: 'Bocce under the lights' });
    await seedShortlink(id, 'Ose479');
    const tpl = nextStepTemplate(await formPage(id))!;
    const href = /data-testid="register-next-calendar"[^>]*href="([^"]+)"/.exec(tpl)?.[1];
    expect(href).toBe(`/events/${id}/calendar.ics`);
    const res = await SELF.fetch(`https://t.test${href}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/calendar');
    expect(await res.text()).toContain('SUMMARY:Bocce under the lights');
  });

  test('no start date: no calendar link, the event page link and check-in line remain', async () => {
    const id = 'evt_ose479_reg_nodate';
    await seedEvent({ id, startDate: null });
    const tpl = nextStepTemplate(await formPage(id))!;
    expect(tpl).not.toContain('register-next-calendar');
    expect(tpl).toContain('data-testid="register-next-event-page"');
    expect(tpl).toContain('data-testid="register-next-checkin"');
  });

  test('an unknown event id gets no card (no link to a page that would 404)', async () => {
    const html = await formPage('evt_ose479_does_not_exist');
    expect(nextStepTemplate(html)).toBeNull();
  });

  test('never a count: the card says nothing with a number in it and echoes nothing typed', async () => {
    const id = 'evt_ose479_reg_nocount';
    await seedEvent({ id });
    const tpl = nextStepTemplate(await formPage(id))!;
    expect(visibleText(tpl)).not.toMatch(/\d/);
    expect(tpl).not.toMatch(/data-testid="[^"]*count/);
    expect(tpl).not.toContain('value=');
  });

  test('the confirmation script moves the card in only after a successful submit', async () => {
    const html = await formPage('evt_ose479_reg_card');
    const script = html.slice(html.indexOf('function showSuccess('));
    expect(script).toContain("getElementById('form-next-step')");
    expect(script).toContain('content.cloneNode(true)');
  });
});

describe('the .ics the card links to (RFC 5545 §3.1)', () => {
  test('a long line folds on whole characters: no U+FFFD, every line at most 75 octets', async () => {
    const id = 'evt_ose479_ics_fold';
    // "SUMMARY:" is 8 characters, so the emoji starts at the 75th character.
    const title = `${'A'.repeat(66)}🎉 night at the hall`;
    await seedEvent({ id, title });
    await seedShortlink(id, 'Fold79');
    const res = await SELF.fetch(`https://t.test/events/${id}/calendar.ics`);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const body = new TextDecoder().decode(bytes);
    expect(body).not.toContain('�');
    const enc = new TextEncoder();
    for (const line of body.split('\r\n')) {
      expect(enc.encode(line).length, line).toBeLessThanOrEqual(75);
    }
    expect(body.replace(/\r\n[ \t]/g, '')).toContain(`SUMMARY:${title}`);
  });

  test('a lone carriage return is escaped, never a raw line break', async () => {
    const id = 'evt_ose479_ics_cr';
    await seedEvent({ id, description: 'Line one\rLine two' });
    await seedShortlink(id, 'Cr4791');
    const body = await (await SELF.fetch(`https://t.test/events/${id}/calendar.ics`)).text();
    expect(body).not.toMatch(/\r(?!\n)/);
    expect(body).toContain('DESCRIPTION:Line one\\nLine two');
  });

  test('the file has the parts every calendar app needs', async () => {
    const id = 'evt_ose479_ics_shape';
    await seedEvent({ id });
    await seedShortlink(id, 'Shp479');
    const body = await (await SELF.fetch(`https://t.test/events/${id}/calendar.ics`)).text();
    expect(body.endsWith('\r\n')).toBe(true);
    expect(body.replace(/\r\n/g, '')).not.toContain('\n');
    const lines = body.split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines.some((l) => l.startsWith('PRODID:'))).toBe(true);
    expect(lines.some((l) => /^UID:\S+@oursharedevents\.com$/.test(l))).toBe(true);
    expect(lines.some((l) => /^DTSTAMP:\d{8}T\d{6}Z$/.test(l))).toBe(true);
    expect(lines.some((l) => /^DTSTART(;TZID=[A-Za-z_/]+)?:\d{8}T\d{6}Z?$/.test(l))).toBe(true);
    expect(lines.some((l) => /^DTEND(;TZID=[A-Za-z_/]+)?:\d{8}T\d{6}Z?$/.test(l))).toBe(true);
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(lines.filter((l) => l === 'END:VEVENT')).toHaveLength(1);
    expect(lines[lines.length - 2]).toBe('END:VCALENDAR');
  });
});
