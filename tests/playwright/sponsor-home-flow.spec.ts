/**
 * Sponsor home — end to end, in a real browser, at phone size.
 *
 * Stitch #3 → #4 of the Triangle screen map (docs/ops/TRIANGLE-SCREEN-MAP-2026-09-16):
 * the organizer mints a sponsor link, the business owner opens it on a phone,
 * answers the placement, and the answer shows (or stops showing) on the public
 * event page.
 *
 * The workers-pool suite (workers/oursharedevents/tests/sponsor-home.spec.ts)
 * already proves the token, the SQL ownership check and the render. What it
 * cannot prove, and this does:
 *   - the page's one inline script actually runs under the nonce CSP and the
 *     Accept / Decline taps reach the server (no CSP violation, no console error)
 *   - the answer survives a reload (the server, not the DOM, holds it)
 *   - the public event page follows the answer — accepted shows the sponsor,
 *     declined removes it (ADR-019 consent; the respond handler busts the cache)
 *   - the controls are ≥ 44 px at 375×812
 *   - a tampered link shows the invalid-link page and leaks no sponsor data
 *
 * Runs in the blocking PR phone audit (playwright.mobile.config.ts): a local
 * worker with migrations, a local admin key and a local signing secret. Seeds
 * its own sponsor, so it never depends on (or disturbs) the audit's one.
 */
import { test, expect, type Page } from '@playwright/test';
import { seedSponsorHome, type SeededSponsorHome } from './helpers/sponsor-home-seed';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';
const MIN_TOUCH_TARGET_PX = 44;

test.describe.configure({ mode: 'serial' });

let seeded: SeededSponsorHome;

/**
 * Collect CSP violations and page errors for the life of a page.
 *
 * The one tolerated error is the browser's own /favicon.ico fetch: no OSE
 * surface declares an icon or serves that path yet, so it 404s on every page.
 * That is a site-wide gap, not this surface's — filtered by URL, never by text,
 * so any other failed load still fails the test.
 */
function watchForBreakage(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    const t = msg.text();
    if (/\/favicon\.ico(\?|$)/.test(msg.location().url)) return;
    if (msg.type() === 'error' || /Content Security Policy/i.test(t)) {
      problems.push(`${t} @ ${msg.location().url}`);
    }
  });
  page.on('pageerror', (err) => problems.push(String(err)));
  return problems;
}

const sponsorPath = () => `/sponsor?t=${encodeURIComponent(seeded.token)}`;

async function publicPageShowsSponsor(page: Page): Promise<boolean> {
  const res = await page.request.get(`/events/${encodeURIComponent(seeded.eventId)}`);
  expect(res.status()).toBe(200);
  return (await res.text()).includes(seeded.sponsorName);
}

test.beforeAll(async ({ request }) => {
  test.skip(
    !ADMIN_BEARER,
    'Needs OSE_ADMIN_BEARER (set by playwright.mobile.config.ts for the local worker).'
  );
  seeded = await seedSponsorHome(request, ADMIN_BEARER, 'Flow');
});

test('the minted link opens the sponsor page with one placement waiting for an answer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const problems = watchForBreakage(page);

  const res = await page.goto(sponsorPath());
  expect(res?.status()).toBe(200);
  expect(res?.headers()['cache-control']).toContain('no-store');

  await expect(page.getByTestId('sponsor-home-name')).toHaveText(seeded.sponsorName);
  await expect(page.getByTestId('sponsor-home-count-pending')).toHaveText('1');

  const card = page.locator(
    `[data-testid="placement-card"][data-placement-id="${seeded.placementId}"]`
  );
  await expect(card).toBeVisible();
  await expect(card.getByTestId('placement-title')).toHaveText(seeded.eventTitle);
  await expect(card.getByTestId('placement-accept')).toBeVisible();
  await expect(card.getByTestId('placement-decline')).toBeVisible();

  // Pending placements are NOT public yet (ADR-019).
  expect(await publicPageShowsSponsor(page)).toBe(false);

  for (const id of ['placement-accept', 'placement-decline']) {
    const box = await card.getByTestId(id).boundingBox();
    expect(box, `${id} has no box`).not.toBeNull();
    expect(box!.height, `${id} height`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
    expect(box!.width, `${id} width`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
  }

  expect(problems, problems.join('\n')).toEqual([]);
});

test('Accept: the card updates, the answer survives a reload, and the event page shows the sponsor', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const problems = watchForBreakage(page);
  await page.goto(sponsorPath());

  const card = page.locator(
    `[data-testid="placement-card"][data-placement-id="${seeded.placementId}"]`
  );
  const respond = page.waitForResponse(
    (r) =>
      r.url().includes(`/placements/${seeded.placementId}/respond`) &&
      r.request().method() === 'POST'
  );
  await card.getByTestId('placement-accept').click();
  expect((await respond).status()).toBe(200);

  await expect(card.getByTestId('placement-state')).toHaveText('Accepted');
  await expect(card).toHaveAttribute('data-sponsor-accepted', '1');
  await expect(card.getByTestId('placement-accept')).toBeHidden();
  await expect(card.getByTestId('placement-decline')).toBeVisible();
  await expect(page.getByTestId('sponsor-home-count-pending')).toHaveText('0');

  await page.reload();
  await expect(card.getByTestId('placement-state')).toHaveText('Accepted');
  await expect(page.getByTestId('sponsor-home-count-pending')).toHaveText('0');

  expect(await publicPageShowsSponsor(page)).toBe(true);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Decline (changing their mind): the card updates and the event page drops the sponsor', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const problems = watchForBreakage(page);
  await page.goto(sponsorPath());

  const card = page.locator(
    `[data-testid="placement-card"][data-placement-id="${seeded.placementId}"]`
  );
  await card.getByTestId('placement-decline').click();

  await expect(card.getByTestId('placement-state')).toHaveText('Declined');
  await expect(card).toHaveAttribute('data-sponsor-accepted', '0');
  await expect(card.getByTestId('placement-accept')).toBeVisible();
  await expect(card.getByTestId('placement-decline')).toBeHidden();

  await page.reload();
  await expect(card.getByTestId('placement-state')).toHaveText('Declined');

  expect(await publicPageShowsSponsor(page)).toBe(false);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('a tampered link shows the invalid-link page and no sponsor data', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const [payload, sig] = seeded.token.split('.');
  const flipped = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
  const res = await page.goto(`/sponsor?t=${encodeURIComponent(`${payload}.${flipped}`)}`);
  expect(res?.status()).toBe(401);
  const body = await page.content();
  expect(body).not.toContain(seeded.sponsorName);
  expect(body).not.toContain(seeded.eventTitle);
  await expect(page.getByTestId('placement-card')).toHaveCount(0);
});
