/**
 * Logs and Settings pages: what a person sees. Each page's real script, from the
 * template Text import, runs in jsdom against a stubbed fetch.
 *
 * What is pinned:
 *   - the Logs page asks the audit-log route in the BRAND view by default, and the
 *     filter each tab sends (System jobs = source=system, Security = outcome=denied);
 *   - whatever the server sends is shown as text, never as markup;
 *   - a masked operator reads "Someone outside your brands"; a log line shows only
 *     the numbers from `details`, never free text;
 *   - what has no durable record (Cost) is an honest "not recorded yet" with no
 *     fetch and no number, and a failed read is an alert, never an empty list;
 *   - the tabs are a real tablist (arrow keys, aria-selected).
 *
 * @born-red logs-settings-screens | method: ran against the first draft templates
 * with the failing assertions inverted one at a time (innerHTML in a row, details
 * text shown, cost tab fetching, error shown as empty) | date: 2026-10-04
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import LOGS_HTML from '../src/templates/admin-logs.html';
import SETTINGS_HTML from '../src/templates/admin-settings.html';

interface Call {
  url: string;
}
type Reply =
  { status?: number; body: unknown } | (() => Promise<{ status?: number; body: unknown }>);

function scriptOf(html: string): string {
  const dom = new JSDOM(html);
  const scripts = Array.from(dom.window.document.querySelectorAll('script'));
  expect(scripts.length).toBe(1);
  return scripts[0].textContent || '';
}

function mount(html: string, replies: Reply[] | ((url: string) => Reply)) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://admin.test/' });
  const w = dom.window as unknown as Window & { eval(s: string): unknown; fetch: unknown };
  const calls: Call[] = [];
  let i = 0;
  w.fetch = async (url: string) => {
    calls.push({ url });
    const r =
      typeof replies === 'function' ? replies(url) : replies[Math.min(i++, replies.length - 1)];
    const v = typeof r === 'function' ? await r() : r;
    const status = v.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => v.body };
  };
  w.eval(scriptOf(html));
  const doc = w.document;
  const $ = <T extends HTMLElement>(testid: string) =>
    doc.querySelector<T>(`[data-testid="${testid}"]`)!;
  return { w, doc, $, calls };
}

const flush = async () => {
  for (let n = 0; n < 6; n++) await new Promise((r) => setTimeout(r, 0));
};

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  created_at: '2026-10-04T10:00:00.000Z',
  action: 'UPDATE_EVENT',
  actor: 'owner@example.com',
  source: 'person',
  resource_type: 'event',
  resource_id: 'evt-1',
  outcome: 'success',
  ip: '203.0.113.0/24',
  details: null,
  brand_id: 'a',
  ...over,
});
const page = (entries: unknown[], extra: Record<string, unknown> = {}) => ({
  ok: true,
  scope: 'brand',
  brands: ['a'],
  entries,
  pagination: { limit: 25, hasMore: false, nextCursor: null },
  ...extra,
});

describe('Logs: first load', () => {
  test('asks the audit log in the brand view, with a time window and no who filter', async () => {
    const { calls } = mount(LOGS_HTML, [{ body: page([entry()]) }]);
    await flush();
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0].url, 'https://admin.test');
    expect(u.pathname).toBe('/api/v2/admin/audit-log');
    expect(u.searchParams.get('scope')).toBe('brand');
    expect(u.searchParams.get('limit')).toBe('25');
    expect(u.searchParams.get('since')).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
    expect(u.searchParams.has('source')).toBe(false);
    expect(u.searchParams.has('outcome')).toBe(false);
  });

  test('shows a row with its kind tag, action, target, who and network', async () => {
    const { doc, $ } = mount(LOGS_HTML, [{ body: page([entry()]) }]);
    await flush();
    const rows = doc.querySelectorAll('[data-testid="logs-row"]');
    expect(rows).toHaveLength(1);
    const t = rows[0].textContent || '';
    expect(t).toContain('Update event');
    expect(t).toContain('event evt-1');
    expect(t).toContain('owner@example.com');
    expect(t).toContain('Network 203.0.113.0/24');
    expect(rows[0].querySelector('[data-testid="logs-row-source"]')!.textContent).toBe('Person');
    expect($('logs-status').textContent).toBe('1 entry shown.');
  });

  test('a masked operator reads as someone outside the brand, never a blank or a guess', async () => {
    const { doc } = mount(LOGS_HTML, [{ body: page([entry({ actor: null })]) }]);
    await flush();
    expect(doc.querySelector('[data-testid="logs-row"]')!.textContent).toContain(
      'Someone outside your brands'
    );
  });

  test('tags: system, sponsor, key, and a refusal with no sign-in', async () => {
    const { doc } = mount(LOGS_HTML, [
      {
        body: page([
          entry({ id: 'a', source: 'system', actor: 'system:lifecycle' }),
          entry({ id: 'b', source: 'sponsor', actor: null }),
          entry({ id: 'c', source: 'key', actor: 'key:admin' }),
          entry({ id: 'd', source: 'unknown', actor: null, outcome: 'denied' }),
        ]),
      },
    ]);
    await flush();
    const rows = Array.from(doc.querySelectorAll('[data-testid="logs-row"]'));
    const text = rows.map((r) => r.textContent || '');
    expect(text[0]).toContain('The system');
    expect(text[1]).toContain('A sponsor');
    expect(text[2]).toContain('key:admin');
    expect(text[3]).toContain('Nobody signed in');
    expect(rows[3].querySelector('[data-testid="logs-row-refused"]')!.textContent).toBe('Refused');
    expect(
      rows.map((r) => r.querySelector('[data-testid="logs-row-source"]')!.textContent)
    ).toEqual(['System', 'Sponsor', 'Key', 'Not signed in']);
  });

  test('only the numbers of a details blob are shown, never its free text', async () => {
    const { doc } = mount(LOGS_HTML, [
      {
        body: page([
          entry({
            action: 'DRAFT_EXPIRED',
            source: 'system',
            actor: 'system:lifecycle',
            details: { archived: 3, days: 30, ids: ['evt-1'], note: 'alice@example.com asked' },
          }),
        ]),
      },
    ]);
    await flush();
    const t = doc.querySelector('[data-testid="logs-row"]')!.textContent || '';
    expect(t).toContain('archived 3, days 30');
    expect(t).not.toContain('alice@example.com');
    expect(t).not.toContain('evt-1,');
  });

  test('server values are text, never markup', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    const { doc } = mount(LOGS_HTML, [
      { body: page([entry({ action: 'X_<B>', resource_id: evil, actor: evil, ip: evil })]) },
    ]);
    await flush();
    expect(doc.querySelectorAll('#logs-list img, #logs-list b')).toHaveLength(0);
    expect(doc.querySelector('[data-testid="logs-row"]')!.textContent).toContain(evil);
  });

  test('empty is said plainly', async () => {
    const { $ } = mount(LOGS_HTML, [{ body: page([]) }]);
    await flush();
    expect($('logs-status').textContent).toBe('Nothing recorded for this view yet.');
  });
});

describe('Logs: failures are never shown as an empty log', () => {
  test('a 503 is an alert, with no rows and no zero', async () => {
    const { doc, $ } = mount(LOGS_HTML, [
      { status: 503, body: { ok: false, code: 'DB_UNAVAILABLE' } },
    ]);
    await flush();
    const s = $('logs-error');
    expect(s.getAttribute('role')).toBe('alert');
    expect(s.textContent).toMatch(/could not be loaded/);
    expect(s.textContent).toContain('503');
    expect(doc.querySelectorAll('[data-testid="logs-row"]')).toHaveLength(0);
    expect(s.textContent).not.toMatch(/nothing recorded/i);
  });

  test('a network failure is an alert too', async () => {
    const { w, doc } = mount(LOGS_HTML, [{ body: page([]) }]);
    await flush();
    (w as unknown as { fetch: unknown }).fetch = async () => {
      throw new Error('offline');
    };
    (doc.querySelector('[data-testid="logs-tab-security"]') as HTMLElement).click();
    await flush();
    expect(doc.querySelector('[data-testid="logs-error"]')!.textContent).toMatch(/No connection/);
  });

  test('a 404 in the platform view says it is for the platform owner', async () => {
    const { doc, $ } = mount(LOGS_HTML, (url) =>
      url.includes('scope=brand') ? { body: page([entry()]) } : { status: 404, body: { ok: false } }
    );
    await flush();
    const view = $<HTMLSelectElement>('logs-view');
    view.value = 'platform';
    view.dispatchEvent(new doc.defaultView!.Event('change', { bubbles: true }));
    await flush();
    expect($('logs-error').textContent).toMatch(/only for the platform owner/);
  });

  test('the platform view drops scope=brand', async () => {
    const { doc, $, calls } = mount(LOGS_HTML, [{ body: page([]) }]);
    await flush();
    const view = $<HTMLSelectElement>('logs-view');
    view.value = 'platform';
    view.dispatchEvent(new doc.defaultView!.Event('change', { bubbles: true }));
    await flush();
    const u = new URL(calls[calls.length - 1].url, 'https://admin.test');
    expect(u.searchParams.has('scope')).toBe(false);
  });
});

describe('Logs: the four tabs', () => {
  test('System jobs asks for source=system, and says what is not shown yet', async () => {
    const { doc, $, calls } = mount(LOGS_HTML, [{ body: page([]) }]);
    await flush();
    (doc.querySelector('[data-testid="logs-tab-system"]') as HTMLElement).click();
    await flush();
    const u = new URL(calls[calls.length - 1].url, 'https://admin.test');
    expect(u.searchParams.get('source')).toBe('system');
    expect($('logs-heading').textContent).toBe('System jobs');
    expect($('logs-note').textContent).toMatch(/not shown here yet/);
  });

  test('Security asks for outcome=denied, and says what is not recorded per brand', async () => {
    const { doc, $, calls } = mount(LOGS_HTML, [{ body: page([]) }]);
    await flush();
    (doc.querySelector('[data-testid="logs-tab-security"]') as HTMLElement).click();
    await flush();
    const u = new URL(calls[calls.length - 1].url, 'https://admin.test');
    expect(u.searchParams.get('outcome')).toBe('denied');
    expect(u.searchParams.has('source')).toBe(false);
    expect($('logs-note').textContent).toMatch(/not recorded per brand yet/);
  });

  test('the who filter shows on Activity only, and is sent as source', async () => {
    const { doc, $, calls } = mount(LOGS_HTML, [{ body: page([]) }]);
    await flush();
    expect(($('logs-who').closest('.form-field') as HTMLElement).hidden).toBe(false);
    const who = $<HTMLSelectElement>('logs-who');
    who.value = 'sponsor';
    who.dispatchEvent(new doc.defaultView!.Event('change', { bubbles: true }));
    await flush();
    expect(
      new URL(calls[calls.length - 1].url, 'https://admin.test').searchParams.get('source')
    ).toBe('sponsor');
    (doc.querySelector('[data-testid="logs-tab-system"]') as HTMLElement).click();
    await flush();
    expect(($('logs-who').closest('.form-field') as HTMLElement).hidden).toBe(true);
  });

  test('Cost is an honest empty state: no fetch, no number', async () => {
    const { doc, $, calls } = mount(LOGS_HTML, [{ body: page([entry()]) }]);
    await flush();
    const before = calls.length;
    (doc.querySelector('[data-testid="logs-tab-cost"]') as HTMLElement).click();
    await flush();
    expect(calls.length).toBe(before);
    const empty = $('logs-cost-empty');
    expect(empty.textContent).toContain('Not recorded yet.');
    expect(empty.textContent).toMatch(/nothing is estimated/i);
    expect(empty.textContent).not.toMatch(/\d/);
    expect(doc.querySelectorAll('[data-testid="logs-row"]')).toHaveLength(0);
    expect($<HTMLButtonElement>('logs-more').hidden).toBe(true);
  });
});

describe('Logs: paging, brands and the tablist', () => {
  test('Show more asks with the cursor and appends', async () => {
    const { doc, $, calls } = mount(LOGS_HTML, [
      {
        body: page([entry({ id: 'p1' })], {
          pagination: { limit: 25, hasMore: true, nextCursor: '2026-10-04T10:00:00.000Z~p1' },
        }),
      },
      { body: page([entry({ id: 'p2' })]) },
    ]);
    await flush();
    const more = $<HTMLButtonElement>('logs-more');
    expect(more.hidden).toBe(false);
    more.click();
    await flush();
    const u = new URL(calls[calls.length - 1].url, 'https://admin.test');
    expect(u.searchParams.get('cursor')).toBe('2026-10-04T10:00:00.000Z~p1');
    expect(doc.querySelectorAll('[data-testid="logs-row"]')).toHaveLength(2);
    expect(more.hidden).toBe(true);
  });

  test('a brand filter appears only for more than one brand, and is sent as brand=', async () => {
    const one = mount(LOGS_HTML, [{ body: page([], { brands: ['a'] }) }]);
    await flush();
    expect(one.doc.getElementById('logs-brand-field')!.hidden).toBe(true);

    const { doc, $, calls } = mount(LOGS_HTML, [{ body: page([], { brands: ['a', 'b'] }) }]);
    await flush();
    expect(doc.getElementById('logs-brand-field')!.hidden).toBe(false);
    const sel = $<HTMLSelectElement>('logs-brand');
    sel.value = 'b';
    sel.dispatchEvent(new doc.defaultView!.Event('change', { bubbles: true }));
    await flush();
    expect(
      new URL(calls[calls.length - 1].url, 'https://admin.test').searchParams.get('brand')
    ).toBe('b');
  });

  test('an all-brands reader (brands: null) gets no brand list to pick from', async () => {
    const { doc } = mount(LOGS_HTML, [{ body: page([], { brands: null }) }]);
    await flush();
    expect(doc.getElementById('logs-brand-field')!.hidden).toBe(true);
  });

  test('a slow answer to an old filter never overwrites the newer one', async () => {
    let release: (v: { body: unknown }) => void = () => {};
    const slow = new Promise<{ body: unknown }>((r) => (release = r));
    const { doc, $ } = mount(LOGS_HTML, [
      () => slow,
      { body: page([entry({ id: 'new', action: 'NEWER_ONE' })]) },
    ]);
    await flush();
    const time = $<HTMLSelectElement>('logs-time');
    time.value = '24';
    time.dispatchEvent(new doc.defaultView!.Event('change', { bubbles: true }));
    await flush();
    release({ body: page([entry({ id: 'old', action: 'OLDER_ONE' })]) });
    await flush();
    const text = doc.getElementById('logs-list')!.textContent || '';
    expect(text).toContain('Newer one');
    expect(text).not.toContain('Older one');
  });

  test('tabs are a tablist: one selected, roving tabindex, arrows move and activate', async () => {
    const { doc, $ } = mount(LOGS_HTML, [{ body: page([]) }]);
    await flush();
    expect(doc.querySelector('[role="tablist"]')).not.toBeNull();
    const tabs = Array.from(doc.querySelectorAll<HTMLElement>('[role="tab"]'));
    expect(tabs.filter((t) => t.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    expect(tabs.filter((t) => t.getAttribute('tabindex') === '0')).toHaveLength(1);
    const first = $('logs-tab-activity');
    first.dispatchEvent(
      new doc.defaultView!.KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      })
    );
    await flush();
    expect($('logs-tab-system').getAttribute('aria-selected')).toBe('true');
    expect($('logs-tab-activity').getAttribute('aria-selected')).toBe('false');
    expect(doc.activeElement).toBe($('logs-tab-system'));
    expect($('logs-panel').getAttribute('aria-labelledby')).toBe('logs-tab-system');
    // ArrowLeft from the first tab wraps to the last.
    $('logs-tab-system').dispatchEvent(
      new doc.defaultView!.KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        bubbles: true,
        cancelable: true,
      })
    );
    $('logs-tab-activity').dispatchEvent(
      new doc.defaultView!.KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        bubbles: true,
        cancelable: true,
      })
    );
    await flush();
    expect($('logs-tab-cost').getAttribute('aria-selected')).toBe('true');
  });
});

// ── Settings ────────────────────────────────────────────────────────────────

const settings = (over: Record<string, unknown> = {}) => ({
  ok: true,
  read_only: true,
  defaults: {
    editable: false,
    note: 'Every new event starts from these values today.',
    items: [
      { key: 'timezone', label: 'Time zone', value: 'America/Chicago', source: 'platform' },
      { key: 'survey', label: 'Survey after the event', value: 'Off', source: 'plan' },
    ],
  },
  plan: {
    tier: 'free',
    name: 'Free',
    description: 'Registration + check-in forms.',
    items: [
      { key: 'forms.register', label: 'Registration form', included: true, lowest_tier: 'free' },
      {
        key: 'branding.white-label',
        label: 'White-label branding',
        included: false,
        lowest_tier: 'enterprise',
      },
    ],
  },
  timings: [
    {
      key: 'listing_delay_minutes',
      label: 'A new event is listed after',
      value: 10,
      unit: 'minutes',
    },
    {
      key: 'draft_archive_days',
      label: 'A draft nobody touched is archived after',
      value: 0,
      unit: 'days',
    },
    { key: 'one_minute', label: 'One', value: 1, unit: 'minutes' },
  ],
  fixed: [
    { key: 'count_floor', text: 'Any count under 5 is hidden.' },
    { key: 'security_same_on_every_plan', text: 'Security is the same on every plan.' },
  ],
  ...over,
});

describe('Settings', () => {
  test('reads only the settings route, and says it is read only and saves nothing', async () => {
    const { calls, $ } = mount(SETTINGS_HTML, [{ body: settings() }]);
    await flush();
    expect(calls.map((c) => c.url)).toEqual(['/api/v2/admin/settings']);
    expect($('settings-readonly').textContent).toMatch(/Read only/);
    expect($('settings-readonly').textContent).toMatch(/nothing here saves/);
  });

  test('shows the four sections with their values', async () => {
    const { doc, $ } = mount(SETTINGS_HTML, [{ body: settings() }]);
    await flush();
    for (const id of ['settings-defaults', 'settings-plan', 'settings-timings', 'settings-fixed']) {
      expect($(id).hidden, id).toBe(false);
    }
    expect($('settings-defaults-note').textContent).toContain('starts from these values');
    expect($('settings-default-timezone').textContent).toContain('America/Chicago');
    expect($('settings-default-survey').textContent).toContain('(follows your plan)');
    expect($('settings-plan-name').textContent).toBe('Free');
    const items = Array.from(doc.querySelectorAll('[data-testid="settings-plan-item"]'));
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Included');
    expect(items[1].textContent).toContain('Not on your plan. Starts on Enterprise.');
    expect(items[1].getAttribute('data-included')).toBe('0');
    expect($('settings-fixed-count_floor').textContent).toContain('Any count under 5 is hidden.');
    expect($('settings-fixed-security_same_on_every_plan').textContent).toContain('every plan');
  });

  test('timings: a value of 0 reads Off, one minute is singular', async () => {
    const { $ } = mount(SETTINGS_HTML, [{ body: settings() }]);
    await flush();
    expect($('settings-timing-listing_delay_minutes').textContent).toContain('10 minutes');
    expect($('settings-timing-draft_archive_days').textContent).toContain('Off');
    expect($('settings-timing-one_minute').textContent).toContain('1 minute');
    expect($('settings-timing-one_minute').textContent).not.toContain('1 minutes');
  });

  test('offers no control: no input, select, button or form that could look like it saves', async () => {
    const { doc } = mount(SETTINGS_HTML, [{ body: settings() }]);
    await flush();
    expect(doc.querySelectorAll('input, select, textarea, button, form')).toHaveLength(0);
  });

  test('a failed read is an alert and leaves every section hidden', async () => {
    const { $ } = mount(SETTINGS_HTML, [{ status: 503, body: { ok: false } }]);
    await flush();
    expect($('settings-error').getAttribute('role')).toBe('alert');
    expect($('settings-error').textContent).toContain('503');
    for (const id of ['settings-defaults', 'settings-plan', 'settings-timings', 'settings-fixed']) {
      expect($(id).hidden, id).toBe(true);
    }
  });

  test('server text is shown as text, never markup', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    const { doc } = mount(SETTINGS_HTML, [
      { body: settings({ fixed: [{ key: 'x', text: evil }] }) },
    ]);
    await flush();
    expect(doc.querySelectorAll('main img')).toHaveLength(0);
    expect(doc.querySelector('[data-testid="settings-fixed-x"]')!.textContent).toBe(evil);
  });
});
