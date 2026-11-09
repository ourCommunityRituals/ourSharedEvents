/**
 * Sponsor public card + OSE default image (migration 0083) — UI half. The admin
 * sponsors card and the /events sponsor banner are RUN (their real scripts,
 * from the served templates) in jsdom against a stubbed fetch.
 * API / page half: sponsor-public-card.spec.ts.
 *
 *   - the form offers "OSE default image" / "Our own logo"; the logo fields
 *     appear only for "own"; choosing the default on an edit CLEARS the logos
 *   - display name, location, phone, email are optional and sent when filled;
 *     on an edit a blank one is sent as null (clears it)
 *   - a server field error lands on that field (aria-invalid + focus)
 *   - the banner shows the OSE default for a logo-less sponsor, the proxy for
 *     one with a logo, the title, and links to the card when there is no website
 *
 * @born-red 0083 | method: spec written against the pre-change tree (no image
 *   choice, no card fields, the banner rendered no image for a logo-less sponsor
 *   and an unlinked name when there was no website) — red; green with the change
 *   | date: 2026-09-30
 */

import { describe, test, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import ADMIN_HTML from '../src/templates/admin.html';
import PUBLIC_HTML from '../src/templates/public.html';
import DISPLAY_HTML from '../src/templates/display.html';
import POSTER_HTML from '../src/templates/poster.html';
import CARD_HTML from '../src/templates/sponsor-card.html';

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

function scriptContaining(html: string, needle: string): string {
  const doc = new JSDOM(html).window.document;
  const el = Array.from(doc.querySelectorAll('script')).find((s) =>
    (s.textContent || '').includes(needle)
  );
  expect(el, needle).toBeDefined();
  return el!.textContent || '';
}

// ── Admin sponsors card ─────────────────────────────────────────────────────

const EXISTING = {
  id: 'sp_has',
  name: 'Had Logos LLC',
  tier: 'gold',
  event_id: null,
  logo_url: 'https://cdn.example.com/w.png',
  sidebar_logo_url: 'https://cdn.example.com/s.png',
  website_url: null,
  display_name: 'Had Logos',
  address_line: 'Beverly',
  contact_phone: '(773) 555-0100',
  contact_email: 'hi@had.example',
};

async function mountCard(reply?: (url: string, init?: RequestInit) => Reply | undefined) {
  const doc0 = new JSDOM(ADMIN_HTML).window.document;
  const card = doc0.querySelector('[data-testid="sponsors-card"]')!;
  const dom = new JSDOM(`<!doctype html><body>${card.outerHTML}</body>`, {
    runScripts: 'outside-only',
    url: 'https://ose.test/admin',
  });
  const w = dom.window as unknown as Record<string, unknown> & {
    eval(s: string): unknown;
    document: Document;
    Event: typeof Event;
  };
  w.OSE_events = async () => ({ ok: true, items: [] });
  w._adminAnnounce = () => {};
  const calls = stubFetch(w, (url, init) => {
    const custom = reply?.(url, init);
    if (custom) return custom;
    if (url === '/api/v2/admin/sponsors' && init?.method === 'POST') {
      return { status: 201, body: { ok: true, id: 'sp_new' } };
    }
    if (url === `/api/v2/admin/sponsors/${EXISTING.id}` && init?.method === 'PUT') {
      return { body: { ok: true } };
    }
    if (url === `/api/v2/admin/sponsors/${EXISTING.id}`) {
      return { body: { ok: true, item: EXISTING } };
    }
    if (url.startsWith('/api/v2/admin/sponsors?')) return { body: { ok: true, items: [] } };
    return { status: 404, body: { ok: false } };
  });
  w.eval(scriptContaining(ADMIN_HTML, "getElementById('spon-create-form').addEventListener"));
  await flush();
  const doc = w.document;
  const $ = (id: string) => doc.getElementById(id) as HTMLInputElement & HTMLSelectElement;
  const choose = (value: string) => {
    $('spon-image-choice').value = value;
    $('spon-image-choice').dispatchEvent(new w.Event('change'));
  };
  const open = async () => {
    $('add-spon-toggle').click();
    await flush();
  };
  const submit = async () => {
    $('spon-create-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
    await flush();
  };
  const sent = (method: string) => calls.filter((c) => c.method === method);
  return { w, doc, $, choose, open, submit, sent };
}

describe('admin | image choice: OSE default or our own logo', () => {
  test('the default is chosen up front and the logo fields stay hidden until "own"', async () => {
    const { $, choose, open } = await mountCard();
    await open();
    expect($('spon-image-choice').value).toBe('default');
    expect($('spon-logo-field').hidden).toBe(true);
    expect($('spon-sidebar-logo-field').hidden).toBe(true);
    choose('own');
    expect($('spon-logo-field').hidden).toBe(false);
    expect($('spon-sidebar-logo-field').hidden).toBe(false);
    choose('default');
    expect($('spon-logo-field').hidden).toBe(true);
  });

  test('create with the default sends no logo — even if a URL was typed then abandoned', async () => {
    const { $, choose, open, submit, sent } = await mountCard();
    await open();
    $('spon-name').value = 'Default Co';
    $('spon-tier').value = 'gold';
    choose('own');
    $('spon-logo').value = 'https://cdn.example.com/abandoned.png';
    choose('default');
    await submit();
    const body = sent('POST')[0].body!;
    expect(body).not.toHaveProperty('logo_url');
    expect(body).not.toHaveProperty('sidebar_logo_url');
  });

  test('editing a sponsor with logos pre-selects "own"; switching to default clears both', async () => {
    const { w, $, choose, sent, submit } = await mountCard();
    await (w as unknown as { _editSponsor(id: string): Promise<void> })._editSponsor(EXISTING.id);
    await flush();
    expect($('spon-image-choice').value).toBe('own');
    expect($('spon-logo-field').hidden).toBe(false);
    expect($('spon-display-name').value).toBe('Had Logos');
    expect($('spon-address').value).toBe('Beverly');
    choose('default');
    await submit();
    const body = sent('PUT')[0].body!;
    expect(body.logo_url).toBeNull();
    expect(body.sidebar_logo_url).toBeNull();
  });
});

describe('admin | the public card fields', () => {
  test('all four are optional: a name + tier create sends none of them', async () => {
    const { $, open, submit, sent } = await mountCard();
    await open();
    for (const id of ['spon-display-name', 'spon-address', 'spon-phone', 'spon-email']) {
      expect($(id).hasAttribute('required'), id).toBe(false);
    }
    $('spon-name').value = 'Minimal';
    $('spon-tier').value = 'primary';
    await submit();
    expect(sent('POST')[0].body).toEqual({ name: 'Minimal', tier: 'primary' });
  });

  test('filled fields are sent; on an edit a blank field is sent as null', async () => {
    const created = await mountCard();
    await created.open();
    created.$('spon-name').value = 'Card Co';
    created.$('spon-tier').value = 'gold';
    created.$('spon-display-name').value = 'The Card Co';
    created.$('spon-address').value = 'Blue Island';
    created.$('spon-phone').value = '(708) 555-0100';
    created.$('spon-email').value = 'hi@card.example';
    await created.submit();
    expect(created.sent('POST')[0].body).toMatchObject({
      display_name: 'The Card Co',
      address_line: 'Blue Island',
      contact_phone: '(708) 555-0100',
      contact_email: 'hi@card.example',
    });

    const edited = await mountCard();
    await (edited.w as unknown as { _editSponsor(id: string): Promise<void> })._editSponsor(
      EXISTING.id
    );
    await flush();
    edited.$('spon-phone').value = '';
    await edited.submit();
    const body = edited.sent('PUT')[0].body!;
    expect(body.contact_phone).toBeNull();
    expect(body.contact_email).toBe('hi@had.example');
  });

  test('a server field error marks and focuses that field', async () => {
    const { doc, $, open, submit } = await mountCard((url, init) =>
      url === '/api/v2/admin/sponsors' && init?.method === 'POST'
        ? {
            status: 400,
            body: {
              ok: false,
              code: 'INVALID_CONTACT_PHONE',
              error: 'Phone must be a phone number',
            },
          }
        : undefined
    );
    await open();
    $('spon-name').value = 'Bad Phone';
    $('spon-tier').value = 'gold';
    $('spon-phone').value = 'call us';
    await submit();
    expect($('spon-phone').getAttribute('aria-invalid')).toBe('true');
    // OSE-1434: the phone field lives in the collapsed "Public card details"
    // section, which must open so the focused field is actually on screen.
    expect(($('spon-card-details') as unknown as HTMLDetailsElement).open).toBe(true);
    expect(doc.activeElement).toBe($('spon-phone'));
    expect($('spon-form-msg').textContent).toMatch(/phone/i);
  });
});

// ── OSE-1434: the form reads in sections, required fields first ─────────────

describe('admin | Create Sponsor form order and sections (OSE-1434)', () => {
  const details = (doc: Document) =>
    doc.querySelector('[data-testid="spon-card-details"]') as HTMLDetailsElement;

  test('fields run Name → Tier → Event → Image → logos → Website, then the poster header and the card section', async () => {
    const { doc } = await mountCard();
    const form = doc.getElementById('spon-create-form')!;
    const order = Array.from(form.querySelectorAll('input:not([type="hidden"]), select')).map(
      (el) => el.id
    );
    expect(order).toEqual([
      'spon-name',
      'spon-tier',
      'spon-event',
      'spon-image-choice',
      'spon-logo',
      'spon-sidebar-logo',
      'spon-website',
      // OSE-1826: the poster header's two fields, in their own collapsed section.
      'spon-header-image',
      'spon-header-text',
      'spon-display-name',
      'spon-address',
      'spon-phone',
      'spon-email',
    ]);
  });

  test('the four public card fields sit in one collapsed "Public card details" section', async () => {
    const { doc, open } = await mountCard();
    await open();
    const d = details(doc);
    expect(d, 'no spon-card-details section').not.toBeNull();
    expect(d.tagName).toBe('DETAILS');
    expect(d.open, 'collapsed by default').toBe(false);
    expect(d.querySelector('summary')!.textContent).toMatch(/public card details/i);
    for (const id of ['spon-display-name', 'spon-address', 'spon-phone', 'spon-email']) {
      expect(d.contains(doc.getElementById(id)), id).toBe(true);
    }
    for (const id of [
      'spon-name',
      'spon-tier',
      'spon-event',
      'spon-image-choice',
      'spon-website',
    ]) {
      expect(d.contains(doc.getElementById(id)), `${id} must stay outside`).toBe(false);
    }
  });

  test('the image choice uses plain words for the standard image', async () => {
    const { $ } = await mountCard();
    const opts = Array.from($('spon-image-choice').options).map((o) => [o.value, o.textContent]);
    expect(opts).toEqual([
      ['default', 'Standard image (OurSharedEvents mark)'],
      ['own', 'Our own logo'],
    ]);
  });

  test('choosing "own" announces the two logo fields through a polite live region', async () => {
    const { $, choose, open } = await mountCard();
    await open();
    const hint = $('spon-image-choice-hint');
    expect(hint.getAttribute('aria-live')).toBe('polite');
    expect(hint.textContent).not.toMatch(/below/i);
    choose('own');
    expect(hint.textContent).toMatch(/wide logo.*square logo.*below/i);
    choose('default');
    expect(hint.textContent).not.toMatch(/below/i);
  });

  test('editing a sponsor that has card details opens the section; one without stays collapsed', async () => {
    const withCard = await mountCard();
    await (withCard.w as unknown as { _editSponsor(id: string): Promise<void> })._editSponsor(
      EXISTING.id
    );
    await flush();
    expect(details(withCard.doc).open).toBe(true);

    const bare = await mountCard((url, init) =>
      url === `/api/v2/admin/sponsors/${EXISTING.id}` && !init?.method
        ? {
            body: {
              ok: true,
              item: {
                ...EXISTING,
                display_name: null,
                address_line: null,
                contact_phone: null,
                contact_email: null,
              },
            },
          }
        : undefined
    );
    await (bare.w as unknown as { _editSponsor(id: string): Promise<void> })._editSponsor(
      EXISTING.id
    );
    await flush();
    expect(details(bare.doc).open).toBe(false);
  });

  test('closing the form collapses the section again', async () => {
    const { w, doc, $ } = await mountCard();
    await (w as unknown as { _editSponsor(id: string): Promise<void> })._editSponsor(EXISTING.id);
    await flush();
    expect(details(doc).open).toBe(true);
    (w as unknown as { _doCloseForm(): void })._doCloseForm();
    expect(details(doc).open).toBe(false);
    expect($('spon-display-name').value).toBe('');
  });
});

// ── /events sponsor banner ───────────────────────────────────────────────────

async function mountBanner(sponsors: Record<string, unknown>[]) {
  const dom = new JSDOM(PUBLIC_HTML, {
    runScripts: 'outside-only',
    url: 'https://ose.test/events?event=evt_a',
  });
  const w = dom.window as unknown as Record<string, unknown> & {
    eval(s: string): unknown;
    document: Document;
  };
  stubFetch(w, (url) =>
    url.includes('/sponsor-bundle')
      ? { body: { ok: true, bundle: { surface_sponsors: { mobileBanner: sponsors } } } }
      : { status: 202, body: { ok: true } }
  );
  w.eval(scriptContaining(PUBLIC_HTML, "sponsor-bundle?surface=public'"));
  await flush();
  return w.document;
}

describe('/events | sponsor banner', () => {
  test('no logo → the OSE default; no website → the card; the title and location show', async () => {
    const doc = await mountBanner([
      {
        id: 'sp_card',
        name: 'Legal LLC',
        title: 'Corner Shop',
        card_url: '/sponsors/sp_card',
        address_line: 'Beverly',
        logo_url: null,
        website_url: null,
      },
    ]);
    const img = doc.querySelector('[data-testid="public-sponsor-logo"]')!;
    expect(img.getAttribute('src')).toBe('/sponsor-default-logo.svg');
    expect(img.getAttribute('alt')).toBe('Corner Shop');
    const link = doc.querySelector('[data-testid="public-sponsor-card-link"]')!;
    expect(link.getAttribute('href')).toBe('/sponsors/sp_card');
    expect(link.hasAttribute('target')).toBe(false);
    expect(link.textContent).toBe('Corner Shop');
    expect(doc.querySelector('[data-testid="public-sponsor-address"]')!.textContent).toBe(
      'Beverly'
    );
  });

  test('a logo loads through the same-origin proxy; a website opens the website', async () => {
    const doc = await mountBanner([
      {
        id: 'sp_site',
        name: 'Site Co',
        logo_url: 'https://cdn.example.com/l.png',
        website_url: 'https://site.example',
      },
    ]);
    const img = doc.querySelector('[data-testid="public-sponsor-logo"]')!;
    expect(img.getAttribute('src')).toBe('/api/v2/sponsors/sp_site/logo');
    expect(img.getAttribute('data-default-src')).toBe('/sponsor-default-logo.svg');
    const link = doc.querySelector('[data-testid="public-sponsor-link"]')!;
    expect(link.getAttribute('href')).toBe('https://site.example');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    // A website wins: no card link even though a card may exist.
    expect(doc.querySelector('[data-testid="public-sponsor-card-link"]')).toBeNull();
  });

  test('OSE-1438: no website and no card_url → the name shows unlinked, never a guessed card path', async () => {
    // The resolver omits card_url when the card would 404 (a Path 2 match with
    // no accepted placement anywhere, or the mock fixtures). The banner used to
    // build /sponsors/:id itself, which is exactly the 404 link.
    const doc = await mountBanner([
      { id: 'sp_pool', name: 'Pool Co', title: 'Pool Co', logo_url: null, website_url: null },
    ]);
    const card = doc.querySelector('[data-testid="public-sponsor-card"]')!;
    expect(card.querySelector('a')).toBeNull();
    expect(doc.querySelector('[data-testid="public-sponsor-card-link"]')).toBeNull();
    expect(doc.querySelector('[data-testid="public-sponsor-name"]')!.textContent).toBe('Pool Co');
  });

  test('a quote in the title cannot break out of the alt attribute', async () => {
    const doc = await mountBanner([
      { id: 'sp_q', name: 'x', title: '" onload="alert(1)', logo_url: null, website_url: null },
    ]);
    const img = doc.querySelector('[data-testid="public-sponsor-logo"]')!;
    expect(img.hasAttribute('onload')).toBe(false);
    expect(img.getAttribute('alt')).toBe('" onload="alert(1)');
  });
});

// ── CCR PR #699 holds: the error-swap loop guard, and the edit warning ─────

/**
 * Run a template's capture-phase `error` listener against a sponsor <img> and
 * fire `error` twice: the first must swap to the OSE default, the second (the
 * default itself failing) must hide the image and NOT swap again — otherwise a
 * dead default is an endless error loop on an unattended TV.
 */
function exerciseErrorGuard(html: string, needle: string, attrs: string) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  const w = dom.window as unknown as {
    eval(s: string): unknown;
    document: Document;
    Event: typeof Event;
  };
  w.eval(scriptContaining(html, needle));
  w.document.body.innerHTML = `<img src="/api/v2/sponsors/sp_x/logo" ${attrs}>`;
  const img = w.document.querySelector('img')!;
  const fire = () => img.dispatchEvent(new w.Event('error'));
  fire();
  const afterFirst = img.getAttribute('src');
  fire();
  return { afterFirst, afterSecond: img.getAttribute('src'), hidden: img.style.display === 'none' };
}

describe('error-swap loop guard on every surface', () => {
  const ATTRS = 'data-hide-on-error="1" data-default-src="/sponsor-default-logo.svg"';
  test.each([
    ['public', PUBLIC_HTML, "hasAttribute('data-hide-on-error')"],
    ['poster', POSTER_HTML, "hasAttribute('data-hide-on-error')"],
    ['display', DISPLAY_HTML, "hasAttribute('data-hide-on-error')"],
  ])(
    '%s: first error → OSE default, second error → hidden, no further swap',
    (_name, html, needle) => {
      const r = exerciseErrorGuard(html, needle, ATTRS);
      expect(r.afterFirst).toBe('/sponsor-default-logo.svg');
      expect(r.afterSecond).toBe('/sponsor-default-logo.svg');
      expect(r.hidden).toBe(true);
    }
  );

  test('sponsor card: first error → OSE default; a failing default is left alone (no loop)', () => {
    const r = exerciseErrorGuard(
      CARD_HTML,
      "'error'",
      'data-default-src="/sponsor-default-logo.svg"'
    );
    expect(r.afterFirst).toBe('/sponsor-default-logo.svg');
    expect(r.afterSecond).toBe('/sponsor-default-logo.svg');
  });

  test('the fallback path is fixed, never read from the element (CodeQL js/xss-through-dom)', () => {
    const r = exerciseErrorGuard(
      PUBLIC_HTML,
      "hasAttribute('data-hide-on-error')",
      'data-hide-on-error="1" data-default-src="javascript:alert(1)"'
    );
    expect(r.afterFirst).toBe('/sponsor-default-logo.svg');
  });
});

describe('admin | switching an existing sponsor to the default warns first', () => {
  test('the hint says the saved logos will be removed, and resets when switched back', async () => {
    const { w, $, choose } = await mountCard();
    await (w as unknown as { _editSponsor(id: string): Promise<void> })._editSponsor(EXISTING.id);
    await flush();
    const hint = () => $('spon-image-choice-hint').textContent || '';
    expect(hint()).not.toMatch(/remove/i);
    choose('default');
    expect(hint()).toMatch(/remove this sponsor.s saved logos/i);
    choose('own');
    expect(hint()).not.toMatch(/remove/i);
  });

  test('a brand-new sponsor choosing the default gets no warning (nothing to remove)', async () => {
    const { $, choose, open } = await mountCard();
    await open();
    choose('own');
    $('spon-logo').value = 'https://cdn.example.com/typed.png';
    choose('default');
    expect($('spon-image-choice-hint').textContent).not.toMatch(/remove/i);
  });
});

// ── OSE-1826: the poster header block's two fields ─────────────────────────────

describe('admin | the poster header (OSE-1826)', () => {
  const header = (doc: Document) =>
    doc.querySelector('[data-testid="spon-header-details"]') as HTMLDetailsElement;

  test('both optional, in one collapsed "Poster header" section, with limits on the inputs', async () => {
    const { doc, $, open, submit, sent } = await mountCard();
    await open();
    const d = header(doc);
    expect(d.tagName).toBe('DETAILS');
    expect(d.open, 'collapsed by default').toBe(false);
    expect(d.querySelector('summary')!.textContent).toMatch(/poster header/i);
    for (const id of ['spon-header-image', 'spon-header-text']) {
      expect(d.contains($(id)), id).toBe(true);
      expect($(id).hasAttribute('required'), id).toBe(false);
    }
    expect($('spon-header-image').getAttribute('maxlength')).toBe('500');
    expect($('spon-header-text').getAttribute('maxlength')).toBe('140');
    $('spon-name').value = 'Minimal';
    $('spon-tier').value = 'primary';
    await submit();
    expect(sent('POST')[0].body).toEqual({ name: 'Minimal', tier: 'primary' });
  });

  test('filled fields are sent on create; an edit loads them, opens the section, and a blank clears', async () => {
    const created = await mountCard();
    await created.open();
    created.$('spon-name').value = 'Bakery';
    created.$('spon-tier').value = 'bronze';
    created.$('spon-header-image').value = 'https://cdn.example.com/h.jpg';
    created.$('spon-header-text').value = 'Fresh bread every morning';
    await created.submit();
    expect(created.sent('POST')[0].body).toMatchObject({
      header_image_url: 'https://cdn.example.com/h.jpg',
      header_text: 'Fresh bread every morning',
    });

    const edited = await mountCard((url, init) =>
      url === `/api/v2/admin/sponsors/${EXISTING.id}` && !init?.method
        ? {
            body: {
              ok: true,
              item: {
                ...EXISTING,
                header_image_url: 'https://cdn.example.com/old.jpg',
                header_text: 'Old line',
              },
            },
          }
        : undefined
    );
    await (edited.w as unknown as { _editSponsor(id: string): Promise<void> })._editSponsor(
      EXISTING.id
    );
    await flush();
    expect(header(edited.doc).open).toBe(true);
    expect(edited.$('spon-header-image').value).toBe('https://cdn.example.com/old.jpg');
    expect(edited.$('spon-header-text').value).toBe('Old line');
    edited.$('spon-header-image').value = '';
    await edited.submit();
    const body = edited.sent('PUT')[0].body!;
    expect(body.header_image_url).toBeNull();
    expect(body.header_text).toBe('Old line');
  });

  test('an edit of a sponsor with no header keeps the section collapsed', async () => {
    const { w, doc } = await mountCard();
    await (w as unknown as { _editSponsor(id: string): Promise<void> })._editSponsor(EXISTING.id);
    await flush();
    expect(header(doc).open).toBe(false);
  });

  test('a server error on the header image opens the section and focuses the field', async () => {
    const { doc, $, open, submit } = await mountCard((url, init) =>
      url === '/api/v2/admin/sponsors' && init?.method === 'POST'
        ? {
            status: 400,
            body: {
              ok: false,
              code: 'INVALID_HEADER_IMAGE_URL',
              error: 'Header image must be an http:// or https:// URL',
            },
          }
        : undefined
    );
    await open();
    $('spon-name').value = 'Bad Header';
    $('spon-tier').value = 'gold';
    $('spon-header-image').value = 'javascript:alert(1)';
    await submit();
    expect($('spon-header-image').getAttribute('aria-invalid')).toBe('true');
    expect(header(doc).open).toBe(true);
    expect(doc.activeElement).toBe($('spon-header-image'));
  });
});
