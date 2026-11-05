/**
 * OSE-1531 — the organizer's SharedReport ends with next actions, one of them
 * "Repeat this event".
 *
 * Runs the real /sharedReport page (shared-report.html Text import) in jsdom with
 * a stubbed fetch, so what is checked is what a browser does:
 *
 *   - the action row shows ONLY for a signed-in organizer looking at one event
 *     (?event=<id> and the admin probe answers); a visitor, a signed-link viewer
 *     (a sponsor's token, a bar owner) never sees it and never causes an admin
 *     request: no clone action for someone without admin rights;
 *   - "Repeat this event" makes exactly one POST, whatever the clicking, and on
 *     success selects the new draft for the admin and links there; every failure
 *     says what happened in plain words and leaves the selection alone;
 *   - the words stay inside the product lexicon.
 *
 * @born-red OSE-1531 | method: written against the pre-change page — no action
 * section existed, so every query for it came back null | date: 2026-10-04
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import REPORT_HTML from '../src/templates/shared-report.html';
import ADMIN_HTML from '../src/templates/admin.html';

const SELECTED_KEY = 'ose_selected_event_id';

interface Call {
  url: string;
  method: string;
}
interface Opts {
  /** Does GET /api/v2/admin/flags/current-tier answer as a signed-in admin? */
  admin?: boolean;
  repeat?: { status: number; body?: unknown } | 'network-error' | 'access-redirect';
  /** Remove AbortSignal.timeout before the page loads (an older browser). */
  noAbortSignalTimeout?: boolean;
}

