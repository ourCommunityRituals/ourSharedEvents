/**
 * SharedReport counts, end to end: a sponsor is placed and accepts, TV screens
 * show it, the organizer makes a report link in /admin, and the report's
 * sponsor table says how many displays there were — or says nothing while the
 * number is under the count floor of 5.
 *
 * Every display here is a real page load of /display in a browser: the page
 * fetches its sponsor bundle, receives a beacon token, and posts the
 * impression itself. The spec counts the beacons the server accepted (201) and
 * expects the report to show exactly that number.
 *
 * One caller counts once per placement per hour (lib/invalid-traffic),
 * so each "screen" is a browser context with its own forwarded address. That
 * header is honoured here only because nothing sits in front of the local
 * worker; behind Cloudflare the edge sets the caller's address.
 *
 * Runs against the local worker of playwright.mobile.config.ts.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { seedSponsorHome, type SeededSponsorHome } from './helpers/sponsor-home-seed';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';
const PHONE = { width: 375, height: 812 };
// The default headless user agent is classed as automated and never counted.
const TV_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const FLOOR = 5;

test.describe.configure({ mode: 'serial' });

let seeded: SeededSponsorHome;
let reportUrl = '';
let counted = 0;
let nextScreen = 1;
const run = Math.floor(Math.random() * 200) + 20;

/** One TV screen loads /display once. Returns how many beacons the server counted. */
async function oneScreen(browser: Browser, n: number): Promise<number> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: TV_UA,
    extraHTTPHeaders: { 'CF-Connecting-IP': `198.51.${run}.${n}` },
  });
  const page = await context.newPage();
  const statuses: number[] = [];
  page.on('response', (r) => {
    if (r.url().includes(`/sponsors/${seeded.sponsorId}/impression`)) statuses.push(r.status());
  });
  await page.goto(`/display?event=${encodeURIComponent(seeded.eventId)}`);
  await expect(page.getByTestId('display-sponsor-name').first()).toHaveText(seeded.sponsorName);
  await expect.poll(() => statuses.length, { timeout: 10_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  await context.close();
  return statuses.filter((s) => s === 201).length;
}

async function openReport(page: Page): Promise<void> {
  await page.setViewportSize(PHONE);
  await page.goto(reportUrl);
  await expect(page.getByTestId('signed-link-event-title')).toHaveText(seeded.eventTitle);
}

test.beforeAll(async ({ request }) => {
  test.skip(
    !ADMIN_BEARER,
    'Needs OSE_ADMIN_BEARER (set by playwright.mobile.config.ts for the local worker).'
  );
  const headers = { Authorization: `Bearer ${ADMIN_BEARER}` };
  // Shared reports are a plan feature and off by default.
  const flag = await request.put('/api/v2/admin/flags/analytics.shared-report', {
    headers,
    data: { enabled: true },
  });
  expect(flag.status()).toBe(200);

  seeded = await seedSponsorHome(request, ADMIN_BEARER, 'Report');
  const accepted = await request.post(
    `/api/v2/sponsor/placements/${encodeURIComponent(seeded.placementId)}/respond`,
    { data: { token: seeded.token, accepted: true } }
  );
  expect(accepted.status()).toBe(200);

  // The link itself comes from the same endpoint the admin page calls.
  const minted = await request.post(
    `/api/v2/admin/events/${encodeURIComponent(seeded.eventId)}/shared-report/mint-link`,
    { headers, data: { role: 'admin', ttl_days: 7 } }
  );
  expect(minted.status()).toBe(200);
  const { token } = (await minted.json()) as { token: string };
  reportUrl = `/sharedReport?eventId=${encodeURIComponent(seeded.eventId)}&token=${encodeURIComponent(token)}`;
});

// Until 2026-10-08 this was a known defect: Generate Link answered "esc is not
// defined" and showed no link. The same flow runs in jsdom, in seconds, in
// workers/oursharedevents/tests/admin-mint-report-link.spec.ts.
test('the organizer makes a report link in /admin', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.setExtraHTTPHeaders({ Authorization: `Bearer ${ADMIN_BEARER}` });
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('admin-path-advanced').click();
  await page.getByTestId('events-filter-active').click();
  await page.locator(`[data-testid="event-row-${seeded.eventId}"]`).click();

  await page.getByTestId('mint-role').selectOption('admin');
  await page.getByTestId('mint-link-btn').click();
  await expect(page.getByTestId('mint-report-url')).toHaveAttribute(
    'href',
    new RegExp(`eventId=${seeded.eventId}`),
    { timeout: 5000 }
  );
  await expect(page.getByTestId('mint-token')).not.toBeEmpty();
  await expect(page.getByTestId('mint-copy-btn')).toBeVisible();
  await expect(page.getByTestId('mint-result')).toContainText(
    "Copy this now; it isn't stored and can't be shown again."
  );

  // The link the page made is a working one: it opens this event's report.
  // The admin key header set above would replace the report page's own
  // Authorization header (the signed link), so it is dropped first.
  const made = await page.getByTestId('mint-report-url').getAttribute('href');
  await page.setExtraHTTPHeaders({});
  await page.goto(made!);
  await expect(page.getByTestId('signed-link-event-title')).toHaveText(seeded.eventTitle);
});

