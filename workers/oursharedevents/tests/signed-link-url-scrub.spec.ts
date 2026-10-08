/**
 * Signed links do not stay in the address bar.
 *
 * `/sponsor?t=…` (30 days) and `/sharedReport?…&token=…` are opened by a link
 * that IS the credential. Left in the address bar it is in every screenshot,
 * every copied or shared link, the Back/Forward list and anyone's line of
 * sight. Each page now reads the token once, keeps it in a script variable for
 * its own later calls, and replaces the address with the same one minus the
 * token.
 *
 * What this does NOT do: take the link as first opened out of the browser's
 * own history list. Chromium records that address when the page arrives,
 * before any script runs (measured 2026-10-07: after the replace, the profile's
 * history still held both addresses). Closing that needs the link itself to
 * stop being the credential, which is the redeem-code story, not this one.
 *
 * Runs each page's real script (the template Text import) in jsdom with a
 * stubbed fetch, so what is checked is what a browser does:
 *
 *   - after load, the address has no token, and every other parameter and the
 *     #fragment are still there;
 *   - the address is replaced, not pushed (Back does not land on a copy that
 *     still carries the token);
 *   - the page's own later calls still send the token (Accept / Decline /
 *     Ask to join on /sponsor; the report read on /sharedReport);
 *   - the token is not put anywhere else a later visit could read it: no
 *     cookie, no localStorage, no sessionStorage, no history state;
 *   - opening the address the page leaves behind (what a refresh does) does not
 *     open the report: the token is gone, which is the point.
 *
 * @born-red signed-link scrub | method: written against the pre-change
 * templates — `location.search` still held `t=` / `token=` after load, so every
 * "has no token" test failed; the tests marked (guard) were green before and
 * are kept so a later change cannot trade the address bar for storage
 * | date: 2026-10-07
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import REPORT_HTML from '../src/templates/shared-report.html';
import { renderSponsorHomePage, type PlacementRow } from '../src/lib/sponsor-home-render';

// Shaped like the real thing (base64url payload, dot, hex signature) so a test
// that looks for it anywhere in the address cannot pass by accident.
const TOKEN = 'eyJraW5kIjoic3BvbnNvcl9ob21lIn0.' + 'ab12'.repeat(16);

interface Call {
  url: string;
  method: string;
  body: string;
  authorization: string;
}
interface HistoryCall {
  kind: 'replace' | 'push';
  url: string;
}

interface Opened {
  w: JSDOM['window'];
  doc: Document;
  calls: Call[];
  historyCalls: HistoryCall[];
  $: (testid: string) => HTMLElement | null;
  settle: () => Promise<void>;
}

async function open(
  html: string,
  url: string,
  respond: (url: string) => unknown = () => ({ ok: true, items: [] })
): Promise<Opened> {
  const calls: Call[] = [];
  const historyCalls: HistoryCall[] = [];
  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      const proto = (w as unknown as { History: { prototype: History } }).History.prototype;
      const realReplace = proto.replaceState;
      const realPush = proto.pushState;
      proto.replaceState = function (this: History, state, unused, u) {
        historyCalls.push({ kind: 'replace', url: String(u) });
        return realReplace.call(this, state, unused, u);
      };
      proto.pushState = function (this: History, state, unused, u) {
        historyCalls.push({ kind: 'push', url: String(u) });
        return realPush.call(this, state, unused, u);
      };
      (w as unknown as { fetch: unknown }).fetch = async (u: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        calls.push({
          url: u,
          method: (init?.method ?? 'GET').toUpperCase(),
          body: typeof init?.body === 'string' ? init.body : '',
          authorization: headers.Authorization ?? '',
        });
        return new Response(JSON.stringify(respond(u)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };
    },
  });
  const w = dom.window;
  const doc = w.document;
  const settle = async () => {
    for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 30));
  };
  await settle();
  return {
    w,
    doc,
    calls,
    historyCalls,
    $: (testid) => doc.querySelector<HTMLElement>(`[data-testid="${testid}"]`),
    settle,
  };
}

/** Nothing a later visit could read the token back from. */
function expectTokenStoredNowhere(o: Opened): void {
  const w = o.w;
  expect(w.document.cookie, 'cookie').toBe('');
  expect(w.localStorage.length, 'localStorage').toBe(0);
  expect(w.sessionStorage.length, 'sessionStorage').toBe(0);
  expect(JSON.stringify(w.history.state ?? null), 'history state').not.toContain(TOKEN);
}

// ── /sponsor ───────────────────────────────────────────────────────────────────

