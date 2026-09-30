/**
 * OSE-1316 / OSE-1317 — Create Sponsor field rules, UI half. The admin sponsors
 * card and the /display side rail are RUN (their real scripts, from the served
 * templates) in jsdom against a stubbed fetch — not pattern-matched.
 * API half: sponsor-create-fields.spec.ts.
 *
 * @born-red OSE-1316/OSE-1317 | method: spec written first and run against
 *   origin/main via a tagged stash of the change (the form blocked on a missing
 *   event, defaulted tier to Primary, had one logo field, sent any website; the
 *   side rail showed the wide header logo) — red; green with the change |
 *   date: 2026-09-30
 */

import { describe, test, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import ADMIN_HTML from '../src/templates/admin.html';
import DISPLAY_HTML from '../src/templates/display.html';

type Reply = { status?: number; body?: unknown };
type Call = { url: string; method: string; body: Record<string, unknown> | undefined };

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

function stubFetch(w: Record<string, unknown>, router: (url: string, init?: RequestInit) => Reply) {
  const calls: Call[] = [];
  w.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: (init?.method ?? 'GET').toUpperCase(),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const r = router(String(url), init);
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body };
  });
  return calls;
}

// Scripts are found as parsed elements (jsdom parses without running them),
// never by slicing raw text around a script tag.
function scriptContaining(html: string, needle: string): string {
  const doc = new JSDOM(html).window.document;
  const el = Array.from(doc.querySelectorAll('script')).find((s) =>
    (s.textContent || '').includes(needle)
  );
  expect(el, needle).toBeDefined();
  return el!.textContent || '';
}

// ── Admin sponsors card ─────────────────────────────────────────────────────

function sponsorsCard(html: string): string {
  const doc = new JSDOM(html).window.document;
  const card = doc.querySelector('[data-testid="sponsors-card"]');
  expect(card).not.toBeNull();
  return card!.outerHTML;
}

const EVENTS = [
  { id: 'evt_a', name: 'Bocce Night' },
  { id: 'evt_b', name: 'Harvest Fair' },
];

