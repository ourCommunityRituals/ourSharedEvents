/**
 * Admin and sponsor home report an action's result with the @ocr/ui toast.
 *
 * What a person sees after an action is one of three toasts (success, failure,
 * note), drawn by the script the Worker serves at /ui-toast.js. A failure's
 * details are the error code and the request reference (`X-Request-Id`), read
 * by `ocrToast.detailsFrom(res, body, action)`. The browser's own error text
 * and the response's other fields are never shown.
 *
 * This file runs the pages' real scripts and the real toast script (the string
 * the route serves) in jsdom:
 *   - which templates load /ui-toast.js (admin pages and sponsor home only)
 *   - sponsor home: accept, decline and ask to join
 *   - admin: the shared announce line and every action that reports through it
 *   - the seeded secret: a token, a bearer key, a cookie, a signed link, an
 *     email, a stack line and SQL in the response reach neither the page nor
 *     the clipboard
 *   - the round trip: the reference in the toast is the `X-Request-Id` of a
 *     response the real handler made
 *   - with no toast script (it failed to load), the old line still says it
 *
 * Real browsers (Chromium and WebKit, axe in both themes) are in
 * tests/playwright/toast-service.spec.ts.
 *
 * @born-red toast adoption | method: run against the pages before the change
 *   (no script tag, no toast, `err.message` shown), then one injected fault per
 *   guard after it | date: 2026-10-12
 */

import vm from 'node:vm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { toastScript } from '@ocr/ui';
import ADMIN_RAW from '../src/templates/admin.html';
import ADMIN_LOGS from '../src/templates/admin-logs.html';
import ADMIN_SETTINGS from '../src/templates/admin-settings.html';
import ADMIN_SIGNIN from '../src/templates/admin-signin.html';
import DISPLAY from '../src/templates/display.html';
import LANDING from '../src/templates/landing.html';
import POSTER from '../src/templates/poster.html';
import PUBLIC from '../src/templates/public.html';
import SHARED_REPORT from '../src/templates/shared-report.html';
import SPONSOR_CARD from '../src/templates/sponsor-card.html';
import SPONSOR_HOME_RAW from '../src/templates/sponsor-home.html';
import { renderSponsorHomePage, type PlacementRow } from '../src/lib/sponsor-home-render';
import { handleSponsorPlacementRespond } from '../src/handlers/sponsor-home';

const ADMIN_HTML = ADMIN_RAW.replace(/\r\n/g, '\n');
const SPONSOR_HOME = SPONSOR_HOME_RAW.replace(/\r\n/g, '\n');
const TAG = '<script src="/ui-toast.js" defer></script>';

// Each admin test parses the whole page; on a busy machine that takes seconds.
vi.setConfig({ testTimeout: 30_000 });

// ── What must never reach the page or the clipboard ─────────────────────────
// Shaped like the real things and plainly not real, so no scanner takes one
// for a credential.
const PAGE_TOKEN = 'test-claim_part.test-signature_part-0';
const SEEDED = {
  jwt: 'eyJ0ZXN0IjoidG9hc3QifQ.eyJub3QiOiJhLXJlYWwtdG9rZW4ifQ.c2VlZGVkLXNlY3JldA',
  bearer: 'Bearer seeded-bearer-value-0001',
  cookie: 'ose_session=seeded-cookie-value-0002',
  signedLink: 'https://events.example/sponsor?t=seeded-signed-link-0003',
  email: 'seeded.person@example.com',
  stack: 'at handleRespond (sponsor-home.ts:340:12)',
  sql: 'SELECT id FROM sponsor_business WHERE id = ?',
  attendee: 'Seeded Attendee Name',
};
const SECRET_MARKS = [
  PAGE_TOKEN,
  SEEDED.jwt,
  'seeded-bearer-value-0001',
  'seeded-cookie-value-0002',
  'seeded-signed-link-0003',
  SEEDED.email,
  'sponsor-home.ts:340',
  'sponsor_business',
  SEEDED.attendee,
];
const REF = 'req-7f3a9c21';

/** A failed response that carries every seeded secret somewhere the page could read. */
function seededFailure(status: number, code: string, error?: string): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      status,
      code,
      error: error ?? `Database not available ${SEEDED.stack} ${SEEDED.sql} token=${SEEDED.jwt}`,
      requestId: REF,
      token: SEEDED.jwt,
      authorization: SEEDED.bearer,
      cookie: SEEDED.cookie,
      link: SEEDED.signedLink,
      email: SEEDED.email,
      stack: SEEDED.stack,
      query: SEEDED.sql,
      request: { token: PAGE_TOKEN, attendee_name: SEEDED.attendee },
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': REF,
        'X-Seeded-Authorization': SEEDED.bearer,
      },
    }
  );
}

