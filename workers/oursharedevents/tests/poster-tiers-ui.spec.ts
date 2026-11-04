/**
 * OSE-1357 poster tiers (PO, 2026-09-30) — UI half (node + jsdom). Each screen's
 * REAL script (from the served templates) runs against a stubbed fetch.
 * API half: tests/poster-tiers.spec.ts (workers pool).
 *
 *   Tier 1 — the REGISTER and SPONSOR codes show one big word + an icon in the
 *            admin "Codes on the poster" editor and on /poster, print + digital.
 *   Tier 2 — the add-placement form starts with a two-choice control (At the
 *            event venue / Out in the community) that swaps the right fields;
 *            each placement row shows where it hangs and its exact scan count.
 *   Tier 3 — the "Before the event" card's Reach section: link taps per code,
 *            then venue areas, then community places — text only.
 *
 * @born-red poster tiers | method: spec written before the change and run
 *   against origin/main's templates (edb9406: no placement-type control, no
 *   per-row scans, no Reach section, no REGISTER/SPONSOR icons) with the change
 *   set aside in a tagged stash — red; green after | date: 2026-09-30
 */

import { describe, test, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { getCode } from '../src/lib/uec';
import ADMIN_HTML from '../src/templates/admin.html';
import POSTER_HTML from '../src/templates/poster.html';

// A code's UEC as the server sends it, read from the registry.
const UEC = (id: string) => {
  const c = getCode(id)!;
  return { id: c.id, color: c.label, scan_hex: c.scan_hex };
};
const EVT = 'evt_tiers_ui_0930';
const QR = 'data:image/png;base64,iVBORw0KGgo=';
const HOSTILE = '"><img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';

type Reply = { status?: number; body?: unknown };
type Router = (url: string, init?: RequestInit) => Reply;
type Win = Window & Record<string, unknown> & { eval(s: string): unknown };

function stubFetch(w: Win, router: Router) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  w.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const r = router(url, init);
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body };
  }) as unknown as typeof fetch;
  return calls;
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

// Scripts are found as parsed elements (jsdom parses without running them) —
// never by slicing raw text around a script tag.
function scriptContaining(html: string, needle: string): string {
  const doc = new JSDOM(html).window.document;
  const el = Array.from(doc.querySelectorAll('script')).find((s) =>
    (s.textContent || '').includes(needle)
  );
  expect(el, needle).toBeDefined();
  return el!.textContent || '';
}

function posterCardMarkup(): string {
  const start = ADMIN_HTML.indexOf('<div class="card poster-deployments-card"');
  const end = ADMIN_HTML.indexOf('<!-- R4 (OSE-1319)', start);
  expect(start).toBeGreaterThan(-1);
  return ADMIN_HTML.slice(start, end);
}

function mountAdmin(router: Router, needle: string) {
  const dom = new JSDOM(`<!doctype html><body>${posterCardMarkup()}</body>`, {
    runScripts: 'outside-only',
    url: 'https://ose.test/admin',
  });
  const w = dom.window as unknown as Win;
  const calls = stubFetch(w, router);
  w._adminAnnounce = () => {};
  Object.defineProperty(w.navigator, 'clipboard', {
    value: { writeText: vi.fn(async () => {}) },
    configurable: true,
  });
  w.eval(scriptContaining(ADMIN_HTML, needle));
  return { w, doc: w.document, calls };
}

// ── Tier 1 ───────────────────────────────────────────────────────────────────

const KINDS = [
  {
    kind: 'checkin',
    word: 'CHECK IN',
    choice: 'Anonymous check-in',
    uec: UEC('CHECK-IN'),
    needs_url: false,
  },
  {
    kind: 'register',
    word: 'REGISTER',
    choice: 'Registration form',
    uec: UEC('ENTER'),
    needs_url: false,
  },
  {
    kind: 'sponsor',
    word: 'SPONSOR',
    choice: 'Sponsorship link',
    uec: UEC('SPONSOR'),
    needs_url: true,
  },
  {
    kind: 'workshop',
    word: 'REGISTER',
    choice: 'External registration link',
    uec: UEC('ENTER'),
    needs_url: true,
  },
];
const CODES = [
  { kind: 'public', word: 'EVENT', code: 'Pub001', qr: QR, target_url: null, points_to: '' },
  { kind: 'register', word: 'REGISTER', code: 'Reg001', qr: QR, target_url: null, points_to: '' },
  {
    kind: 'sponsor',
    word: 'SPONSOR',
    code: 'Spo001',
    qr: QR,
    target_url: 'https://harbor.example.org/sponsor',
    points_to: 'https://harbor.example.org/sponsor',
  },
];