function placement(over: Partial<PlacementRow> = {}): PlacementRow {
  return {
    placement_id: 'pl_1',
    event_id: 'evt_1',
    tier: 'gold',
    locality_band: 0,
    organizer_accepted: 1,
    sponsor_accepted: null,
    placement_active: 1,
    title: 'Bocce Night',
    status: 'active',
    start_date: '2099-01-01',
    end_date: null,
    location: 'Eagles Hall',
    is_published: 1,
    ...over,
  };
}

const SPONSOR_HTML = renderSponsorHomePage({
  sponsor: { id: 'sb_1', name: 'Corner Bakery' },
  placements: [placement()],
  discoverable: [
    { id: 'evt_2', title: 'Chili Cook-off', start_date: '2099-02-01', location: null, near: 0 },
  ],
  requests: [],
  expiresIso: '2099-01-01T12:00:00Z',
});

const openSponsor = (search: string) =>
  open(SPONSOR_HTML, `https://ose.test/sponsor${search}`, () => ({ ok: true }));

describe('/sponsor: the link token leaves the address bar once read', () => {
  test('after load the address has no token', async () => {
    const o = await openSponsor(`?t=${TOKEN}`);
    expect(new URLSearchParams(o.w.location.search).has('t')).toBe(false);
    expect(o.w.location.search).toBe('');
    expect(o.w.location.pathname).toBe('/sponsor');
    expect(o.w.location.href).not.toContain(TOKEN);
  });

  test('only the token is dropped: other parameters and the #fragment stay', async () => {
    const o = await openSponsor(`?lang=es&t=${TOKEN}&ref=email#main-content`);
    const left = new URLSearchParams(o.w.location.search);
    expect([...left.keys()]).toEqual(['lang', 'ref']);
    expect(left.get('lang')).toBe('es');
    expect(left.get('ref')).toBe('email');
    expect(o.w.location.hash).toBe('#main-content');
    expect(o.w.location.href).not.toContain(TOKEN);
  });

  test('the address is replaced once, never pushed', async () => {
    const o = await openSponsor(`?t=${TOKEN}`);
    expect(o.historyCalls).toEqual([{ kind: 'replace', url: '/sponsor' }]);
    expect(o.w.history.length).toBe(1);
  });

  test('Accept still sends the token after it has left the address', async () => {
    const o = await openSponsor(`?t=${TOKEN}`);
    expect(o.w.location.href).not.toContain(TOKEN);
    o.$('placement-accept')!.click();
    await o.settle();
    const respond = o.calls.find((c) => c.url.endsWith('/placements/pl_1/respond'));
    expect(respond, 'the respond call').toBeDefined();
    expect(respond!.method).toBe('POST');
    expect(JSON.parse(respond!.body)).toEqual({ token: TOKEN, accepted: true });
    expect(o.$('placement-state')!.textContent).toBe('Accepted');
  });

  test('(guard) Ask to join still sends the token after it has left the address', async () => {
    const o = await openSponsor(`?t=${TOKEN}`);
    o.$('discover-ask')!.click();
    await o.settle();
    const ask = o.calls.find((c) => c.url === '/api/v2/sponsor/requests');
    expect(ask, 'the ask call').toBeDefined();
    expect(JSON.parse(ask!.body)).toEqual({ token: TOKEN, event_id: 'evt_2' });
  });

  test('(guard) the token is kept in the page only: no cookie, no storage, no history state', async () => {
    const o = await openSponsor(`?t=${TOKEN}`);
    o.$('placement-accept')!.click();
    await o.settle();
    expectTokenStoredNowhere(o);
  });

  test('(guard) an address with no token is left exactly as it was', async () => {
    const o = await openSponsor('?lang=es#main-content');
    expect(o.historyCalls).toEqual([]);
    expect(o.w.location.href).toBe('https://ose.test/sponsor?lang=es#main-content');
  });
});

// ── /sharedReport ──────────────────────────────────────────────────────────────

const reportBody = (url: string) =>
  url.includes('/shared-report')
    ? { ok: true, report: { event_title: 'Bocce Night', event_start_date: '2026-09-26' } }
    : url.includes('/flags/current-tier')
      ? { ok: false }
      : { ok: true, items: [] };

const openReport = (search: string, path = '/sharedReport') =>
  open(REPORT_HTML, `https://ose.test${path}${search}`, reportBody);

const reportReads = (o: Opened) => o.calls.filter((c) => c.url.endsWith('/shared-report'));

