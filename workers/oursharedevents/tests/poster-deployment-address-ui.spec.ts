/**
 * OSE-1357 (part 1) — admin poster card: ADDRESS is the default field, lat/lon
 * live under an "advanced" disclosure, save geocodes first and never blocks, and
 * each row shows the short link + Copy FIRST, then the QR, then the target —
 * all read from the API response.
 *
 * RUNS the card's real script (extracted from the served admin.html) in jsdom
 * against a stubbed fetch, rather than pattern-matching its source.
 * API half: tests/poster-deployment-address.spec.ts (workers pool).
 *
 * @born-red OSE-1357 | method: spec written before the change and run against
 *   origin/main's admin.html (lat/lon default fields, no geocode call, no short
 *   link / target in the row) — red; green after | date: 2026-09-29
 */

import { describe, test, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import ADMIN_HTML from '../src/templates/admin.html';

const EVT = 'evt_pd_ui_1357';

function cardMarkup(html: string): string {
  const start = html.indexOf('<div class="card poster-deployments-card"');
  const end = html.indexOf('<!-- R4 (OSE-1319)', start);
  expect(start, 'poster card markup').toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

// The card's script, found as a parsed element (jsdom parses without running
// scripts) rather than by searching the raw text for a script tag — string
// slicing around a script tag is what Semgrep's unknown-value-with-script-tag
// rule flags, and a parser is the more honest extraction anyway.
function cardScript(html: string): string {
  const doc = new JSDOM(html).window.document;
  const el = Array.from(doc.querySelectorAll('script')).find((s) =>
    (s.textContent || '').includes('window.loadPosterDeployments = async function')
  );
  expect(el, 'poster card script').toBeDefined();
  return el!.textContent || '';
}

type Reply = { status?: number; body?: unknown; reject?: boolean };
type Router = (url: string, init?: RequestInit) => Reply;

function mount(router: Router) {
  const dom = new JSDOM(`<!doctype html><body>${cardMarkup(ADMIN_HTML)}</body>`, {
    runScripts: 'outside-only',
    url: 'https://admin.test/admin',
  });
  const w = dom.window as unknown as Window &
    Record<string, unknown> & { eval(s: string): unknown };
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  w.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const r = router(url, init);
    if (r.reject) throw new TypeError('network down');
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body };
  }) as unknown as typeof fetch;
  w._adminAnnounce = () => {};
  const writeText = vi.fn(async () => {});
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText }, configurable: true });
  w.eval(cardScript(ADMIN_HTML));
  return { w, doc: w.document, calls, writeText };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

const ITEM = {
  id: 'pd_1',
  qr_token: 'qrt_abc',
  placement_label: 'Front door',
  location_desc: 'By the bocce courts',
  address: '12 Red Arrow Hwy, Sawyer, MI 49125, USA',
  h3_res9: '89266454447ffff',
  is_active: 1,
  scan_url: 'https://oursharedevents.com/q/qrt_abc',
  qr_data_uri: 'data:image/png;base64,iVBORw0KGgo=',
  target_url: 'https://oursharedevents.com/events/evt_x?type=register&deployment=pd_1',
  target_label: 'Event page',
  slots: [],
};

const listReply = (items: unknown[], event_address: string | null = null): Reply => ({
  body: { ok: true, items, event_address },
});

function fill(doc: Document, id: string, value: string) {
  (doc.getElementById(id) as HTMLInputElement).value = value;
}

async function submit(w: Window, doc: Document) {
  const form = doc.getElementById('pd-create-form') as HTMLFormElement;
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
}

