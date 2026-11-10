/**
 * OSE-1900: the admin's sponsors switch ("Sponsors (you choose)").
 *
 * Sponsors show only if the event chose them. The switch is `useSponsors` in
 * events.settings_json and absent means OFF (lib/event-settings.ts); the gate
 * every sponsor reader goes through is in lib/sponsor-card.ts and is covered by
 * tests/sponsor-opt-in-gate.spec.ts. This spec covers the control an organizer
 * uses to say yes or no:
 *
 *   1. The sponsors card states the setting in words and offers one control
 *      that names its outcome, 48 px tall with 16 px text, with one line on what
 *      turning it on means. It sits outside the folded list, so it is in view
 *      without opening anything.
 *   2. It reads `use_sponsors` from the admin events list row. A row with no
 *      value reads as OFF (the opposite of the map setting, which reads as on).
 *   3. It writes PUT /api/v2/admin/events/:id with
 *      {"settings":{"useSponsors":true|false}} and nothing else, then shows
 *      what the server stored.
 *   4. A failed save leaves the row as it was and says so.
 *
 * Runs the page's real script text from the admin.html Text import, the same
 * way tests/admin-map-setting.spec.ts does for the map control it mirrors.
 *
 * @born-red OSE-1900 | method: ran against the template before the control was
 * added (no helper, no markup, no click action): every test below failed |
 * date: 2026-11-09
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import ADMIN_HTML_RAW from '../src/templates/admin.html';

// The checkout may be CRLF (Windows); CI is LF. The slices below look for LF.
const ADMIN_HTML = ADMIN_HTML_RAW.replace(/\r\n/g, '\n');

type SwitchView = { on: boolean; text: string; actionLabel: string; wantOn: boolean };

/** One `window.<name> = ...;` definition from the dashboard script, as source. */
function sourceOf(opener: string): string {
  const start = ADMIN_HTML.indexOf(opener);
  expect(start, `admin.html must define ${opener}`).toBeGreaterThan(-1);
  const end = ADMIN_HTML.indexOf('\n      };\n', start) + '\n      };'.length;
  return ADMIN_HTML.slice(start, end);
}

const VIEW_SRC = () => sourceOf('window.sponsorsSwitchView = function (e) {');
const RENDER_SRC = () => sourceOf('window.renderSponsorsSwitch = function (id) {');
const CHANGE_SRC = () =>
  sourceOf('window.changeEventSponsors = async function (id, wantOn, btn) {');

function viewHelper(): (e: Record<string, unknown>) => SwitchView {
  const win: Record<string, unknown> = {};
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('window', VIEW_SRC())(win);
  return win.sponsorsSwitchView as (e: Record<string, unknown>) => SwitchView;
}

/** The sponsors card from its opening tag to the folded body (the part in view). */
function cardHead(): string {
  const from = ADMIN_HTML.indexOf('id="sponsors-card"');
  const to = ADMIN_HTML.indexOf('id="spon-card-body"', from);
  expect(from, 'the sponsors card').toBeGreaterThan(-1);
  expect(to, 'the folded body').toBeGreaterThan(from);
  return ADMIN_HTML.slice(ADMIN_HTML.lastIndexOf('<div', from), ADMIN_HTML.lastIndexOf('<div', to));
}