describe('Tier 1 | admin: REGISTER and SPONSOR codes carry a word + an icon', () => {
  test('each has its own icon (never the generic arrow), its UEC, and the word', async () => {
    const { w, doc } = mountAdmin(
      () => ({ body: { ok: true, limit: 5, kinds: KINDS, codes: CODES } }),
      'window.loadPosterCodes = async function'
    );
    await (w.loadPosterCodes as (id: string) => Promise<void>)(EVT);
    await flush();
    const row = (k: string) =>
      doc.querySelector(`[data-testid="poster-code-row"][data-kind="${k}"]`)!;
    const icons = new Set<string>();
    for (const [k, word] of [
      ['register', 'REGISTER'],
      ['sponsor', 'SPONSOR'],
    ]) {
      expect(row(k).querySelector('.pc-word-text')!.textContent).toBe(word);
      const icon = row(k).querySelector('.pc-icon')!.textContent!;
      expect(icon).not.toBe('→');
      expect(icon.length).toBeGreaterThan(0);
      icons.add(icon);
      expect(row(k).getAttribute('data-uec')).toBe(k === 'register' ? 'ENTER' : 'SPONSOR');
      expect((row(k) as HTMLElement).style.borderLeftColor).not.toBe('');
    }
    expect(icons.size).toBe(2);
    // REGISTER (the event's own form) needs no link; SPONSOR does.
    expect((row('register').querySelector('[data-role="target"]') as HTMLElement).hidden).toBe(
      true
    );
    expect((row('sponsor').querySelector('[data-role="target"]') as HTMLElement).hidden).toBe(
      false
    );
    // The picker tells the two registration choices apart.
    const opts = Array.from(row('sponsor').querySelectorAll('option')).map((o) => o.textContent);
    expect(opts).toContain('Registration form (REGISTER)');
    expect(opts).toContain('External registration link (REGISTER)');
  });

  test('a hostile kind from the response is never an object key into the icon map', async () => {
    const { w, doc } = mountAdmin(
      () => ({
        body: {
          ok: true,
          limit: 5,
          kinds: KINDS,
          codes: [CODES[0], { ...CODES[2], kind: '__proto__' }],
        },
      }),
      'window.loadPosterCodes = async function'
    );
    await (w.loadPosterCodes as (id: string) => Promise<void>)(EVT);
    await flush();
    const icons = Array.from(doc.querySelectorAll('.pc-icon')).map((e) => e.textContent);
    expect(icons[1]).toBe('→');
  });
});

function posterBody(): string {
  const doc = new JSDOM(POSTER_HTML).window.document;
  doc.querySelectorAll('script').forEach((s) => s.remove());
  return doc.body.innerHTML;
}

async function mountPoster(kind: 'print' | 'digital', slots: unknown[]) {
  const dom = new JSDOM(`<!doctype html><body>${posterBody()}</body>`, {
    runScripts: 'outside-only',
    url: `https://ose.test/poster?event=${EVT}&kind=${kind}`,
  });
  const w = dom.window as unknown as Win;
  stubFetch(w, (url) => {
    if (url === '/api/v2/events') {
      return { body: { ok: true, items: [{ id: EVT, name: 'Harbor County Bocce' }] } };
    }
    // OSE-867: a scoped poster is one poster-bundle call carrying the event.
    if (url.includes('/poster-bundle')) {
      return {
        body: { ok: true, event: { id: EVT, name: 'Harbor County Bocce' }, sponsors: [], slots },
      };
    }
    return { body: { ok: false } };
  });
  w.eval(scriptContaining(POSTER_HTML, 'async function loadPosterBundle'));
  await flush();
  return w.document;
}

