/**
 * A stale status panel: the event moved elsewhere; the panel catches up and
 * Undo is honest.
 *
 * The defect (tests/playwright/admin-deep-dive-journey.spec.ts held it as a
 * known failure): the panel shows Draft, another tab marks the event Ready,
 * and the organizer presses Archive in the stale panel. Ready -> archived is a
 * valid edge, so it lands. Undo then sent the event to Draft, the status the
 * panel had shown, not Ready, where the event really was. The panel now takes
 * the origin from the server's answer (`from` on PUT status), and a refused
 * move repaints the panel and the row with the status the server named.
 *
 * Also here: Undo from Archived back to Ready goes via Draft. It used to plan
 * Archived -> Live -> Ready, which put the event on its public page for a
 * moment on the way.
 *
 * Runs the admin page's real events script (from the admin.html Text import)
 * in jsdom, against a small in-memory stand-in for the three status endpoints
 * that follows the server's rules (src/domain/event-state.ts).
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import ADMIN_HTML_RAW from '../src/templates/admin.html';
import { VALID_TRANSITIONS } from '../src/domain/event-state';

const ADMIN_HTML = ADMIN_HTML_RAW.replace(/\r\n/g, '\n');
const ID = 'evt_stale';

type Call = { method: string; path: string; body: Record<string, unknown> | null };

function eventsScript(doc: Document): string {
  const el = Array.from(doc.querySelectorAll('script')).find((s) =>
    (s.textContent || '').includes('window.changeEventStatus = async function')
  );
  expect(el, 'the events script').toBeDefined();
  return el!.textContent || '';
}

async function mount(listed: string) {
  const dom = new JSDOM(ADMIN_HTML, {
    runScripts: 'outside-only',
    url: 'https://admin.test/admin',
  });
  const w = dom.window as unknown as Window & {
    eval(s: string): unknown;
    changeEventStatus(id: string, to: string, btn?: unknown): Promise<void>;
    _oseList: { byId: Record<string, { status?: string }> };
    renderEventStatus(id: string): void;
  };
  const doc = w.document;
  (w as unknown as { Element: typeof Element }).Element.prototype.scrollIntoView = () => {};
  const server = { status: listed };
  const calls: Call[] = [];
  const reply = (status: number, data: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  });
  w.fetch = (async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = String(url);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    if (method === 'GET' && path === '/api/v2/admin/events') {
      return reply(200, {
        ok: true,
        items: [{ id: ID, name: 'Stale panel night', status: server.status, brand_id: 'root' }],
      });
    }
    if (method === 'GET') return reply(200, { ok: false });
    calls.push({ method, path, body });
    const valid = (from: string, to: string) =>
      (VALID_TRANSITIONS as Record<string, readonly string[]>)[from]!.includes(to);
    if (path.endsWith('/verify-qr') || path.endsWith('/unverify-qr')) {
      const [need, to] = path.endsWith('/verify-qr') ? ['ready', 'active'] : ['active', 'ready'];
      if (server.status !== need)
        return reply(409, { ok: false, code: 'INVALID_TRANSITION', from: server.status, to });
      server.status = to;
      return reply(200, { ok: true, event: { id: ID, status: to } });
    }
    if (method === 'PUT' && body && typeof body.status === 'string') {
      const from = server.status;
      const to = body.status;
      if (from !== to && !valid(from, to))
        return reply(409, { ok: false, code: 'INVALID_TRANSITION', from, to });
      server.status = to;
      return reply(200, { ok: true, status: 200, id: ID, from });
    }
    return reply(200, { ok: true });
  }) as unknown as typeof fetch;
  // Defined by an earlier admin script; the list rows read it.
  (w as unknown as { friendlyPhase: (n: number) => string }).friendlyPhase = (n) => 'Phase ' + n;
  // The page's own script, from the template under test (not untrusted input).
  w.eval(eventsScript(doc));
  const flush = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  };
  await flush();
  expect(w._oseList.byId[ID], 'the list loaded the event').toBeDefined();
  w.renderEventStatus(ID);
  const $ = (id: string) => doc.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const badge = () => $('event-status-badge')!.textContent;
  const rowBadge = () =>
    doc.querySelector(`[data-testid="event-row-${ID}"] [data-testid="event-status"]`)?.textContent;
  const undoTo = () => $('event-status-undo')?.getAttribute('data-to');
  const press = async (to: string) => {
    await w.changeEventStatus(ID, to);
    await flush();
  };
  return { w, server, calls, badge, rowBadge, undoTo, press };
}

describe('a stale status panel', () => {
  test('Archive lands from Ready; Undo goes back to Ready, not to the Draft the panel showed', async () => {
    const t = await mount('draft');
    expect(t.badge()).toBe('Draft');
    t.server.status = 'ready'; // another tab marks it ready
    await t.press('archived');
    expect(t.server.status).toBe('archived');
    expect(t.badge()).toBe('Archived');
    expect(t.undoTo()).toBe('ready');

    t.calls.length = 0;
    await t.press(t.undoTo()!);
    expect(t.server.status).toBe('ready');
    expect(t.badge()).toBe('Ready');
    expect(t.rowBadge()).toBe('Ready');
  });

  test('Undo from Archived to Ready never puts the event live on the way', async () => {
    const t = await mount('ready');
    await t.press('archived');
    expect(t.undoTo()).toBe('ready');
    t.calls.length = 0;
    await t.press('ready');
    expect(t.server.status).toBe('ready');
    expect(t.calls.map((c) => c.body?.status ?? c.path)).toEqual(['draft', 'ready']);
    expect(t.calls.some((c) => c.path.endsWith('/verify-qr'))).toBe(false);
  });

  test('a refused move: the panel and the row catch up to where the server says it is', async () => {
    const t = await mount('draft');
    t.server.status = 'archived'; // archived elsewhere; archived -> ready is not an edge
    await t.press('ready');
    expect(t.server.status).toBe('archived');
    expect(t.badge()).toBe('Archived');
    expect(t.rowBadge()).toBe('Archived');
    expect(t.undoTo()).toBeUndefined();
  });

  test('a panel that was right: Undo still goes back to where it was', async () => {
    const t = await mount('draft');
    await t.press('ready');
    expect(t.undoTo()).toBe('draft');
    await t.press('draft');
    expect(t.server.status).toBe('draft');
    expect(t.badge()).toBe('Draft');
  });
});
