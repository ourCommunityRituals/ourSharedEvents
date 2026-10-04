/**
 * OSE-1560 — the admin shows the map setting, and a first-timer does not choose it by accident.
 *
 * PO decision 2026-10-03: a new event is OFF the map; the organizer is told so in
 * plain words, and the fact stays visible afterwards (the toast that announces it
 * is OSE-1564, hub @ocr/ui). Until that component exists the words are plain
 * persistent text: in the wizard summary, in the create message, and in the
 * event status panel, which also carries the control to change it.
 *
 *   1. The wizard no longer pre-selects "Yes, put it on the map". "No" is the
 *      selected card, and the create request carries `is_published` only when
 *      the organizer clicked a card. An omitted value is what lets a sponsor the
 *      organizer adds later turn the map on (server: lib/map-default.ts).
 *   2. The advanced form's checkbox starts unchecked and is sent only once touched.
 *   3. The status panel states the map setting and offers one control for it.
 *   4. Adding or approving a sponsor, when the server says it turned the map on,
 *      updates what the panel shows, with no reload.
 *
 * Runs the page's real scripts from the admin.html Text import (jsdom for the
 * wizard; the pure helpers extracted from the dashboard script).
 *
 * @born-red OSE-1560 | method: ran against the pre-change template - "Yes" was
 * pre-selected and always sent, the checkbox was checked and always sent, and
 * the status panel had no map line or control | date: 2026-10-04
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import ADMIN_HTML_RAW from '../src/templates/admin.html';

// The checkout may be CRLF (Windows); CI is LF. The slices below look for LF.
const ADMIN_HTML = ADMIN_HTML_RAW.replace(/\r\n/g, '\n');

function wizardScript(doc: Document): string {
  const el = Array.from(doc.querySelectorAll('script')).find((s) =>
    (s.textContent || '').includes('function goNext()')
  );
  expect(el, 'the wizard script').toBeDefined();
  return el!.textContent || '';
}

function mount(createResponse: Record<string, unknown> = {}) {
  const dom = new JSDOM(ADMIN_HTML, {
    runScripts: 'outside-only',
    url: 'https://admin.test/admin',
  });
  const w = dom.window as unknown as Window & { eval(s: string): unknown };
  const doc = w.document;
  (w as unknown as { Element: typeof Element }).Element.prototype.scrollIntoView = () => {};
  const posts: Array<Record<string, unknown>> = [];
  w.fetch = (async (url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET').toUpperCase() === 'POST' && String(url).endsWith('/admin/events')) {
      posts.push(JSON.parse(String(init!.body)));
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ ok: true, id: 'evt_new', ...createResponse }),
        json: async () => ({ ok: true, id: 'evt_new', ...createResponse }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }) as unknown as typeof fetch;
  w.eval(wizardScript(doc));
  const $ = <T extends HTMLElement>(id: string) => doc.querySelector<T>(`[data-testid="${id}"]`)!;
  $('admin-path-wizard').click();
  const type = (id: string, value: string) => {
    const el = $<HTMLInputElement>(id);
    el.value = value;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  const flush = async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  };
  /** Fill step 1, go through 2 and 3; step 3's Next creates the draft. */
  const create = async () => {
    type('wizard-event-name', 'Bocce Night');
    type('wizard-event-venue', 'Eagles Hall');
    const d = new Date(Date.now() + 14 * 86_400_000);
    type(
      'wizard-event-date',
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    );
    for (let i = 0; i < 3; i++) $('wizard-next-btn').click();
    await flush();
  };
  return { w, doc, $, create, posts };
}

describe('the wizard does not pre-select a public listing', () => {
  test('"No" is the selected card; "Yes" is not', () => {
    const { $ } = mount();
    expect($('wizard-publish-no').getAttribute('aria-pressed')).toBe('true');
    expect($('wizard-publish-no').classList.contains('selected')).toBe(true);
    expect($('wizard-publish-yes').getAttribute('aria-pressed')).toBe('false');
    expect($('wizard-publish-yes').classList.contains('selected')).toBe(false);
  });

  test('no card clicked: the create request does not carry is_published', async () => {
    const { create, posts } = mount();
    await create();
    expect(posts).toHaveLength(1);
    expect('is_published' in posts[0]!).toBe(false);
  });

  test('"Yes" clicked: is_published is true', async () => {
    const { $, create, posts } = mount();
    $('wizard-publish-yes').click();
    expect($('wizard-publish-yes').getAttribute('aria-pressed')).toBe('true');
    await create();
    expect(posts[0]!.is_published).toBe(true);
  });

  test('"Yes" then "No": the organizer chose, so is_published is false (not omitted)', async () => {
    const { $, create, posts } = mount();
    $('wizard-publish-yes').click();
    $('wizard-publish-no').click();
    await create();
    expect(posts[0]!.is_published).toBe(false);
  });

  test("the server's heads-up is shown, in a polite region, after the draft is saved", async () => {
    const note = "This event isn't on the map. You can turn that on any time.";
    const { $, create } = mount({ map: { on: false, by_default: true, note } });
    await create();
    const el = $('wizard-map-note');
    expect(el.textContent).toBe(note);
    expect(el.getAttribute('aria-live')).toBe('polite');
    expect(el.hidden).toBe(false);
  });

  test('no note from the server (the organizer chose): nothing is said', async () => {
    const { $, create } = mount({ map: { on: false, by_default: false, note: null } });
    await create();
    expect($('wizard-map-note').hidden).toBe(true);
  });
});