const SLOTS = [
  { kind: 'public', word: 'EVENT', code: 'Pub001', url: 'x', qr: QR },
  {
    kind: 'register',
    word: 'REGISTER',
    uec: UEC('ENTER'),
    label: 'Register',
    code: 'Reg001',
    url: 'x',
    qr: QR,
  },
  {
    kind: 'sponsor',
    word: 'SPONSOR',
    uec: UEC('SPONSOR'),
    label: 'Sponsor us',
    code: 'Spo001',
    url: 'x',
    qr: QR,
  },
];

describe('Tier 1 | /poster: REGISTER and SPONSOR print + digital with word and icon', () => {
  for (const kind of ['print', 'digital'] as const) {
    test(`${kind}: word + a distinct icon, its UEC, link rebuilt from the code`, async () => {
      const doc = await mountPoster(kind, SLOTS);
      const iconOf = (k: string) =>
        doc.querySelector(`[data-testid="poster-qr-slot-label-${k}"] [aria-hidden="true"]`)!
          .textContent;
      for (const [k, word, code] of [
        ['register', 'REGISTER', 'Reg001'],
        ['sponsor', 'SPONSOR', 'Spo001'],
      ]) {
        const card = doc.querySelector(`[data-testid="poster-qr-slot-${k}"]`)!;
        expect(card.getAttribute('data-uec')).toBe(k === 'register' ? 'ENTER' : 'SPONSOR');
        expect((card as HTMLElement).style.borderTopColor).not.toBe('');
        expect(
          doc.querySelector(`[data-testid="poster-qr-slot-label-${k}"]`)!.textContent
        ).toContain(word);
        expect(iconOf(k)).not.toBe('→');
        expect(doc.querySelector(`[data-testid="qr-slot-code-${k}"]`)!.textContent).toBe(
          `https://ose.test/s/${code}`
        );
      }
      expect(iconOf('register')).not.toBe(iconOf('sponsor'));
      expect(doc.querySelectorAll('#poster-qr-slots img').length).toBe(kind === 'print' ? 3 : 0);
    });
  }
});

// ── Tier 2 ───────────────────────────────────────────────────────────────────

const PD_SCRIPT = 'window.loadPosterDeployments = async function';
const EVENT_ADDRESS = 'Harbor Country Park, Sawyer, MI';

function listReply(items: unknown[]): Reply {
  return { body: { ok: true, items, event_address: EVENT_ADDRESS } };
}
const ITEM = (extra: Record<string, unknown>) => ({
  id: 'pd_1',
  qr_token: 'qrt_abc',
  placement_label: 'Front door',
  location_desc: null,
  address: EVENT_ADDRESS,
  placement_type: 'venue',
  scans: fc(23),
  h3_res9: '89266454447ffff',
  is_active: 1,
  scan_url: 'https://ose.test/q/qrt_abc',
  qr_data_uri: QR,
  target_url: 'https://ose.test/events/x',
  target_label: 'Event page',
  slots: [],
  ...extra,
});

async function submit(w: Win) {
  const form = w.document.getElementById('pd-create-form') as HTMLFormElement;
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
}
function choose(w: Win, which: 'venue' | 'community') {
  const r = w.document.getElementById(`pd-type-${which}`) as HTMLInputElement;
  r.checked = true;
  r.dispatchEvent(new w.Event('change', { bubbles: true }));
}