const jsonReply = (status: number, body: unknown, ref = REF): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': ref },
  });

// ── Page harness ────────────────────────────────────────────────────────────
type Win = Window & Record<string, unknown>;
type Call = { url: string; method: string; body: Record<string, unknown> | null };
type Answer = (call: Call) => Response | Promise<Response> | Error;

const open: JSDOM[] = [];
afterEach(() => {
  while (open.length) open.pop()!.window.close();
});

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

function boot(html: string, url: string, opts: { toast: boolean; answer: Answer }) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url });
  open.push(dom);
  const w = dom.window as unknown as Win;
  const context = dom.getInternalVMContext();
  const run = (code: string) => new vm.Script(code).runInContext(context) as unknown;
  const calls: Call[] = [];
  w.fetch = (async (target: string, init?: RequestInit) => {
    const call: Call = {
      url: String(target),
      method: (init?.method ?? 'GET').toUpperCase(),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
    };
    calls.push(call);
    const reply = await opts.answer(call);
    if (reply instanceof Error) throw reply;
    return reply;
  }) as unknown as typeof fetch;
  const copied: string[] = [];
  Object.defineProperty(w.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text: string) => void copied.push(text) },
  });
  (w as unknown as { Element: typeof Element }).Element.prototype.scrollIntoView = () => {};
  // The script the route serves, run as the page would run it.
  if (opts.toast) run(toastScript);
  const doc = w.document;
  /** The page's own scripts that hold these lines, run in page order. */
  const runPageScripts = (...markers: string[]) => {
    const scripts = Array.from(doc.querySelectorAll('script'))
      .map((s) => s.textContent || '')
      .filter((text) => markers.some((m) => text.includes(m)));
    expect(scripts.length, 'every page script this flow needs was found').toBe(markers.length);
    for (const text of scripts) run(text);
  };
  const toasts = (kind?: string) =>
    Array.from(
      doc.querySelectorAll<HTMLElement>(kind ? `[data-ocr-toast="${kind}"]` : '[data-ocr-toast]')
    );
  const message = (el: Element) => el.querySelector('.ocr-toast-msg')!.textContent ?? '';
  const details = (el: Element) => el.querySelector('.ocr-toast-details-text')?.textContent ?? '';
  const copyDetails = async (el: Element) => {
    el.querySelector<HTMLButtonElement>('.ocr-toast-more')!.click();
    el.querySelector<HTMLButtonElement>('.ocr-toast-copy')!.click();
    await flush();
    return copied[copied.length - 1] ?? '';
  };
  /** Everything a person or a screen reader could read, plus the clipboard. */
  const everything = () => doc.documentElement.outerHTML + '\n' + copied.join('\n');
  return {
    w,
    doc,
    run,
    runPageScripts,
    calls,
    copied,
    toasts,
    message,
    details,
    copyDetails,
    everything,
  };
}

function expectNoSecret(text: string) {
  for (const mark of SECRET_MARKS) expect(text, `leaked: ${mark}`).not.toContain(mark);
}

// ── Which pages load the script ─────────────────────────────────────────────
describe('which pages load /ui-toast.js', () => {
  const LOADS: Record<string, string> = {
    'admin.html': ADMIN_HTML,
    'admin-logs.html': ADMIN_LOGS,
    'admin-settings.html': ADMIN_SETTINGS,
    'sponsor-home.html': SPONSOR_HOME,
  };
  // Not adopted yet. Adding one is a product decision (cookies, counts on the
  // display, tokens), so it is a change to this list, not a side effect.
  const DOES_NOT_LOAD: Record<string, string> = {
    'admin-signin.html': ADMIN_SIGNIN,
    'display.html': DISPLAY,
    'landing.html': LANDING,
    'poster.html': POSTER,
    'public.html': PUBLIC,
    'shared-report.html': SHARED_REPORT,
    'sponsor-card.html': SPONSOR_CARD,
  };

  for (const [name, html] of Object.entries(LOADS)) {
    test(`${name} loads it once, in the head, deferred, with nothing inline`, () => {
      expect(html.match(/<script[^>]*src="\/ui-toast\.js"/g), 'one script element').toHaveLength(1);
      const head = html.slice(0, html.indexOf('</head>'));
      expect(head).toContain(TAG);
      expect(head.indexOf('href="/ui.css"'), 'after the stylesheet it needs').toBeLessThan(
        head.indexOf(TAG)
      );
    });
  }

  for (const [name, html] of Object.entries(DOES_NOT_LOAD)) {
    test(`${name} does not load it`, () => {
      expect(html).not.toContain('ui-toast.js');
      expect(html).not.toContain('ocrToast');
    });
  }

  test('the rendered sponsor page carries the tag', () => {
    expect(sponsorPage()).toContain(TAG);
  });
});

