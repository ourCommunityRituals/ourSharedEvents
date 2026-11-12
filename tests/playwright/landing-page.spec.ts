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
import {
  createLiveEvent,
  seedSponsorCard,
  waitUntilListed,
  type SeededSponsorHome,
} from './helpers/sponsor-home-seed';

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

  test('one h1 asks where you are, and the town-or-zip box is labelled', async ({ page }) => {
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByTestId('landing-h1')).toHaveText(/What.s happening near you\?/);
    await expect(page.getByTestId('where-input')).toBeVisible();
    await expect(page.getByLabel('Town or zip code')).toBeVisible();
    await expect(page.getByTestId('where-submit')).toHaveText('Find events');
  });

  // Owner 2026-11-06: a town name first, then a zip; one name can be many places.
  test('a name that is many places offers every one to choose from', async ({ page }) => {
    await page.getByTestId('where-input').fill('Springfield');
    await page.getByTestId('where-submit').click();
    await expect(page).toHaveURL(/[?&]where=Springfield/);
    await expect(page.getByTestId('where-msg')).toHaveCount(0);
    // The box is a plain GET form, so toHaveURL passes when the navigation
    // commits, before the new page has parsed its list. A one-shot count()
    // there could read 0; poll until the list is in.
    const choices = page.getByTestId('where-choice');
    await expect.poll(() => choices.count()).toBeGreaterThanOrEqual(20);
    await expect(page.getByTestId('where-choices')).toContainText('places are called Springfield');
    await page.getByRole('link', { name: 'Springfield, IL', exact: true }).click();
    await expect(page).toHaveURL(/[?&]where=Springfield%2C(%20|\+)IL/);
    await expect(page.getByTestId('where-choices')).toHaveCount(0);
    await expect(page.getByTestId('area-heading')).toContainText('Near Springfield, IL');
    await expect(page.getByTestId('where-input')).toHaveValue('Springfield, IL');
  });

  test('a town name with one place goes straight to it', async ({ page }) => {
    await page.getByTestId('where-input').fill('Oak Lawn');
    await page.getByTestId('where-submit').click();
    await expect(page.getByTestId('area-heading')).toContainText('Near Oak Lawn, IL');
    await expect(page.getByTestId('where-choices')).toHaveCount(0);
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
    await page.getByTestId('where-input').fill('00000');
    await page.getByTestId('where-submit').click();
    await expect(page).toHaveURL(/[?&]where=00000/);
    await expect(page.getByTestId('where-msg')).toContainText("couldn't find zip 00000");
    await expect(page.getByTestId('where-input')).toHaveAttribute('aria-invalid', 'true');
  });

  test('links are real and images carry alt text', async ({ page }) => {
    expect(await page.locator('a[href=""], a[href="#"], a:not([href])').count()).toBe(0);
    for (const img of await page.locator('img').all()) {
      expect(await img.getAttribute('alt')).not.toBeNull();
    }
  });

  test('the keyboard reaches the town-or-zip box and both doors', async ({ page }) => {
    const targets = [
      'landing-skip-link',
      'where-input',
      'door-create-event',
      'door-create-sponsor',
    ];
    // One Tab per focusable control, plus slack: at 10+ events the doors sit
    // below the area, and every event card adds its own links.
    const budget =
      (await page
        .locator('a[href], button, input, select, textarea, summary, [tabindex]')
        .count()) + 5;
    const reached = new Set<string>();
    for (let i = 0; i < budget && !targets.every((t) => reached.has(t)); i++) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      if (id) reached.add(id);
    }
    expect([...reached]).toEqual(expect.arrayContaining(targets));
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

// Owner 2026-11-09: "Event Types should be Categories. When clicked you get all
// the event types under this category". Two types under Arts and one under
// Business, made through the admin API; a tap on the Arts chip shows both Arts
// events and hides the Business one, with no script and no request.
// @born-red landing-category-click | method: the card tagged by its type id
//   instead of its category (the Arts chip then hid both Arts events), and the
//   category rule's selector misspelt (nothing hidden) — each turned it red
//   | date: 2026-11-09
test.describe('landing: the Type row is the event categories', () => {
  const run = Date.now();
  const titles = {
    music: `Category probe music ${run}`,
    gallery: `Category probe gallery ${run}`,
    mixer: `Category probe mixer ${run}`,
  };

  test.beforeAll(async ({ request }) => {
    test.setTimeout(150_000);
    expect(ADMIN_BEARER, 'OSE_ADMIN_BEARER is set by playwright.mobile.config.ts').not.toBe('');
    const made = [
      await createLiveEvent(request, ADMIN_BEARER, titles.music, 12, undefined, 'etr-art-music'),
      await createLiveEvent(
        request,
        ADMIN_BEARER,
        titles.gallery,
        13,
        undefined,
        'etr-art-gallery'
      ),
      await createLiveEvent(request, ADMIN_BEARER, titles.mixer, 14, undefined, 'etr-biz-mixer'),
    ];
    await waitUntilListed(
      made
        .map((m) => m.listedFrom)
        .sort()
        .at(-1) ?? null
    );
  });

  test('a category chip shows every type under it, and only those', async ({ page }) => {
    await loadAndRecord(page);
    const row = page.getByTestId('toggle-type');
    await expect(row).toBeVisible();
    // Real category names, never a type id made readable ("Etr Art Music").
    await expect(row).not.toContainText('Etr ');
    await expect(page.locator('label[for="type-all"]')).toHaveText('All types');
    await expect(page.locator('#type-all')).toBeChecked();
    const arts = page.locator('label[for="cat-art"]');
    await expect(arts).toHaveText('Arts, Culture & Live Music');
    await expect(page.locator('label[for="cat-biz"]')).toHaveText('Business & Networking');

    const card = (title: string) =>
      page.getByTestId('area-card').filter({ has: page.getByText(title, { exact: true }) });
    for (const t of Object.values(titles)) await expect(card(t), t).toBeVisible();

    const requestsAfterLoad: string[] = [];
    page.on('request', (r) => requestsAfterLoad.push(r.url()));
    await arts.click();
    await expect(page.locator('#cat-art')).toBeChecked();
    await expect(card(titles.music)).toBeVisible();
    await expect(card(titles.gallery)).toBeVisible();
    await expect(card(titles.mixer)).toBeHidden();

    await page.locator('label[for="type-all"]').click();
    await expect(card(titles.mixer)).toBeVisible();
    expect(requestsAfterLoad, 'choosing a category stays on the device').toEqual([]);
  });
});

// Owner 2026-11-09: "Omit sponsors from the search criteria". The consented
// sponsor shows by the title (OSE-1522), but a visitor never finds or filters an
// event by its sponsor.
// @born-red sponsor-not-search-criterion | method: the sponsor title added to the
//   /events search text (the sponsor name then found its event), and a sponsor
//   class on the landing card — each turned it red | date: 2026-11-11
test.describe('search and filters: a sponsor is never a search criterion', () => {
  let seeded: SeededSponsorHome;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(150_000);
    expect(ADMIN_BEARER, 'OSE_ADMIN_BEARER is set by playwright.mobile.config.ts').not.toBe('');
    // An accepted placement on a live event: the card shows "Supported by <sponsor>".
    seeded = await seedSponsorCard(request, ADMIN_BEARER, 'Omit');
    await waitUntilListed(seeded.listedFrom);
  });

  async function search(page: Page, q: string): Promise<void> {
    await page.goto('/events');
    await page.getByTestId('disc-q').fill(q);
    await page.getByTestId('disc-go').click();
    await page.waitForURL(/[?&]q=/);
  }

  test('/events: the sponsor name finds nothing, though the card shows the sponsor', async ({
    page,
  }) => {
    const card = page.locator(`[data-event-id="${seeded.eventId}"]`);
    // Not vacuous: the event is found by its own name, and its card names the sponsor.
    await search(page, seeded.eventTitle);
    await expect(card).toBeVisible();
    await expect(card).toContainText(`Supported by ${seeded.sponsorName}`);

    await search(page, seeded.sponsorName);
    await expect(page.getByTestId('disc-q')).toHaveValue(seeded.sponsorName);
    await expect(card).toHaveCount(0);
    await expect(page.getByText(`Supported by ${seeded.sponsorName}`)).toHaveCount(0);
  });

  test('landing: no filter names a sponsor, and the card is not tagged by it', async ({ page }) => {
    await loadAndRecord(page);
    const card = page.locator(`[data-testid="area-list"] [data-event-id="${seeded.eventId}"]`);
    await expect(card).toBeVisible();
    await expect(card).toContainText(`Supported by ${seeded.sponsorName}`);
    expect(await card.getAttribute('class')).not.toMatch(/sponsor/i);
    const toggles = page.getByTestId('area-toggles');
    await expect(toggles).toBeVisible();
    await expect(toggles).not.toContainText(seeded.sponsorName);
    for (const id of await toggles
      .locator('label')
      .evaluateAll((ls) => ls.map((l) => l.getAttribute('for') ?? ''))) {
      expect(id, 'a filter choice is never a sponsor').not.toMatch(/sponsor/i);
    }
  });
});