describe('Tier 2 | add placement: At the event venue / Out in the community', () => {
  test('the two-choice control leads the form; community is the default; each choice is a 44px labelled target', () => {
    const { doc } = mountAdmin(() => listReply([]), PD_SCRIPT);
    const group = doc.querySelector('[data-testid="pd-placement-type"]')!;
    expect(group.getAttribute('role')).toBe('radiogroup');
    const form = doc.getElementById('pd-create-form')!;
    const label = doc.getElementById('pd-placement-label')!;
    expect(group.compareDocumentPosition(label) & 4, 'choice precedes the fields').toBe(4);
    expect(form.contains(group)).toBe(true);
    const venue = doc.getElementById('pd-type-venue') as HTMLInputElement;
    const community = doc.getElementById('pd-type-community') as HTMLInputElement;
    expect(venue.type).toBe('radio');
    expect(community.checked).toBe(true);
    for (const r of [venue, community]) {
      const wrap = r.closest('label')!;
      expect(wrap.classList.contains('events-filter-mine')).toBe(true); // min-height: 44px
      expect(wrap.textContent!.trim().length).toBeGreaterThan(0);
    }
    expect(ADMIN_HTML).toMatch(/\.events-filter-mine \{[^}]*min-height: 44px/);
  });

  test('venue: the address field hides and the event’s own address is shown instead; labels speak of an area', async () => {
    const { w, doc } = mountAdmin(() => listReply([]), PD_SCRIPT);
    await (w.loadPosterDeployments as (id: string) => Promise<void>)(EVT);
    choose(w, 'venue');
    expect((doc.getElementById('pd-address-field') as HTMLElement).hidden).toBe(true);
    const hint = doc.getElementById('pd-venue-hint') as HTMLElement;
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toContain(EVENT_ADDRESS);
    expect(doc.getElementById('pd-label-text')!.textContent).toBe('Area of the venue');
    expect((doc.getElementById('pd-placement-label') as HTMLInputElement).placeholder).toMatch(
      /Front door/
    );
    choose(w, 'community');
    expect((doc.getElementById('pd-address-field') as HTMLElement).hidden).toBe(false);
    expect(hint.hidden).toBe(true);
    expect(doc.getElementById('pd-label-text')!.textContent).toBe('Place name');
  });

  test('venue save: one POST with placement_type venue — no geocode, no typed address; the choice stays for the next area', async () => {
    const { w, doc, calls } = mountAdmin((url) => {
      if (url.endsWith('/poster-deployments')) return listReply([]);
      return { status: 404, body: { ok: false } };
    }, PD_SCRIPT);
    w._pdEventId = EVT;
    choose(w, 'venue');
    (doc.getElementById('pd-placement-label') as HTMLInputElement).value = 'Bar';
    (doc.getElementById('pd-address') as HTMLInputElement).value = 'somewhere stale';
    await submit(w);
    expect(calls.some((c) => c.url.endsWith('/geocode'))).toBe(false);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe(`/api/v2/admin/events/${EVT}/poster-deployments`);
    expect(post.body).toEqual({ placement_label: 'Bar', placement_type: 'venue' });
    expect((doc.getElementById('pd-type-venue') as HTMLInputElement).checked).toBe(true);
    expect((doc.getElementById('pd-address-field') as HTMLElement).hidden).toBe(true);
  });

  test('community save keeps the address + geocode path and sends no placement_type (server default)', async () => {
    const { w, doc, calls } = mountAdmin((url) => {
      if (url.endsWith('/geocode')) {
        return { body: { ok: true, lat: 41.88, lng: -86.6, formatted_address: '100 Library Ln' } };
      }
      return listReply([]);
    }, PD_SCRIPT);
    w._pdEventId = EVT;
    (doc.getElementById('pd-placement-label') as HTMLInputElement).value = 'Harbor Library';
    (doc.getElementById('pd-address') as HTMLInputElement).value = '100 library ln';
    await submit(w);
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/poster-deployments'))!;
    expect(post.body).toEqual({
      placement_label: 'Harbor Library',
      address: '100 Library Ln',
      latitude: 41.88,
      longitude: -86.6,
    });
  });
});