// ── Sponsor home ────────────────────────────────────────────────────────────
const placement = (over: Partial<PlacementRow> = {}): PlacementRow => ({
  placement_id: 'p1',
  event_id: 'e1',
  tier: 'gold',
  locality_band: 0,
  organizer_accepted: 1,
  sponsor_accepted: null,
  placement_active: 1,
  title: 'Bocce Night',
  status: 'active',
  start_date: '2099-10-01',
  end_date: null,
  location: 'Eagles Hall',
  is_published: 1,
  ...over,
});

const sponsorPage = () =>
  renderSponsorHomePage({
    sponsor: { id: 'sb1', name: 'Corner Bakery' },
    placements: [placement()],
    expiresIso: '2099-11-10T12:00:00Z',
    discoverable: [
      { id: 'e2', title: 'Trivia', start_date: '2099-10-02', location: 'Eagles Hall', near: 0 },
    ],
    requests: [],
  });

function sponsorHome(opts: { toast?: boolean; answer: Answer }) {
  const page = boot(sponsorPage(), `https://sponsor.test/sponsor?t=${PAGE_TOKEN}`, {
    toast: opts.toast !== false,
    answer: opts.answer,
  });
  page.runPageScripts('placement-respond');
  const card = page.doc.querySelector<HTMLElement>('[data-testid="placement-card"]')!;
  const line = (el: Element | null) => el?.closest('.sh-card')?.querySelector('.sh-msg') ?? null;
  const tap = async (testid: string) => {
    const btn = page.doc.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)!;
    expect(btn, testid).not.toBeNull();
    btn.click();
    await flush();
    return btn;
  };
  const tapAsk = async () => {
    const btn = page.doc.querySelector<HTMLButtonElement>('[data-action="sponsor-request"]')!;
    expect(btn, 'the ask-to-join button').not.toBeNull();
    btn.click();
    await flush();
    return btn;
  };
  return { ...page, card, line, tap, tapAsk };
}