describe('the advanced form does not pre-check a public listing', () => {
  test('the checkbox starts unchecked', () => {
    const m = /<input[^>]*id="create-published"[^>]*>/.exec(ADMIN_HTML);
    expect(m, 'the checkbox').not.toBeNull();
    expect(m![0]).not.toMatch(/\schecked\b/);
  });

  test('it is sent only once the operator touched it', () => {
    expect(ADMIN_HTML).toMatch(
      /if \(publishedEl && publishedEl\.dataset\.chosen === '1'\) body\.is_published = publishedEl\.checked;/
    );
    expect(ADMIN_HTML).toMatch(
      /publishedEl\.addEventListener\('change', function \(\) \{ publishedEl\.dataset\.chosen = '1'; \}\)/
    );
  });

  test("the create message carries the server's heads-up", () => {
    expect(ADMIN_HTML).toMatch(
      /msg\.textContent = 'Event created\.' \+ \(data\.map && data\.map\.note/
    );
  });
});

// ─── The status panel ────────────────────────────────────────────────────────

type MapView = { on: boolean; text: string; actionLabel: string; wantOn: boolean };

function extractHelper(): (e: Record<string, unknown>) => MapView {
  const start = ADMIN_HTML.indexOf('window.mapSettingView = function (e) {');
  expect(start, 'admin.html must define window.mapSettingView').toBeGreaterThan(-1);
  const end = ADMIN_HTML.indexOf('\n      };\n', start) + '\n      };'.length;
  const src = ADMIN_HTML.slice(start, end);
  const win: Record<string, unknown> = {};
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('window', src)(win);
  return win.mapSettingView as (e: Record<string, unknown>) => MapView;
}

describe('the status panel states the map setting and offers one control', () => {
  test('off at the default: says so, and how to change it', () => {
    const v = extractHelper()({ is_published: 0, map_default: 1 });
    expect(v.on).toBe(false);
    expect(v.text).toBe("This event isn't on the map. You can turn that on any time.");
    expect(v.actionLabel).toBe('Put on the map');
    expect(v.wantOn).toBe(true);
  });

  test('off by choice: says it is their choice', () => {
    const v = extractHelper()({ is_published: 0, map_default: 0 });
    expect(v.on).toBe(false);
    expect(v.text).toContain('as you chose');
    expect(v.wantOn).toBe(true);
  });

  test('on: says so, and offers to turn it off', () => {
    const v = extractHelper()({ is_published: 1, map_default: 0 });
    expect(v.on).toBe(true);
    expect(v.text).toMatch(/^This event is on the map/);
    expect(v.actionLabel).toBe('Turn off the map');
    expect(v.wantOn).toBe(false);
  });

  test('a missing value (an older row) reads as on, never as a surprise off', () => {
    const v = extractHelper()({});
    expect(v.on).toBe(true);
  });

  test('the panel has the line and the control, inside the status card', () => {
    const card = ADMIN_HTML.slice(
      ADMIN_HTML.indexOf('id="event-status-card"'),
      ADMIN_HTML.indexOf('<!-- Event timeline')
    );
    expect(card).toContain('data-testid="event-map-state"');
    expect(card).toContain('data-testid="event-map-toggle"');
    expect(card).toContain('data-action="event-map"');
    expect(ADMIN_HTML).toContain("'event-map': function (el)");
  });

  test('renderEventStatus fills the line and the control from the row', () => {
    const from = ADMIN_HTML.indexOf('window.renderEventStatus = function (id) {');
    const body = ADMIN_HTML.slice(from, ADMIN_HTML.indexOf('window.changeEventMap', from));
    expect(body).toContain('window.mapSettingView(e)');
    expect(body).toContain("getElementById('event-map-state')");
    expect(body).toContain("getElementById('event-map-toggle')");
  });
});

describe('changing the map setting from the panel', () => {
  function run(opts: { ok: boolean; data?: Record<string, unknown>; status?: number }) {
    const start = ADMIN_HTML.indexOf('window.changeEventMap = async function (id, wantOn, btn) {');
    expect(start, 'admin.html must define window.changeEventMap').toBeGreaterThan(-1);
    const end = ADMIN_HTML.indexOf('\n      };\n', start) + '\n      };'.length;
    const src = ADMIN_HTML.slice(start, end);
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const row: Record<string, unknown> = { id: 'evt_1', is_published: 0, map_default: 1 };
    const rendered: string[] = [];
    const msgEl = { textContent: '', className: '' };
    const win: Record<string, unknown> = {
      _oseList: { byId: { evt_1: row } },
      renderEventStatus: (id: string) => rendered.push('status:' + id),
      renderEventTimeline: (id: string) => rendered.push('timeline:' + id),
      _adminAnnounce: (t: string) => rendered.push('announce:' + t),
    };
    const doc = { getElementById: (id: string) => (id === 'event-status-msg' ? msgEl : null) };
    const fetchStub = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: opts.ok,
        status: opts.status ?? (opts.ok ? 200 : 400),
        json: async () => opts.data ?? { ok: opts.ok },
      };
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('window', 'document', 'fetch', src)(win, doc, fetchStub);
    return {
      change: win.changeEventMap as (id: string, on: boolean, b?: unknown) => Promise<void>,
      calls,
      row,
      rendered,
      msgEl,
    };
  }

  test('turning it on PUTs is_published true, and the row stops being "default"', async () => {
    const t = run({ ok: true, data: { ok: true } });
    await t.change('evt_1', true);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.url).toBe('/api/v2/admin/events/evt_1');
    expect(t.calls[0]!.init.method).toBe('PUT');
    expect(JSON.parse(String(t.calls[0]!.init.body))).toEqual({ is_published: true });
    expect(t.row.is_published).toBe(1);
    expect(t.row.map_default).toBe(0);
    expect(t.rendered).toContain('status:evt_1');
    expect(t.rendered).toContain('timeline:evt_1');
  });

  test('turning it off PUTs is_published false', async () => {
    const t = run({ ok: true, data: { ok: true } });
    t.row.is_published = 1;
    await t.change('evt_1', false);
    expect(JSON.parse(String(t.calls[0]!.init.body))).toEqual({ is_published: false });
    expect(t.row.is_published).toBe(0);
  });

  test('a failed save leaves the row as it was, and says so', async () => {
    const t = run({ ok: false, status: 503, data: { ok: false, error: 'Failed to update event' } });
    await t.change('evt_1', true);
    expect(t.row.is_published).toBe(0);
    expect(t.row.map_default).toBe(1);
    expect(t.msgEl.textContent).toContain('Failed to update event');
    expect(t.msgEl.className).toContain('error');
  });

  test('a sponsor flip reported by the server updates the row with no reload', () => {
    const start = ADMIN_HTML.indexOf('window.oseMapFlipped = function (eventId) {');
    expect(start, 'admin.html must define window.oseMapFlipped').toBeGreaterThan(-1);
    const end = ADMIN_HTML.indexOf('\n      };\n', start) + '\n      };'.length;
    const row: Record<string, unknown> = { id: 'evt_1', is_published: 0, map_default: 1 };
    const rendered: string[] = [];
    const win: Record<string, unknown> = {
      _oseList: { byId: { evt_1: row } },
      renderEventStatus: (id: string) => rendered.push('status:' + id),
      renderEventTimeline: (id: string) => rendered.push('timeline:' + id),
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('window', ADMIN_HTML.slice(start, end))(win);
    (win.oseMapFlipped as (id: string) => void)('evt_1');
    expect(row.is_published).toBe(1);
    expect(row.map_default).toBe(0);
    expect(rendered).toEqual(['status:evt_1', 'timeline:evt_1']);
  });

  test('both sponsor paths pass the server note on to the page', () => {
    // The add/attach form and the approve button each read `map` from the response.
    expect(ADMIN_HTML).toMatch(/data\.map && data\.map\.changed[\s\S]{0,300}window\.oseMapFlipped/);
    expect(ADMIN_HTML).toMatch(
      /_answerSponsorRequest[\s\S]{0,3500}data\.map && data\.map\.changed[\s\S]{0,400}window\.oseMapFlipped/
    );
  });
});