// OSE-1656: a row's scans arrive floored (the poster's hours with 5 or more).
describe('Tier 2 | each placement row: where it hangs + its floored scans', () => {
  test('venue and community rows say where, and how many scans; under the floor in words', async () => {
    const { w, doc } = mountAdmin(
      () =>
        listReply([
          ITEM({}),
          ITEM({
            id: 'pd_2',
            qr_token: 'qrt_2',
            placement_label: 'Harbor Library',
            placement_type: 'community',
            scans: fc(1),
          }),
        ]),
      PD_SCRIPT
    );
    await (w.loadPosterDeployments as (id: string) => Promise<void>)(EVT);
    const rows = Array.from(doc.querySelectorAll('[data-testid="poster-deployment-row"]'));
    const at = (r: Element, id: string) => r.querySelector(`[data-testid="${id}"]`)!.textContent;
    expect(at(rows[0], 'pd-placement-kind')).toBe('At the venue');
    expect(at(rows[0], 'pd-scans')).toBe('23 scans');
    expect(at(rows[1], 'pd-placement-kind')).toBe('In the community');
    expect(at(rows[1], 'pd-scans')).toBe('Fewer than 5 scans in any hour');
  });

  test('hostile label / description / scans stay text', async () => {
    const { w, doc } = mountAdmin(
      () => listReply([ITEM({ placement_label: HOSTILE, location_desc: HOSTILE, scans: HOSTILE })]),
      PD_SCRIPT
    );
    await (w.loadPosterDeployments as (id: string) => Promise<void>)(EVT);
    await flush();
    expect(w.__pwned).toBeUndefined();
    const panel = doc.getElementById('pd-panel')!;
    expect(panel.querySelector('script')).toBeNull();
    expect(panel.querySelector('img[onerror]')).toBeNull();
    expect(panel.querySelector('[data-testid="pd-label"]')!.textContent).toBe(HOSTILE);
    expect(panel.querySelector('[data-testid="pd-location"]')!.textContent).toBe(HOSTILE);
    expect(panel.querySelector('[data-testid="pd-scans"]')!.textContent).toBe(
      'Fewer than 5 scans in any hour'
    );
  });
});

// ── Tier 3 ───────────────────────────────────────────────────────────────────

/** The Reach renderer, as served: from its assignment to its own closing line. */
function reachFn(): string {
  const start = ADMIN_HTML.indexOf('window.renderPreEventReach = function');
  expect(start).toBeGreaterThan(-1);
  const rest = ADMIN_HTML.slice(start);
  const end = rest.search(/\r?\n {6}\};\r?\n/);
  expect(end).toBeGreaterThan(-1);
  return rest.slice(0, end) + '\n};';
}
function preEventCardMarkup(): string {
  const doc = new JSDOM(ADMIN_HTML).window.document;
  doc.querySelectorAll('script').forEach((s) => s.remove());
  return doc.getElementById('pre-event-card')!.outerHTML;
}
function mountReach() {
  const dom = new JSDOM(`<!doctype html><body>${preEventCardMarkup()}</body>`, {
    runScripts: 'outside-only',
  });
  const w = dom.window as unknown as Win;
  w.eval(reachFn());
  const render = (r: unknown, plan?: unknown) =>
    (w.renderPreEventReach as (r: unknown, plan?: unknown) => void)(r, plan);
  const line = (id: string) => w.document.querySelector(`[data-testid="${id}"]`)!.textContent;
  return { w, doc: w.document, render, line };
}

/** A FlooredCount as the server sends it (K=5). */
const fc = (n: number) =>
  n >= 5 ? { count: n, suppressed: false, floor: 5 } : { count: null, suppressed: true, floor: 5 };

// Scans arrive floored too (OSE-1656): the café's 4 never joins its group.
const REACH = {
  venue: {
    scans: fc(34),
    places: 1,
    placements: [
      { id: 'a', label: 'Front door', scans: fc(23) },
      { id: 'b', label: 'Bar', scans: fc(11) },
    ],
  },
  community: {
    scans: fc(9),
    places: 2,
    placements: [
      { id: 'c', label: 'Harbor Library', scans: fc(9) },
      { id: 'd', label: 'Café', scans: fc(4) },
    ],
  },
  // Taps arrive FLOORED from the server (lib/poster-reach.ts floorTaps).
  taps: {
    total: fc(53),
    codes: [
      { kind: 'public', word: 'EVENT', taps: fc(40) },
      { kind: 'donation', word: 'DONATE', taps: fc(6) },
    ],
    other: { codes: 2, taps: fc(7) },
  },
  totals: { scans: fc(43), taps: fc(53) },
};