describe('OSE-1357 | the form asks for an address; coordinates are advanced', () => {
  test('address is a default field; lat/lon sit inside a closed "advanced" disclosure', () => {
    const { doc } = mount(() => listReply([]));
    const address = doc.querySelector('[data-testid="pd-address"]') as HTMLInputElement;
    expect(address).not.toBeNull();
    expect(address.closest('details')).toBeNull();
    const adv = doc.querySelector('details[data-testid="pd-advanced"]') as HTMLDetailsElement;
    expect(adv).not.toBeNull();
    expect(adv.open).toBe(false);
    expect(adv.querySelector('[data-testid="pd-latitude"]')).not.toBeNull();
    expect(adv.querySelector('[data-testid="pd-longitude"]')).not.toBeNull();
    // The address label is programmatically tied to its input.
    expect(doc.querySelector('label[for="pd-address"]')).not.toBeNull();
  });

  test('no hardcoded city: the placeholders carry no Chicago coordinates or city', () => {
    const card = cardMarkup(ADMIN_HTML);
    expect(card).not.toMatch(/41\.8781|-87\.6298|Chicago/i);
  });

  test('the address placeholder comes from the event venue/address in the response', async () => {
    const { w, doc } = mount(() => listReply([], 'Harbor Country Park, Sawyer, MI'));
    await (w.loadPosterDeployments as (id: string) => Promise<void>)(EVT);
    const address = doc.getElementById('pd-address') as HTMLInputElement;
    expect(address.placeholder).toContain('Harbor Country Park, Sawyer, MI');
  });
});

describe('OSE-1357 | save geocodes the address, then creates with the returned coords', () => {
  test('geocode first, then create with its lat/lng + formatted address', async () => {
    const { w, doc, calls } = mount((url) => {
      if (url.endsWith('/api/v2/admin/geocode'))
        return {
          body: {
            ok: true,
            lat: 41.8837,
            lng: -86.5925,
            formatted_address: '12 Red Arrow Hwy, Sawyer, MI 49125, USA',
            corridor_id: null,
          },
        };
      return url.endsWith('/poster-deployments') ? { status: 201, body: { ok: true } } : {};
    });
    w._pdEventId = EVT;
    fill(doc, 'pd-placement-label', 'Front door');
    fill(doc, 'pd-address', '12 red arrow hwy sawyer');
    await submit(w, doc);

    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts.map((c) => c.url)).toEqual([
      '/api/v2/admin/geocode',
      `/api/v2/admin/events/${EVT}/poster-deployments`,
    ]);
    expect(posts[0].body).toEqual({ address: '12 red arrow hwy sawyer' });
    expect(posts[1].body).toMatchObject({
      placement_label: 'Front door',
      latitude: 41.8837,
      longitude: -86.5925,
      address: '12 Red Arrow Hwy, Sawyer, MI 49125, USA',
    });
  });

  for (const [name, reply] of [
    ['503 GEO_NOT_CONFIGURED', { status: 503, body: { ok: false, code: 'GEO_NOT_CONFIGURED' } }],
    ['no results', { status: 404, body: { ok: false, code: 'GEO_NO_RESULTS' } }],
    ['network failure', { reject: true }],
  ] as Array<[string, Reply]>) {
    test(`geocode ${name}: still saves, without coordinates, and says so`, async () => {
      const { w, doc, calls } = mount((url) =>
        url.endsWith('/api/v2/admin/geocode')
          ? reply
          : url.endsWith('/poster-deployments')
            ? { status: 201, body: { ok: true } }
            : {}
      );
      w._pdEventId = EVT;
      fill(doc, 'pd-placement-label', 'Library board');
      fill(doc, 'pd-address', 'Sawyer library');
      await submit(w, doc);

      const create = calls.find(
        (c) => c.method === 'POST' && c.url.endsWith('/poster-deployments')
      );
      expect(create, 'the organizer is never blocked').toBeDefined();
      expect(create!.body).toEqual({ placement_label: 'Library board', address: 'Sawyer library' });
      const geoMsg = doc.querySelector('[data-testid="pd-geo-msg"]')!.textContent ?? '';
      expect(geoMsg).toMatch(/saved without a map location/i);
      if (name.startsWith('503')) expect(geoMsg).toMatch(/isn.t set up/i);
      expect(doc.querySelector('[data-testid="pd-create-msg"]')!.textContent).toMatch(/created/i);
    });
  }

  test('advanced lat/lon, when filled, are used as-is (no geocode call)', async () => {
    const { w, doc, calls } = mount((url) =>
      url.endsWith('/poster-deployments') ? { status: 201, body: { ok: true } } : {}
    );
    w._pdEventId = EVT;
    fill(doc, 'pd-placement-label', 'Exact spot');
    fill(doc, 'pd-address', 'Somewhere');
    fill(doc, 'pd-latitude', '41.6571');
    fill(doc, 'pd-longitude', '-87.6798');
    await submit(w, doc);
    expect(calls.some((c) => c.url.endsWith('/geocode'))).toBe(false);
    const create = calls.find((c) => c.method === 'POST')!;
    expect(create.body).toMatchObject({
      latitude: 41.6571,
      longitude: -87.6798,
      address: 'Somewhere',
    });
  });
});