describe('sponsor home: an answer is reported in a toast', () => {
  test('accepting shows a success toast, and the line under the card stays empty', async () => {
    const p = sponsorHome({ answer: () => jsonReply(200, { ok: true }) });
    const btn = await p.tap('placement-accept');
    expect(p.calls[0].url).toBe('/api/v2/sponsor/placements/p1/respond');
    expect(p.toasts()).toHaveLength(1);
    expect(p.message(p.toasts('success')[0])).toBe('Success: Thanks. Your placement is on.');
    expect(p.line(btn)!.textContent).toBe('');
    // The card itself still shows the new state.
    expect(p.card.querySelector('[data-testid="placement-state"]')!.textContent).toBe('Accepted');
  });

  test('declining shows a success toast that says it can be changed', async () => {
    const p = sponsorHome({ answer: () => jsonReply(200, { ok: true }) });
    await p.tap('placement-decline');
    expect(p.message(p.toasts('success')[0])).toBe(
      'Success: Declined. You can change your mind below.'
    );
  });

  test('asking to join shows a success toast', async () => {
    const p = sponsorHome({ answer: () => jsonReply(200, { ok: true }) });
    const btn = await p.tapAsk();
    expect(p.calls[0].url).toBe('/api/v2/sponsor/requests');
    expect(p.message(p.toasts('success')[0])).toBe(
      'Success: Asked. Your name shows only if they say yes.'
    );
    expect(p.line(btn)!.textContent).toBe('');
  });

  test('a failed answer shows a failure toast with the code, the reference and the action', async () => {
    const p = sponsorHome({ answer: () => seededFailure(503, 'DB_NOT_CONFIGURED') });
    const btn = await p.tap('placement-accept');
    expect(p.toasts()).toHaveLength(1);
    const toast = p.toasts('failure')[0];
    expect(p.message(toast)).toBe('Error: Could not save your answer.');
    expect(p.details(toast)).toMatch(
      /^Error code: DB_NOT_CONFIGURED\nRequest reference: req-7f3a9c21\nTime: \d{4}-\d\d-\d\dT[\d:.]+Z\nAction: Answering a placement$/
    );
    expect(p.line(btn)!.textContent).toBe('');
    // Nothing changed on the card, and the buttons work again.
    expect(p.card.querySelector('[data-testid="placement-state"]')!.textContent).not.toBe(
      'Accepted'
    );
    expect(btn.disabled).toBe(false);
  });

  test("a known refusal adds this page's own reason for that code; the server sentence is never shown", async () => {
    const refused = sponsorHome({
      answer: () =>
        jsonReply(409, {
          ok: false,
          code: 'TOO_MANY_OPEN',
          error: `${SEEDED.attendee} already has requests waiting`,
        }),
    });
    await refused.tapAsk();
    expect(refused.message(refused.toasts('failure')[0])).toBe(
      'Error: Could not send your request. You have several requests waiting. Once an organizer answers one, you can ask again.'
    );
    expect(refused.details(refused.toasts('failure')[0])).toContain('Error code: TOO_MANY_OPEN');
    expectNoSecret(refused.everything());

    for (const [code, reason] of [
      ['NOT_DISCOVERABLE', 'That event is not open for sponsor requests.'],
      ['ALREADY_LINKED', 'You are already linked to this event.'],
      ['UNAUTHORIZED', 'This link no longer works. Open the link the organizer sent you again.'],
    ]) {
      const p = sponsorHome({
        answer: () => jsonReply(409, { ok: false, code, error: 'server words' }),
      });
      await p.tapAsk();
      expect(p.message(p.toasts('failure')[0])).toBe(
        'Error: Could not send your request. ' + reason
      );
    }

    // A code this page has no words for, and a 5xx: the plain sentence alone.
    const unknown = sponsorHome({
      answer: () =>
        jsonReply(400, { ok: false, code: 'MISSING_FIELD', error: 'event_id is required' }),
    });
    await unknown.tapAsk();
    expect(unknown.message(unknown.toasts('failure')[0])).toBe(
      'Error: Could not send your request.'
    );
    const broken = sponsorHome({
      answer: () =>
        jsonReply(500, { ok: false, code: 'INTERNAL', error: 'D1_ERROR: no such table' }),
    });
    await broken.tapAsk();
    expect(broken.message(broken.toasts('failure')[0])).toBe('Error: Could not send your request.');
  });

  test('no connection: the toast says so and never shows the browser error text', async () => {
    const p = sponsorHome({
      answer: () => new TypeError(`Failed to fetch https://sponsor.test/x?t=${PAGE_TOKEN}`),
    });
    await p.tap('placement-accept');
    const toast = p.toasts('failure')[0];
    expect(p.message(toast)).toBe(
      'Error: Could not save your answer. Check your connection and try again.'
    );
    expect(p.details(toast)).toMatch(
      /^Error code: not available\nRequest reference: not available\n/
    );
    expect(p.everything()).not.toContain('Failed to fetch');
  });

  test('seeded secret: nothing sensitive in the response reaches the page or the clipboard', async () => {
    // A refusal whose own sentence carries every seeded secret, a name included.
    const hostile = `Link not valid for ${SEEDED.email}. Open ${SEEDED.signedLink} token=${SEEDED.jwt} ${SEEDED.cookie} ${SEEDED.attendee}`;
    const p = sponsorHome({ answer: () => seededFailure(401, 'UNAUTHORIZED', hostile) });
    await p.tap('placement-accept');
    const toast = p.toasts('failure')[0];
    expect(toast, 'a failure toast').toBeDefined();
    expect(p.message(toast)).toBe(
      'Error: Could not save your answer. This link no longer works. Open the link the organizer sent you again.'
    );
    const copiedText = await p.copyDetails(toast);
    expect(copiedText).toBe(p.details(toast));
    expect(copiedText.split('\n')).toHaveLength(4);
    expect(copiedText).toContain('Request reference: req-7f3a9c21');
    // The page's own token left the address bar and never comes back.
    expectNoSecret(p.everything());

    const broken = sponsorHome({ answer: () => seededFailure(500, 'INTERNAL') });
    await broken.tapAsk();
    await broken.copyDetails(broken.toasts('failure')[0]);
    expectNoSecret(broken.everything());
  });

  test('round trip: the reference in the toast is the X-Request-Id of the response the handler made', async () => {
    let served: Response | null = null;
    const p = sponsorHome({
      answer: async (call) => {
        // The real handler, with no database bound: it refuses with 503 and
        // makes a fresh request id for this request.
        const req = new Request(`https://sponsor.test${call.url}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(call.body),
        });
        const res = await handleSponsorPlacementRespond(req, {} as never, 'p1');
        served = res.clone();
        return res;
      },
    });
    await p.tap('placement-accept');
    expect(served, 'the handler answered').not.toBeNull();
    const header = served!.headers.get('X-Request-Id');
    expect(header, 'the handler sent a request id').toMatch(/^[0-9a-f-]{36}$/);
    const body = (await served!.json()) as { code: string; requestId: string };
    expect(body.requestId).toBe(header);
    const text = p.details(p.toasts('failure')[0]);
    expect(text).toContain(`Request reference: ${header}`);
    expect(text).toContain(`Error code: ${body.code}`);
  });

  test('without the toast script the line under the card still says it', async () => {
    const ok = sponsorHome({ toast: false, answer: () => jsonReply(200, { ok: true }) });
    const btn = await ok.tap('placement-accept');
    expect(ok.toasts()).toHaveLength(0);
    expect(ok.line(btn)!.textContent).toBe('Thanks. Your placement is on.');
    expect(ok.line(btn)!.className).toBe('sh-msg ok');

    const bad = sponsorHome({
      toast: false,
      answer: () => seededFailure(503, 'DB_NOT_CONFIGURED'),
    });
    const btn2 = await bad.tap('placement-accept');
    expect(bad.line(btn2)!.textContent).toBe('Could not save your answer.');
    expect(bad.line(btn2)!.className).toBe('sh-msg error');
    expectNoSecret(bad.everything());
  });
});

// ── Admin ───────────────────────────────────────────────────────────────────
const ANNOUNCE = 'window._adminAnnounce = function';

function admin(opts: { toast?: boolean; answer?: Answer; scripts?: string[] }) {
  const page = boot(ADMIN_HTML, 'https://admin.test/admin', {
    toast: opts.toast !== false,
    answer: opts.answer ?? (() => jsonReply(200, { ok: false })),
  });
  page.w.OSE_events = async () => ({ ok: true, items: [] });
  page.w.friendlyPhase = (n: number) => 'Phase ' + n;
  page.runPageScripts(ANNOUNCE, ...(opts.scripts ?? []));
  const status = page.doc.getElementById('admin-status')!;
  const announce = page.w._adminAnnounce as (m: string, kind?: string, details?: unknown) => void;
  const requestFailed = page.w._adminRequestFailed as (
    sentence: string,
    res: Response | null,
    body: unknown,
    action: string
  ) => void;
  return { ...page, status, announce, requestFailed };
}

describe('admin: the shared announce line is the toast', () => {
  test('ok is a success toast, info a note, error a failure; the old line stays hidden', () => {
    const p = admin({});
    p.announce('Poster deployment deactivated.', 'ok');
    p.announce('Someone already answered this request.', 'info');
    p.announce('QR not available to print.', 'error', { action: 'Printing a poster code' });
    expect(p.message(p.toasts('success')[0])).toBe('Success: Poster deployment deactivated.');
    expect(p.message(p.toasts('neutral')[0])).toBe('Note: Someone already answered this request.');
    const failure = p.toasts('failure')[0];
    expect(p.message(failure)).toBe('Error: QR not available to print.');
    expect(p.details(failure)).toMatch(
      /^Error code: not available\nRequest reference: not available\nTime: .+\nAction: Printing a poster code$/
    );
    expect(p.status.hidden).toBe(true);
    expect(p.status.textContent).toBe('');
  });

  test('a failed request: plain sentence, then code and reference from the response', () => {
    const p = admin({});
    p.requestFailed(
      'Could not create the sponsor link.',
      seededFailure(503, 'SIGNING_NOT_CONFIGURED'),
      {
        ok: false,
        code: 'SIGNING_NOT_CONFIGURED',
        error: 'Sponsor links are not enabled',
        token: SEEDED.jwt,
      },
      'Creating a sponsor page link'
    );
    const failure = p.toasts('failure')[0];
    expect(p.message(failure)).toBe('Error: Could not create the sponsor link.');
    expect(p.details(failure)).toMatch(
      /^Error code: SIGNING_NOT_CONFIGURED\nRequest reference: req-7f3a9c21\nTime: .+\nAction: Creating a sponsor page link$/
    );
    expectNoSecret(p.everything());
  });

  test("the server sentence is never shown; a known code adds this page's own reason", () => {
    const p = admin({});
    p.requestFailed(
      'Could not answer the request.',
      jsonReply(404, {}),
      { ok: false, code: 'NOT_FOUND', error: `Request not found: spl_1 for ${SEEDED.attendee}` },
      'Answering a sponsor request'
    );
    expect(p.message(p.toasts('failure')[0])).toBe('Error: Could not answer the request.');
    expect(p.details(p.toasts('failure')[0])).toContain('Error code: NOT_FOUND');
    expectNoSecret(p.everything());

    p.requestFailed(
      'Could not change the status.',
      jsonReply(409, {}),
      { ok: false, code: 'INVALID_TRANSITION', error: 'Cannot move an event from draft to active' },
      'Changing the event status'
    );
    expect(p.message(p.toasts('failure')[1])).toBe(
      'Error: Could not change the status. It moved since this page loaded. The panel shows where it is now.'
    );
  });

  test('no response at all: the toast says to check the connection', () => {
    const p = admin({});
    p.requestFailed(
      'Could not deactivate the poster deployment.',
      null,
      null,
      'Deactivating a poster deployment'
    );
    expect(p.message(p.toasts('failure')[0])).toBe(
      'Error: Could not deactivate the poster deployment. Check your connection and try again.'
    );
    expect(p.details(p.toasts('failure')[0])).toMatch(
      /^Error code: not available\nRequest reference: not available\n/
    );
  });

  test('without the toast script the status line still says it, as text', () => {
    const p = admin({ toast: false });
    p.announce('<b>Saved</b>', 'ok');
    expect(p.toasts()).toHaveLength(0);
    expect(p.status.hidden).toBe(false);
    expect(p.status.textContent).toBe('<b>Saved</b>');
    expect(p.status.querySelector('b')).toBeNull();
    expect(p.status.className).toBe('admin-status is-ok');
    p.requestFailed(
      'Could not create the sponsor link.',
      seededFailure(503, 'X'),
      null,
      'Creating a link'
    );
    expect(p.status.textContent).toBe('Could not create the sponsor link.');
    expect(p.status.className).toBe('admin-status is-error');
    expectNoSecret(p.everything());
  });
});

describe('admin: each action reports through the toast', () => {
  const SPONSORS = "getElementById('spon-create-form').addEventListener";
  const FORMS = 'window.mintReportLink = async function';
  const POSTERS = 'window.loadPosterDeployments = async function';

  /** Fail only the write under test; every list the card loads stays empty. */
  const failing =
    (method: string, match: string, reply: () => Response | Error): Answer =>
    (call) =>
      call.method === method && call.url.includes(match)
        ? reply()
        : jsonReply(200, { ok: true, items: [] });

  function expectFailure(
    p: ReturnType<typeof admin>,
    sentence: string,
    code: string,
    action: string
  ) {
    expect(p.toasts('failure'), 'one failure toast').toHaveLength(1);
    const toast = p.toasts('failure')[0];
    expect(p.message(toast)).toBe('Error: ' + sentence);
    expect(p.details(toast)).toMatch(
      new RegExp(
        `^Error code: ${code}\\nRequest reference: ${code === 'not available' ? 'not available' : REF}\\nTime: .+\\nAction: ${action}$`
      )
    );
    expect(p.status.hidden, 'the old line is not used').toBe(true);
    expectNoSecret(p.everything());
  }

  function sponsorRow(doc: Document) {
    const table = doc.createElement('table');
    table.innerHTML =
      '<tr data-testid="sponsor-row-sb1"><td data-testid="spon-name-sb1">Corner Bakery</td>' +
      '<td data-label="Actions"><button data-testid="deactivate-sb1">Deactivate</button>' +
      '<button data-action="sponsor-request-answer" data-approve="1">Approve</button></td></tr>';
    doc.body.appendChild(table);
    return table.querySelector<HTMLButtonElement>('[data-action="sponsor-request-answer"]')!;
  }

  test('sponsor page link: a failure is a toast with the code and reference', async () => {
    const p = admin({
      scripts: [SPONSORS],
      answer: failing('POST', '/home-link', () => seededFailure(503, 'SIGNING_NOT_CONFIGURED')),
    });
    await flush();
    sponsorRow(p.doc);
    await (p.w._mintSponsorHomeLink as (id: string) => Promise<void>)('sb1');
    expectFailure(
      p,
      'Could not create the sponsor link.',
      'SIGNING_NOT_CONFIGURED',
      'Creating a sponsor page link'
    );
  });

  test('sponsor page link: success is a success toast that names the sponsor', async () => {
    const p = admin({
      scripts: [SPONSORS],
      answer: failing('POST', '/home-link', () =>
        jsonReply(200, {
          ok: true,
          url: 'https://ose.test/sponsor?t=x',
          expiresAt: '2099-01-01T00:00:00Z',
        })
      ),
    });
    await flush();
    sponsorRow(p.doc);
    await (p.w._mintSponsorHomeLink as (id: string) => Promise<void>)('sb1');
    expect(p.message(p.toasts('success')[0])).toBe(
      'Success: Sponsor page link ready. Send it to Corner Bakery.'
    );
    // The link is a credential: it is in the row for the organizer, never in a toast.
    expect(p.toasts()[0].textContent).not.toContain('sponsor?t=');
  });

  test('sponsor request: answered elsewhere (409) is a note; a failure is a failure toast', async () => {
    const taken = admin({
      scripts: [SPONSORS],
      answer: failing('POST', '/respond', () =>
        jsonReply(409, { ok: false, code: 'ALREADY_ANSWERED' })
      ),
    });
    await flush();
    await (taken.w._answerSponsorRequest as (id: string, a: boolean, b: Element) => Promise<void>)(
      'spl_1',
      true,
      sponsorRow(taken.doc)
    );
    expect(taken.message(taken.toasts('neutral')[0])).toBe(
      'Note: Someone already answered this request. Showing the current state.'
    );
    expect(taken.toasts('failure')).toHaveLength(0);

    const p = admin({
      scripts: [SPONSORS],
      answer: failing('POST', '/respond', () => seededFailure(503, 'DB_NOT_CONFIGURED')),
    });
    await flush();
    const btn = sponsorRow(p.doc);
    await (p.w._answerSponsorRequest as (id: string, a: boolean, b: Element) => Promise<void>)(
      'spl_1',
      true,
      btn
    );
    expectFailure(
      p,
      'Could not answer the request.',
      'DB_NOT_CONFIGURED',
      'Answering a sponsor request'
    );
    expect(btn.disabled, 'the row can be answered again').toBe(false);
  });

  test('sponsor request: approve and decline are success toasts', async () => {
    const p = admin({
      scripts: [SPONSORS],
      answer: failing('POST', '/respond', () => jsonReply(200, { ok: true })),
    });
    await flush();
    const answer = p.w._answerSponsorRequest as (
      id: string,
      a: boolean,
      b: Element
    ) => Promise<void>;
    await answer('spl_1', true, sponsorRow(p.doc));
    await answer('spl_2', false, sponsorRow(p.doc));
    expect(p.toasts('success').map(p.message)).toEqual([
      'Success: Approved. The sponsor is now on this event.',
      'Success: Declined. The sponsor will see your answer on their page.',
    ]);
  });

  test('deactivate a sponsor: a failure is a toast; no connection never shows the browser text', async () => {
    const p = admin({
      scripts: [SPONSORS],
      answer: failing('DELETE', '/api/v2/admin/sponsors/sb1', () => seededFailure(500, 'INTERNAL')),
    });
    await flush();
    await (p.w._confirmDeactivate as (id: string) => Promise<void>)('sb1');
    expectFailure(p, 'Could not deactivate the sponsor.', 'INTERNAL', 'Deactivating a sponsor');

    const off = admin({
      scripts: [SPONSORS],
      answer: failing(
        'DELETE',
        '/api/v2/admin/sponsors/sb1',
        () => new TypeError('Failed to fetch')
      ),
    });
    await flush();
    await (off.w._confirmDeactivate as (id: string) => Promise<void>)('sb1');
    expectFailure(
      off,
      'Could not deactivate the sponsor. Check your connection and try again.',
      'not available',
      'Deactivating a sponsor'
    );
    expect(off.everything()).not.toContain('Failed to fetch');
  });

  test('a form switch: success names the form; a failure puts the switch back and says so', async () => {
    const switchFor = (doc: Document) => {
      const el = doc.createElement('input');
      el.type = 'checkbox';
      el.checked = true;
      el.dataset.flag = 'registration';
      el.dataset.event = 'evt_1';
      doc.body.appendChild(el);
      return el;
    };
    const ok = admin({
      scripts: [FORMS],
      answer: failing('PUT', '/flags/registration', () => jsonReply(200, { ok: true })),
    });
    await (ok.w.toggleFormFlag as (el: Element) => Promise<void>)(switchFor(ok.doc));
    expect(ok.message(ok.toasts('success')[0])).toBe('Success: Enabled registration.');

    const p = admin({
      scripts: [FORMS],
      answer: failing('PUT', '/flags/registration', () => seededFailure(500, 'FLAG_WRITE_FAILED')),
    });
    const el = switchFor(p.doc);
    await (p.w.toggleFormFlag as (el: Element) => Promise<void>)(el);
    expect(el.checked, 'the switch went back').toBe(false);
    expectFailure(
      p,
      'Could not update registration. It is back as it was.',
      'FLAG_WRITE_FAILED',
      'Turning a form on or off'
    );
  });

  test('delete a poster deployment: success and failure are toasts', async () => {
    const ok = admin({
      scripts: [POSTERS],
      answer: failing('DELETE', '/poster-deployments/pd_1', () => jsonReply(200, { ok: true })),
    });
    await (ok.w._confirmDeletePd as (id: string) => Promise<void>)('pd_1');
    expect(ok.message(ok.toasts('success')[0])).toBe('Success: Poster deployment deactivated.');

    const p = admin({
      scripts: [POSTERS],
      answer: failing('DELETE', '/poster-deployments/pd_1', () =>
        seededFailure(503, 'DB_NOT_CONFIGURED')
      ),
    });
    await (p.w._confirmDeletePd as (id: string) => Promise<void>)('pd_1');
    expectFailure(
      p,
      'Could not deactivate the poster deployment.',
      'DB_NOT_CONFIGURED',
      'Deactivating a poster deployment'
    );
  });

  test('a poster code that is not there: a failure toast that names the action', () => {
    const p = admin({ scripts: [POSTERS] });
    (p.w.downloadPosterQr as (id: string) => void)('pd_missing');
    expectFailure(
      p,
      'QR not available for download.',
      'not available',
      'Downloading a poster code'
    );
  });
});

describe('admin: a refused status change', () => {
  const EVENTS = 'window.changeEventStatus = async function';

  test("the toast carries this page's reason, the code and the reference of the refused step", async () => {
    const p = admin({
      scripts: [EVENTS],
      answer: (call) => {
        if (call.method === 'GET' && call.url === '/api/v2/admin/events') {
          return jsonReply(200, {
            ok: true,
            items: [{ id: 'evt_1', name: 'Bocce Night', status: 'draft', brand_id: 'root' }],
          });
        }
        if (call.method === 'PUT') {
          return jsonReply(409, {
            ok: false,
            code: 'CORE_VALUES_MISSING',
            missing: ['start_time'],
            error: 'Add a start time before this event can be published.',
            from: 'draft',
          });
        }
        return jsonReply(200, { ok: false });
      },
    });
    await flush();
    (p.w.renderEventStatus as (id: string) => void)('evt_1');
    await (p.w.changeEventStatus as (id: string, to: string) => Promise<void>)('evt_1', 'ready');
    await flush();
    const toast = p.toasts('failure')[0];
    expect(toast, 'a failure toast').toBeDefined();
    expect(p.message(toast)).toBe(
      'Error: Could not change the status. It needs a start time and an event type first.'
    );
    expect(p.details(toast)).toMatch(
      /^Error code: CORE_VALUES_MISSING\nRequest reference: req-7f3a9c21\nTime: .+\nAction: Changing the event status$/
    );
    // The reason also stays beside the buttons, where the missing field is marked.
    expect(p.doc.getElementById('event-status-msg')!.textContent).toBe(
      'Add a start time before this event can be published.'
    );
  });
});

// ── The rule, read from the source ──────────────────────────────────────────
describe('the pages never hand the toast a raw error or a response', () => {
  const pages: Record<string, string> = {
    'admin.html': ADMIN_HTML,
    'sponsor-home.html': SPONSOR_HOME,
  };

  for (const [name, html] of Object.entries(pages)) {
    test(`${name}: one place builds a failure, and its details come from detailsFrom`, () => {
      expect(html.match(/\.failure\(/g), 'one failure call').toHaveLength(1);
      expect(html.match(/\.detailsFrom\(/g), 'one detailsFrom call').toHaveLength(1);
      expect(html).not.toMatch(/ocrToast\.(?:success|neutral|failure)\(/);
    });
  }

  test('admin.html: the announce script reads no error text from a response or an exception', () => {
    const doc = new JSDOM(ADMIN_HTML).window.document;
    const script = Array.from(doc.querySelectorAll('script'))
      .map((el) => el.textContent || '')
      .find((text) => text.includes(ANNOUNCE))!;
    expect(script).toContain('window._adminRequestFailed = function');
    expect(script).not.toMatch(/\.(?:error|message|stack)\b/);
  });

  test('admin.html: no announce call passes a caught error or a response field', () => {
    const calls = ADMIN_HTML.match(/_admin(?:Announce|RequestFailed)\([^\n]*/g) ?? [];
    expect(calls.length).toBeGreaterThan(15);
    for (const call of calls) {
      expect(call, call).not.toMatch(/\b(?:err|error|e)\.message\b/);
      expect(call, call).not.toMatch(/\bdata\.(?:error|code)\b/);
    }
  });

  test('sponsor-home.html: no message is built from a caught error or a response field', () => {
    const script = SPONSOR_HOME.slice(SPONSOR_HOME.lastIndexOf('<script'));
    expect(script).toContain('function failed(card, sentence, res, body, action)');
    expect(script).not.toMatch(/\.(?:error|message|stack)\b/);
    expect(script).not.toMatch(/data\.code\b/);
    expect(script).not.toMatch(/server said/);
  });
});
