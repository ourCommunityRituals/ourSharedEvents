/**
 * Language in the URL path, on staging (OSE-1761, slice B of the i18n epic).
 *
 * The worker-layer spec (workers/oursharedevents/tests/language-path-prefix.spec.ts)
 * proves the router. This T4 slice proves it through a real browser against the
 * deployed Worker: the Spanish page, the language switch as a plain link, a shared
 * link that keeps its prefix, a printed code that does not change, and the paths
 * a prefix must never reach.
 *
 * It creates its own event (a 2099 date, a per-run slug) and removes it after.
 */

import { test, expect, type Browser } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://stg.oursharedevents.com';
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.X_OCR_INTERNAL || '';
const X_OCR_INTERNAL = process.env.X_OCR_INTERNAL || '';
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID || '';
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || '';
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// No skip: a missing credential fails the run. A gate that skips when it cannot
// reach the Worker would stay green while checking nothing (OSE-1606 ratchet).
function precondition(unmet: boolean, message: string): void {
  if (unmet) throw new Error(`precondition unmet: ${message}`);
}

function adminHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ADMIN_KEY}`,
  };
  if (X_OCR_INTERNAL) headers['X-OCR-Internal'] = X_OCR_INTERNAL;
  if (CF_ACCESS_CLIENT_ID) headers['CF-Access-Client-Id'] = CF_ACCESS_CLIENT_ID;
  if (CF_ACCESS_CLIENT_SECRET) headers['CF-Access-Client-Secret'] = CF_ACCESS_CLIENT_SECRET;
  return headers;
}

// A red should name the edge, not read as a wrong status from the Worker.
function throwIfChallenged(headers: Record<string, string>, method: string, path: string): void {
  if (headers['cf-mitigated']) {
    throw new Error(
      `Cloudflare's Bot Fight Mode answered ${method} ${path}, not the Worker; no rule can skip it, so this client looks like a bot`
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Req = any;

async function adminFetch(request: Req, method: string, path: string, body?: object) {
  const resp = await request.fetch(`${BASE_URL}${path}`, {
    method,
    headers: adminHeaders(),
    data: body,
    timeout: 30_000,
  });
  throwIfChallenged(resp.headers(), method, path);
  if ((resp.headers()['content-type'] || '').includes('text/html')) {
    throw new Error(
      `CF Access returned HTML for ${method} ${path}; the spec did not reach the Worker`
    );
  }
  return resp;
}

/**
 * The first answer to a GET, before any redirect, with its Location readable.
 * A fresh browser each time, because Bot Fight Mode challenges Node's HTTP client
 * whatever headers it sends, and no rule can skip it (OSE-1162).
 */
async function open(browser: Browser, path: string) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const last = await page.goto(`${BASE_URL}${path}`, { waitUntil: 'commit' });
    let request = last!.request();
    for (let from = request.redirectedFrom(); from; from = request.redirectedFrom()) request = from;
    const first = await request.response();
    const headers = await first!.allHeaders();
    throwIfChallenged(headers, 'GET', path);
    return {
      status: first!.status(),
      location: headers['location'],
      cookie: headers['set-cookie'],
    };
  } finally {
    await context.close();
  }
}

