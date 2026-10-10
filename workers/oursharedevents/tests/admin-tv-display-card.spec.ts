/**
 * The admin "TV display" card (2026-10-01): GAS's per-event display order
 * (AdminDisplay.html) brought back. It loads the saved order / seconds / league
 * links from GET /api/v2/admin/events/:id/display-config and saves them through
 * PUT /api/v2/admin/events/:id { settings }. Runs the card's real script from
 * the admin.html Text import in jsdom with a stubbed fetch.
 */

import { describe, test, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import ADMIN_HTML from '../src/templates/admin.html';

const EVT = 'evt_tv_card';

function cardMarkup(html: string): string {
  const start = html.indexOf('<div class="card tv-display-card"');
  const end = html.indexOf('    </main>', start);
  expect(start, 'TV card markup').toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

function cardScript(html: string): string {
  const doc = new JSDOM(html).window.document;
  const el = Array.from(doc.querySelectorAll('script')).find((s) =>
    (s.textContent || '').includes('window.loadTvDisplay = async function')
  );
  expect(el, 'TV card script').toBeDefined();
  return el!.textContent || '';
}

type Reply = { status?: number; body?: unknown };

const SAVED = {
  ok: true,
  panes: ['league', 'event'],
  dwell_seconds: 30,
  league: [{ kind: 'standings', label: 'Standings', url: 'https://docs.google.com/x', qr: null }],
  donate: { label: 'Donate', url: 'https://donate.example/give' },
};

const TV_CODE: Reply = {
  body: { ok: true, code: 'K7Q2PX', links: { share: '/e/K7Q2PX', tv: '/tv/K7Q2PX' } },
};

function mount(
  load: Reply = { body: SAVED },
  save: Reply = { body: { ok: true } },
  tvCode: Reply = TV_CODE
) {
  const dom = new JSDOM(`<!doctype html><body>${cardMarkup(ADMIN_HTML)}</body>`, {
    runScripts: 'outside-only',
    url: 'https://admin.test/admin',
  });
  const w = dom.window as unknown as Window & { eval(s: string): unknown } & Record<
      string,
      unknown
    >;
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  w.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = url.endsWith('/short-links') ? tvCode : method === 'PUT' ? save : load;
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body };
  }) as unknown as typeof fetch;
  w.eval(cardScript(ADMIN_HTML));
  const doc = w.document;
  const $ = <T extends HTMLElement>(id: string) => doc.querySelector<T>(`[data-testid="${id}"]`)!;
  const order = () =>
    [...doc.querySelectorAll('[data-testid="tv-screen-row"]')].map((li) => [
      li.getAttribute('data-pane'),
      (li.querySelector('[data-testid="tv-screen-on"]') as HTMLInputElement).checked,
    ]);
  const load_ = async () => {
    await (w.loadTvDisplay as (id: string) => Promise<void>)(EVT);
  };
  return { w, doc, $, calls, order, load: load_ };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('admin TV display card', () => {
  test('shows the short code to type on the TV (OSE-1684), after the settings load', async () => {
    const { $, load, calls } = await mount();
    expect($('tv-code').hidden).toBe(true);
    await load();
    await flush();
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['GET', `/api/v2/admin/events/${EVT}/display-config`],
      ['POST', `/api/v2/admin/events/${EVT}/short-links`],
    ]);
    expect($('tv-code').hidden).toBe(false);
    expect($('tv-code-address').textContent).toBe('admin.test/tv/K7Q2PX');
  });

  test('a failed code read leaves the line hidden; Open the TV still works', async () => {
    const { $, load } = await mount(undefined, undefined, { status: 503, body: { ok: false } });
    await load();
    await flush();
    expect($('tv-code').hidden).toBe(true);
    expect($('tv-open').getAttribute('href')).toBe(`/events/${EVT}/tv`);
  });

  test('loads the saved order: saved screens on, in order; the rest off, after them', async () => {
    const { $, order, load, calls } = await mount();
    await load();
    expect(calls[0]).toMatchObject({
      url: `/api/v2/admin/events/${EVT}/display-config`,
      method: 'GET',
    });
    expect(order()).toEqual([
      ['league', true],
      ['event', true],
      ['upcoming', false],
      ['sponsors', false],
      ['donate', false],
      ['sponsor', false],
    ]);
    expect($<HTMLInputElement>('tv-dwell').value).toBe('30');
    expect($<HTMLInputElement>('tv-donate').value).toBe('https://donate.example/give');
    expect($<HTMLInputElement>('tv-league-standings').value).toBe('https://docs.google.com/x');
    expect($<HTMLInputElement>('tv-league-schedule').value).toBe('');
    expect($('tv-open').getAttribute('href')).toBe(`/events/${EVT}/tv`);
    expect($<HTMLButtonElement>('tv-save').disabled).toBe(false);
  });

  test('Move up / Move down reorder; the first cannot go up, the last cannot go down', async () => {
    const { doc, order, load } = await mount();
    await load();
    const rows = () => doc.querySelectorAll('[data-testid="tv-screen-row"]');
    expect(
      (rows()[0].querySelector('[data-testid="tv-screen-up"]') as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (rows()[5].querySelector('[data-testid="tv-screen-down"]') as HTMLButtonElement).disabled
    ).toBe(true);
    (rows()[1].querySelector('[data-testid="tv-screen-up"]') as HTMLButtonElement).click();
    expect(order().map((r) => r[0])).toEqual([
      'event',
      'league',
      'upcoming',
      'sponsors',
      'donate',
      'sponsor',
    ]);
    (rows()[0].querySelector('[data-testid="tv-screen-down"]') as HTMLButtonElement).click();
    expect(order().map((r) => r[0])).toEqual([
      'league',
      'event',
      'upcoming',
      'sponsors',
      'donate',
      'sponsor',
    ]);
  });

  test('Save sends only the ON screens in order, the seconds, and every league link (blank → null)', async () => {
    const { doc, $, calls, load, w } = await mount();
    await load();
    const sponsors = doc.querySelector(
      '[data-pane="sponsors"] [data-testid="tv-screen-on"]'
    ) as HTMLInputElement;
    sponsors.checked = true;
    sponsors.dispatchEvent(new w.Event('change', { bubbles: true }));
    $<HTMLInputElement>('tv-dwell').value = '20';
    $<HTMLInputElement>('tv-league-schedule').value = '  https://league.example/s  ';
    $<HTMLButtonElement>('tv-save').click();
    await flush();
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toBe(`/api/v2/admin/events/${EVT}`);
    expect(put.body).toEqual({
      settings: {
        displayPanes: ['league', 'event', 'sponsors'],
        displayDwellSeconds: 20,
        leagueLinks: {
          schedule: 'https://league.example/s',
          standings: 'https://docs.google.com/x',
          bracket: null,
        },
        donateLink: 'https://donate.example/give',
      },
    });
    expect($('tv-msg').textContent).toContain('within a minute');
  });

  test('OSE-1521: the donate link and the screen per sponsor are saved like any other screen', async () => {
    const { doc, $, calls, load, w } = await mount();
    await load();
    for (const pane of ['donate', 'sponsor']) {
      const box = doc.querySelector(
        `[data-pane="${pane}"] [data-testid="tv-screen-on"]`
      ) as HTMLInputElement;
      box.checked = true;
      box.dispatchEvent(new w.Event('change', { bubbles: true }));
    }
    $<HTMLInputElement>('tv-donate').value = '  https://donate.example/new  ';
    $<HTMLButtonElement>('tv-save').click();
    await flush();
    const put = calls.find((c) => c.method === 'PUT')!;
    const settings = (put.body as { settings: Record<string, unknown> }).settings;
    expect(settings.displayPanes).toEqual(['league', 'event', 'donate', 'sponsor']);
    expect(settings.donateLink).toBe('https://donate.example/new');
  });

  test('OSE-1521: a blank donate link is sent as null (it clears), and no amount or goal is ever sent', async () => {
    const { $, calls, load } = await mount();
    await load();
    $<HTMLInputElement>('tv-donate').value = '';
    $<HTMLButtonElement>('tv-save').click();
    await flush();
    const put = calls.find((c) => c.method === 'PUT')!;
    const settings = (put.body as { settings: Record<string, unknown> }).settings;
    expect(settings.donateLink).toBeNull();
    expect(Object.keys(settings).sort()).toEqual([
      'displayDwellSeconds',
      'displayPanes',
      'donateLink',
      'leagueLinks',
    ]);
  });

  test('OSE-1521: the card says what the new screens are, in plain words', () => {
    const doc = new JSDOM(cardMarkup(ADMIN_HTML)).window.document;
    expect(doc.querySelector('label[for="tv-donate"]')?.textContent).toMatch(/donat/i);
    expect(cardScript(ADMIN_HTML)).toContain("sponsor: 'One screen per sponsor'");
  });

  test('nothing ON, or seconds out of range: not sent, and the organiser is told why', async () => {
    const { doc, $, calls, load, w } = await mount();
    await load();
    $<HTMLInputElement>('tv-dwell').value = '200';
    $<HTMLButtonElement>('tv-save').click();
    await flush();
    expect($('tv-msg').textContent).toContain('5 to 120');
    $<HTMLInputElement>('tv-dwell').value = '15';
    for (const box of doc.querySelectorAll<HTMLInputElement>('[data-testid="tv-screen-on"]')) {
      box.checked = false;
      box.dispatchEvent(new w.Event('change', { bubbles: true }));
    }
    $<HTMLButtonElement>('tv-save').click();
    await flush();
    expect($('tv-msg').textContent).toBe('Pick at least one screen.');
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  test("a server refusal shows the server's reason, and the card stays usable", async () => {
    const { $, load } = await mount(
      { body: SAVED },
      {
        status: 400,
        body: { ok: false, error: 'settings.leagueLinks.schedule must be an https:// link' },
      }
    );
    await load();
    $<HTMLButtonElement>('tv-save').click();
    await flush();
    expect($('tv-msg').textContent).toBe(
      'Not saved: settings.leagueLinks.schedule must be an https:// link'
    );
    expect($<HTMLButtonElement>('tv-save').disabled).toBe(false);
  });

  test('a failed load says so and keeps the card disabled (no saving blind)', async () => {
    const { $, load } = await mount({ status: 500, body: { ok: false } });
    await load();
    expect($('tv-msg').textContent).toBe('Could not load the TV settings.');
    expect($<HTMLButtonElement>('tv-save').disabled).toBe(true);
  });

  test('every control is labelled', () => {
    const doc = new JSDOM(cardMarkup(ADMIN_HTML)).window.document;
    for (const input of doc.querySelectorAll('input[id]')) {
      expect(doc.querySelector(`label[for="${input.id}"]`), input.id).not.toBeNull();
    }
  });
});

describe('admin TV display card: a save answered after switching events', () => {
  test("event A's result is not written into event B's card", async () => {
    const { w, $ } = await mount();
    let answer: (v: unknown) => void = () => {};
    // Hold A's PUT open until we have moved to B.
    (w as unknown as { fetch: typeof fetch }).fetch = (async (url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET').toUpperCase() === 'PUT') {
        return new Promise((resolve) => {
          answer = () => resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
        });
      }
      return { ok: true, status: 200, json: async () => SAVED };
    }) as unknown as typeof fetch;
    const load = w.loadTvDisplay as (id: string) => Promise<void>;
    await load('evt-A');
    $<HTMLButtonElement>('tv-save').click();
    await flush();
    expect($('tv-msg').textContent).toBe('Saving…');
    await load('evt-B');
    answer(null);
    await flush();
    expect($('tv-msg').textContent, "A's 'Saved' must not land on B").toBe('');
    expect($<HTMLButtonElement>('tv-save').disabled).toBe(false);
  });
});

