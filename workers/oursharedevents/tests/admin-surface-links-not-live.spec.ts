/**
 * The admin Links cards never send the organizer to a "not open" page.
 *
 * Owner report 2026-10-10: on a draft event, the event page and poster links
 * in admin opened the public 404 ("We couldn't find that event"). That is
 * right for guests: a draft's pages answer the same as a missing event. For
 * the organizer it looked broken. Until the event is live, Open goes to the
 * admin preview of the same page, a note says why, and Copy keeps the real
 * links, which start working on publish. A status change re-checks the cards.
 *
 * Runs the cards' real script from the admin.html Text import in jsdom.
 *
 * @born-red 2026-10-10 | method: on main's template a draft's Open Public Page
 * pointed at /events/<id> and there was no note
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import ADMIN_HTML from '../src/templates/admin.html';

function mount(byId: Record<string, { status: string }>) {
  const dom = new JSDOM(ADMIN_HTML, {
    runScripts: 'outside-only',
    url: 'https://admin.test/admin',
  });
  const w = dom.window as unknown as Window & {
    eval(s: string): unknown;
    _oseList: { byId: Record<string, { status: string }> };
    scopeSurfaceCards(id: string, name: string): void;
    refreshSurfaceLinks(id: string): void;
  };
  const doc = w.document;
  const script = Array.from(doc.querySelectorAll('script')).find((s) =>
    (s.textContent || '').includes('window.scopeSurfaceCards = function')
  );
  expect(script, 'the surface cards script').toBeDefined();
  // The short-link mint is not under test: it never answers here.
  (w as unknown as { fetch: () => Promise<never> }).fetch = () => new Promise<never>(() => {});
  w.eval(script!.textContent || '');
  w._oseList = { byId };
  const $ = (id: string) => doc.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
  return { w, $ };
}

describe('admin Links cards for an event that is not live', () => {
  test.each(['draft', 'ready'])('%s: Open goes to the preview, and a note says why', (status) => {
    const { w, $ } = mount({ evt_1: { status } });
    w.scopeSurfaceCards('evt_1', 'Bears, Big Screens');
    expect($('link-public').getAttribute('href')).toBe('/api/v2/admin/events/evt_1/preview');
    expect($('link-public').textContent).toBe('Preview Page');
    expect($('link-poster').getAttribute('href')).toBe('/api/v2/admin/events/evt_1/poster-preview');
    expect($('link-poster').textContent).toBe('Preview Poster');
    expect(($('surface-cards-not-live') as HTMLParagraphElement).hidden).toBe(false);
    expect($('surface-cards-not-live').textContent).toMatch(/start working when you publish/);
  });

  test('live: Open goes to the real pages, with their own labels, and no note', () => {
    const { w, $ } = mount({ evt_1: { status: 'active' } });
    w.scopeSurfaceCards('evt_1', 'Bears, Big Screens');
    expect($('link-public').getAttribute('href')).toBe('/events/evt_1');
    expect($('link-public').textContent).toBe('Open Public Page');
    expect($('link-poster').getAttribute('href')).toBe('/events/evt_1/poster');
    expect(($('surface-cards-not-live') as HTMLParagraphElement).hidden).toBe(true);
  });

  test('publishing, then taking it back to draft, switches the cards each time', () => {
    const list = { evt_1: { status: 'draft' } };
    const { w, $ } = mount(list);
    w.scopeSurfaceCards('evt_1', 'Bears, Big Screens');
    list.evt_1.status = 'active';
    w.refreshSurfaceLinks('evt_1');
    expect($('link-public').getAttribute('href')).toBe('/events/evt_1');
    expect($('link-public').textContent).toBe('Open Public Page');
    list.evt_1.status = 'draft';
    w.refreshSurfaceLinks('evt_1');
    expect($('link-public').getAttribute('href')).toBe('/api/v2/admin/events/evt_1/preview');
    expect(($('surface-cards-not-live') as HTMLParagraphElement).hidden).toBe(false);
  });

  test('the TV and report cards keep their own addresses', () => {
    const { w, $ } = mount({ evt_1: { status: 'draft' } });
    w.scopeSurfaceCards('evt_1', 'x');
    expect($('link-display').getAttribute('href')).toBe('/events/evt_1/tv');
    expect($('link-report').getAttribute('href')).toBe('/sharedReport?event=evt_1');
  });

  test('a status change from the status panel re-checks the cards', () => {
    const at = ADMIN_HTML.indexOf('window.changeEventStatus = async function');
    expect(at).toBeGreaterThan(0);
    const body = ADMIN_HTML.slice(at, ADMIN_HTML.indexOf('\n      };', at));
    expect(body).toContain('window.refreshSurfaceLinks(id)');
  });
});