describe('/sharedReport: the link token leaves the address bar once read', () => {
  test('after load the address has no token and still names the event', async () => {
    const o = await openReport(`?eventId=evt_1&token=${TOKEN}`);
    const left = new URLSearchParams(o.w.location.search);
    expect(left.has('token')).toBe(false);
    expect(left.get('eventId')).toBe('evt_1');
    expect(o.w.location.search).toBe('?eventId=evt_1');
    expect(o.w.location.href).not.toContain(TOKEN);
  });

  test('only the token is dropped: every other parameter and the #fragment stay', async () => {
    const o = await openReport(`?event=evt_1&token=${TOKEN}&from=email#main-content`);
    const left = new URLSearchParams(o.w.location.search);
    expect([...left.keys()]).toEqual(['event', 'from']);
    expect(left.get('event')).toBe('evt_1');
    expect(left.get('from')).toBe('email');
    expect(o.w.location.hash).toBe('#main-content');
  });

  test('the legacy ?id= form keeps its event id too', async () => {
    const o = await openReport(`?token=${TOKEN}&id=evt_1`);
    expect(o.w.location.search).toBe('?id=evt_1');
  });

  test('an alias path keeps its path', async () => {
    const o = await openReport(`?eventId=evt_1&token=${TOKEN}`, '/report');
    expect(o.w.location.pathname).toBe('/report');
    expect(o.w.location.search).toBe('?eventId=evt_1');
  });

  test('a token with no event id is dropped as well (it is still a credential)', async () => {
    const o = await openReport(`?token=${TOKEN}`);
    expect(o.w.location.search).toBe('');
    expect(o.w.location.href).not.toContain(TOKEN);
  });

  test('the address is replaced once, never pushed', async () => {
    const o = await openReport(`?eventId=evt_1&token=${TOKEN}`);
    expect(o.historyCalls).toEqual([{ kind: 'replace', url: '/sharedReport?eventId=evt_1' }]);
    expect(o.w.history.length).toBe(1);
  });

  test('(guard) the report is still read with the token, and the page stays the one-event report', async () => {
    const o = await openReport(`?eventId=evt_1&token=${TOKEN}`);
    const reads = reportReads(o);
    expect(reads).toHaveLength(1);
    expect(reads[0].url).toBe('/api/v2/events/evt_1/shared-report');
    expect(reads[0].authorization).toBe(`Bearer ${TOKEN}`);
    // The later scripts on the page run after the address changed. They must
    // still see a signed-link visit: no organizer dashboard, no admin request.
    expect(o.$('signed-link-section')!.hidden).toBe(false);
    expect(o.doc.getElementById('admin-section-events')!.hidden).toBe(true);
    expect(o.calls.filter((c) => c.url.startsWith('/api/v2/admin/'))).toEqual([]);
    expect(o.calls.filter((c) => c.url === '/api/v2/events')).toEqual([]);
  });

  test('(guard) the token is kept in the page only: no cookie, no storage, no history state', async () => {
    const o = await openReport(`?eventId=evt_1&token=${TOKEN}`);
    expectTokenStoredNowhere(o);
  });

  test('(guard) an address with no token is left exactly as it was', async () => {
    const o = await openReport('?event=evt_1&from=email#main-content');
    expect(o.historyCalls).toEqual([]);
    expect(o.w.location.href).toBe(
      'https://ose.test/sharedReport?event=evt_1&from=email#main-content'
    );
  });

  // The token goes when it is read, not when the report arrives: a working link
  // on a connection that drops must not sit in the address bar next to an error.
  // (Written after the code; seen red by moving the replace to after the read.)
  test('the token leaves the address even when the report cannot be reached', async () => {
    const o = await open(
      REPORT_HTML,
      `https://ose.test/sharedReport?eventId=evt_1&token=${TOKEN}`,
      (url) => {
        if (url.includes('/shared-report')) throw new TypeError('network down');
        return { ok: true, items: [] };
      }
    );
    expect(o.$('signed-link-error')!.getAttribute('data-error-code')).toBe('NETWORK_ERROR');
    expect(o.w.location.search).toBe('?eventId=evt_1');
    expect(o.w.location.href).not.toContain(TOKEN);
  });

  // What a refresh does. The browser asks for the address the page left behind,
  // which has the event id and no token.
  test('a refresh does not reopen the report: the address left behind has no token to send', async () => {
    const first = await openReport(`?eventId=evt_1&token=${TOKEN}`);
    const leftBehind = first.w.location.pathname + first.w.location.search;
    expect(leftBehind).toBe('/sharedReport?eventId=evt_1');

    const again = await open(REPORT_HTML, `https://ose.test${leftBehind}`, reportBody);
    expect(reportReads(again), 'no report read without a token').toEqual([]);
    expect(again.$('signed-link-section')!.hidden).toBe(true);
    // It falls back to the page's no-token view (the public events list).
    expect(again.calls.some((c) => c.url === '/api/v2/events')).toBe(true);
  });
});