describe('Tier 3 | the "Before the event" card: a compact Reach section', () => {
  test('lives in the pre-event card, after the stats and the scans chart', () => {
    const card = new JSDOM(preEventCardMarkup()).window.document;
    const reach = card.querySelector('[data-testid="pre-event-reach"]')!;
    expect(reach).not.toBeNull();
    const spark = card.querySelector('[data-testid="pre-event-spark"]')!;
    expect(spark.compareDocumentPosition(reach) & 4).toBe(4);
    expect(reach.getAttribute('aria-labelledby')).toBe('pre-event-reach-title');
    expect(card.getElementById('pre-event-reach-title')!.textContent).toBe(
      'Taps and scans, by place'
    );
  });

  test('link first: taps per code, then venue areas, then community places — in that order', () => {
    const { doc, render, line } = mountReach();
    render(REACH);
    const box = doc.getElementById('pre-event-reach')!;
    expect(box.hidden).toBe(false);
    const order = Array.from(box.querySelectorAll('p')).map((p) => p.getAttribute('data-testid'));
    expect(order).toEqual([
      'pre-event-reach-taps',
      'pre-event-reach-venue',
      'pre-event-reach-community',
    ]);
    expect(line('pre-event-reach-taps')).toBe('Link taps: EVENT 40 · DONATE 6 · other links 7');
    expect(line('pre-event-reach-venue')).toBe('At the venue: Front door 23 · Bar 11');
    expect(line('pre-event-reach-community')).toBe(
      'In the community: Harbor Library 9 · Café fewer than 5'
    );
  });

  test('empty groups say so; a long list is capped with "N more"; no reach → hidden', () => {
    const { doc, render, line } = mountReach();
    const many = Array.from({ length: 8 }, (_, i) => ({
      label: `Spot ${i + 1}`,
      scans: fc(8 - i),
    }));
    render({
      venue: { placements: [] },
      community: { placements: many },
      taps: { codes: [], other: { codes: 2, taps: fc(3) }, total: fc(3) },
    });
    expect(line('pre-event-reach-venue')).toBe('At the venue: no posters placed yet');
    // Under the floor is week one of a healthy campaign, not an error (§10.1).
    // "On any one link": the withheld state is per link, not a claim about
    // how many taps there are in all.
    expect(line('pre-event-reach-taps')).toBe(
      'Link taps: fewer than 5 on any one link so far (a link shows here at 5 or more)'
    );
    const box = doc.getElementById('pre-event-reach')!;
    expect(box.querySelector('.error, .card-error, [role="alert"]')).toBeNull();
    expect(line('pre-event-reach-community')).toMatch(
      /Spot 1 8 · .* · Spot 4 5 · Spot 5 fewer than 5 · Spot 6 fewer than 5 · 2 more$/
    );
    render(null);
    expect((doc.getElementById('pre-event-reach') as HTMLElement).hidden).toBe(true);
  });

  test('hostile labels and words stay text; anything but a floored count reads "fewer than 5", never a number', () => {
    const { w, doc, render, line } = mountReach();
    render({
      venue: { placements: [{ label: HOSTILE, scans: '<b>9</b>' }] },
      community: { placements: [{ label: 'Café', scans: -3 }] },
      taps: { codes: [{ word: HOSTILE, taps: fc(9) }] },
    });
    expect(w.__pwned).toBeUndefined();
    const box = doc.getElementById('pre-event-reach')!;
    expect(box.querySelector('script, img')).toBeNull();
    expect(line('pre-event-reach-venue')).toBe(`At the venue: ${HOSTILE} fewer than 5`);
    expect(line('pre-event-reach-community')).toBe('In the community: Café fewer than 5');
    expect(line('pre-event-reach-taps')).toBe(`Link taps: ${HOSTILE} 9`);
  });

  test('a small tap count never shows as a number: suppressed codes are skipped, a withheld group reads "fewer than 5 each"', () => {
    const { render, line } = mountReach();
    render({
      venue: { placements: [] },
      community: { placements: [] },
      // Even if a raw small number rode along in a suppressed shape, it is not shown.
      taps: {
        codes: [
          { word: 'EVENT', taps: fc(12) },
          { word: 'DONATE', taps: { count: null, suppressed: true, floor: 5, raw: 3 } },
        ],
        other: { codes: 2, taps: fc(4) },
        total: fc(12),
      },
    });
    const t = line('pre-event-reach-taps')!;
    expect(t).toBe('Link taps: EVENT 12 · other links fewer than 5 each');
    expect(t).not.toMatch(/\b[1-4]\b/);
  });

  test('a withheld figure is never shown as 0, NaN or a blank, whatever shape it arrives in', () => {
    const { render, line } = mountReach();
    const none = { count: null, suppressed: true, floor: 5 };
    for (const taps of [
      // The server's shapes: nothing listed; one listed beside a withheld group.
      { codes: [], other: { codes: 4, taps: none }, total: none },
      { codes: [{ word: 'EVENT', taps: fc(10) }], other: { codes: 2, taps: none }, total: fc(10) },
      // Shapes it should never send, which must still not print a number.
      { codes: [], other: null, total: none },
      { codes: [], other: { codes: 2, taps: { count: 'NaN' } }, total: none },
      { codes: [{ word: 'EVENT', taps: none }], other: { codes: 1, taps: {} } },
      {},
    ]) {
      render({ venue: { placements: [] }, community: { placements: [] }, taps });
      const t = line('pre-event-reach-taps')!;
      expect(t, JSON.stringify(taps)).toMatch(/^Link taps: \S/);
      expect(t, JSON.stringify(taps)).not.toMatch(/NaN|null|undefined|\b0\b/);
      // The only digits in a line with nothing listed are the floor itself.
      if (!/EVENT/.test(t)) expect(t.replace(/\b5\b/g, ''), JSON.stringify(taps)).not.toMatch(/\d/);
    }
    render({
      venue: { placements: [] },
      community: { placements: [] },
      taps: {
        codes: [{ word: 'EVENT', taps: fc(10) }],
        other: { codes: 2, taps: none },
        total: fc(10),
      },
    });
    expect(line('pre-event-reach-taps')).toBe(
      'Link taps: EVENT 10 · other links fewer than 5 each'
    );
  });

  test('OSE-682: a line the plan withholds says it comes with Mid, never "nothing yet"', () => {
    const { render, line } = mountReach();
    render(
      { totals: { scans: fc(12), taps: fc(9) } },
      {
        paid_report: false,
        locked_sections: ['reach.venue', 'reach.community', 'reach.taps', 'activity.scansByDay'],
        next_plan: 'mid',
      }
    );
    for (const id of [
      'pre-event-reach-taps',
      'pre-event-reach-venue',
      'pre-event-reach-community',
    ]) {
      expect(line(id)).toContain('comes with the Mid plan');
      expect(line(id)).not.toContain('no posters placed yet');
    }
  });

  test('textContent / createElement only: no innerHTML, no href, no response value as a key', () => {
    const fn = reachFn();
    expect(fn).not.toContain('innerHTML');
    expect(fn).not.toContain('insertAdjacentHTML');
    expect(fn).not.toMatch(/\bhref\b|\bsrc\b/);
    expect(fn).not.toMatch(/\[[a-z]+\.(kind|label|word)\]/);
    // The card calls it with the response's reach and plan, before revealing the card.
    const pre = ADMIN_HTML.slice(
      ADMIN_HTML.indexOf('window.renderPreEventWindow = async function')
    );
    expect(pre.indexOf('window.renderPreEventReach(d.reach, d.plan);')).toBeGreaterThan(-1);
    expect(pre.indexOf('window.renderPreEventReach(d.reach, d.plan);')).toBeLessThan(
      pre.indexOf('card.hidden = false;')
    );
  });
});

