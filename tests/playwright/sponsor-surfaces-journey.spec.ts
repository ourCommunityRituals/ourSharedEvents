/**
 * Sponsor consent, followed across every surface a patron sees.
 *
 * sponsor-home-flow.spec.ts proves the sponsor's answer reaches the public
 * event page. This flow asks the wider question: once an organizer has placed
 * a sponsor and the sponsor has said yes, is the sponsor on the event page,
 * the form page, the poster and the TV display — and off all four the moment
 * the sponsor changes their mind (ADR-019)?
 *
 * The answer is given by tapping Accept / Decline on /sponsor, the same door
 * a business owner uses. Each surface is opened in a browser and read the way
 * a patron reads it: the name is on screen, or it is not.
 *
 * Runs against the local worker of playwright.mobile.config.ts and seeds its
 * own event and sponsor, so it does not depend on any other spec's rows.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  seedSponsorHome,
  waitUntilListed,
  type SeededSponsorHome,
} from './helpers/sponsor-home-seed';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';
const PHONE = { width: 375, height: 812 };
const TV = { width: 1280, height: 720 };

test.describe.configure({ mode: 'serial' });

let seeded: SeededSponsorHome;

const placementCard = (page: Page) =>
  page.locator(`[data-testid="placement-card"][data-placement-id="${seeded.placementId}"]`);

async function answer(page: Page, which: 'accept' | 'decline'): Promise<void> {
  await page.setViewportSize(PHONE);
  await page.goto(`/sponsor?t=${encodeURIComponent(seeded.token)}`);
  const responded = page.waitForResponse(
    (r) =>
      r.url().includes(`/placements/${seeded.placementId}/respond`) &&
      r.request().method() === 'POST'
  );
  await placementCard(page).getByTestId(`placement-${which}`).click();
  expect((await responded).status()).toBe(200);
  await expect(placementCard(page).getByTestId('placement-state')).toHaveText(
    which === 'accept' ? 'Accepted' : 'Declined'
  );
}

/** Each surface, read as a patron would: is the sponsor's name on screen? */
const surfaces: Record<string, (page: Page) => Promise<boolean>> = {
  'event page': async (page) => {
    await page.setViewportSize(PHONE);
    await page.goto(`/events/${encodeURIComponent(seeded.eventId)}`);
    await expect(page.getByTestId('event-title')).toBeVisible();
    return page.getByTestId('sponsor-item').filter({ hasText: seeded.sponsorName }).isVisible();
  },
  'form page': async (page) => {
    await page.setViewportSize(PHONE);
    const bundle = page.waitForResponse((r) => r.url().includes('/sponsor-bundle'));
    await page.goto(`/forms/${encodeURIComponent(seeded.eventId)}?type=register`);
    await bundle;
    await expect(page.getByTestId('register-submit')).toBeVisible();
    return page
      .getByTestId('form-sponsor-strip')
      .filter({ hasText: seeded.sponsorName })
      .isVisible();
  },
  poster: async (page) => {
    await page.setViewportSize(TV);
    await page.goto(`/poster?event=${encodeURIComponent(seeded.eventId)}`);
    await expect(page.getByTestId('poster-title')).toHaveText(seeded.eventTitle);
    await expect(page.getByTestId('poster-sponsors-loading')).toBeHidden();
    return page
      .getByTestId('poster-sponsor-item')
      .filter({ hasText: seeded.sponsorName })
      .isVisible();
  },
  'TV display': async (page) => {
    await page.setViewportSize(TV);
    // The display draws the event first and its sponsors after a second request.
    const bundle = page.waitForResponse((r) => r.url().includes('/sponsor-bundle'));
    await page.goto(`/display?event=${encodeURIComponent(seeded.eventId)}`);
    await bundle;
    await expect(page.getByTestId('display-featured-title')).toHaveText(seeded.eventTitle);
    return page
      .getByTestId('display-sponsor-name')
      .filter({ hasText: seeded.sponsorName })
      .isVisible();
  },
  // OSE-1522: the title shows on the list surfaces too, so the sponsor does.
  // The event must be on the list for these (publish grace window, waited out
  // once in beforeAll).
  'events list card': async (page) => {
    await page.setViewportSize(PHONE);
    await page.goto('/events');
    const card = page.locator(
      `[data-testid="public-event-card"][data-event-id="${seeded.eventId}"]`
    );
    await expect(card.getByTestId('public-event-name')).toContainText(seeded.eventTitle);
    return card
      .getByTestId('public-event-sponsor')
      .filter({ hasText: seeded.sponsorName })
      .isVisible();
  },
  'landing card': async (page) => {
    await page.setViewportSize(PHONE);
    await page.goto('/');
    const card = page.locator(`[data-testid="area-card"][data-event-id="${seeded.eventId}"]`);
    await expect(card.getByTestId('area-card-name')).toContainText(seeded.eventTitle);
    return card
      .getByTestId('public-event-sponsor')
      .filter({ hasText: seeded.sponsorName })
      .isVisible();
  },
  'TV featured event': async (page) => {
    await page.setViewportSize(TV);
    await page.goto(`/display?event=${encodeURIComponent(seeded.eventId)}`);
    await expect(page.getByTestId('display-featured-title')).toHaveText(seeded.eventTitle);
    return page
      .getByTestId('display-featured-sponsor')
      .filter({ hasText: seeded.sponsorName })
      .isVisible();
  },
};

