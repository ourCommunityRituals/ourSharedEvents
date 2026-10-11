/**
 * Admin: one button copies the emails registrants chose to leave, so the
 * organizer can write to them from their own email if the event moves or is
 * cancelled (owner 2026-10-11). Runs the page's own scripts in jsdom with a
 * stubbed fetch, like tests/admin-mint-report-link.spec.ts.
 *
 * @born-red registrant contacts button | method: run before the button existed
 *   (no element with the test id) | date: 2026-10-11
 */
import vm from 'node:vm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import ADMIN_HTML from '../src/templates/admin.html';

const ORIGIN = 'https://admin.test';
const EVT = 'evt_contacts_panel';
const PAGE_SCRIPTS = [
  'var ACTIONS = {',
  'window._adminAnnounce = function',
  'window.mintReportLink = async function',
  'window.friendlyTier = function',
];

vi.setConfig({ testTimeout: 30_000 });
const open: JSDOM[] = [];
afterEach(() => {
  while (open.length) open.pop()!.window.close();
});
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

async function mount(contacts: { status?: number; body: unknown }) {
  const dom = new JSDOM(ADMIN_HTML, { runScripts: 'outside-only', url: `${ORIGIN}/admin` });
  open.push(dom);
  const w = dom.window as unknown as Window & Record<string, unknown>;
  const calls: string[] = [];
  const answer = (status: number, body: unknown) => ({
    ok: status < 400,
    status,
    json: async () => body,
  });
  w.fetch = vi.fn(async (url: string) => {
    calls.push(String(url));
    if (String(url).endsWith('/forms/contacts'))
      return answer(contacts.status ?? 200, contacts.body);
    if (String(url).includes('/flags/resolve')) return answer(200, { ok: true, flags: {} });
    return answer(200, { ok: true, suppressed: true });
  }) as unknown as typeof fetch;
  const copied: string[] = [];
  Object.defineProperty(w.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (t: string) => void copied.push(t) },
  });
  const context = dom.getInternalVMContext();
  const scripts = Array.from(w.document.querySelectorAll('script'))
    .map((s) => s.textContent || '')
    .filter((t) => PAGE_SCRIPTS.some((m) => t.includes(m)));
  for (const t of scripts) new vm.Script(t).runInContext(context);
  await (w.loadForms as (id: string, n: string, p: number) => Promise<void>)(EVT, 'Bocce', 1);
  const $ = (id: string) => w.document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  return { $, calls, copied };
}

describe('admin: copy registrants’ emails', () => {
  test('the forms card has the button, and pressing it copies the emails, comma-separated', async () => {
    const { $, calls, copied } = await mount({
      body: {
        ok: true,
        items: [
          { name: 'Dee', email: 'dee@example.org' },
          { name: null, email: 'fay@example.org' },
        ],
      },
    });
    const btn = $('copy-registrant-emails')!;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('Copy registrants’ emails');
    btn.click();
    await flush();
    expect(calls).toContain(`/api/v2/admin/events/${EVT}/forms/contacts`);
    expect(copied).toEqual(['dee@example.org, fay@example.org']);
    expect($('registrant-contacts-msg')!.textContent).toBe('Copied 2 emails.');
  });

  test('no one left an email: says so and copies nothing', async () => {
    const { $, copied } = await mount({ body: { ok: true, items: [] } });
    $('copy-registrant-emails')!.click();
    await flush();
    expect(copied).toEqual([]);
    expect($('registrant-contacts-msg')!.textContent).toBe('No one has left an email.');
  });

  test('a failed read says so and copies nothing', async () => {
    const { $, copied } = await mount({ status: 503, body: { ok: false } });
    $('copy-registrant-emails')!.click();
    await flush();
    expect(copied).toEqual([]);
    expect($('registrant-contacts-msg')!.textContent).toBe('Could not load the emails. Try again.');
  });
});