test.describe('Language path prefix — /es/ on staging (OSE-1761)', () => {
  let eventId: string | null = null;
  let deploymentId: string | null = null;
  let slug = '';
  let code = '';
  let qrToken = '';

  test.beforeAll(async ({ request }) => {
    precondition(!ADMIN_KEY, 'ADMIN_KEY or X_OCR_INTERNAL is required');
    slug = `language-prefix-${RUN_ID}`;
    const created = await adminFetch(request, 'POST', '/api/v2/admin/events', {
      brand_id: 'root',
      title: `Language Prefix ${RUN_ID}`,
      slug,
      status: 'active',
      is_published: true,
      description: 'Temporary language-prefix smoke event.',
      location: 'Language Prefix Hall',
      start_date: '2099-02-01',
      end_date: '2099-02-02',
      timezone: 'America/Chicago',
    });
    expect(created.status(), 'create event').toBe(201);
    eventId = (await created.json()).id;
    expect(eventId).toBeTruthy();

    const links = await adminFetch(
      request,
      'POST',
      `/api/v2/admin/events/${encodeURIComponent(eventId!)}/short-links`,
      {}
    );
    expect(links.status(), 'mint short code').toBe(200);
    code = (await links.json()).code;
    expect(code).toBeTruthy();

    const deployment = await adminFetch(
      request,
      'POST',
      `/api/v2/admin/events/${encodeURIComponent(eventId!)}/poster-deployments`,
      {
        placement_label: `Language Prefix ${RUN_ID}`,
        location_desc: 'Language smoke',
        is_active: true,
      }
    );
    expect(deployment.status(), 'create poster deployment').toBe(201);
    const dep = await deployment.json();
    deploymentId = dep.id;
    qrToken = dep.qr_token;
    expect(qrToken).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    for (const path of [
      deploymentId && `/api/v2/admin/poster-deployments/${encodeURIComponent(deploymentId)}`,
      eventId && `/api/v2/admin/events/${encodeURIComponent(eventId)}`,
    ]) {
      if (!path) continue;
      try {
        await adminFetch(request, 'DELETE', path);
      } catch {
        // Best-effort: the slug is per-run unique and the date is 2099.
      }
    }
  });

  test('the Spanish page, its head, and a switch that is a plain link both ways', async ({
    page,
  }) => {
    const readable = `/events/${eventId}/${slug}`;
    // Headless Chromium fails Bot Fight Mode's JS check, and a failed check gets the
    // next navigation challenged. Without a result, the two clicks below reach the Worker.
    await page.route('**/cdn-cgi/challenge-platform/**', (route) => route.abort());
    const res = await page.goto(`${BASE_URL}/es${readable}`, { waitUntil: 'domcontentloaded' });
    expect(res?.status(), 'the Spanish page is served by the Worker').toBe(200);
    expect(
      (await res?.allHeaders())?.['set-cookie'],
      'no cookie because of language'
    ).toBeUndefined();

    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.locator('[data-testid="share-btn"]')).toHaveText('Compartir este evento');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      new RegExp(`/es${readable}$`)
    );
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
      'href',
      new RegExp(`${readable}$`)
    );
    await expect(page.locator('link[rel="alternate"][hreflang="es"]')).toHaveAttribute(
      'href',
      new RegExp(`/es${readable}$`)
    );

    // The switch: a link, no button or script behind it, with a 44 px target.
    const toEnglish = page.locator('[data-testid="language-switch-en"]');
    await expect(toEnglish).toHaveText('Inglés');
    expect(await toEnglish.evaluate((el) => el.tagName)).toBe('A');
    const box = await toEnglish.boundingBox();
    expect(box?.height ?? 0, 'target height').toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0, 'target width').toBeGreaterThanOrEqual(44);
    await toEnglish.click();
    await expect(page).toHaveURL(`${BASE_URL}${readable}`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.locator('[data-testid="language-switch-es"]').click();
    await expect(page).toHaveURL(`${BASE_URL}/es${readable}`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');

    const cookies = await page.context().cookies();
    expect(
      cookies.filter((c) => /lang|locale/i.test(c.name)),
      'no language cookie'
    ).toEqual([]);
  });

  test('a prefix beats the browser language, and a bare address still follows it', async ({
    browser,
  }) => {
    const readable = `/events/${eventId}/${slug}`;
    const english = await browser.newContext({ locale: 'en-US' });
    const spanishPrefixed = await (await english.newPage()).goto(`${BASE_URL}/es${readable}`);
    expect(spanishPrefixed?.status()).toBe(200);
    expect(await spanishPrefixed?.text()).toContain('<html lang="es"');
    await english.close();

    const spanish = await browser.newContext({ locale: 'es-MX' });
    const bare = await (await spanish.newPage()).goto(`${BASE_URL}${readable}`);
    expect(bare?.status()).toBe(200);
    expect(await bare?.text()).toContain('<html lang="es"');
    await spanish.close();
  });

  test('a shared link keeps the prefix, and a printed code does not change', async ({
    page,
    browser,
  }) => {
    const readable = `/events/${eventId}/${slug}`;
    await page.goto(`${BASE_URL}/es${readable}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="share-btn"]')).toHaveAttribute(
      'data-share-url',
      new RegExp(`/es/e/${code}$`)
    );

    const sharedSpanish = await open(browser, `/es/e/${code}`);
    expect(sharedSpanish.status).toBe(302);
    expect(sharedSpanish.location).toBe(`/es${readable}`);
    expect(sharedSpanish.cookie).toBeUndefined();

    const sharedEnglish = await open(browser, `/e/${code}`);
    expect(sharedEnglish.status).toBe(302);
    expect(sharedEnglish.location).toBe(readable);

    // A printed poster code is language-neutral: it lands where it always did.
    const printed = await open(browser, `/q/${qrToken}`);
    expect(printed.status).toBe(302);
    const where = printed.location || '';
    expect(where, 'a printed code resolves to the unprefixed event page').toContain(
      `/events/${eventId}`
    );
    expect(where).not.toMatch(/\/es\//);
  });

  test('a prefix reaches nothing but the language-layer pages', async ({ browser }) => {
    for (const path of [
      '/fr/events/x',
      '/ES/events/x',
      '/en/events/x',
      // OSE-1762: /es/ and /es/events are pages; the landing's other names are not.
      '/es/home',
      '/es/near',
      '/es/admin',
      '/es/api/v2/events',
      `/es/q/${qrToken}`,
      `/es/s/anything`,
      `/es/p/${code}`,
      `/es/events/${eventId}/tv`,
    ]) {
      const res = await open(browser, path);
      expect(res.status, path).toBe(404);
    }
  });

  // ── OSE-1762: the event list and the landing in Spanish ─────────────────────

  test('/es/events is the Spanish list: its words, its card, its head, a switch both ways', async ({
    page,
  }) => {
    await page.route('**/cdn-cgi/challenge-platform/**', (route) => route.abort());
    // The window and a search ride along on the switch. A new event waits out the
    // publish grace before it is listed, so the cards read are the staging stock
    // (refreshed daily), not this run's event.
    const search = '?when=next-90';
    const res = await page.goto(`${BASE_URL}/es/events${search}`, {
      waitUntil: 'domcontentloaded',
    });
    expect(res?.status(), 'the Spanish list is served by the Worker').toBe(200);
    expect((await res?.allHeaders())?.['set-cookie'], 'no cookie').toBeUndefined();

    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.locator('[data-testid="public-events-heading"]')).toHaveText(
      'En los próximos 90 días'
    );
    await expect(page.locator('[data-testid="disc-go"]')).toHaveText('Buscar');
    await expect(page.locator('[data-testid="disc-when-all"]')).toHaveText('Todo');
    await expect(page.locator('[data-testid="disc-summary"]')).toHaveText(
      /^\d+ eventos? en los próximos 90 días$/
    );
    await expect(page.locator('[data-testid="never-who-summary"]')).toContainText(
      'Nunca quién, solo cuántos.'
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/es\/events$/);
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
      'href',
      /[^s]\/events$/
    );

    const toEnglish = page.locator('[data-testid="language-switch-en"]');
    await expect(toEnglish).toHaveText('Inglés');
    await toEnglish.click();
    await expect(page).toHaveURL(`${BASE_URL}/events${search}`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('[data-testid="disc-go"]')).toHaveText('Search');
    await page.locator('[data-testid="language-switch-es"]').click();
    await expect(page).toHaveURL(`${BASE_URL}/es/events${search}`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');

    // What staging lists changes day to day, so the page is read as it is: a card
    // reads its date in Spanish, offers a Spanish button and leads to the Spanish
    // page; with no card, the empty state is Spanish. Either way it asserts.
    // `count()` does not wait, and the URL and `lang` checks above pass as soon
    // as the top of the page arrives. So wait for the list itself, a card or the
    // empty state, before counting: with 50 cards still loading the count read
    // 0 and the test waited on an empty state that never came (main, 0dd790c9).
    const cards = page.locator('[data-testid="public-event-card"]');
    await expect(
      page
        .locator('[data-testid="public-event-card"], [data-testid="public-events-empty"]')
        .first(),
      'the list has rendered: a card or the empty state'
    ).toBeVisible();
    if ((await cards.count()) === 0) {
      await expect(page.locator('[data-testid="public-events-empty"]')).toContainText(
        /^(Todavía no hay nada en los próximos 90 días\.|No hay eventos programados\.)/
      );
      return;
    }
    const card = cards.first();
    await expect(card.locator('[data-testid="public-event-date"]')).toHaveText(
      /^(lunes|martes|miércoles|jueves|viernes|sábado|domingo), \d{1,2} de [a-z]+ de \d{4}$/
    );
    await expect(card.locator('[data-testid="public-event-card-link"]')).toHaveAttribute(
      'href',
      /^\/es\/events\//
    );
    await expect(card.locator('[data-testid="public-event-cta"]')).toHaveText(
      /^(Inscribirse|Ver cómo salió)$/
    );
  });

  test('/es/ is the Spanish landing', async ({ page }) => {
    await page.route('**/cdn-cgi/challenge-platform/**', (route) => route.abort());
    const res = await page.goto(`${BASE_URL}/es/`, { waitUntil: 'domcontentloaded' });
    expect(res?.status(), 'the Spanish landing is served by the Worker').toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.locator('[data-testid="landing-h1"]')).toHaveText('¿Qué pasa cerca de ti?');
    await expect(page.locator('[data-testid="where-submit"]')).toHaveText('Buscar eventos');
    await expect(page.locator('[data-testid="nav-events"]')).toHaveAttribute('href', '/es/events');
    await expect(page.locator('[data-testid="language-switch-en"]')).toHaveText('Inglés');
  });

  // ── The header Language menu (owner 2026-11-10) ───────────────────────────
  // Wide screen: a "Language" button opens the list, the page's language marked;
  // picking another loads the whole page in it. Phone: the menu button's first
  // option is Language, which opens the same list.

  test('wide screen: the header Language button lists the languages and switches the page', async ({
    browser,
  }) => {
    const readable = `/events/${eventId}/${slug}`;
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    try {
      const page = await context.newPage();
      await page.route('**/cdn-cgi/challenge-platform/**', (route) => route.abort());
      await page.goto(`${BASE_URL}/es${readable}`, { waitUntil: 'domcontentloaded' });

      const button = page.locator('[data-testid="language-menu-button"]');
      await expect(button).toBeVisible();
      await expect(button).toHaveText(/Idioma/);
      await expect(page.locator('[data-testid="site-menu-button"]')).toBeHidden();
      // On the left: the button starts left of the site links in the top bar.
      const navBox = await page.locator('[data-testid="event-nav"]').boundingBox();
      const btnBox = await button.boundingBox();
      expect(btnBox!.x, 'Language sits left of the site links').toBeLessThan(navBox!.x);
      expect(btnBox!.height, 'target height').toBeGreaterThanOrEqual(44);

      await button.click();
      const current = page.locator('[data-testid="language-menu-es"]');
      await expect(current).toBeVisible();
      await expect(current).toHaveAttribute('aria-current', 'true');
      await expect(current).toHaveText(/Español/);
      expect(await current.evaluate((el) => el.tagName), 'the current language is not a link').toBe(
        'SPAN'
      );

      await page.locator('[data-testid="language-menu-en"]').click();
      await expect(page).toHaveURL(`${BASE_URL}${readable}`);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.locator('[data-testid="language-menu-button"]')).toHaveText(/Language/);
    } finally {
      await context.close();
    }
  });

  test('phone: the menu button opens Language first, then the list, and switches the page', async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    try {
      const page = await context.newPage();
      await page.route('**/cdn-cgi/challenge-platform/**', (route) => route.abort());
      await page.goto(`${BASE_URL}/events?when=next-90`, { waitUntil: 'domcontentloaded' });

      await expect(page.locator('[data-testid="language-menu-button"]')).toBeHidden();
      const burger = page.locator('[data-testid="site-menu-button"]');
      await expect(burger).toBeVisible();
      await expect(burger).toHaveAttribute('aria-label', 'Menu');
      const titleBox = await page.locator('[data-testid="public-title"]').boundingBox();
      expect(
        (await burger.boundingBox())!.x,
        'the menu button sits left of the title'
      ).toBeLessThan(titleBox!.x);

      await burger.click();
      const firstOption = page.locator('[data-testid="site-menu-panel"] > :first-child');
      await expect(firstOption).toHaveAttribute('data-testid', 'site-menu-language');
      await page.locator('[data-testid="site-menu-language-button"]').click();
      await expect(page.locator('[data-testid="site-menu-language-en"]')).toHaveAttribute(
        'aria-current',
        'true'
      );

      await page.locator('[data-testid="site-menu-language-es"]').click();
      await expect(page).toHaveURL(`${BASE_URL}/es/events?when=next-90`);
      await expect(page.locator('html')).toHaveAttribute('lang', 'es');
      await expect(page.locator('[data-testid="site-menu-button"]')).toHaveAttribute(
        'aria-label',
        'Menú'
      );
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, 'no sideways scroll on a phone').toBeLessThanOrEqual(0);
    } finally {
      await context.close();
    }
  });

  // F5 and F6 (owner D4, 2026-11-10): an open menu closes on a tap outside it and
  // on Escape, under the real page CSP (the closing script carries the nonce; a
  // refused script would leave the menu open and this test red).
  test('an open menu closes on a tap outside it and on Escape, with no CSP refusal', async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    try {
      const page = await context.newPage();
      const refused: string[] = [];
      page.on('console', (m) => {
        if (/Content Security Policy|Refused to execute/i.test(m.text())) refused.push(m.text());
      });
      await page.route('**/cdn-cgi/challenge-platform/**', (route) => route.abort());
      await page.goto(`${BASE_URL}/es/events/${eventId}/${slug}`, { waitUntil: 'load' });

      const menu = page.locator('[data-testid="site-menu"]');
      const isOpen = () => menu.evaluate((d) => (d as HTMLDetailsElement).open);

      await page.locator('[data-testid="site-menu-button"]').click();
      await page.locator('[data-testid="site-menu-language-button"]').click();
      // F2: a tap on the current language leaves the menu open.
      await page.locator('[data-testid="site-menu-language-es"]').click();
      expect(await isOpen(), 'a tap on the current language keeps it open').toBe(true);
      // F5: a tap outside closes it. The spot is inside <main> (the title), to
      // the right of the open panel (it is at most 18rem wide), and not a link.
      await page.locator('main').click({ position: { x: 330, y: 4 } });
      expect(await isOpen(), 'a tap outside closes it').toBe(false);

      // F6: Escape closes it and focus returns to the menu button.
      await page.locator('[data-testid="site-menu-button"]').click();
      expect(await isOpen()).toBe(true);
      await page.keyboard.press('Escape');
      expect(await isOpen(), 'Escape closes it').toBe(false);
      await expect(page.locator('[data-testid="site-menu-button"]')).toBeFocused();

      expect(refused, 'no script refused by the page CSP').toEqual([]);
    } finally {
      await context.close();
    }
  });

  // The longest Spanish strings these pages show (the doors, the chips, the
  // search placeholder, the summary) on a 320 px phone: nothing scrolls sideways,
  // inputs keep 16 px text and the controls keep a 44 px target.
  for (const path of ['/es/events?when=weekend', '/es/']) {
    test(`${path} holds at 320 px`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 320, height: 720 } });
      try {
        const page = await context.newPage();
        await page.route('**/cdn-cgi/challenge-platform/**', (route) => route.abort());
        const res = await page.goto(`${BASE_URL}${path}`, { waitUntil: 'load' });
        expect(res?.status()).toBe(200);
        await expect(page.locator('html')).toHaveAttribute('lang', 'es');
        // Open the disclosure too, so its paragraph is measured.
        await page.locator('[data-testid="never-who-summary"]').click();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow, `${path} scrolls sideways at 320 px`).toBeLessThanOrEqual(0);

        const small = await page.evaluate(() => {
          const out: string[] = [];
          for (const el of document.querySelectorAll<HTMLElement>(
            'input:not([type="hidden"]):not([type="radio"]), button, .disc-chip, .ose-lang a, .btn'
          )) {
            const box = el.getBoundingClientRect();
            if (box.width === 0 && box.height === 0) continue; // not shown
            const name = el.getAttribute('data-testid') || el.textContent?.trim() || el.tagName;
            if (box.height < 44) out.push(`${name}: ${Math.round(box.height)} px high`);
            if (el.tagName === 'INPUT' && parseFloat(getComputedStyle(el).fontSize) < 16)
              out.push(`${name}: text under 16 px`);
          }
          return out;
        });
        expect(small, `${path} controls under the floor`).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});

// ── Polish and Arabic, pairwise (OSE-1957, epic OSE-1959, story OSE-1972) ────
// The full set is 4 languages x 5 pages x 5 viewports x 4 menu states x 2
// themes = 800 cells. The node layer runs all 800
// (workers/oursharedevents/tests/language-permutations.spec.ts). A real browser
// runs the pairwise subset: every pair of values in at least one row (owner
// 2026-11-08: pairs, not every combination). On staging the page factor is the
// three pages a fresh run can reach (the event page before it starts, /events,
// the landing); the live and recap phases are covered at the node layer.

const PW_LANGS = ['en', 'es', 'pl', 'ar'] as const;
const PW_PAGES = ['event', 'events', 'landing'] as const;
const PW_VIEWPORTS = [320, 375, 640, 641, 1280] as const;
const PW_MENUS = ['closed', 'wide-open', 'phone-open', 'phone-language-open'] as const;
const PW_THEMES = ['dark', 'light'] as const;
type PwRow = {
  lang: (typeof PW_LANGS)[number];
  page: (typeof PW_PAGES)[number];
  viewport: (typeof PW_VIEWPORTS)[number];
  menu: (typeof PW_MENUS)[number];
  theme: (typeof PW_THEMES)[number];
};
const PW_FACTORS = ['lang', 'page', 'viewport', 'menu', 'theme'] as const;

/** Every pair of values two factors take in a row, as strings. */
function pairsOf(row: PwRow): string[] {
  const out: string[] = [];
  for (let i = 0; i < PW_FACTORS.length; i++) {
    for (let j = i + 1; j < PW_FACTORS.length; j++) {
      out.push(`${PW_FACTORS[i]}=${row[PW_FACTORS[i]]}|${PW_FACTORS[j]}=${row[PW_FACTORS[j]]}`);
    }
  }
  return out;
}

function allCells(): PwRow[] {
  const all: PwRow[] = [];
  for (const lang of PW_LANGS)
    for (const page of PW_PAGES)
      for (const viewport of PW_VIEWPORTS)
        for (const menu of PW_MENUS)
          for (const theme of PW_THEMES) all.push({ lang, page, viewport, menu, theme });
  return all;
}

/** Greedy all-pairs: deterministic, so the same rows run every time. */
function pairwiseRows(): PwRow[] {
  const all = allCells();
  const left = new Set(all.flatMap(pairsOf));
  const rows: PwRow[] = [];
  while (left.size) {
    let best = all[0];
    let bestHits = -1;
    for (const r of all) {
      const hits = pairsOf(r).filter((p) => left.has(p)).length;
      if (hits > bestHits) [best, bestHits] = [r, hits];
    }
    rows.push(best);
    for (const p of pairsOf(best)) left.delete(p);
  }
  return rows;
}

const PW_ROWS = pairwiseRows();

test.describe('Polish and Arabic on staging, pairwise rows (OSE-1972)', () => {
  let eventId: string | null = null;
  let slug = '';

  test('the rows cover every pair of values, in far fewer rows than the cells', () => {
    const covered = new Set(PW_ROWS.flatMap(pairsOf));
    const missing = [...new Set(allCells().flatMap(pairsOf))].filter((p) => !covered.has(p));
    expect(missing).toEqual([]);
    expect(PW_ROWS.length).toBeLessThan(40);
  });

  test.beforeAll(async ({ request }) => {
    precondition(!ADMIN_KEY, 'ADMIN_KEY or X_OCR_INTERNAL is required');
    slug = `language-pairwise-${RUN_ID}`;
    const created = await adminFetch(request, 'POST', '/api/v2/admin/events', {
      brand_id: 'root',
      title: `Bocce Night #3! ${RUN_ID}`,
      slug,
      status: 'active',
      is_published: true,
      description: 'Temporary pairwise language event.',
      location: 'Pairwise Hall',
      start_date: '2099-03-01',
      end_date: '2099-03-01',
      timezone: 'America/Chicago',
    });
    expect(created.status(), 'create event').toBe(201);
    eventId = (await created.json()).id;
  });

  test.afterAll(async ({ request }) => {
    if (!eventId) return;
    try {
      await adminFetch(request, 'DELETE', `/api/v2/admin/events/${encodeURIComponent(eventId)}`);
    } catch {
      // Best-effort: the slug is per-run unique and the date is 2099.
    }
  });

  for (const row of PW_ROWS) {
    const name = `${row.lang} ${row.page} ${row.viewport}px ${row.menu} ${row.theme}`;
    test(name, async ({ browser }, testInfo) => {
      const context = await browser.newContext({
        viewport: { width: row.viewport, height: 800 },
        colorScheme: row.theme,
      });
      try {
        const page = await context.newPage();
        await page.route('**/cdn-cgi/challenge-platform/**', (route) => route.abort());
        const prefix = row.lang === 'en' ? '' : `/${row.lang}`;
        const path =
          row.page === 'event'
            ? `${prefix}/events/${eventId}/${slug}`
            : row.page === 'events'
              ? `${prefix}/events`
              : `${prefix}/`;
        const res = await page.goto(`${BASE_URL}${path}`, { waitUntil: 'load' });
        expect(res?.status(), `${path} is served`).toBe(200);
        expect((await res?.allHeaders())?.['set-cookie'], 'no cookie').toBeUndefined();

        const rtl = row.lang === 'ar';
        await expect(page.locator('html')).toHaveAttribute('lang', row.lang);
        await expect(page.locator('html')).toHaveAttribute('dir', rtl ? 'rtl' : 'ltr');

        const phone = row.viewport <= 640;
        const wideButton = page.locator('[data-testid="language-menu-button"]');
        const burger = page.locator('[data-testid="site-menu-button"]');
        const control = phone ? burger : wideButton;
        await expect(control).toBeVisible();
        await expect(phone ? wideButton : burger).toBeHidden();

        // The menu sits at the reading start: the left half in ltr, the right in rtl.
        const box = (await control.boundingBox())!;
        const centre = box.x + box.width / 2;
        if (rtl) expect(centre, 'menu on the right in rtl').toBeGreaterThan(row.viewport / 2);
        else expect(centre, 'menu on the left in ltr').toBeLessThan(row.viewport / 2);
        expect(box.height, 'target height').toBeGreaterThanOrEqual(44);

        const family = phone ? 'site-menu-language' : 'language-menu';
        const listOpen =
          (row.menu === 'wide-open' && !phone) || (row.menu === 'phone-language-open' && phone);
        if (row.menu === 'wide-open' && !phone) await wideButton.click();
        if (row.menu.startsWith('phone') && phone) {
          await burger.click();
          await expect(page.locator('[data-testid="site-menu-language-button"]')).toBeVisible();
          if (row.menu === 'phone-language-open') {
            await page.locator('[data-testid="site-menu-language-button"]').click();
          }
        }
        for (const l of PW_LANGS) {
          const item = page.locator(`[data-testid="${family}-${l}"]`);
          if (listOpen) await expect(item).toBeVisible();
          else await expect(item).toBeHidden();
        }
        if (listOpen) {
          const current = page.locator(`[data-testid="${family}-${row.lang}"]`);
          await expect(current).toHaveAttribute('aria-current', 'true');
          // The open list stays on the screen.
          const list = (await current.boundingBox())!;
          expect(list.x, 'list inside the left edge').toBeGreaterThanOrEqual(0);
          expect(list.x + list.width, 'list inside the right edge').toBeLessThanOrEqual(
            row.viewport
          );
        }

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow, 'no sideways scroll').toBeLessThanOrEqual(0);
        if (rtl) {
          await testInfo.attach(`${name}.png`, {
            body: await page.screenshot({ fullPage: false }),
            contentType: 'image/png',
          });
        }
      } finally {
        await context.close();
      }
    });
  }
});