test('the report link opens the report for this event', async ({ page }) => {
  await openReport(page);
});

// OSE-818 (owner 2026-10-11): the scan count is "Distinct scanners", read from
// `distinct_scanners`. The old banned wording must not come back on the page.
test('the scan card says "Distinct Scanners", in the lexicon', async ({ page }) => {
  await openReport(page);
  const card = page.getByTestId('signed-link-distinct-scanners');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Distinct Scanners');
  const text = (await page.getByTestId('signed-link-report-article').innerText()).toLowerCase();
  expect(text).not.toContain('unique');
  expect(text).not.toContain('distinct gatherings');
});

// On a phone the three summary cards stack, each the full width of the row.
// @ocr/ui's .stats-row (loaded after the page's own rules) is a sideways
// strip of flex:1 cards; at 375px that squeezed all three into one row and
// wrapped their notes a word or two per line. Nothing may scroll sideways.
test('on a phone the summary cards stack full width, with no sideways scroll', async ({ page }) => {
  await openReport(page);
  const row = page.getByTestId('signed-link-stats');
  const cards = row.locator(':scope > .stat-card');
  await expect(cards).toHaveCount(3);
  const rowBox = await row.boundingBox();
  expect(rowBox, 'summary row has a box').not.toBeNull();
  const boxes = await cards.evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect().toJSON())
  );
  for (const [i, b] of boxes.entries()) {
    expect(
      b.width,
      `card ${i + 1} is ${Math.round(b.width)}px of a ${Math.round(rowBox!.width)}px row`
    ).toBeGreaterThan(rowBox!.width * 0.9);
    if (i > 0)
      expect(b.top, `card ${i + 1} sits below card ${i}`).toBeGreaterThanOrEqual(
        boxes[i - 1].bottom
      );
  }
  const sideways = await row.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(sideways, 'the summary row scrolls sideways').toBeLessThanOrEqual(1);
});

// On a phone each table row is a card: it fills the table's width, and every
// cell names its field. A missing data-label printed a bare ": "; a tbody left
// as a table group shrank each card to its content.
test('on a phone the report tables read as full-width labelled cards', async ({ page }) => {
  await openReport(page);
  const tables = page.locator('[data-testid="signed-link-report-article"] table.funnel-table');
  expect(await tables.count(), 'the report has at least one table').toBeGreaterThan(0);
  const problems = await tables.evaluateAll((els) =>
    els.flatMap((table) => {
      const name = table.getAttribute('aria-label') ?? 'table';
      const tw = table.getBoundingClientRect().width;
      const out: string[] = [];
      for (const tr of table.querySelectorAll('tbody tr')) {
        const w = tr.getBoundingClientRect().width;
        if (w < tw * 0.9) out.push(`${name}: a row is ${Math.round(w)}px of ${Math.round(tw)}px`);
        for (const td of tr.querySelectorAll('td')) {
          const label = getComputedStyle(td, '::before').content;
          if (!td.getAttribute('data-label') && label !== 'none' && label !== '""')
            out.push(`${name}: a cell has no data-label but prints ${label}`);
        }
      }
      return out;
    })
  );
  expect(problems).toEqual([]);
});