async function expectEverySurface(page: Page, shown: boolean, when: string): Promise<void> {
  for (const [name, isShown] of Object.entries(surfaces)) {
    await expect
      .poll(() => isShown(page), { message: `${name}, ${when}`, timeout: 15_000 })
      .toBe(shown);
  }
}

test.beforeAll(async ({ request }) => {
  test.skip(
    !ADMIN_BEARER,
    'Needs OSE_ADMIN_BEARER (set by playwright.mobile.config.ts for the local worker).'
  );
  seeded = await seedSponsorHome(request, ADMIN_BEARER, 'Surfaces');
  // The list surfaces show the event only once the publish grace window is over
  // (a minute on the local worker).
  test.setTimeout(120_000);
  await waitUntilListed(seeded.listedFrom);
});

test('placed but not answered: the sponsor is on no surface', async ({ page }) => {
  await expectEverySurface(page, false, 'before the sponsor answers');
});

test('Accept: the sponsor is on the event page, form page, poster and TV', async ({ page }) => {
  await answer(page, 'accept');
  await expectEverySurface(page, true, 'after Accept');
});

// OSE-1520: one card on /events and the landing. At phone width the button
// drops under the text and the title keeps the card, instead of being squeezed
// to a sliver beside the button (137px on staging). Since the card picture
// (owner 2026-10-11) the title shares its row with the 64px picture, so the
// picture and the title together must span most of the card.
for (const [name, path, cardTestId] of [
  ['events list', '/events', 'public-event-card'],
  ['landing', '/', 'area-card'],
] as const) {
  test(`${name}: at 375px the button stacks under the text and the title keeps the card`, async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await page.goto(path);
    const card = page.locator(`[data-testid="${cardTestId}"][data-event-id="${seeded.eventId}"]`);
    await expect(card).toBeVisible();
    const box = (await card.boundingBox())!;
    const info = (await card.getByTestId('public-event-info').boundingBox())!;
    const cta = (await card.getByTestId('public-event-cta').boundingBox())!;
    const thumb = (await card.locator('img.event-thumb').boundingBox())!;
    expect(cta.y, 'the button starts below the text').toBeGreaterThanOrEqual(
      info.y + info.height - 1
    );
    expect(thumb.y, 'the picture sits on the title row').toBeLessThan(info.y + info.height);
    expect(
      (info.x + info.width - thumb.x) / box.width,
      'the picture and the title have most of the card'
    ).toBeGreaterThan(0.8);
    expect(cta.height, 'the button is a 44px target').toBeGreaterThanOrEqual(44);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, 'no sideways scroll').toBeLessThanOrEqual(clientWidth + 1);
  });
}

test('events list and landing offer the same date, place and Register on the same card', async ({
  page,
}) => {
  const facts: string[][] = [];
  for (const [path, cardTestId] of [
    ['/events', 'public-event-card'],
    ['/', 'area-card'],
  ] as const) {
    await page.goto(path);
    const card = page.locator(`[data-testid="${cardTestId}"][data-event-id="${seeded.eventId}"]`);
    await expect(card.getByTestId('public-event-cta')).toHaveText('Register');
    facts.push([
      (await card.getByTestId('public-event-date').innerText()).trim(),
      (await card.getByTestId('public-event-venue').innerText()).trim(),
    ]);
  }
  expect(facts[1], 'the landing card says what /events says').toEqual(facts[0]);
});