// ── The Arabic event page keeps left-to-right values in order (OSE-1966) ──
//
// The owner's phone screenshot of /ar/ on staging (2026-11-10) showed a sponsor
// address as "S Cicero Ave, Oak Lawn, IL 60453 9333": the right-to-left page
// pulled the house number to the far end. This block builds the same shape (an
// event with an English title, type, address, why and how, and an accepted
// sponsor with an address), opens it at 375 px, and checks where the glyphs
// land: the house number's first digit must sit LEFT of the street letter, as
// in English. The node layer (workers/oursharedevents/tests/
// event-page-arabic-bidi.spec.ts) covers the live and recap phases and the
// price note; the admin create route takes no price, so it is not set here.

test.describe('Arabic event page: left-to-right values keep their order at 375 px (OSE-1966)', () => {
  let eventId: string | null = null;
  let sponsorId: string | null = null;
  let slug = '';
  const SPONSOR_ADDRESS = '9333 S Cicero Ave, Oak Lawn, IL 60453';
  const EVENT_ADDRESS = '9401 S Oak Park Ave, Oak Lawn, IL 60453';

  test.beforeAll(async ({ request }) => {
    precondition(!ADMIN_KEY, 'ADMIN_KEY or X_OCR_INTERNAL is required');
    slug = `arabic-bidi-${RUN_ID}`;
    const created = await adminFetch(request, 'POST', '/api/v2/admin/events', {
      brand_id: 'root',
      title: `Turkey Hoops #3! ${RUN_ID}`,
      slug,
      status: 'active',
      is_published: true,
      description: 'Basketball shooting and skills contest at the pavilion.',
      location: 'Community Pavilion',
      where_address: EVENT_ADDRESS,
      why_purpose: 'Raise $500 for the food pantry!',
      how_details: 'Bring sneakers; sign-in at 9:30 AM.',
      event_type_id: 'etr-rec-pickup',
      start_date: '2099-11-26',
      start_time: '10:00',
      end_date: '2099-11-26',
      timezone: 'America/Chicago',
    });
    expect(created.status(), 'create event').toBe(201);
    eventId = (await created.json()).id;

    const sponsor = await adminFetch(request, 'POST', '/api/v2/admin/sponsors', {
      name: `Hilton Chicago/Oak Lawn ${RUN_ID}`,
      event_id: eventId,
      tier: 'gold',
      website_url: null,
      address_line: SPONSOR_ADDRESS,
    });
    expect([200, 201], 'create sponsor').toContain(sponsor.status());
    const sp = await sponsor.json();
    sponsorId = sp.id;
    // Strict consent (ADR-019): the sponsor accepts on its own link before it shows.
    const mint = await adminFetch(request, 'POST', `/api/v2/admin/sponsors/${sponsorId}/home-link`);
    expect(mint.status(), 'mint sponsor home link').toBe(200);
    const token = new URL((await mint.json()).url).searchParams.get('t');
    const accepted = await adminFetch(
      request,
      'POST',
      `/api/v2/sponsor/placements/${sp.placement_id}/respond`,
      { token, accepted: true }
    );
    expect(accepted.status(), 'sponsor accepts').toBe(200);
  });

  test.afterAll(async ({ request }) => {
    for (const path of [
      sponsorId && `/api/v2/admin/sponsors/${encodeURIComponent(sponsorId)}`,
      eventId && `/api/v2/admin/events/${encodeURIComponent(eventId)}`,
    ]) {
      if (!path) continue;
      try {
        await adminFetch(request, 'DELETE', path);
      } catch {
        // Best-effort: the slug is per-run unique and the date is 2099.
      }
    }
  });

  test('addresses, type, why and how read in order; the time names the zone in Arabic', async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    try {
      const page = await context.newPage();
      await page.route('**/cdn-cgi/challenge-platform/**', (route) => route.abort());
      const res = await page.goto(`${BASE_URL}/ar/events/${eventId}/${slug}`, {
        waitUntil: 'load',
      });
      expect(res?.status()).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

      // Each value sits in its own <bdi>.
      await expect(page.locator('[data-testid="sponsor-item-address"] bdi')).toHaveText(
        SPONSOR_ADDRESS
      );
      await expect(page.locator('[data-testid="event-type"] bdi')).toHaveText('Pickup Basketball');
      await expect(page.locator('[data-testid="event-why"] bdi')).toHaveText(
        'Raise $500 for the food pantry!'
      );
      await expect(page.locator('[data-testid="event-how"] bdi')).toHaveText(
        'Bring sneakers; sign-in at 9:30 AM.'
      );

      // Where the glyphs land: the first digit of the house number is left of
      // the "S" of the street, and the "!" is right of the last word.
      const leftOf = (testid: string, a: number, b: number) =>
        page.evaluate(
          ({ testid, a, b }) => {
            const el = document.querySelector(`[data-testid="${testid}"] bdi`);
            const node = el?.firstChild;
            if (!node) return null;
            const x = (i: number) => {
              const r = document.createRange();
              r.setStart(node, i);
              r.setEnd(node, i + 1);
              return r.getBoundingClientRect().left;
            };
            return x(a) < x(b);
          },
          { testid, a, b }
        );
      expect(await leftOf('sponsor-item-address', 0, 5), 'house number first').toBe(true);
      expect(await leftOf('event-type', 0, 7), '"Pickup" before "Basketball"').toBe(true);
      const why = 'Raise $500 for the food pantry!';
      expect(await leftOf('event-why', why.length - 2, why.length - 1), '"!" at the end').toBe(
        true
      );
      expect(await leftOf('event-why', 6, 7), '"$" before "500"').toBe(true);

      // 12-hour clock, the zone by its city in Arabic, not "GMT-6".
      const when = (await page.locator('[data-testid="event-when"]').innerText()).trim();
      expect(when).toMatch(/10:00 ص توقيت شيكاغو/);
      expect(when).not.toMatch(/غرينتش|GMT|CST/);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, 'no sideways scroll').toBeLessThanOrEqual(0);
      await testInfo.attach('arabic-event-375.png', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    } finally {
      await context.close();
    }
  });
});