// The phone fix must not stack them on a laptop: there they share one row, equal width.
test('on a laptop the summary cards share one row, equal width', async ({ page }) => {
  await openReport(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  const cards = page.getByTestId('signed-link-stats').locator(':scope > .stat-card');
  await expect(cards).toHaveCount(3);
  const boxes = await cards.evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect().toJSON())
  );
  const tops = new Set(boxes.map((b) => Math.round(b.top)));
  expect(tops.size, 'all three cards start on the same line').toBe(1);
  const widths = boxes.map((b) => b.width);
  expect(
    Math.max(...widths) - Math.min(...widths),
    'the cards are the same width'
  ).toBeLessThanOrEqual(1);
});

test('before any screen has shown the sponsor, the report counts nothing', async ({ page }) => {
  await openReport(page);
  await expect(page.getByTestId('premium-sponsor-count')).toHaveText('0');
  await expect(page.getByTestId('premium-displays')).toHaveText('0');
});

test('displays under the floor of 5: the report still shows no number', async ({
  page,
  browser,
}) => {
  // One screen load shows the sponsor in two places (top banner, side rail) and
  // each is counted as a display, so two screens are four displays.
  counted += await oneScreen(browser, nextScreen++);
  counted += await oneScreen(browser, nextScreen++);
  expect(counted, 'displays the server counted').toBeGreaterThan(0);
  expect(counted, 'still under the floor').toBeLessThan(FLOOR);

  await openReport(page);
  await expect(page.getByTestId('premium-sponsor-count')).toHaveText('0');
  await expect(page.getByTestId('premium-displays')).toHaveText('0');
});

test('the same screen reloading is not counted again', async ({ browser }) => {
  expect(await oneScreen(browser, 1)).toBe(0);
});

test('past the floor: one premium sponsor, and exactly the displays the server counted', async ({
  page,
  browser,
}) => {
  while (counted < FLOOR) counted += await oneScreen(browser, nextScreen++);

  await openReport(page);
  await expect(page.getByTestId('premium-sponsor-count')).toHaveText('1');
  await expect(page.getByTestId('premium-displays')).toHaveText(String(counted));
  await expect(page.getByTestId('local-sponsor-count')).toHaveText('0');
  await expect(page.getByTestId('mid-sponsor-count')).toHaveText('0');
  await expect(page.getByTestId('paid-displays-total')).toContainText(String(counted));
});

test("the organizer's report names the sponsor beside the same count", async ({ page }) => {
  await openReport(page);
  const main = page.getByTestId('report-main');
  await expect(main).toContainText(seeded.sponsorName);
  await expect(page.getByTestId('local-vs-paid-delta')).toContainText(`Paid: ${counted} displays`);
});

test('a link that was tampered with shows a plain message and no event', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const bad = reportUrl.replace(/token=([^&]{6})/, 'token=AAAAAA');
  await page.goto(bad);
  await expect(page.getByTestId('signed-link-error')).toContainText(
    /expired or isn.t valid. Ask the sender for a fresh link/
  );
  await expect(page.getByTestId('report-main')).not.toContainText(seeded.eventTitle);
});

test('a link for one event does not open another event', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const other = reportUrl.replace(/eventId=[^&]+/, 'eventId=evt_some_other_event');
  await page.goto(other);
  await expect(page.getByTestId('signed-link-error')).toBeVisible();
  await expect(page.getByTestId('report-main')).not.toContainText(seeded.eventTitle);
});

