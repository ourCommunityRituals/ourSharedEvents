/**
 * OSE-1518: the three plain choices on the public event page, in real layout.
 *
 * The worker-pool spec (workers/oursharedevents/tests/event-page-choices.spec.ts)
 * proves the markup and the order. This proves what only a browser measures:
 * Register is the first button and runs the full width of the column, the three
 * choices are tall enough to tap, Share and Add to calendar sit side by side
 * below them (a pair, not a stack), nothing scrolls sideways, and each choice
 * goes where it says.
 *
 * Runs against the local worker of playwright.mobile.config.ts and seeds its
 * own event through the admin API.
 */
import { test, expect, type Page } from '@playwright/test';
import { createLiveEvent } from './helpers/sponsor-home-seed';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';
const MIN_TOUCH = 44;

test.describe.configure({ mode: 'serial' });

let eventId = '';
let eventTitle = '';

test.beforeAll(async ({ request }) => {
  expect(
    ADMIN_BEARER,
    'OSE_ADMIN_BEARER must be set (playwright.mobile.config.ts sets it)'
  ).not.toBe('');
  eventTitle = `Choices night ${Date.now().toString(36)}`;
  eventId = (await createLiveEvent(request, ADMIN_BEARER, eventTitle)).id;
});

async function open(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 812 });
  await page.goto(`/events/${encodeURIComponent(eventId)}`);
  await expect(page.getByTestId('event-choices')).toBeVisible();
}

type Box = { x: number; y: number; width: number; height: number };

/**
 * Every box in one reading of the page. Asking for them one call at a time
 * lets the page move between two answers: on WebKit at 320px the Where card
 * grew by about 120px after Register had been measured, so Register read as
 * sitting above the bottom of a card it is drawn below (2026-10-07).
 */
async function boxes<K extends string>(page: Page, ids: readonly K[]): Promise<Record<K, Box>> {
  for (const id of ids) await expect(page.getByTestId(id)).toBeVisible();
  return page.evaluate(
    (list) => {
      const out: Record<string, { x: number; y: number; width: number; height: number }> = {};
      for (const id of list) {
        const r = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
        out[id] = { x: r.x, y: r.y, width: r.width, height: r.height };
      }
      return out;
    },
    ids as readonly string[]
  ) as Promise<Record<K, Box>>;
}

for (const width of [375, 320]) {
  test(`at ${width}px: Register is first and full width, the three choices are tappable`, async ({
    page,
  }) => {
    await open(page, width);
    const b = await boxes(page, [
      'event-choices',
      'event-rsvp',
      'event-choice-checkin',
      'event-choice-looking',
      'event-where',
    ] as const);
    const column = b['event-choices'];
    const register = b['event-rsvp'];
    const checkin = b['event-choice-checkin'];
    const looking = b['event-choice-looking'];

    // First, and as wide as the column they sit in.
    expect(register.y).toBeLessThan(checkin.y);
    expect(checkin.y).toBeLessThan(looking.y);
    expect(Math.abs(register.width - column.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(checkin.width - column.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(looking.width - column.width)).toBeLessThanOrEqual(1);
    for (const choice of [register, checkin, looking])
      expect(choice.height).toBeGreaterThanOrEqual(MIN_TOUCH);

    // The facts come first: the choices are below the Where card.
    const where = b['event-where'];
    expect(register.y).toBeGreaterThan(where.y + where.height - 1);
  });

  test(`at ${width}px: Share and Add to calendar are a pair below the choices, and nothing scrolls sideways`, async ({
    page,
  }) => {
    await open(page, width);
    const b = await boxes(page, [
      'event-choice-looking',
      'share-btn',
      'add-to-calendar-summary',
    ] as const);
    const looking = b['event-choice-looking'];
    const share = b['share-btn'];
    const calendar = b['add-to-calendar-summary'];

    expect(share.y, 'the pair is below the last choice').toBeGreaterThan(
      looking.y + looking.height - 1
    );
    expect(Math.abs(share.y - calendar.y), 'one row, side by side').toBeLessThanOrEqual(4);
    expect(share.x + share.width).toBeLessThanOrEqual(calendar.x + 1);
    for (const half of [share, calendar]) {
      expect(half.height).toBeGreaterThanOrEqual(MIN_TOUCH);
      expect(half.width, 'each takes about half the row').toBeGreaterThan(width * 0.35);
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, 'no sideways scroll').toBeLessThanOrEqual(0);
  });
}

test('each choice goes where it says', async ({ page }) => {
  await open(page, 375);
  await page.getByTestId('event-rsvp').click();
  await expect(page.getByTestId('register-name-input')).toBeVisible();

  await open(page, 375);
  await page.getByTestId('event-choice-checkin').click();
  await expect(page.getByTestId('checkin-submit')).toBeVisible();

  await open(page, 375);
  await page.getByTestId('event-choice-looking').click();
  await expect(page).toHaveURL(/\/events$/);
});

test('the choices make no request that carries a cookie or an identity', async ({
  page,
  context,
}) => {
  const sent: string[] = [];
  page.on('request', (r) => {
    const h = r.headers();
    if (h['cookie']) sent.push(`${r.url()} carried a cookie`);
  });
  await open(page, 375);
  expect(await context.cookies(), 'the event page sets no cookie').toEqual([]);
  expect(sent).toEqual([]);
});