describe('Tier 3 | the card’s Link taps tile and lede read the FLOORED tap total', () => {
  function windowFn(): string {
    const start = ADMIN_HTML.indexOf('window.renderPreEventWindow = async function');
    const rest = ADMIN_HTML.slice(start);
    const end = rest.search(/\r?\n {6}\};\r?\n/);
    return rest.slice(0, end) + '\n};';
  }
  /** `scans` is the event's raw scans, all in one poster-hour: sent floored. */
  async function mountCard(clicks: unknown, scans: number, reach: unknown = REACH) {
    const dom = new JSDOM(`<!doctype html><body>${preEventCardMarkup()}</body>`, {
      runScripts: 'outside-only',
      url: 'https://ose.test/admin',
    });
    const w = dom.window as unknown as Win;
    w._oseList = { byId: { [EVT]: { phase: 'pre_event', status: 'active' } } };
    w._osePreSeq = 0;
    stubFetch(w, () => ({
      body: {
        ok: true,
        event: { id: EVT, status: 'active', days_to_go: 12 },
        activity: { posters: 1, places: 1, scans: fc(scans), clicks, scansByDay: [] },
        reach,
        link: { url: 'https://ose.test/s/Pub001', code: 'Pub001', qr: QR },
      },
    }));
    w.eval(reachFn());
    w.eval(windowFn());
    await (w.renderPreEventWindow as (id: string) => Promise<void>)(EVT);
    await flush();
    const text = (id: string) => w.document.querySelector(`[data-testid="${id}"]`)!.textContent;
    return { text };
  }

  test('withheld: the tile reads Held and the lede says "fewer than 5 taps on any one link" — never the number', async () => {
    const { text } = await mountCard(fc(3), 7);
    expect(text('pre-event-clicks')).toBe('Held');
    expect(text('pre-event-lede')).toBe(
      'People are finding it: fewer than 5 taps on any one link and 7 poster scans so far.'
    );
  });

  test('nothing yet (or withheld with no scans) reads as the normal early state', async () => {
    const { text } = await mountCard(fc(0), 0);
    expect(text('pre-event-clicks')).toBe('Held');
    expect(text('pre-event-lede')).toMatch(/taps show here once a link has 5 or more/);
  });

  test('a withheld total is not "fewer than 5 taps": four links with 4, 4, 3 and 4 taps (15 in all)', async () => {
    // What the server sends for that event: no link has 5, so no code is
    // listed and the total is withheld. The card must not say there are fewer
    // than 5 taps (there are 15), and must not print 0, NaN or a blank.
    const none = { count: null, suppressed: true, floor: 5 };
    const { text } = await mountCard(none, 7, {
      venue: { scans: 0, places: 0, placements: [] },
      community: { scans: 0, places: 0, placements: [] },
      taps: { codes: [], other: { codes: 4, taps: none }, total: none },
      totals: { scans: fc(7), taps: none },
    });
    const tile = text('pre-event-clicks')!;
    const lede = text('pre-event-lede')!;
    const line = text('pre-event-reach-taps')!;
    expect(tile).toBe('Held');
    expect(lede).toBe(
      'People are finding it: fewer than 5 taps on any one link and 7 poster scans so far.'
    );
    expect(line).toBe(
      'Link taps: fewer than 5 on any one link so far (a link shows here at 5 or more)'
    );
    for (const shown of [tile, lede, line]) {
      expect(shown).not.toMatch(/NaN|null|undefined|<5|\b0\b/);
      expect(shown).not.toMatch(/fewer than 5 (link )?taps(?! on any one link)/);
      expect(shown).not.toMatch(/fewer than 5 so far/);
    }
  });

  test('at or over the floor: the exact number', async () => {
    const { text } = await mountCard(fc(11), 8);
    expect(text('pre-event-clicks')).toBe('11');
    expect(text('pre-event-scans')).toBe('8');
    expect(text('pre-event-lede')).toBe(
      'People are finding it: 11 link taps and 8 poster scans so far.'
    );
  });

  // OSE-1656: poster scans arrive floored; withheld reads in words, never 0.
  test('scans withheld, taps shown: the tile reads Held and the lede says so in words', async () => {
    const { text } = await mountCard(fc(11), 3);
    expect(text('pre-event-scans')).toBe('Held');
    expect(text('pre-event-lede')).toBe(
      'People are finding it: 11 link taps and fewer than 5 poster scans in any one hour so far.'
    );
    expect(text('pre-event-lede')).not.toMatch(/\b3\b|\b0 poster/);
  });
});
