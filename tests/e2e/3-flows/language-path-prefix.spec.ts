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
    await expect(toEnglish).toHaveText('English');
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

  test('a prefix reaches nothing but the event page and its share link', async ({ browser }) => {
    for (const path of [
      '/fr/events/x',
      '/ES/events/x',
      '/en/events/x',
      '/es',
      '/es/events',
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
});