async function open(search: string, opts: Opts = {}) {
  const calls: Call[] = [];
  const dom = new JSDOM(REPORT_HTML, {
    url: `https://ose.test/sharedReport${search}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      if (opts.noAbortSignalTimeout) {
        (w.AbortSignal as unknown as { timeout?: unknown }).timeout = undefined;
      }
      (w as unknown as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
        const method = (init?.method ?? 'GET').toUpperCase();
        calls.push({ url, method });
        const json = (status: number, body: unknown) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
          });
        if (url.includes('/flags/current-tier')) {
          return opts.admin ? json(200, { ok: true, tier: 'free' }) : json(401, { ok: false });
        }
        if (url.endsWith('/repeat')) {
          if (opts.repeat === 'network-error') throw new TypeError('network down');
          if (opts.repeat === 'access-redirect') {
            // What fetch(..., { redirect: 'manual' }) gives for a 302 to the Access login.
            return {
              type: 'opaqueredirect',
              status: 0,
              ok: false,
              json: async () => {
                throw new SyntaxError('opaque');
              },
            } as unknown as Response;
          }
          const r = opts.repeat ?? { status: 201, body: { ok: true, id: 'evt_new' } };
          return json(r.status, r.body ?? { ok: false });
        }
        if (url.includes('/shared-report')) {
          return json(200, {
            ok: true,
            report: { event_title: 'Bocce', event_start_date: '2026-09-26' },
          });
        }
        return json(200, { ok: true, items: [] });
      };
    },
  });
  const w = dom.window;
  const doc = w.document;
  const $ = (testid: string) => doc.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
  // Let the page's async scripts (probe, list loads) run to rest.
  const settle = async (ms = 40) => {
    for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, ms));
  };
  await settle();
  return { w, doc, $, calls, settle };
}

const adminCalls = (calls: Call[]) => calls.filter((c) => c.url.startsWith('/api/v2/admin/'));

describe('who sees the action row', () => {
  test('a signed-in organizer looking at one event sees it, last on the page', async () => {
    const { $, doc } = await open('?event=evt_1', { admin: true });
    const row = $('report-actions')!;
    expect(row).not.toBeNull();
    expect(row.hidden).toBe(false);
    const sections = [...doc.querySelectorAll('main > section')];
    expect(sections[sections.length - 1]).toBe(row);
    expect($('report-action-repeat')!.tagName).toBe('BUTTON');
    for (const id of ['report-action-create-next', 'report-action-share', 'report-action-invite']) {
      expect($(id)!.getAttribute('href')).toBe('/admin');
    }
  });

  test('no event named in the address: nothing to repeat, row stays hidden', async () => {
    const { $ } = await open('', { admin: true });
    expect($('report-actions')!.hidden).toBe(true);
  });

  test('an organizer who is not signed in sees no row (the probe is refused)', async () => {
    const { $ } = await open('?event=evt_1', { admin: false });
    expect($('report-actions')!.hidden).toBe(true);
  });

  test('a signed-link viewer never sees it, and the page asks for nothing admin-only', async () => {
    const { $, calls } = await open('?eventId=evt_1&token=sig', { admin: true });
    expect($('report-actions')!.hidden).toBe(true);
    expect(adminCalls(calls)).toEqual([]);
    expect(calls.some((c) => c.url.endsWith('/repeat'))).toBe(false);
  });
});

describe('Repeat this event', () => {
  test('one POST to the repeat route, however often it is clicked', async () => {
    const { $, calls, settle } = await open('?event=evt_1', { admin: true });
    const btn = $('report-action-repeat') as HTMLButtonElement;
    btn.click();
    btn.click();
    btn.click();
    await settle();
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toEqual([{ url: '/api/v2/admin/events/evt_1/repeat', method: 'POST' }]);
  });

  test('success: the new draft is selected for the admin, and the page links there', async () => {
    const { $, w, settle } = await open('?event=evt_1', {
      admin: true,
      repeat: {
        status: 201,
        body: { ok: true, id: 'evt_new', title: 'Bocce Night', start_date: '2026-10-10' },
      },
    });
    ($('report-action-repeat') as HTMLButtonElement).click();
    await settle();
    expect(w.sessionStorage.getItem(SELECTED_KEY)).toBe('evt_new');
    const status = $('report-action-status')!.textContent!;
    expect(status).toContain('Bocce Night');
    expect(status).toContain('Oct 10, 2026');
    expect(status.toLowerCase()).toContain('draft');
    expect($('report-action-open-draft')!.getAttribute('href')).toBe('/admin');
    expect(($('report-action-repeat') as HTMLButtonElement).disabled).toBe(true);
  });

  test('a title from the server is shown as text, never as markup', async () => {
    const { $, doc, settle } = await open('?event=evt_1', {
      admin: true,
      repeat: {
        status: 201,
        body: { ok: true, id: 'evt_new', title: '<img src=x onerror=alert(1)>', start_date: null },
      },
    });
    ($('report-action-repeat') as HTMLButtonElement).click();
    await settle();
    expect(doc.querySelector('[data-testid="report-actions"] img')).toBeNull();
    expect($('report-action-status')!.textContent).toContain('<img src=x');
  });

  test.each([
    [
      400,
      'Some details of this event could not be copied. Nothing was made. Create the next one from the admin instead.',
    ],
    [401, 'Sign in to the admin to repeat this event.'],
    [403, 'Sign in to the admin to repeat this event.'],
    [404, 'We could not find that event.'],
    [429, 'That was a lot of copies at once. Try again in a minute.'],
    [503, 'Nothing was copied. Try again in a moment.'],
  ])('a %i answer is explained in plain words and changes nothing', async (status, words) => {
    const { $, w, settle } = await open('?event=evt_1', {
      admin: true,
      repeat: { status, body: { ok: false, code: 'RATE_LIMITED', error: 'raw server text' } },
    });
    ($('report-action-repeat') as HTMLButtonElement).click();
    await settle();
    const text = $('report-action-status')!.textContent!;
    expect(text).toBe(words);
    expect(text).not.toMatch(/RATE_LIMITED|raw server text/);
    expect(w.sessionStorage.getItem(SELECTED_KEY)).toBeNull();
    expect(($('report-action-repeat') as HTMLButtonElement).disabled).toBe(false);
    expect($('report-action-open-draft')).toBeNull();
  });

  test('an expired Access session (the request is redirected to the login) asks to sign in', async () => {
    const { $, w, settle } = await open('?event=evt_1', { admin: true, repeat: 'access-redirect' });
    ($('report-action-repeat') as HTMLButtonElement).click();
    await settle();
    expect($('report-action-status')!.textContent).toBe(
      'Sign in to the admin to repeat this event.'
    );
    expect(w.sessionStorage.getItem(SELECTED_KEY)).toBeNull();
    expect(($('report-action-repeat') as HTMLButtonElement).disabled).toBe(false);
  });

  test('no connection: says so, changes nothing, can be tried again', async () => {
    const { $, w, settle } = await open('?event=evt_1', { admin: true, repeat: 'network-error' });
    ($('report-action-repeat') as HTMLButtonElement).click();
    await settle();
    expect($('report-action-status')!.textContent).toBe(
      'Could not reach the service. Nothing was copied. Check your connection and try again.'
    );
    expect(w.sessionStorage.getItem(SELECTED_KEY)).toBeNull();
    expect(($('report-action-repeat') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('the admin probes cannot hold the page open', () => {
  test('without AbortSignal.timeout, the probe signal still aborts on its own', async () => {
    const { w } = await open('?event=evt_1', { admin: true, noAbortSignalTimeout: true });
    const probe = (w as unknown as { probeTimeout: (ms?: number) => AbortSignal | undefined })
      .probeTimeout;
    const signal = probe(20);
    expect(signal).toBeDefined();
    expect(signal!.aborted).toBe(false);
    await new Promise((r) => setTimeout(r, 80));
    expect(signal!.aborted).toBe(true);
  });
});

describe('the other actions', () => {
  test('Share the report and Invite a partner open this event in the admin', async () => {
    for (const id of ['report-action-share', 'report-action-invite']) {
      const { $, w } = await open('?event=evt_1', { admin: true });
      w.sessionStorage.setItem(SELECTED_KEY, 'something-else');
      $(id)!.addEventListener('click', (e) => e.preventDefault()); // do not navigate in jsdom
      $(id)!.click();
      expect(w.sessionStorage.getItem(SELECTED_KEY), id).toBe('evt_1');
    }
  });

  test('Create the next one opens the admin front door, with no event selected', async () => {
    const { $, w } = await open('?event=evt_1', { admin: true });
    w.sessionStorage.setItem(SELECTED_KEY, 'evt_1');
    $('report-action-create-next')!.addEventListener('click', (e) => e.preventDefault());
    $('report-action-create-next')!.click();
    expect(w.sessionStorage.getItem(SELECTED_KEY)).toBeNull();
  });
});

describe('words, structure and the key the admin reads', () => {
  test('the visible words stay inside the lexicon (no reach, impressions, unique, attendance, turnout, people)', async () => {
    const { $ } = await open('?event=evt_1', { admin: true });
    const text = $('report-actions')!.textContent!;
    expect(text.length).toBeGreaterThan(40);
    expect(text).not.toMatch(/\b(reach|impressions?|unique|attendance|turnout|people)\b/i);
  });

  test('the selection key is the one the admin reads and writes', () => {
    expect(ADMIN_HTML).toContain(`window.SELECTED_EVENT_KEY = '${SELECTED_KEY}'`);
    expect(REPORT_HTML).toContain(`'${SELECTED_KEY}'`);
  });

  test('still exactly one h1; the row has a heading and a polite status', async () => {
    const { $, doc } = await open('?event=evt_1', { admin: true });
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
    const row = $('report-actions')!;
    expect(row.getAttribute('aria-labelledby')).toBeTruthy();
    expect(doc.getElementById(row.getAttribute('aria-labelledby')!)!.tagName).toBe('H2');
    expect($('report-action-status')!.getAttribute('role')).toBe('status');
  });

  test('no raw hex and no new inline style in the row markup', () => {
    const start = REPORT_HTML.indexOf('data-testid="report-actions"');
    const end = REPORT_HTML.indexOf('</section>', start);
    expect(start).toBeGreaterThan(0);
    const markup = REPORT_HTML.slice(start, end);
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}\b|style=/);
  });
});