test('on the event page the sponsor sits below the title and above the content, and the poster names it', async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await page.goto(`/events/${encodeURIComponent(seeded.eventId)}`);
  const strip = await page.getByTestId('pre-sponsor-strip').boundingBox();
  const header = await page.getByTestId('event-header').boundingBox();
  const where = await page.getByTestId('event-where').boundingBox();
  expect(strip, 'sponsor strip is rendered').not.toBeNull();
  expect(strip!.y, 'sponsor strip is below the title and date').toBeGreaterThanOrEqual(
    header!.y + header!.height
  );
  expect(strip!.y + strip!.height, 'sponsor strip is above the content').toBeLessThanOrEqual(
    where!.y
  );

  await page.setViewportSize(TV);
  await page.goto(`/poster?event=${encodeURIComponent(seeded.eventId)}`);
  await expect(page.getByTestId('poster-sponsor-name')).toHaveText(seeded.sponsorName);
  await expect(page.getByTestId('poster-sponsor-item')).toHaveCount(1);
});

// OSE-1435: the location a sponsor chose to show reads as its own muted line
// under the name. It was a bare <small> beside the name in a flex row, at the
// browser's default size and the body text colour.
test('the sponsor location is its own muted line under the name, and wraps', async ({
  page,
  request,
}) => {
  const address = '1234 West One Hundred Eleventh Street, Suite 200, Blue Island';
  const put = await request.put(`/api/v2/admin/sponsors/${encodeURIComponent(seeded.sponsorId)}`, {
    headers: { Authorization: `Bearer ${ADMIN_BEARER}`, 'Content-Type': 'application/json' },
    data: { address_line: address },
  });
  expect(put.status(), 'set the sponsor location').toBe(200);

  await page.setViewportSize(PHONE);
  await page.goto(`/events/${encodeURIComponent(seeded.eventId)}`);
  const item = page.getByTestId('sponsor-item').filter({ hasText: seeded.sponsorName });
  const line = item.getByTestId('sponsor-item-address');
  await expect(line).toHaveText(address);

  const name = await item.locator('a').first().boundingBox();
  const box = await line.boundingBox();
  expect(box!.y, 'the location starts below the name').toBeGreaterThanOrEqual(
    name!.y + name!.height - 1
  );
  expect(box!.x + box!.width, 'the location stays on the screen').toBeLessThanOrEqual(PHONE.width);
  const style = await line.evaluate((el) => {
    const cs = getComputedStyle(el);
    const probe = document.createElement('span');
    probe.style.color = 'var(--text-muted)';
    el.appendChild(probe);
    const muted = getComputedStyle(probe).color;
    probe.remove();
    return { color: cs.color, muted, size: parseFloat(cs.fontSize) };
  });
  expect(style.color, 'the location is muted').toBe(style.muted);
  expect(style.size, 'the location is small text, at or above the 13px floor').toBe(13);
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, 'no sideways scroll').toBeLessThanOrEqual(clientWidth + 1);
});

test('Decline (changed their mind): the sponsor leaves all four surfaces', async ({ page }) => {
  await answer(page, 'decline');
  await expectEverySurface(page, false, 'after Decline');
});

test('Accept again: the sponsor is back on all four', async ({ page }) => {
  await answer(page, 'accept');
  await expectEverySurface(page, true, 'after the second Accept');
});

test('a forged answer changes nothing', async ({ page, request }) => {
  const [payload, sig] = seeded.token.split('.');
  const forged = `${payload}.${(sig[0] === 'a' ? 'b' : 'a') + sig.slice(1)}`;
  const res = await request.post(
    `/api/v2/sponsor/placements/${encodeURIComponent(seeded.placementId)}/respond`,
    { data: { token: forged, accepted: false } }
  );
  expect(res.status()).toBe(401);
  await expectEverySurface(page, true, 'after a forged Decline');
});