describe('OSE-1357 | each row: short link + Copy first, then QR, then target', () => {
  function rowOf(doc: Document): Element {
    const row = doc.querySelector('[data-testid="poster-deployment-row"]');
    expect(row).not.toBeNull();
    return row!;
  }
  const at = (row: Element, testid: string): Element => {
    const el = row.querySelector(`[data-testid="${testid}"]`);
    expect(el, testid).not.toBeNull();
    return el!;
  };
  const before = (a: Element, b: Element) =>
    !!(a.compareDocumentPosition(b) & 4 /* DOCUMENT_POSITION_FOLLOWING */);

  test('order and values come straight from the response', async () => {
    const { w, doc } = mount(() => listReply([ITEM]));
    await (w.loadPosterDeployments as (id: string) => Promise<void>)(EVT);
    const row = rowOf(doc);

    expect(at(row, 'pd-label').textContent).toBe('Front door');
    expect(at(row, 'pd-address').textContent).toBe(ITEM.address);
    const link = at(row, 'pd-short-link');
    const copy = at(row, 'pd-copy-link');
    const qr = at(row, 'pd-qr-img') as HTMLImageElement;
    const target = at(row, 'pd-target');
    expect(link.textContent).toBe(ITEM.scan_url);
    expect(qr.getAttribute('src')).toBe(ITEM.qr_data_uri);
    expect(target.textContent).toContain(ITEM.target_label);
    expect(target.textContent).toContain(ITEM.target_url);
    expect(before(link, copy)).toBe(true);
    expect(before(copy, qr)).toBe(true);
    expect(before(qr, target)).toBe(true);
    // The short link leads the card body.
    const body = row.querySelector('.qr-card-body')!;
    expect(body.firstElementChild!.contains(link)).toBe(true);
  });

  test('Copy copies the response short link', async () => {
    const { w, doc, writeText } = mount(() => listReply([ITEM]));
    await (w.loadPosterDeployments as (id: string) => Promise<void>)(EVT);
    (at(rowOf(doc), 'pd-copy-link') as HTMLButtonElement).click();
    await flush();
    expect(writeText).toHaveBeenCalledWith(ITEM.scan_url);
  });

  test('hostile response strings stay text; a non-data:image QR is never loaded', async () => {
    const evil = {
      ...ITEM,
      placement_label: '<img src=x onerror="window.__pwned=1">',
      address: '"><script>window.__pwned=1</script>',
      scan_url: 'javascript:window.__pwned=1',
      target_url: 'javascript:window.__pwned=1',
      qr_data_uri: 'https://evil.test/qr.png',
    };
    const { w, doc } = mount(() => listReply([evil]));
    await (w.loadPosterDeployments as (id: string) => Promise<void>)(EVT);
    const row = rowOf(doc);
    expect(row.querySelector('script')).toBeNull();
    expect(row.querySelector('img[src="x"]')).toBeNull();
    expect(row.querySelector('[data-testid="pd-qr-img"]')).toBeNull();
    expect(row.querySelector('[data-testid="pd-qr-fallback"]')).not.toBeNull();
    for (const el of Array.from(row.querySelectorAll('[href],[src]'))) {
      expect(el.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
      expect(el.getAttribute('src') ?? '').not.toMatch(/^(javascript:|https?:)/i);
    }
    expect(at(row, 'pd-label').textContent).toBe(evil.placement_label);
    expect((w as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
});
