/**
 * CONTRACT — the server-rendered page and the JSON API describe the same events.
 *
 * WHY THIS CONTRACT IS NEW. Before OSE-1243 it was true by construction: the
 * page fetched `GET /api/v2/events` and rendered whatever came back, so there
 * was exactly one description of "which events exist" and nothing to disagree
 * with. Server-rendering created a SECOND read path. Two paths that must agree
 * is the definition of a contract, and an untested one drifts — the JSON adds a
 * field, the page keeps rendering the old shape, and nobody notices because
 * both are individually green.
 *
 * The specific failure this guards is not hypothetical. The first cut of
 * OSE-1243 read the DataProvider directly and skipped `enrichWithPhase`, so the
 * page rendered raw D1 column names while the API emitted canonical ones. Every
 * unit test passed. THIS is the test shape that catches that class: not "does
 * the page render", but "does the page render what the API says".
 */
import { describe, test, expect } from 'vitest';
import { handlePublicPage } from '../src/handlers/pages';
import { handleListEvents } from '../src/handlers/events';

interface ApiEvent {
  id?: string;
  name?: string;
  venue?: string;
  phase?: string;
}

async function apiItems(): Promise<ApiEvent[]> {
  const res = await handleListEvents(new Request('https://t.test/api/v2/events'), {} as never);
  const body = (await res.json()) as { ok: boolean; items: ApiEvent[] };
  expect(body.ok).toBe(true);
  return body.items;
}

async function pageHtml(): Promise<string> {
  return (await handlePublicPage({} as never)).text();
}

function attrs(html: string, attr: string): string[] {
  const re = new RegExp(attr + '="([^"]*)"', 'g');
  return [...html.matchAll(re)].map((m) => m[1]);
}

describe('CONTRACT | public page ↔ GET /api/v2/events', () => {
  test('the page renders one card per event the API returns', async () => {
    const items = await apiItems();
    const html = await pageHtml();
    const cards = (html.match(/data-testid="public-event-card"/g) ?? []).length;
    expect(cards).toBe(items.length);
  });

  test('every event id in the API appears as a card id on the page', async () => {
    const items = await apiItems();
    const ids = attrs(await pageHtml(), 'data-event-id');
    expect(ids.sort()).toEqual(items.map((e) => String(e.id)).sort());
  });

  test('the phase the API computes is the phase the page renders', async () => {
    // This is the assertion that fails when the page skips enrichWithPhase:
    // the API says post_event, the page renders an empty data-phase and offers
    // a registration form for an event that already happened.
    const items = await apiItems();
    const phases = attrs(await pageHtml(), 'data-phase');
    expect(phases.sort()).toEqual(items.map((e) => String(e.phase)).sort());
  });

  test('the canonical name from the API is the name on the card', async () => {
    const items = await apiItems();
    const html = await pageHtml();
    for (const item of items) {
      if (!item.name) continue;
      // Compare escaped, since the page necessarily escapes what the API sends
      // raw. An escaping difference is a real contract difference.
      const escaped = String(item.name)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
      expect(html, `API name not rendered: ${item.name}`).toContain(escaped);
    }
  });

  test('the API emits the canonical field names the renderer reads', async () => {
    // A one-way guard on the enrichment seam itself. If the API ever stopped
    // mapping title→name, the page would render blanks and the tests above
    // would still agree with it — both wrong, consistently.
    const items = await apiItems();
    // The DataProvider falls through to its fixture with an empty env, so there
    // is always at least one item here. An empty list would mean the seam
    // itself broke, which is worth failing on rather than skipping past.
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(Object.keys(item)).toContain('name');
      expect(Object.keys(item)).toContain('startDateISO');
      expect(Object.keys(item)).toContain('venue');
      expect(Object.keys(item)).toContain('phase');
    }
  });

  test('the CTA a card offers matches the phase the API reports', async () => {
    const items = await apiItems();
    const html = await pageHtml();
    for (const item of items) {
      const id = String(item.id);
      const card = html.slice(html.indexOf(`data-event-id="${id}"`));
      const cta = card.slice(0, card.indexOf('</div>', card.indexOf('data-cta=')) + 6);
      if (item.phase === 'post_event') {
        expect(cta, `${id} is post_event but was offered registration`).toContain(
          'data-cta="recap"'
        );
      } else {
        expect(cta, `${id} is ${item.phase} but was offered a recap`).toContain(
          'data-cta="register"'
        );
      }
    }
  });
});