test.describe('poster with two sponsors', () => {
  let secondName = '';

  // OSE-1991: the digital poster's turns follow each sponsor's share
  // (`sponsor_rotation` in the poster bundle), so which sponsor shows first,
  // and how many turns pass before the next one comes up, is read from the
  // bundle, not assumed. Items are drawn in the order of `sponsors`.
  async function firstChange(page: Page) {
    const r = await page.request.get(
      `/api/v2/events/${encodeURIComponent(seeded.eventId)}/poster-bundle`
    );
    expect(r.status()).toBe(200);
    const d = (await r.json()) as { sponsors: { id: string }[]; sponsor_rotation: string[] };
    const order = d.sponsor_rotation.map((id) => d.sponsors.findIndex((s) => s.id === id));
    const steps = order.findIndex((i) => i !== order[0]);
    expect(steps, 'a second sponsor comes up in the cycle').toBeGreaterThan(0);
    return { from: order[0], to: order[steps], steps };
  }

  test.beforeAll(async ({ request }) => {
    const headers = { Authorization: `Bearer ${ADMIN_BEARER}` };
    secondName = `Surfaces Hardware ${Date.now().toString(36)}`;
    const sp = await request.post('/api/v2/admin/sponsors', {
      headers,
      data: { name: secondName, tier: 'gold', event_id: seeded.eventId },
    });
    expect(sp.status()).toBe(201);
    const { id, placement_id } = (await sp.json()) as { id: string; placement_id: string };
    const link = await request.post(`/api/v2/admin/sponsors/${encodeURIComponent(id)}/home-link`, {
      headers,
      data: {},
    });
    const token = new URL(((await link.json()) as { url: string }).url).searchParams.get('t');
    const accepted = await request.post(
      `/api/v2/sponsor/placements/${encodeURIComponent(placement_id)}/respond`,
      { data: { token, accepted: true } }
    );
    expect(accepted.status()).toBe(200);
  });

  test('the strip sits under the poster title, above the details and codes', async ({ page }) => {
    await page.setViewportSize(TV);
    await page.goto(`/poster?event=${encodeURIComponent(seeded.eventId)}`);
    await expect(page.getByTestId('poster-sponsor-item')).toHaveCount(2);
    const title = await page.getByTestId('poster-title').boundingBox();
    const strip = await page.getByTestId('poster-sponsor-strip').boundingBox();
    const body = await page.getByTestId('poster-body').boundingBox();
    expect(strip!.y, 'below the title').toBeGreaterThanOrEqual(title!.y + title!.height);
    expect(strip!.y + strip!.height, 'above the details').toBeLessThanOrEqual(body!.y + 1);
  });

  test('print poster shows both sponsors at once and does not rotate', async ({ page }) => {
    await page.clock.install();
    await page.setViewportSize(TV);
    await page.goto(`/poster?event=${encodeURIComponent(seeded.eventId)}&kind=print`);
    const items = page.getByTestId('poster-sponsor-item');
    await expect(items).toHaveCount(2);
    await page.clock.fastForward(12_000);
    await expect(items.nth(0)).toBeVisible();
    await expect(items.nth(1)).toBeVisible();
  });

  test('digital poster shows one sponsor at a time and gives each a turn', async ({ page }) => {
    // The entrance is random; pin it to a plain one so the turn is immediate.
    await page.addInitScript(() => {
      Math.random = () => 0;
    });
    await page.clock.install();
    await page.setViewportSize(PHONE);
    await page.goto(`/poster?event=${encodeURIComponent(seeded.eventId)}&kind=digital`);
    const items = page.getByTestId('poster-sponsor-item');
    await expect(items).toHaveCount(2);
    const visibleName = async () => {
      const shown: string[] = [];
      for (let i = 0; i < 2; i++) {
        if (await items.nth(i).isVisible()) shown.push((await items.nth(i).innerText()).trim());
      }
      expect(shown, 'exactly one sponsor is on screen').toHaveLength(1);
      return shown[0];
    };

    // OSE-1991: the turns follow each sponsor's share (the bundle's
    // sponsor_rotation, the TV side rail's sequence), so a bigger share can
    // come up twice running. Walk one whole cycle in that order and back round.
    const bundle = await page.request.get(
      `/api/v2/events/${encodeURIComponent(seeded.eventId)}/poster-bundle`
    );
    expect(bundle.status()).toBe(200);
    const data = (await bundle.json()) as {
      sponsors: { id: string; title?: string; name: string }[];
      sponsor_rotation: string[];
    };
    const nameOf = (id: string) => {
      const s = data.sponsors.find((x) => x.id === id)!;
      return s.title || s.name;
    };
    const expected = data.sponsor_rotation.map(nameOf);
    expect([...new Set(expected)].sort(), 'every sponsor has a turn').toEqual(
      [seeded.sponsorName, secondName].sort()
    );
    for (let k = 0; k <= expected.length; k++) {
      const label = k === expected.length ? 'and the cycle comes back round' : `turn ${k + 1}`;
      expect(await visibleName(), label).toBe(expected[k % expected.length]);
      await page.clock.fastForward(5_000);
    }
  });

  test('a vignette plays first, and the sponsor changes when it lands', async ({ page }) => {
    // Pin the draws: "play a vignette", then "the first one in the library".
    await page.addInitScript(() => {
      const draws = [0.99, 0];
      const w = window as unknown as { __drawN: number };
      w.__drawN = 0;
      Math.random = () => draws[w.__drawN++ % draws.length];
    });
    await page.clock.install();
    await page.setViewportSize(PHONE);
    await page.goto(`/poster?event=${encodeURIComponent(seeded.eventId)}&kind=digital`);
    const items = page.getByTestId('poster-sponsor-item');
    await expect(items).toHaveCount(2);
    const { from, to, steps } = await firstChange(page);
    const vignette = page.getByTestId('poster-vignette');
    await expect(items.nth(from)).toBeVisible();
    await expect(vignette).toHaveCount(0);

    // A turn that keeps the same sponsor plays nothing. Anything else on the page
    // that draws a number while those turns pass would shift the pinned draws,
    // so they start again right before the turn that changes the sponsor.
    // runFor, not fastForward: fastForward fires a repeating timer at most once
    // however far it jumps, so several turns in one call would be one turn.
    if (steps > 1) await page.clock.runFor(5_000 * (steps - 1));
    await expect(vignette).toHaveCount(0);
    await page.evaluate(() => {
      (window as unknown as { __drawN: number }).__drawN = 0;
    });
    await page.clock.fastForward(5_000);
    await expect(vignette).toHaveAttribute('data-vignette', 'bocce');
    await expect(items.nth(from), 'the sponsor holds until the ball lands').toBeVisible();
    await expect(items.nth(to)).toBeHidden();

    await page.clock.fastForward(700);
    await expect(vignette).toHaveCount(0);
    await expect(items.nth(to), 'the hit changes the sponsor').toBeVisible();
    await expect(items.nth(from)).toBeHidden();
    await expect(items.nth(to)).toHaveAttribute('data-effect', 'shake');
  });

  test('with reduce-motion on, no vignette plays and the sponsor still changes', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Math.random = () => 0.99;
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.install();
    await page.setViewportSize(PHONE);
    await page.goto(`/poster?event=${encodeURIComponent(seeded.eventId)}&kind=digital`);
    const items = page.getByTestId('poster-sponsor-item');
    await expect(items).toHaveCount(2);
    const { to, steps } = await firstChange(page);
    // The turn order is seeded per event, so the second sponsor can first come
    // up after two or more turns. runFor fires each of them; fastForward would
    // fire the timer once and the sponsor would not change.
    await page.clock.runFor(5_000 * steps);
    await expect(page.getByTestId('poster-vignette')).toHaveCount(0);
    await expect(items.nth(to)).toBeVisible();
  });

  test('the DJ vignette knocks the sponsor over before the next one comes up', async ({ page }) => {
    // Pin the draws: "play a vignette", then "the last one in the library".
    await page.addInitScript(() => {
      Math.random = () => 0.99;
    });
    await page.clock.install();
    await page.setViewportSize(PHONE);
    await page.goto(`/poster?event=${encodeURIComponent(seeded.eventId)}&kind=digital`);
    const items = page.getByTestId('poster-sponsor-item');
    await expect(items).toHaveCount(2);
    const { from, to, steps } = await firstChange(page);

    await page.clock.runFor(5_000 * steps);
    await expect(page.getByTestId('poster-vignette')).toHaveAttribute('data-vignette', 'dj');
    await expect(items.nth(from), 'the sponsor she bumps is the one on screen').toHaveAttribute(
      'data-leaving',
      'topple'
    );
    await expect(items.nth(to)).toBeHidden();

    await page.clock.fastForward(1_100);
    await expect(page.getByTestId('poster-vignette')).toHaveCount(0);
    await expect(items.nth(from)).toBeHidden();
    await expect(items.nth(from)).not.toHaveAttribute('data-leaving', 'topple');
    await expect(items.nth(to), 'the next sponsor comes up').toBeVisible();
    await expect(items.nth(to)).toHaveAttribute('data-effect', 'rise');
  });
});