async function mountCard(opts: { list?: unknown[] } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${sponsorsCard(ADMIN_HTML)}</body>`, {
    runScripts: 'outside-only',
    url: 'https://ose.test/admin',
  });
  const w = dom.window as unknown as Record<string, unknown> & {
    eval(s: string): unknown;
    document: Document;
  };
  w.OSE_events = async () => ({ ok: true, items: EVENTS });
  w._adminAnnounce = () => {};
  const calls = stubFetch(w, (url, init) => {
    if (url === '/api/v2/admin/sponsors' && init?.method === 'POST') {
      return { status: 201, body: { ok: true, id: 'sp_new' } };
    }
    if (url.startsWith('/api/v2/admin/sponsors?')) {
      return { body: { ok: true, items: opts.list ?? [] } };
    }
    return { status: 404, body: { ok: false } };
  });
  w.eval(scriptContaining(ADMIN_HTML, "getElementById('spon-create-form').addEventListener"));
  await flush();
  const doc = w.document;
  const $ = (id: string) => doc.getElementById(id) as HTMLInputElement & HTMLSelectElement;
  const open = async () => {
    $('add-spon-toggle').click();
    await flush();
  };
  const submit = async () => {
    $('spon-create-form').dispatchEvent(new w.Event('submit', { cancelable: true }) as Event);
    await flush();
  };
  const posts = () => calls.filter((c) => c.method === 'POST');
  return { w, doc, $, open, submit, posts, calls };
}

describe('admin | Create Sponsor form', () => {
  test('tier is required: submit is blocked with an inline message until one is chosen', async () => {
    const { $, open, submit, posts } = await mountCard();
    await open();
    expect($('spon-tier').value, 'no tier is pre-chosen').toBe('');
    expect($('spon-tier').hasAttribute('required')).toBe(true);
    $('spon-name').value = 'Acme';
    await submit();
    expect(posts()).toHaveLength(0);
    expect($('spon-form-msg').textContent).toMatch(/choose a tier/i);
    expect($('spon-form-msg').className).toMatch(/error/);
    expect($('spon-tier').getAttribute('aria-invalid')).toBe('true');
  });

  test('the event is optional: "No event yet" is the default and the hint says events attach later', async () => {
    const { $, doc, open, submit, posts } = await mountCard();
    await open();
    const sel = $('spon-event');
    expect(sel.hasAttribute('required')).toBe(false);
    expect(sel.value).toBe('');
    expect(sel.options[0].textContent).toMatch(/no event yet/i);
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(['', 'evt_a', 'evt_b']);
    expect(doc.querySelector('[data-testid="spon-event-hint"]')!.textContent).toMatch(
      /you can attach events later/i
    );
    $('spon-name').value = 'Pool Co';
    $('spon-tier').value = 'gold';
    await submit();
    expect(posts()).toHaveLength(1);
    expect(posts()[0].body).toEqual({ name: 'Pool Co', tier: 'gold' });
    expect($('spon-form-msg').textContent).toMatch(/attach events later/i);
  });

  test('choosing an event sends it', async () => {
    const { $, open, submit, posts } = await mountCard();
    await open();
    $('spon-name').value = 'Linked Co';
    $('spon-tier').value = 'title';
    $('spon-event').value = 'evt_b';
    await submit();
    expect(posts()[0].body).toMatchObject({ name: 'Linked Co', tier: 'title', event_id: 'evt_b' });
  });

  test('header logo and sidebar logo are two separate fields with their own aspect guidance', async () => {
    const { w, $, doc, open, submit, posts } = await mountCard();
    await open();
    expect(doc.querySelector('label[for="spon-logo"]')!.textContent).toMatch(/header logo/i);
    expect(doc.querySelector('label[for="spon-sidebar-logo"]')!.textContent).toMatch(
      /sidebar logo/i
    );
    expect(doc.querySelector('[data-testid="spon-logo-hint"]')!.textContent).toMatch(/wide/i);
    expect(doc.querySelector('[data-testid="spon-sidebar-logo-hint"]')!.textContent).toMatch(
      /square or compact/i
    );
    expect($('spon-logo').hasAttribute('required')).toBe(false);
    expect($('spon-sidebar-logo').hasAttribute('required')).toBe(false);
    $('spon-name').value = 'Two Logos';
    $('spon-tier').value = 'gold';
    // 0083: the logo fields belong to the "Our own logo" image choice.
    $('spon-image-choice').value = 'own';
    $('spon-image-choice').dispatchEvent(
      new (w as unknown as { Event: typeof Event }).Event('change')
    );
    $('spon-logo').value = 'https://cdn.example.com/wide.png';
    $('spon-sidebar-logo').value = 'https://cdn.example.com/square.png';
    await submit();
    expect(posts()[0].body).toMatchObject({
      logo_url: 'https://cdn.example.com/wide.png',
      sidebar_logo_url: 'https://cdn.example.com/square.png',
    });
  });

  test('website: empty sends nothing, valid https is sent, malformed is blocked inline', async () => {
    const { $, open, submit, posts } = await mountCard();
    await open();
    $('spon-name').value = 'Site Co';
    $('spon-tier').value = 'gold';
    for (const bad of ['http://acme.com', 'javascript:alert(1)', 'acme dot com', 'www.acme.com']) {
      $('spon-website').value = bad;
      await submit();
      expect(posts(), bad).toHaveLength(0);
      expect($('spon-form-msg').textContent).toMatch(/https:\/\//);
      expect($('spon-website').getAttribute('aria-invalid')).toBe('true');
    }
    $('spon-website').value = '';
    await submit();
    expect(posts()).toHaveLength(1);
    expect(posts()[0].body).not.toHaveProperty('website_url');
    $('spon-website').value = 'https://acme.com';
    await submit();
    expect(posts()[1].body).toMatchObject({ website_url: 'https://acme.com' });
  });

  test('a hostile event name from the API is text in the picker, never markup', async () => {
    const { $, open, w } = await mountCard();
    w.OSE_events = async () => ({
      ok: true,
      items: [{ id: 'evt_x"><img src=x onerror=alert(1)>', name: '<img src=x onerror=alert(1)>' }],
    });
    await open();
    const sel = $('spon-event');
    expect(sel.querySelector('img')).toBeNull();
    expect(sel.options[1].textContent).toBe('<img src=x onerror=alert(1)>');
    expect(sel.options[1].value).toBe('evt_x"><img src=x onerror=alert(1)>');
  });

  test('a hostile sponsor name in the list stays escaped', async () => {
    const hostile = '"><img src=x onerror=alert(1)>';
    const { doc, w } = await mountCard({
      list: [
        {
          id: 'sp_1',
          name: hostile,
          tier: 'gold',
          event_id: 'evt_a',
          is_active: 1,
          sponsor_accepted: 1,
        },
      ],
    });
    await (w._loadSponsorsForEvent as (id: string) => Promise<void>)('evt_a');
    await flush();
    const list = doc.querySelector('[data-testid="sponsors-list"]')!;
    expect(list.querySelector('img')).toBeNull();
    expect(doc.querySelector('[data-testid="spon-name-sp_1"]')!.textContent).toBe(hostile);
  });
});

// ── /display side rail ─────────────────────────────────────────────────────

async function mountDisplay(sponsor: Record<string, unknown>) {
  const dom = new JSDOM(DISPLAY_HTML, {
    runScripts: 'outside-only',
    url: 'https://ose.test/display',
  });
  const w = dom.window as unknown as Record<string, unknown> & {
    eval(s: string): unknown;
    document: Document;
    close(): void;
  };
  stubFetch(w, (url) => {
    if (url === '/api/v2/events') {
      return {
        body: { ok: true, items: [{ id: 'evt_a', title: 'Bocce Night', name: 'Bocce Night' }] },
      };
    }
    if (url.includes('/sponsor-bundle')) {
      return {
        body: {
          ok: true,
          bundle: { surface_sponsors: { tvTop: [sponsor], tvSide: [sponsor] } },
        },
      };
    }
    return { status: 202, body: { ok: true } };
  });
  w.eval(scriptContaining(DISPLAY_HTML, 'async function loadDisplaySponsors'));
  await flush();
  const doc = w.document;
  return { doc, close: () => w.close() };
}

describe('/display | header logo vs sidebar logo', () => {
  test('the side rail shows the SIDEBAR logo; the top banner keeps the header logo', async () => {
    const { doc, close } = await mountDisplay({
      id: 'sp_1',
      name: 'Acme',
      tier: 'gold',
      logo_url: 'https://cdn.example.com/wide.png',
      sidebar_logo_url: 'https://cdn.example.com/square.png',
    });
    const side = doc.querySelector(
      '[data-testid="display-sponsor-sidebar-logo"]'
    ) as HTMLImageElement;
    expect(side).not.toBeNull();
    // 0083: logos load through the same-origin proxy — the page CSP (img-src
    // 'self' data:) and COEP both block an external URL in <img src>. The side
    // rail asks the proxy for the compact slot; the top banner for the header.
    expect(side.getAttribute('src')).toBe('/api/v2/sponsors/sp_1/logo?slot=sidebar');
    const top = doc.querySelector('[data-testid="display-sponsor-logo"]') as HTMLImageElement;
    expect(top.getAttribute('src')).toBe('/api/v2/sponsors/sp_1/logo');
    close();
  });

  test('no sidebar logo → falls back to the header logo', async () => {
    const { doc, close } = await mountDisplay({
      id: 'sp_2',
      name: 'Acme',
      tier: 'gold',
      logo_url: 'https://cdn.example.com/wide.png',
    });
    // The proxy's slot=sidebar falls back to the header logo server-side.
    const side = doc.querySelector('[data-testid="display-sponsor-sidebar-logo"]');
    expect(side!.getAttribute('src')).toBe('/api/v2/sponsors/sp_2/logo?slot=sidebar');
    close();
  });

  test('no logo at all → the OSE default image and the name render', async () => {
    const { doc, close } = await mountDisplay({ id: 'sp_3', name: 'Name Only Co', tier: 'gold' });
    const sidebar = doc.querySelector('[data-testid="display-sponsor-sidebar"]')!;
    // 0083 (decided 2026-09-30): a sponsor with no image gets the OSE default.
    expect(sidebar.querySelector('img')!.getAttribute('src')).toBe('/sponsor-default-logo.svg');
    expect(doc.querySelector('[data-testid="display-sponsor-sidebar-name"]')!.textContent).toBe(
      'Name Only Co'
    );
    close();
  });

  test('a hostile name / logo URL never becomes markup in the side rail', async () => {
    const { doc, close } = await mountDisplay({
      id: 'sp_4',
      name: '"><img src=x onerror=alert(1)>',
      tier: 'gold',
      sidebar_logo_url: 'javascript:alert(1)',
      logo_url: 'https://cdn.example.com/w.png" onerror="alert(1)',
    });
    const sidebar = doc.querySelector('[data-testid="display-sponsor-sidebar"]')!;
    const imgs = Array.from(sidebar.querySelectorAll('img'));
    expect(imgs).toHaveLength(1);
    expect(imgs[0].hasAttribute('onerror')).toBe(false);
    // The stored URL never reaches the markup at all — only the proxy path.
    expect(imgs[0].getAttribute('src')).toBe('/api/v2/sponsors/sp_4/logo?slot=sidebar');
    expect(doc.querySelector('[data-testid="display-sponsor-sidebar-name"]')!.textContent).toBe(
      '"><img src=x onerror=alert(1)>'
    );
    close();
  });
});