describe('admin TV display card: review fixes', () => {
  test("a failed load for event B never shows event A's values", async () => {
    const { w, $, order } = await mount();
    const load = w.loadTvDisplay as (id: string) => Promise<void>;
    await load('evt-A');
    expect($<HTMLInputElement>('tv-league-standings').value).toBe('https://docs.google.com/x');
    (w as unknown as { fetch: typeof fetch }).fetch = (async () => ({
      ok: false,
      status: 500,
      json: async () => ({ ok: false }),
    })) as unknown as typeof fetch;
    await load('evt-B');
    expect($<HTMLInputElement>('tv-league-standings').value).toBe('');
    expect($<HTMLInputElement>('tv-dwell').value).toBe('15');
    expect(order()).toEqual([
      ['event', true],
      ['upcoming', true],
      ['sponsors', true],
      ['league', true],
      ['donate', true],
      ['sponsor', false],
    ]);
    expect($<HTMLInputElement>('tv-donate').value).toBe('');
    expect($<HTMLButtonElement>('tv-save').disabled).toBe(true);
  });

  test('moving a row to the top keeps keyboard focus on that row', async () => {
    const { doc, load } = await mount();
    await load();
    const rows = () => doc.querySelectorAll('[data-testid="tv-screen-row"]');
    (rows()[1].querySelector('[data-testid="tv-screen-up"]') as HTMLButtonElement).click();
    // Row 0 now; its Move up is disabled, so focus goes to its Move down.
    expect(doc.activeElement).toBe(rows()[0].querySelector('[data-testid="tv-screen-down"]'));
  });
});
