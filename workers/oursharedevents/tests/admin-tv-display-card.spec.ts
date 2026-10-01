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
  const end = html.indexOf('<!-- R4 (OSE-1319)', start);
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
};

function mount(load: Reply = { body: SAVED }, save: Reply = { body: { ok: true } }) {
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
    const r = method === 'PUT' ? save : load;
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
    ]);
    expect($<HTMLInputElement>('tv-dwell').value).toBe('30');
    expect($<HTMLInputElement>('tv-league-standings').value).toBe('https://docs.google.com/x');
    expect($<HTMLInputElement>('tv-league-schedule').value).toBe('');
    expect($('tv-open').getAttribute('href')).toBe(`/display?event=${EVT}`);
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
      (rows()[3].querySelector('[data-testid="tv-screen-down"]') as HTMLButtonElement).disabled
    ).toBe(true);
    (rows()[1].querySelector('[data-testid="tv-screen-up"]') as HTMLButtonElement).click();
    expect(order().map((r) => r[0])).toEqual(['event', 'league', 'upcoming', 'sponsors']);
    (rows()[0].querySelector('[data-testid="tv-screen-down"]') as HTMLButtonElement).click();
    expect(order().map((r) => r[0])).toEqual(['league', 'event', 'upcoming', 'sponsors']);
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
      },
    });
    expect($('tv-msg').textContent).toContain('within a minute');
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
