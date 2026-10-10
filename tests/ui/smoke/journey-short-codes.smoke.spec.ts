/**
 * SMOKE JOURNEY: an event's short codes, opened on staging like a phone does.
 *
 * Owner, 2026-10-10: "clicking the shortened links do not work… make sure they
 * connect e2e through the entire infra". The Bruno contract (T2, folder 15)
 * checks the first hop of /e/ and /tv/ only. This walks all five codes
 * (/e/ /p/ /tv/ /r/ /c/) through the deployed Worker, follows every redirect,
 * and checks the page each one lands on actually opens for that event.
 *
 * The code is read from the event page's own Share link, the way a person gets
 * it, so a code that stopped being handed out fails here too. The event is
 * test-event-001 (seeded with its code by fixtures/test-event-001.sql).
 *
 * Runs in T4e with the attendee arc (BASE_URL = staging).
 */

import { test, expect } from '@playwright/test';

const EVENT = process.env.SMOKE_EVENT_CODES || 'test-event-001';
// The code alphabet: A–Z and 2–9 without 0, O, 1, I, L (lib/event-code.ts).
const CODE_IN_SHARE_LINK = /\/e\/([A-HJKMNP-Z2-9]{6})(?![A-Za-z0-9])/;

test.describe('Journey: short codes reach their page on staging', () => {
  test.describe.configure({ mode: 'serial' });

  let code = '';
  let title = '';

  test('the event page hands out its short code', async ({ page }) => {
    const res = await page.goto(`/events/${EVENT}`, { waitUntil: 'domcontentloaded' });
    expect(res?.status(), 'the event page opens').toBe(200);
    title = ((await page.locator('h1').first().textContent()) || '').trim();
    expect(title, 'the event page names the event').not.toBe('');
    const m = CODE_IN_SHARE_LINK.exec(await page.content());
    expect(m, 'the Share link carries /e/<code>').not.toBeNull();
    code = m![1];
  });

  const HOPS: Array<{ prefix: string; lands: RegExp; what: string; showsTitle: boolean }> = [
    {
      prefix: 'e',
      lands: new RegExp(`^/events/${EVENT}(/[a-z0-9-]+)?$`),
      what: 'event page',
      showsTitle: true,
    },
    {
      prefix: 'p',
      lands: new RegExp(`^/events/${EVENT}/poster$`),
      what: 'poster',
      showsTitle: true,
    },
    {
      prefix: 'tv',
      lands: new RegExp(`^/events/${EVENT}/tv$`),
      what: 'TV display',
      showsTitle: false,
    },
    {
      prefix: 'r',
      lands: new RegExp(`^/events/${EVENT}/register$`),
      what: 'sign-up form',
      showsTitle: true,
    },
    {
      prefix: 'c',
      lands: new RegExp(`^/events/${EVENT}/checkin$`),
      what: 'check-in form',
      showsTitle: true,
    },
  ];

  for (const hop of HOPS) {
    test(`/${hop.prefix}/<code> opens the ${hop.what}`, async ({ page }) => {
      test.skip(!code, 'no code was handed out (the first test says why)');
      const res = await page.goto(`/${hop.prefix}/${code}`, { waitUntil: 'domcontentloaded' });
      expect(res?.status(), `/${hop.prefix}/${code} ends on a page that opens`).toBe(200);
      expect(new URL(page.url()).pathname).toMatch(hop.lands);
      if (hop.showsTitle) {
        await expect(page.getByText(title, { exact: false }).first()).toBeVisible({
          timeout: 15_000,
        });
      } else {
        await expect(page.locator('[data-testid="display-main"]')).toBeAttached();
      }
    });
  }

  test('a code typed in lower case and with a space still opens the event', async ({ page }) => {
    test.skip(!code, 'no code was handed out');
    const typed = `${code.slice(0, 3).toLowerCase()}%20${code.slice(3).toLowerCase()}`;
    const res = await page.goto(`/e/${typed}`, { waitUntil: 'domcontentloaded' });
    expect(res?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toMatch(new RegExp(`^/events/${EVENT}`));
  });
});
