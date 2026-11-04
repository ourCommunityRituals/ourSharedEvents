/**
 * The landing page as a visitor's browser sees it (OSE-1312).
 *
 * This file used to test an email-capture landing (a Mailchimp form) that was
 * replaced in September and rewritten again on 2026-10-10 (#913). It ran in no
 * workflow, so nothing noticed it was testing a page that no longer existed.
 * It now tests the page that ships: one question ("where are you?"), the two
 * organizer doors, and the area of events with its CSS-only toggles.
 *
 * What only a real browser can show, and the markup specs cannot:
 *   - the page lives up to its own privacy line: no cookie, no request to any
 *     other host, and no location request on arrival;
 *   - the controls are reachable by keyboard and carry accessible names;
 *   - the headers a browser enforces (CSP, framing) are on the response.
 * The markup itself is gated in workers/oursharedevents/tests/landing-where.spec.ts
 * and landing-area.spec.ts.
 *
 * Runs in the blocking phone audit (playwright.mobile.config.ts), against the
 * local worker that config starts. Relative URLs only: the config owns the host.
 */
import { test, expect, type Page } from '@playwright/test';
import { createLiveEvent, waitUntilListed } from './helpers/sponsor-home-seed';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';

/** Every request the page makes while loading, by URL. */
async function loadAndRecord(page: Page, path = '/'): Promise<string[]> {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  const res = await page.goto(path);
  expect(res?.status(), `GET ${path}`).toBe(200);
  await page.waitForLoadState('networkidle');
  return urls;
}

test.describe('landing: the page keeps its own privacy promise', () => {
  test('sets no cookie and makes no request to another host', async ({ page, context }) => {
    const urls = await loadAndRecord(page);
    const origin = new URL(page.url()).origin;
    const offsite = urls.filter((u) => !u.startsWith('data:') && new URL(u).origin !== origin);
    expect(offsite, 'no analytics, fonts or embeds from another host').toEqual([]);
    expect(await context.cookies(), 'the landing sets no cookie').toEqual([]);
  });

  test('does not ask for the location on arrival', async ({ page }) => {
    // Count every call into the geolocation API before any page script runs.
    await page.addInitScript(() => {
      const w = window as unknown as { __geoCalls: number };
      w.__geoCalls = 0;
      const geo = navigator.geolocation;
      if (!geo) return;
      const count = () => {
        w.__geoCalls += 1;
      };
      geo.getCurrentPosition = count as unknown as Geolocation['getCurrentPosition'];
      geo.watchPosition = (() => {
        count();
        return 0;
      }) as unknown as Geolocation['watchPosition'];
    });
    await loadAndRecord(page);
    const calls = await page.evaluate(
      () => (window as unknown as { __geoCalls: number }).__geoCalls
    );
    expect(calls, 'location is asked only after the visitor taps "Use my location"').toBe(0);
  });

  test('carries no third-party form, key or developer leftovers', async ({ page }) => {
    await loadAndRecord(page);
    const html = await page.content();
    expect(html).not.toMatch(/list-manage\.com|mailchimp\.com/i);
    expect(html).not.toMatch(/[a-f0-9]{32}-us\d+/i); // Mailchimp API key shape
    expect(await page.locator('meta[name="author"]').count()).toBe(0);
    const leaky = (html.match(/<!--[\s\S]*?-->/g) || []).filter((c) =>
      /\b(todo|fixme|hack|password|secret|api[_-]?key|token)\b/i.test(c)
    );
    expect(leaky).toEqual([]);
  });

  test('sends a CSP and refuses to be framed', async ({ page }) => {
    const res = await page.goto('/');
    const headers = res?.headers() ?? {};
    const csp = headers['content-security-policy'] ?? '';
    expect(csp, 'Content-Security-Policy').not.toBe('');
    expect(!!headers['x-frame-options'] || csp.includes('frame-ancestors')).toBe(true);
  });

  test('loads with no console error, no failed asset and no source map', async ({ page }) => {
    const errors: string[] = [];
    const failed: string[] = [];
    const maps: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('response', (r) => {
      if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
      if (r.url().endsWith('.map')) maps.push(r.url());
    });
    await loadAndRecord(page);
    expect(errors).toEqual([]);
    expect(failed).toEqual([]);
    expect(maps).toEqual([]);
  });
});

test.describe('landing: what the visitor sees first', () => {
  test.beforeEach(async ({ page }) => {
    await loadAndRecord(page);
  });

  test('one h1 asks where you are, and the zip box is labelled', async ({ page }) => {
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByTestId('landing-h1')).toHaveText(/What.s happening near you\?/);
    const zip = page.getByTestId('where-zip');
    await expect(zip).toBeVisible();
    await expect(page.getByLabel('Your zip code')).toBeVisible();
    await expect(page.getByTestId('where-submit')).toHaveText('Find events');
  });

  test('both organizer doors are there and lead to admin', async ({ page }) => {
    await expect(page.getByTestId('door-create-event')).toHaveAttribute(
      'href',
      '/admin?start=event'
    );
    await expect(page.getByTestId('door-create-sponsor')).toHaveAttribute(
      'href',
      '/admin?start=sponsor'
    );
  });

  test('an unknown zip says so instead of showing nothing', async ({ page }) => {
    await page.getByTestId('where-zip').fill('00000');
    await page.getByTestId('where-submit').click();
    await expect(page).toHaveURL(/[?&]zip=00000/);
    await expect(page.getByTestId('where-msg')).toContainText("couldn't find zip 00000");
    await expect(page.getByTestId('where-zip')).toHaveAttribute('aria-invalid', 'true');
  });

  test('links are real and images carry alt text', async ({ page }) => {
    expect(await page.locator('a[href=""], a[href="#"], a:not([href])').count()).toBe(0);
    for (const img of await page.locator('img').all()) {
      expect(await img.getAttribute('alt')).not.toBeNull();
    }
  });

  test('the keyboard reaches the zip box and the doors', async ({ page }) => {
    const reached = new Set<string>();
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      if (id) reached.add(id);
    }
    expect([...reached]).toEqual(
      expect.arrayContaining(['landing-skip-link', 'where-zip', 'door-create-event'])
    );
  });
});

test.describe('landing: an area with events', () => {
  test.beforeAll(async ({ request }) => {
    // The local worker lists a new event one minute after it goes live.
    test.setTimeout(150_000);
    // No skip: a skipped check on a required job would read as a pass.
    expect(ADMIN_BEARER, 'OSE_ADMIN_BEARER is set by playwright.mobile.config.ts').not.toBe('');
    // Unique per run: a local D1 keeps rows between runs and the slug must be free.
    const ev = await createLiveEvent(
      request,
      ADMIN_BEARER,
      `Landing toggles probe ${Date.now()}`,
      10
    );
    await waitUntilListed(ev.listedFrom);
  });

  test('offers both list and map, and the four time windows', async ({ page }) => {
    await loadAndRecord(page);
    await expect(page.getByTestId('area-list')).toBeVisible();
    await expect(page.getByTestId('toggle-view')).toBeVisible();
    await expect(page.locator('label[for="view-list"]')).toBeVisible();
    await expect(page.locator('label[for="view-map"]')).toBeVisible();
    await expect(page.getByTestId('toggle-window')).toBeVisible();
    for (const w of ['weekend', 'week', 'month', 'next-90']) {
      await expect(page.locator(`label[for="win-${w}"]`), `window ${w}`).toBeVisible();
    }
    // The widest window is the default (lib/landing-area.ts DEFAULT_WINDOW).
    await expect(page.locator('#win-next-90')).toBeChecked();
  });
});
