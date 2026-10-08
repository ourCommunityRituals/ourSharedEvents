/**
 * A withheld count is shown in words, never as 0 (OSE-1657, items 1 and 3).
 *
 * Two admin-side pages draw counts in the browser from routes that floor them
 * (`applyCountFloor`, K = 5: under 5 the route sends `count: null` and
 * `suppressed: true`). Each page has to say "fewer than 5" for those, and say
 * that a read failed when it failed. Before this, both drew a 0.
 *
 *   1. The organizer's report page (bare /sharedReport, Advanced Metrics): the
 *      Registration → Check-in funnel read `Number(count) || 0`, so 3
 *      registrations read "0", and so did a failed read.
 *   3. The Live view (/api/v2/admin/events/:id/live): its note said every total
 *      under 5 reads "held", but poster scans, posters and places are exact by
 *      the dashboard contract. The note now names the tiles that came floored,
 *      from the data itself, so it stays true when more of them are floored
 *      (OSE-1656). A floored day in the scans list reads "Held", not 0.
 *   4. The public post-event "By the numbers" card: a line was drawn only when
 *      its raw count was above 0, so a missing line said 0 and "Fewer than 5"
 *      said 1 to 4; the card itself showed for any count above 0. Walk-ins and
 *      check-ins were floored one by one, so with 8 check-ins and 6 walk-ins
 *      both printed, and 8 - 6 = 2 came through registration. Now the card shows
 *      only when some count clears the floor, draws every line, and floors the
 *      walk-ins as a subset of the check-ins (`floorNestedCounts`).
 *
 * Item 2 (the public check-in answer) needs the Worker: see
 * `withheld-checkin-answer.spec.ts`.
 *
 * Both pages run here in jsdom with the real page script and a stubbed fetch.
 *
 * @born-red OSE-1657 | method: this file was written first and run on main at
 *   c2065af. Funnel: withheld cells read "0" and "0%", failed reads read "0".
 *   Live view: the note claimed every total under 5 reads "held" while the scans
 *   tile read 3, and a floored day read "0". Recap: a missing line for 0 and
 *   "Fewer than 5" for 1 to 4; 8 check-ins and 6 walk-ins both printed.
 *   Red: 16 of 18 (the all-published funnel case and the 14/6 recap case are
 *   guards) | date: 2026-10-08
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import REPORT_HTML from '../src/templates/shared-report.html';
import { handleAdminEventLivePage, type LiveMonitorEnv } from '../src/handlers/live-monitor';
import { renderPostEventHtml, type PublicEventRow } from '../src/handlers/pages';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

async function until(doc: Document, selector: string, ok?: (el: Element) => boolean) {
  for (let i = 0; i < 120; i++) {
    const el = doc.querySelector(selector);
    if (el && (!ok || ok(el))) return el;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`${selector} did not render`);
}

const WITHHELD = { ok: true, count: null, suppressed: true, floor: 5 };
const shown = (n: number) => ({ ok: true, count: n, suppressed: false, floor: 5 });

// ─── 1. The report page's funnel ─────────────────────────────────────────────

type Answer = { status: number; body: unknown } | 'network-error';

async function openFunnel(reg: Answer, checkin: Answer): Promise<Document> {
  const dom = new JSDOM(REPORT_HTML, {
    url: 'https://ose.test/sharedReport',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      const reply = (a: Answer) => {
        if (a === 'network-error') throw new TypeError('Failed to fetch');
        return json(a.status, a.body);
      };
      (w as unknown as { fetch: unknown }).fetch = async (input: string) => {
        const url = String(input);
        if (url === '/api/v2/events')
          return json(200, {
            ok: true,
            items: [{ id: 'evt_1', name: 'Bocce night', title: 'Bocce night', status: 'active' }],
          });
        if (url.includes('/flags/current-tier')) return json(200, { ok: true, tier: 'mid' });
        if (url.endsWith('/forms/registrations')) return reply(reg);
        if (url.endsWith('/forms/checkin-count')) return reply(checkin);
        return json(404, { ok: false });
      };
    },
  });
  const doc = dom.window.document;
  await until(doc, '[data-testid="funnel-row"]');
  return doc;
}

const cell = (doc: Document, id: string) =>
  (doc.querySelector(`[data-testid="${id}"]`)?.textContent ?? '').trim();

describe('OSE-1657 item 1 | the report funnel draws a withheld count in words', () => {
  test('3 registrations and 2 check-ins (both withheld by the route) read "Fewer than 5", not 0', async () => {
    const doc = await openFunnel({ status: 200, body: WITHHELD }, { status: 200, body: WITHHELD });
    expect(cell(doc, 'funnel-reg-count')).toBe('Fewer than 5');
    expect(cell(doc, 'funnel-checkin-count')).toBe('Fewer than 5');
    // A rate over a withheld count is withheld too, and says so.
    expect(cell(doc, 'funnel-rate')).not.toMatch(/\d/);
    expect(cell(doc, 'funnel-rate')).toBe('Held');
  });

  test('one side withheld: that side reads "Fewer than 5" and the rate is held', async () => {
    const doc = await openFunnel({ status: 200, body: shown(12) }, { status: 200, body: WITHHELD });
    expect(cell(doc, 'funnel-reg-count')).toBe('12');
    expect(cell(doc, 'funnel-checkin-count')).toBe('Fewer than 5');
    expect(cell(doc, 'funnel-rate')).toBe('Held');
  });

  test.each([
    ['a 503', { status: 503, body: { ok: false, code: 'DB_UNAVAILABLE' } } as Answer],
    ['a network error', 'network-error' as Answer],
    ['an answer with no count', { status: 200, body: { ok: true } } as Answer],
  ])('%s reads "Not available", never 0', async (_name, failed) => {
    const doc = await openFunnel(failed, failed);
    expect(cell(doc, 'funnel-reg-count')).toBe('Not available');
    expect(cell(doc, 'funnel-checkin-count')).toBe('Not available');
    expect(cell(doc, 'funnel-rate')).not.toMatch(/\d/);
  });

  test('guard: both published, the numbers and the rate are drawn as before', async () => {
    const doc = await openFunnel({ status: 200, body: shown(10) }, { status: 200, body: shown(7) });
    expect(cell(doc, 'funnel-reg-count')).toBe('10');
    expect(cell(doc, 'funnel-checkin-count')).toBe('7');
    expect(cell(doc, 'funnel-rate')).toBe('70%');
  });
});

// ─── 3. The Live view ────────────────────────────────────────────────────────

function liveEnv(): LiveMonitorEnv {
  const row = { id: 'evt_live', title: 'Bocce night', status: 'active' };
  const stmt = { bind: () => stmt, first: async () => row };
  return { DB: { prepare: () => stmt } as unknown as D1Database };
}

async function openLive(dashboard: unknown): Promise<Document> {
  const res = await handleAdminEventLivePage(liveEnv(), 'evt_live');
  expect(res.status).toBe(200);
  const dom = new JSDOM(await res.text(), {
    url: 'https://ose.test/api/v2/admin/events/evt_live/live',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      (w as unknown as { fetch: unknown }).fetch = async () => json(200, dashboard);
    },
  });
  const doc = dom.window.document;
  await until(
    doc,
    '[data-testid="live-status"]',
    (el) => el.getAttribute('data-state') === 'fresh'
  );
  return doc;
}

/** The governed event dashboard as the route sends it today: scans exact, taps and check-ins floored. */
function dashboard(overrides: { scans?: unknown; scansByDay?: unknown[] } = {}) {
  return {
    ok: true,
    reach: {
      scans: overrides.scans ?? 3,
      scansByDay: overrides.scansByDay ?? [{ day: '2026-10-07', count: 3 }],
      clicks: WITHHELD,
      posters: 2,
      places: 1,
    },
    participation: { explicit: { checkins: WITHHELD } },
    sponsors: { on_show: 1 },
  };
}