// ── The form pages in every language (OSE-1850, OSE-1943) ───────────────────
// The owner's report, 2026-11-10, word for word: "Does not translate to the
// selected language". A phone reader picked a language on the event page,
// tapped check-in, and got an English page with no Language menu. Each row
// here walks that path on staging at phone width, then submits in that
// language. The words are the catalog's (workers/oursharedevents/src/lib/i18n).

const FORM_ROWS = [
  {
    lang: 'es',
    dir: 'ltr',
    heading: 'Registrar llegada',
    done: 'Tu llegada quedó registrada.',
    band: 'Solo para pruebas.',
  },
  { lang: 'pl', dir: 'ltr', heading: 'Zamelduj się', done: 'Zameldowano.', band: null },
  { lang: 'ar', dir: 'rtl', heading: 'تسجيل الحضور', done: 'تم تسجيل حضورك.', band: null },
] as const;

// English a reader of another language must not see outside the marked legal text.
const ENGLISH_FORM_WORDS = [
  'Tap to',
  'Check In',
  'Didn’t register?',
  "Didn't register?",
  'walk-in',
  'Back',
  'Privacy details',
];

test.describe('Form pages in every language on staging (OSE-1850)', () => {
  let eventId: string | null = null;
  let slug = '';

  test.beforeAll(async ({ request }) => {
    precondition(!ADMIN_KEY, 'ADMIN_KEY or X_OCR_INTERNAL is required');
    slug = `language-forms-${RUN_ID}`;
    const created = await adminFetch(request, 'POST', '/api/v2/admin/events', {
      brand_id: 'root',
      title: `Language Forms ${RUN_ID}`,
      slug,
      status: 'active',
      is_published: true,
      description: 'Temporary language form event.',
      location: 'Language Forms Hall',
      start_date: '2099-04-01',
      end_date: '2099-04-01',
      timezone: 'America/Chicago',
    });
    expect(created.status(), 'create event').toBe(201);
    eventId = (await created.json()).id;
  });

  test.afterAll(async ({ request }) => {
    if (!eventId) return;
    try {
      await adminFetch(request, 'DELETE', `/api/v2/admin/events/${encodeURIComponent(eventId)}`);
    } catch {
      // Best-effort: the slug is per-run unique and the date is 2099.
    }
  });

  for (const row of FORM_ROWS) {
    test(`${row.lang}: event page, tap check-in, the form is ${row.lang}, then check in`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
      try {
        const page = await context.newPage();
        await page.route('**/cdn-cgi/challenge-platform/**', (route) => route.abort());
        const eventPath = `/${row.lang}/events/${eventId}/${slug}`;
        expect((await page.goto(`${BASE_URL}${eventPath}`))?.status(), eventPath).toBe(200);

        const formPath = `/${row.lang}/events/${eventId}/checkin`;
        const choice = page.locator('[data-testid="event-choice-checkin"]');
        await expect(choice).toHaveAttribute('href', formPath);
        await choice.click();
        await page.waitForURL(`${BASE_URL}${formPath}`);

        await expect(page.locator('html')).toHaveAttribute('lang', row.lang);
        await expect(page.locator('html')).toHaveAttribute('dir', row.dir);
        await expect(page.locator('[data-testid="form-checkin"] h2')).toHaveText(row.heading);
        // The staging band reads in the page language too.
        const band = page.locator('[data-testid="test-site-notice"]');
        await expect(band).toBeVisible();
        await expect(band).not.toContainText('Testing purposes only.');
        if (row.band) await expect(band).toContainText(row.band);
        const visible = await page.evaluate(() => {
          const copy = document.body.cloneNode(true) as HTMLElement;
          copy
            .querySelectorAll('script, style, [lang="en"], [data-testid="language-menu"] li')
            .forEach((el) => el.remove());
          return copy.textContent ?? '';
        });
        for (const en of ENGLISH_FORM_WORDS) {
          expect(visible, `"${en}" on the ${row.lang} page`).not.toContain(en);
        }
        // The privacy text says, in the page language, why it is in English.
        await expect(page.locator('[data-testid="privacy-english-note"]')).toBeVisible();
        await expect(page.locator('[data-testid="privacy-details"] p')).toHaveAttribute(
          'lang',
          'en'
        );

        // The phone menu, at the reading start, Language first, back to English.
        const burger = page.locator('[data-testid="site-menu-button"]');
        await expect(burger).toBeVisible();
        const box = (await burger.boundingBox())!;
        if (row.dir === 'rtl') expect(box.x + box.width / 2).toBeGreaterThan(375 / 2);
        else expect(box.x + box.width / 2).toBeLessThan(375 / 2);
        expect(box.height).toBeGreaterThanOrEqual(44);
        await burger.click();
        await page.locator('[data-testid="site-menu-language-button"]').click();
        await expect(
          page.locator(`[data-testid="site-menu-language-${row.lang}"]`)
        ).toHaveAttribute('aria-current', 'true');
        await expect(page.locator('[data-testid="site-menu-language-en"]')).toHaveAttribute(
          'href',
          `/events/${eventId}/checkin`
        );
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-testid="form-back"]')).toHaveAttribute(
          'href',
          `/${row.lang}/events/${eventId}`
        );
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow, 'no sideways scroll at 375 px').toBeLessThanOrEqual(0);

        // Check in. The form posts to the unprefixed API and sends no language.
        const posted = page.waitForRequest(
          (r) =>
            r.method() === 'POST' && r.url().includes(`/api/v2/events/${eventId}/forms/checkin`)
        );
        await page.locator('[data-testid="checkin-submit"]').click();
        const req = await posted;
        expect(new URL(req.url()).pathname).toBe(`/api/v2/events/${eventId}/forms/checkin`);
        expect(Object.keys(req.postDataJSON() ?? {})).toEqual(['sourcePlacementId']);
        await expect(page.locator('[data-testid="checkin-count"]')).toHaveText(row.done);
      } finally {
        await context.close();
      }
    });
  }

  test('a bare form address follows the browser language; a near miss under a prefix is a 404', async ({
    browser,
  }) => {
    const context = await browser.newContext({ locale: 'es-MX' });
    try {
      const page = await context.newPage();
      await page.route('**/cdn-cgi/challenge-platform/**', (route) => route.abort());
      await page.goto(`${BASE_URL}/events/${eventId}/register`);
      await expect(page.locator('html')).toHaveAttribute('lang', 'es');
      await expect(page.locator('[data-testid="form-register"] h2')).toHaveText(
        'Inscríbete en este evento'
      );
    } finally {
      await context.close();
    }
    for (const path of [`/es/events/${eventId}/checkin/`, `/es/events/${eventId}/Checkin`]) {
      expect((await open(browser, path)).status, path).toBe(404);
    }
  });
});