// A sponsor's own link is sent fewer sections than the organizer's, and the
// report names the ones it withheld as locked cards. On a phone those cards are
// part of the page's one scroll: in the flow, inside the screen's width, with
// nothing opened over the page. The names come from the API's answer for the
// same link, so the page is checked against the server and not against a list
// kept here.
for (const depth of ['local', 'mid'] as const) {
  test(`a sponsor link at ${depth} depth: its locked sections sit in the page's one scroll on a 375px screen`, async ({
    page,
    request,
  }) => {
    const minted = await request.post(
      `/api/v2/admin/events/${encodeURIComponent(seeded.eventId)}/shared-report/mint-link`,
      {
        headers: { Authorization: `Bearer ${ADMIN_BEARER}` },
        data: { role: 'sponsor', depth, sponsor_id: seeded.sponsorId, ttl_days: 1 },
      }
    );
    expect(minted.status()).toBe(200);
    const { token } = (await minted.json()) as { token: string };

    const api = await request.get(
      `/api/v2/events/${encodeURIComponent(seeded.eventId)}/shared-report`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(api.status()).toBe(200);
    const { report } = (await api.json()) as {
      report: { upgrade?: { locked_sections: string[]; next_depth: string } };
    };
    const locked = report.upgrade?.locked_sections ?? [];
    expect(locked.length, `the ${depth} link has sections withheld`).toBeGreaterThan(0);

    await page.setViewportSize(PHONE);
    await page.goto(
      `/sharedReport?eventId=${encodeURIComponent(seeded.eventId)}&token=${encodeURIComponent(token)}`
    );
    await expect(page.getByTestId('signed-link-event-title')).toHaveText(seeded.eventTitle);

    const cards = page.getByTestId('signed-link-locked-section');
    await expect(cards).toHaveCount(locked.length);
    expect(
      await cards.evaluateAll((els) => els.map((el) => el.getAttribute('data-section-name')))
    ).toEqual(locked);

    // Measured before anything is scrolled. Each line below is its own finding,
    // so they are soft: one run names every rule the page breaks.
    const layout = await page.evaluate(() => {
      const doc = document.documentElement;
      const group = document.querySelector('[data-testid="signed-link-locked-sections"]')!;
      const cardEls = [...group.querySelectorAll('[data-testid="signed-link-locked-section"]')];
      const chain: Element[] = [...cardEls];
      for (let el: Element | null = group; el && el !== doc; el = el.parentElement) chain.push(el);
      const outOfFlow: string[] = [];
      const innerScrollers: string[] = [];
      for (const el of chain) {
        const cs = getComputedStyle(el);
        const name = `${el.tagName.toLowerCase()}.${el.className}`;
        if (cs.position !== 'static' && cs.position !== 'relative') {
          outOfFlow.push(`${name} is ${cs.position}`);
        }
        const scrollsDown =
          /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
        const scrollsAcross =
          /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1;
        if (el !== document.body && (scrollsDown || scrollsAcross)) innerScrollers.push(name);
      }
      const offScreen = cardEls
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.left < 0 || r.right > window.innerWidth + 0.5 || r.width < 1)
        .map((r) => `${Math.round(r.left)}..${Math.round(r.right)}`);
      const blurred = chain
        .map((el) => getComputedStyle(el).filter)
        .filter((f) => f && f !== 'none');
      return {
        sideways: doc.scrollWidth - doc.clientWidth,
        outOfFlow,
        innerScrollers,
        offScreen,
        openDialogs: document.querySelectorAll(
          'dialog[open], [role="dialog"]:not([hidden]), [role="alertdialog"]:not([hidden]), [aria-modal="true"]:not([hidden])'
        ).length,
        blurred,
      };
    });
    expect.soft(layout.sideways, 'no sideways scroll at 375px').toBeLessThanOrEqual(0);
    expect.soft(layout.outOfFlow, "in the page's flow").toEqual([]);
    expect.soft(layout.innerScrollers, 'one scroll: no scrolling box around the cards').toEqual([]);
    expect.soft(layout.offScreen, "inside the screen's width").toEqual([]);
    expect.soft(layout.openDialogs, 'no dialog').toBe(0);
    // Present behaviour, not the story's wording: the cards are plain
    // placeholders, with no blur filter on them or on anything around them.
    expect.soft(layout.blurred, 'no blur (present behaviour)').toEqual([]);

    // Each card is reached by scrolling the page, and once there it is what is
    // drawn at its own middle: nothing is laid over it. 95% and not 100%: a card
    // brought to the screen's edge can sit a fraction of a pixel past it (seen
    // at 99.97%); a card too wide for the screen, or held in a short scrolling
    // box, shows about 79%.
    for (let i = 0; i < locked.length; i++) {
      await cards.nth(i).scrollIntoViewIfNeeded();
      await expect.soft(cards.nth(i), `card ${i + 1} fits on the screen`).toBeInViewport({
        ratio: 0.95,
      });
      const covered = await cards.nth(i).evaluate((el) => {
        const box = el.getBoundingClientRect();
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return top !== null && el.contains(top) ? '' : `covered by ${top?.tagName ?? 'nothing'}`;
      });
      expect.soft(covered, `nothing drawn over card ${i + 1}`).toBe('');
    }
  });
}