const text = (doc: Document, id: string) =>
  (doc.querySelector(`[data-testid="${id}"]`)?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('OSE-1657 item 3 | the Live view says only what is true of its numbers', () => {
  test('the note names the tiles that came floored, and no other', async () => {
    const doc = await openLive(dashboard());
    expect(text(doc, 'live-scans')).toBe('3');
    expect(text(doc, 'live-taps')).toBe('Held');
    expect(text(doc, 'live-checkins')).toBe('Held');
    const note = text(doc, 'live-note');
    // Before: "A total under 5 reads "held"." — untrue while scans read 3.
    expect(note).not.toMatch(/A total under 5 reads/i);
    expect(note).toMatch(/Link taps and check-ins under 5 read .Held./);
    expect(note).not.toMatch(/scans[^.]*under 5/i);
  });

  test('when scans come floored too (OSE-1656), the note says so, and a floored day reads Held', async () => {
    const doc = await openLive(
      dashboard({
        scans: WITHHELD,
        scansByDay: [
          { day: '2026-10-06', count: null, suppressed: true, floor: 5 },
          { day: '2026-10-07', count: 6 },
        ],
      })
    );
    expect(text(doc, 'live-scans')).toBe('Held');
    expect(text(doc, 'live-note')).toMatch(
      /Poster scans, link taps and check-ins under 5 read .Held./
    );
    const days = [...doc.querySelectorAll('[data-testid="live-days"] li b')].map(
      (b) => b.textContent
    );
    expect(days).toEqual(['Held', '6']);
  });

  test('guard: nothing floored, the note makes no claim about "Held"', async () => {
    const doc = await openLive({
      ...dashboard(),
      reach: { scans: 9, scansByDay: [], clicks: shown(12), posters: 2, places: 1 },
      participation: { explicit: { checkins: shown(7) } },
    });
    expect(text(doc, 'live-note')).not.toMatch(/Held/i);
    expect(text(doc, 'live-note')).toMatch(/Counts only/);
  });
});

// ─── 4. The public post-event "By the numbers" ───────────────────────────────

function pastRow(): PublicEventRow {
  return {
    id: 'evt_recap',
    brand_id: 'root',
    title: 'Bocce night',
    slug: 'bocce-night',
    status: 'active',
    description: 'Bocce in the park.',
    location: 'Harbor Country Park',
    start_date: '2026-10-01',
    end_date: '2026-10-01',
    timezone: 'America/Chicago',
    starts_at: '2026-10-01T23:00:00Z',
    what_short: 'Bocce night.',
    who_host: null,
    why_purpose: null,
    how_details: null,
    where_address: null,
    who_story: null,
    who_image_url: null,
    what_video_url: null,
    what_url: null,
    what_url_enabled: 0,
    what_url_type: null,
    lat: null,
    lon: null,
    price_cents: null,
    price_model: null,
    price_note: null,
  } as PublicEventRow;
}

interface Counts {
  regCount: number;
  checkinCount: number;
  walkInCount?: number;
  surveyCount: number;
  emailCount: number;
}
const zero: Counts = {
  regCount: 0,
  checkinCount: 0,
  walkInCount: 0,
  surveyCount: 0,
  emailCount: 0,
};

/** The "By the numbers" card, or '' when the recap draws none. */
function statsCard(c: Partial<Counts>): string {
  const html = renderPostEventHtml(pastRow(), 'https://ose.test/events/evt_recap', [], {
    sponsors: [],
    ...zero,
    ...c,
  });
  expect(html).toContain('data-testid="event-main-post"');
  return html.match(/<section[^>]*data-testid="event-stats-card"[\s\S]*?<\/section>/)?.[0] ?? '';
}

describe('OSE-1657 item 4 | the recap cannot tell 0 from fewer than 5', () => {
  test.each([
    ['registrations', 'regCount'],
    ['check-ins', 'checkinCount'],
    ['surveys', 'surveyCount'],
    ['email signups', 'emailCount'],
  ] as const)('%s: 0 and 1 to 4 draw the same card', (_name, key) => {
    // One published count keeps the card on; the count under test is 0, then 1..4.
    const other = key === 'emailCount' ? { surveyCount: 9 } : { emailCount: 9 };
    const seen = new Set([0, 1, 2, 3, 4].map((n) => statsCard({ ...other, [key]: n })));
    expect(seen.size, 'the card for 0, 1, 2, 3 and 4').toBe(1);
  });

  test('every count under 5 draws no card at all, the same as nothing happened', () => {
    expect(statsCard({})).toBe('');
    expect(
      statsCard({ regCount: 3, checkinCount: 2, walkInCount: 1, surveyCount: 1, emailCount: 4 })
    ).toBe('');
  });

  test('a card that is drawn says "Fewer than 5" for each small count, never a bare absence', () => {
    const card = statsCard({ regCount: 12, checkinCount: 0, surveyCount: 2 });
    expect(card).toContain('<strong>12</strong> Registered');
    expect(card).toContain('Fewer than 5 Checked in');
    expect(card).toContain('Fewer than 5 Surveys submitted');
    expect(card).toContain('Fewer than 5 Email signups');
  });

  test('walk-ins are a subset of check-ins: 8 check-ins and 6 walk-ins never both print', () => {
    const card = statsCard({ regCount: 20, checkinCount: 8, walkInCount: 6 });
    // Both would be over the floor alone; together they give back 8 - 6 = 2.
    const both =
      card.includes('<strong>8</strong> Checked in') &&
      card.includes('<strong>6</strong> Walked in');
    expect(both, 'check-ins and walk-ins both exact').toBe(false);
    expect(card).not.toContain('<strong>6</strong>');
    expect(card).not.toContain('data-testid="stat-walk-in-share"');
    // Withheld in words, and true: six walked in, so not "Fewer than 5".
    expect(card).toMatch(/data-testid="stat-walk-ins"[^>]*>Walked in: held/);
  });

  test('walk-ins: 0 and 1 to 4 read the same, once check-ins print', () => {
    const seen = new Set(
      [0, 1, 2, 3, 4].map((w) => statsCard({ checkinCount: 14, walkInCount: w }))
    );
    expect(seen.size).toBe(1);
    expect([...seen][0]).toContain('Fewer than 5 Walked in');
  });

  test('guard: 14 check-ins and 6 walk-ins (8 through registration) all print, with the share', () => {
    const card = statsCard({ regCount: 20, checkinCount: 14, walkInCount: 6 });
    expect(card).toContain('<strong>14</strong> Checked in');
    expect(card).toContain('<strong>6</strong> Walked in');
    expect(card).toContain('43% of check-ins were walk-ins');
    expect(card).toContain('70% of those registered showed up');
  });
});