/** The CSS rule body for one selector, from the page's own stylesheet. */
function cssRule(selector: string): string {
  const re = new RegExp(`\\n\\s*${selector.replace(/[.\\-]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const m = re.exec(ADMIN_HTML);
  expect(m, `a CSS rule for ${selector}`).not.toBeNull();
  return m![1]!;
}

describe('the switch in words, from an admin list row', () => {
  test('on: says so, and offers to turn it off', () => {
    const v = viewHelper()({ use_sponsors: 1 });
    expect(v.on).toBe(true);
    expect(v.text).toBe('Sponsors are on for this event.');
    expect(v.actionLabel).toBe('Turn off sponsors');
    expect(v.wantOn).toBe(false);
  });

  test('off: says so, says what off means, and offers to turn it on', () => {
    const v = viewHelper()({ use_sponsors: 0 });
    expect(v.on).toBe(false);
    expect(v.text).toBe(
      'Sponsors are off for this event. No sponsor shows with it, and none can ask to join.'
    );
    expect(v.actionLabel).toBe('Turn on sponsors');
    expect(v.wantOn).toBe(true);
  });

  // The opposite of the map setting: sponsors are opt-in, so nothing reads as on
  // unless the list row says 1.
  test.each([
    ['a missing value (an older list response)', {}],
    ['null', { use_sponsors: null }],
    ['the string "true"', { use_sponsors: 'true' }],
    ['the boolean true', { use_sponsors: true }],
    ['2', { use_sponsors: 2 }],
    ['an empty string', { use_sponsors: '' }],
  ])('%s reads as off, never as a surprise on', (_name, row) => {
    const v = viewHelper()(row as Record<string, unknown>);
    expect(v.on).toBe(false);
    expect(v.wantOn).toBe(true);
    expect(v.actionLabel).toBe('Turn on sponsors');
  });

  test('"1" as text (a D1 driver that returns strings) still reads as on', () => {
    expect(viewHelper()({ use_sponsors: '1' }).on).toBe(true);
  });
});

describe('the control is in the sponsors card, in view without opening the list', () => {
  test('the card carries the label, the state line, the control, the one line and a status region', () => {
    const head = cardHead();
    expect(head).toContain('data-testid="sponsors-switch"');
    expect(head).toMatch(/<h3[^>]*id="spon-switch-label"[^>]*>Sponsors \(you choose\)<\/h3>/);
    expect(head).toContain('data-testid="sponsors-switch-state"');
    expect(head).toContain('data-testid="sponsors-switch-toggle"');
    expect(head).toContain('data-action="event-sponsors"');
    expect(head).toContain('data-testid="sponsors-switch-hint"');
    expect(head).toMatch(
      /id="spon-switch-msg"[^>]*role="status"[^>]*aria-live="polite"|id="spon-switch-msg"[^>]*aria-live="polite"[^>]*role="status"/
    );
  });

  test('the control is a real button, named by the group label and described by the one line', () => {
    const dom = new JSDOM(`<body>${cardHead()}</div></body>`);
    const doc = dom.window.document;
    const group = doc.querySelector('[data-testid="sponsors-switch"]')!;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-labelledby')).toBe('spon-switch-label');
    const btn = doc.querySelector('[data-testid="sponsors-switch-toggle"]')!;
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.getAttribute('aria-describedby')).toBe('spon-switch-hint');
    expect(doc.getElementById('spon-switch-hint')).not.toBeNull();
    // Hidden until an event is selected: there is nothing to switch before that.
    expect((group as HTMLElement).hidden).toBe(true);
  });

  test('one line says what turning it on means: both sides still have to say yes', () => {
    const dom = new JSDOM(`<body>${cardHead()}</div></body>`);
    const hint = dom.window.document.getElementById('spon-switch-hint')!.textContent!.trim();
    expect(hint).toBe(
      'Turning sponsors on lets a sponsor show with this event once you and the sponsor have both said yes.'
    );
    expect(hint.split(/[.!?]\s/).length).toBe(1);
  });

  test('the click table routes the action to changeEventSponsors with the id and the wanted state', () => {
    const at = ADMIN_HTML.indexOf("'event-sponsors': function (el)");
    expect(at, 'the click action').toBeGreaterThan(-1);
    const body = ADMIN_HTML.slice(at, at + 260);
    expect(body).toContain('window.changeEventSponsors(');
    expect(body).toContain("argOf(el, 'event-id')");
    expect(body).toContain("el.getAttribute('data-want-on') === '1'");
  });

  test('48 px tall, 16 px text, a strong line, and colours from tokens only', () => {
    const btn = cssRule('.spon-switch-btn');
    expect(btn).toMatch(/min-height:\s*48px/);
    expect(btn).toMatch(/font-size:\s*16px/);
    expect(btn).toMatch(/border:\s*1px solid var\(--border-strong\)/);
    for (const sel of [
      '.spon-switch',
      '.spon-switch-label',
      '.spon-switch-state',
      '.spon-switch-hint',
      '.spon-switch-btn',
    ]) {
      const rule = cssRule(sel);
      expect(rule, `${sel} has no raw hex`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(rule, `${sel} has no rgb()/hsl()`).not.toMatch(/\b(rgb|hsl)a?\(/);
      // Nothing below the 13 px floor: these all set 16px or inherit.
      for (const m of rule.matchAll(/font-size:\s*([\d.]+)(px|rem)/g)) {
        const px = m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1]);
        expect(px, `${sel} font-size`).toBeGreaterThanOrEqual(16);
      }
    }
  });

  test('copy rules: sentence case, no em dash, the button names its outcome', () => {
    const texts = [
      VIEW_SRC(),
      CHANGE_SRC(),
      cardHead().slice(cardHead().indexOf('data-testid="sponsors-switch"')),
    ];
    for (const t of texts) expect(t).not.toMatch(/—|&mdash;|&#8212;/);
    const v = viewHelper();
    for (const label of [v({ use_sponsors: 1 }).actionLabel, v({ use_sponsors: 0 }).actionLabel]) {
      expect(label).toMatch(/^Turn (on|off) sponsors$/);
    }
  });
});

describe('the card shows what the row says', () => {
  function mountCard(row: Record<string, unknown> | null) {
    const dom = new JSDOM(`<body>${cardHead()}</div></body>`);
    const doc = dom.window.document;
    const win: Record<string, unknown> = {
      _oseList: { byId: row ? { [String(row.id)]: row } : {} },
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('window', 'document', VIEW_SRC() + '\n' + RENDER_SRC())(win, doc);
    const $ = (id: string) => doc.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
    return { render: win.renderSponsorsSwitch as (id: string) => void, $, doc };
  }

  test('off: the state line and a control that turns it on', () => {
    const { render, $ } = mountCard({ id: 'evt_1', use_sponsors: 0 });
    render('evt_1');
    expect($('sponsors-switch').hidden).toBe(false);
    expect($('sponsors-switch-state').textContent).toMatch(/^Sponsors are off for this event\./);
    const btn = $('sponsors-switch-toggle') as HTMLButtonElement;
    expect(btn.textContent).toBe('Turn on sponsors');
    expect(btn.getAttribute('data-event-id')).toBe('evt_1');
    expect(btn.getAttribute('data-want-on')).toBe('1');
    expect(btn.disabled).toBe(false);
  });

  test('on: the state line and a control that turns it off', () => {
    const { render, $ } = mountCard({ id: 'evt_1', use_sponsors: 1 });
    render('evt_1');
    expect($('sponsors-switch-state').textContent).toBe('Sponsors are on for this event.');
    expect($('sponsors-switch-toggle').textContent).toBe('Turn off sponsors');
    expect($('sponsors-switch-toggle').getAttribute('data-want-on')).toBe('0');
  });

  test('a render re-enables a control that a save had disabled', () => {
    const { render, $ } = mountCard({ id: 'evt_1', use_sponsors: 0 });
    ($('sponsors-switch-toggle') as HTMLButtonElement).disabled = true;
    render('evt_1');
    expect(($('sponsors-switch-toggle') as HTMLButtonElement).disabled).toBe(false);
  });

  test('no event selected, or an id the list does not have: the control is hidden', () => {
    const { render, $ } = mountCard({ id: 'evt_1', use_sponsors: 1 });
    render('evt_1');
    expect($('sponsors-switch').hidden).toBe(false);
    render('evt_other');
    expect($('sponsors-switch').hidden).toBe(true);
  });

  test('a message left by an earlier save is cleared when another event is shown', () => {
    const { render, $ } = mountCard({ id: 'evt_1', use_sponsors: 1 });
    $('sponsors-switch-msg').textContent = 'Sponsors are on.';
    render('evt_1');
    expect($('sponsors-switch-msg').textContent).toBe('');
  });

  test('selecting an event renders the switch for it', () => {
    expect(ADMIN_HTML).toMatch(
      /window\.addEventListener\('ose:event-selected', function \(ev\) \{\s*var d = ev\.detail \|\| \{\};\s*window\.renderEventStatus\(d\.id\);\s*window\.renderSponsorsSwitch\(d\.id\);/
    );
  });
});

describe('changing the switch from the card', () => {
  function run(opts: {
    ok: boolean;
    data?: Record<string, unknown> | null;
    status?: number;
    start?: number;
    throws?: boolean;
  }) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const row: Record<string, unknown> = { id: 'evt_1', use_sponsors: opts.start ?? 0 };
    const rendered: string[] = [];
    const msgEl = { textContent: '', className: '' };
    const win: Record<string, unknown> = {
      _oseList: { byId: { evt_1: row } },
      renderSponsorsSwitch: (id: string) => rendered.push('switch:' + id),
    };
    const doc = { getElementById: (id: string) => (id === 'spon-switch-msg' ? msgEl : null) };
    const fetchStub = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (opts.throws) throw new Error('Failed to fetch');
      return {
        ok: opts.ok,
        status: opts.status ?? (opts.ok ? 200 : 400),
        json: async () => {
          if (opts.data === null) throw new Error('not json');
          return opts.data ?? { ok: opts.ok };
        },
      };
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('window', 'document', 'fetch', CHANGE_SRC())(win, doc, fetchStub);
    return {
      change: win.changeEventSponsors as (
        id: string,
        on: boolean,
        b?: { disabled: boolean }
      ) => Promise<void>,
      calls,
      row,
      rendered,
      msgEl,
    };
  }

  test('turning it on PUTs settings.useSponsors true and nothing else', async () => {
    const t = run({ ok: true, data: { ok: true, sponsors: { on: true } } });
    await t.change('evt_1', true);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.url).toBe('/api/v2/admin/events/evt_1');
    expect(t.calls[0]!.init.method).toBe('PUT');
    expect((t.calls[0]!.init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json'
    );
    expect(JSON.parse(String(t.calls[0]!.init.body))).toEqual({ settings: { useSponsors: true } });
    expect(t.row.use_sponsors).toBe(1);
    expect(t.rendered).toEqual(['switch:evt_1']);
    expect(t.msgEl.textContent).toBe(
      'Sponsors are on. A sponsor shows once you and the sponsor have both said yes.'
    );
    expect(t.msgEl.className).toContain('success');
  });

  test('turning it off PUTs settings.useSponsors false, and says nothing was deleted', async () => {
    const t = run({ ok: true, start: 1, data: { ok: true, sponsors: { on: false } } });
    await t.change('evt_1', false);
    expect(JSON.parse(String(t.calls[0]!.init.body))).toEqual({ settings: { useSponsors: false } });
    expect(t.row.use_sponsors).toBe(0);
    expect(t.msgEl.textContent).toBe(
      'Sponsors are off. Nothing was deleted. Turn them back on and what you both agreed shows again.'
    );
    expect(t.msgEl.className).toContain('success');
  });

  test('a truthy stand-in is sent as a real boolean (the server refuses anything else)', async () => {
    const t = run({ ok: true, data: { ok: true, sponsors: { on: true } } });
    await t.change('evt_1', 1 as unknown as boolean);
    expect(JSON.parse(String(t.calls[0]!.init.body))).toEqual({ settings: { useSponsors: true } });
  });

  test('the id is encoded into the path', () => {
    expect(CHANGE_SRC()).toContain("'/api/v2/admin/events/' + encodeURIComponent(id)");
  });

  test('the card shows what the server stored, not what was asked', async () => {
    // Asked on, but the answer says off (another admin turned it off in between).
    const t = run({ ok: true, data: { ok: true, sponsors: { on: false } } });
    await t.change('evt_1', true);
    expect(t.row.use_sponsors).toBe(0);
    expect(t.msgEl.textContent).toMatch(/^Sponsors are off\./);
  });

  test('an answer that does not say which way it went is not taken as a yes', async () => {
    const t = run({ ok: true, data: { ok: true } });
    await t.change('evt_1', true);
    expect(t.row.use_sponsors).toBe(0);
    expect(t.msgEl.className).toContain('error');
    expect(t.msgEl.textContent).toBe(
      'Could not confirm the sponsors setting. Reload the page to see what was saved.'
    );
  });

  test.each([
    [
      'the server refused (400)',
      {
        ok: false,
        status: 400,
        data: { ok: false, error: 'settings.useSponsors must be true or false' },
      },
      'settings.useSponsors must be true or false',
    ],
    [
      "another brand's event (404)",
      { ok: false, status: 404, data: { ok: false, error: 'Event not found' } },
      'Event not found',
    ],
    [
      'the database was down (503)',
      { ok: false, status: 503, data: { ok: false, error: 'Failed to update event' } },
      'Failed to update event',
    ],
    [
      'a 200 whose body says not ok',
      { ok: true, status: 200, data: { ok: false, code: 'CONFLICT' } },
      'CONFLICT',
    ],
    [
      'an answer that is not JSON',
      { ok: false, status: 502, data: null },
      'Could not change the sponsors setting (server said 502)',
    ],
    ['no network', { ok: false, throws: true }, 'Failed to fetch'],
  ])('a failed save (%s) leaves the row as it was, and says so', async (_name, opts, text) => {
    const t = run({ start: 1, ...(opts as { ok: boolean }) });
    await t.change('evt_1', false);
    expect(t.row.use_sponsors).toBe(1);
    expect(t.msgEl.textContent).toContain(text);
    expect(t.msgEl.className).toContain('error');
    expect(t.rendered).toEqual(['switch:evt_1']);
  });

  test('the control is disabled while the save is in flight', async () => {
    const t = run({ ok: true, data: { ok: true, sponsors: { on: true } } });
    const btn = { disabled: false };
    const p = t.change('evt_1', true, btn);
    expect(btn.disabled).toBe(true);
    await p;
  });

  test('an id the list does not have sends nothing', async () => {
    const t = run({ ok: true });
    await t.change('evt_missing', true);
    expect(t.calls).toHaveLength(0);
    expect(t.rendered).toEqual([]);
  });
});
