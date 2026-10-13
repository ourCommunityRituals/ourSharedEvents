/**
 * The toast service in real browsers, on the pages that use it.
 *
 * Admin and sponsor home say what an action did with the @ocr/ui toast, served
 * by the Worker at /ui-toast.js. The jsdom layer
 * (workers/oursharedevents/tests/toast-adoption.spec.ts) proves what each
 * action says. What only a browser can prove, and this does:
 *   - the script loads from this origin under the page's nonce CSP, with no
 *     violation, no console error and no cookie
 *   - each kind is told apart by icon and spoken label, not colour alone
 *   - a success and a note go after 10 seconds, a failure stays, and the clock
 *     pauses while the toast is hovered or holds keyboard focus
 *   - Details opens the four fields, Copy details puts exactly that block on
 *     the clipboard, and Escape dismisses and gives focus back
 *   - axe finds nothing in the toasts in light and in dark, and the contrast
 *     of every piece of toast text is measured here against its own ground
 *     (axe leaves contrast "incomplete" on a fixed layer over the page, so its
 *     silence alone proved nothing: a red-on-red message passed it)
 *   - on a phone the toast does not cover the action that raised it, and its
 *     controls are 44 px
 *   - round trip: the reference in a failure toast is the `X-Request-Id` the
 *     Worker sent for that request (sponsor home and admin)
 *   - seeded secret: nothing sensitive in a response reaches the page or the
 *     clipboard
 *
 * Runs in the blocking PR phone audit (playwright.mobile.config.ts) on
 * Chromium and WebKit: a local worker with migrations, a local admin key and
 * a local signing secret. Seeds its own sponsor.
 *
 * @born-red toast in a browser | method: run against the pages before they
 *   loaded the script (every test failed at "the page has ocrToast"), then one
 *   injected fault per guard | date: 2026-10-12
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedSponsorHome, type SeededSponsorHome } from './helpers/sponsor-home-seed';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';
const MIN_TOUCH_TARGET_PX = 44;
const PHONE = { width: 375, height: 812 };

test.describe.configure({ mode: 'serial' });

let seeded: SeededSponsorHome;

test.beforeAll(async ({ request }) => {
  test.skip(
    !ADMIN_BEARER,
    'Needs OSE_ADMIN_BEARER (set by playwright.mobile.config.ts for the local worker).'
  );
  seeded = await seedSponsorHome(request, ADMIN_BEARER, 'Toast');
});

// Shaped like the real things and plainly not real.
const SEEDED = {
  jwt: 'eyJ0ZXN0IjoidG9hc3QifQ.eyJub3QiOiJhLXJlYWwtdG9rZW4ifQ.c2VlZGVkLXNlY3JldA',
  bearer: 'Bearer seeded-bearer-value-0001',
  cookie: 'ose_session=seeded-cookie-value-0002',
  signedLink: 'https://oursharedevents.com/sponsor?t=seeded-signed-link-0003',
  email: 'seeded.person@example.com',
  stack: 'at handleRespond (sponsor-home.ts:340:12)',
  sql: 'SELECT id FROM sponsor_business WHERE id = ?',
  attendee: 'Seeded Attendee Name',
};
const SECRET_MARKS = [
  SEEDED.jwt,
  'seeded-bearer-value-0001',
  'seeded-cookie-value-0002',
  'seeded-signed-link-0003',
  SEEDED.email,
  'sponsor-home.ts:340',
  'sponsor_business',
  SEEDED.attendee,
];

/** CSP violations, console errors and page errors, for the life of a page. */
function watchForBreakage(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    const t = msg.text();
    // No OSE surface serves /favicon.ico yet; filtered by URL, never by text.
    if (/\/favicon\.ico(\?|$)/.test(msg.location().url)) return;
    if (msg.type() === 'error' || /Content Security Policy/i.test(t)) {
      problems.push(`${t} @ ${msg.location().url}`);
    }
  });
  page.on('pageerror', (err) => problems.push(String(err)));
  return problems;
}

/** Record what the page hands to the clipboard, and still do the real write. */
async function spyOnClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __copied: string[] };
    w.__copied = [];
    const real = navigator.clipboard && navigator.clipboard.writeText.bind(navigator.clipboard);
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText = (text: string) => {
      w.__copied.push(text);
      return real ? real(text).catch(() => undefined) : Promise.resolve();
    };
  });
}
const copied = (page: Page) =>
  page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);

async function openSponsorHome(page: Page): Promise<void> {
  await page.setViewportSize(PHONE);
  const res = await page.goto(`/sponsor?t=${encodeURIComponent(seeded.token)}`);
  expect(res?.status()).toBe(200);
  await expect(page.getByTestId('sponsor-home-name')).toHaveText(seeded.sponsorName);
  await expect
    .poll(() => page.evaluate(() => typeof (window as { ocrToast?: unknown }).ocrToast), {
      message: 'the page has ocrToast',
    })
    .toBe('object');
}

async function openAdmin(page: Page): Promise<void> {
  await page.setViewportSize(PHONE);
  await page.setExtraHTTPHeaders({ Authorization: `Bearer ${ADMIN_BEARER}` });
  const res = await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  expect(res?.status()).toBe(200);
  await expect
    .poll(() => page.evaluate(() => typeof (window as { ocrToast?: unknown }).ocrToast), {
      message: 'the page has ocrToast',
    })
    .toBe('object');
}

type ToastOptions = { details?: Record<string, unknown>; duration?: number };
const show = (
  page: Page,
  kind: 'success' | 'failure' | 'neutral',
  message: string,
  o?: ToastOptions
) =>
  page.evaluate(
    ([k, m, opts]) => {
      const api = (
        window as unknown as { ocrToast: Record<string, (m: string, o?: unknown) => void> }
      ).ocrToast;
      api[k as string](m as string, opts ?? undefined);
    },
    [kind, message, o ?? null] as const
  );

const toast = (page: Page, kind: string): Locator => page.locator(`[data-ocr-toast="${kind}"]`);

/**
 * WCAG contrast of every piece of text in the toasts against the nearest
 * painted ground under it, as the browser computed them. Colours are read by
 * painting them on a canvas, so any colour syntax the engine supports works.
 */
async function toastContrasts(page: Page) {
  return page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const rgba = (color: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    };
    const lum = ([r, g, b]: number[]) => {
      const c = [r, g, b].map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const groundOf = (el: Element): number[] | null => {
      for (let n: Element | null = el; n; n = n.parentElement) {
        const bg = rgba(getComputedStyle(n).backgroundColor);
        if (bg[3] === 255) return bg;
        if (bg[3] !== 0) return null; // a see-through ground: not measurable this way
      }
      return null;
    };
    const out: { what: string; ratio: number }[] = [];
    const texts = document.querySelectorAll(
      '[data-ocr-toast] .ocr-toast-msg, [data-ocr-toast] button, [data-ocr-toast] .ocr-toast-details-text'
    );
    texts.forEach((el) => {
      const kind = el.closest('[data-ocr-toast]')!.getAttribute('data-ocr-toast');
      const what = `${kind} ${el.className}`;
      const ground = groundOf(el);
      const ink = rgba(getComputedStyle(el).color);
      if (!ground || ink[3] !== 255) {
        out.push({ what, ratio: 0 });
        return;
      }
      const a = lum(ink);
      const b = lum(ground);
      out.push({ what, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) });
    });
    return out;
  });
}
const placementCard = (page: Page) =>
  page.locator(`[data-testid="placement-card"][data-placement-id="${seeded.placementId}"]`);

test('the page loads the toast script from this origin, under its CSP, and sets no cookie', async ({
  page,
  context,
}) => {
  const problems = watchForBreakage(page);
  const script = page.waitForResponse((r) => new URL(r.url()).pathname === '/ui-toast.js');
  await page.setViewportSize(PHONE);
  const doc = await page.goto(`/sponsor?t=${encodeURIComponent(seeded.token)}`);
  const js = await script;
  expect(js.status()).toBe(200);
  expect(js.headers()['content-type']).toBe('text/javascript; charset=utf-8');
  expect(js.headers()['x-content-type-options']).toBe('nosniff');
  expect(new URL(js.url()).origin).toBe(new URL(page.url()).origin);

  // The CSP is the one every page has: same-origin scripts and this response's
  // nonce. Nothing was loosened to let the toast in.
  const csp = doc?.headers()['content-security-policy'] ?? '';
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=_-]+';/);
  expect(csp.split(';').find((d) => d.trim().startsWith('script-src'))).not.toContain('unsafe');

  await expect
    .poll(() => page.evaluate(() => typeof (window as { ocrToast?: unknown }).ocrToast))
    .toBe('object');
  await show(page, 'success', 'Saved');
  await expect(toast(page, 'success')).toBeVisible();
  // The script uses no inline style and no inline handler, so nothing is refused.
  expect(problems, problems.join('\n')).toEqual([]);
  // No cookies on a public surface, and nothing kept in the browser.
  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});

test('each kind has its own icon and spoken label', async ({ page }) => {
  await openSponsorHome(page);
  await show(page, 'success', 'Event saved');
  await show(page, 'failure', 'Could not save the event');
  await show(page, 'neutral', 'The map is on for this event');

  const expected = [
    { kind: 'success', icon: 'check', word: 'Success: ', lane: 'polite' },
    { kind: 'failure', icon: 'cross', word: 'Error: ', lane: 'assertive' },
    { kind: 'neutral', icon: 'info', word: 'Note: ', lane: 'polite' },
  ];
  const shapes = new Set<string>();
  for (const e of expected) {
    const t = toast(page, e.kind);
    await expect(t).toBeVisible();
    const icon = t.locator(`svg[data-icon="${e.icon}"]`);
    await expect(icon).toBeVisible();
    const box = await icon.boundingBox();
    expect(box!.width, `${e.kind} icon is drawn`).toBeGreaterThanOrEqual(16);
    shapes.add((await icon.locator('path').getAttribute('d')) ?? '');
    // The word a screen reader hears first. It is in the DOM, not painted.
    await expect(t.locator('.ocr-toast-msg .ocr-sr-only')).toHaveText(e.word, {
      useInnerText: false,
    });
    expect(
      await t.evaluate((el) => el.closest('[aria-live]')?.getAttribute('aria-live')),
      `${e.kind} is announced ${e.lane}`
    ).toBe(e.lane);
  }
  expect(shapes.size, 'three different shapes, so colour is not the only cue').toBe(3);
});

test('a success and a note go after 10 seconds; a failure stays', async ({ page }) => {
  await page.clock.install();
  await openSponsorHome(page);
  await show(page, 'success', 'Event saved');
  await show(page, 'neutral', 'Heads up');
  await show(page, 'failure', 'Could not save the event');
  await page.clock.runFor(9_500);
  await expect(toast(page, 'success')).toBeVisible();
  await expect(toast(page, 'neutral')).toBeVisible();
  await page.clock.runFor(1_000);
  await expect(toast(page, 'success')).toHaveCount(0);
  await expect(toast(page, 'neutral')).toHaveCount(0);
  await page.clock.runFor(120_000);
  await expect(toast(page, 'failure')).toBeVisible();
});

test('the 10 seconds pause while the toast is hovered, and resume after', async ({ page }) => {
  await page.clock.install();
  await openSponsorHome(page);
  await show(page, 'neutral', 'Heads up');
  await page.clock.runFor(4_000);
  await toast(page, 'neutral').hover();
  await page.clock.runFor(60_000);
  await expect(toast(page, 'neutral'), 'hovered: still there a minute later').toBeVisible();
  await page.mouse.move(187, 700);
  await page.clock.runFor(5_000);
  await expect(toast(page, 'neutral'), '5 of the 6 seconds left have passed').toBeVisible();
  await page.clock.runFor(1_500);
  await expect(toast(page, 'neutral')).toHaveCount(0);
});

test('the 10 seconds pause while the toast holds keyboard focus, and resume after', async ({
  page,
}) => {
  await page.clock.install();
  await openSponsorHome(page);
  await show(page, 'success', 'Event saved');
  await page.clock.runFor(4_000);
  await toast(page, 'success').locator('.ocr-toast-dismiss').focus();
  await page.clock.runFor(60_000);
  await expect(toast(page, 'success'), 'focused: still there a minute later').toBeVisible();
  await placementCard(page).getByTestId('placement-accept').focus();
  await page.clock.runFor(5_000);
  await expect(toast(page, 'success'), '5 of the 6 seconds left have passed').toBeVisible();
  await page.clock.runFor(1_500);
  await expect(toast(page, 'success')).toHaveCount(0);
});

test('Details opens the four fields and Copy details copies exactly that block', async ({
  page,
  browserName,
}) => {
  await spyOnClipboard(page);
  await openSponsorHome(page);
  await show(page, 'failure', 'Could not save the event', {
    details: { code: 'INVALID_TRANSITION', requestId: 'req-7f3a9c21', action: 'Saving the event' },
  });
  const t = toast(page, 'failure');
  const more = t.locator('.ocr-toast-more');
  const panel = t.locator('.ocr-toast-details');
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toBeHidden();
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).toBeVisible();
  const block = (await t.locator('.ocr-toast-details-text').textContent()) ?? '';
  expect(block).toMatch(
    /^Error code: INVALID_TRANSITION\nRequest reference: req-7f3a9c21\nTime: \d{4}-\d\d-\d\dT[\d:.]+Z\nAction: Saving the event$/
  );

  await t.locator('.ocr-toast-copy').click();
  await expect.poll(() => copied(page)).toEqual([block]);
  if (browserName === 'chromium') {
    // Chromium has the clipboard permission here, so read the real clipboard back.
    await expect(t.locator('.ocr-toast-copied')).toHaveText('Copied.');
    // Windows hands text back with CRLF line ends; the block itself is LF.
    const onClipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(onClipboard.replace(/\r\n/g, '\n')).toBe(block);
  }
  // Opening the details does not dismiss, and the arrow closes them again.
  await more.click();
  await expect(panel).toBeHidden();
  await expect(t).toBeVisible();
});

test('Escape dismisses the toast that has focus and gives focus back', async ({ page }) => {
  await openSponsorHome(page);
  const accept = placementCard(page).getByTestId('placement-accept');
  await accept.focus();
  await show(page, 'failure', 'Could not save the event');
  await show(page, 'neutral', 'Heads up');
  // A toast never takes focus by itself.
  await expect(accept).toBeFocused();
  await toast(page, 'failure').locator('.ocr-toast-more').focus();
  await page.keyboard.press('Escape');
  await expect(toast(page, 'failure')).toHaveCount(0);
  await expect(toast(page, 'neutral'), 'only the focused toast goes').toBeVisible();
  await expect(accept).toBeFocused();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`axe finds nothing in the toasts, and their text passes AA contrast, in ${scheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    for (const open of [openSponsorHome, openAdmin]) {
      await open(page);
      await show(page, 'success', 'Event saved');
      await show(page, 'neutral', 'The map is on for this event');
      await show(page, 'failure', 'Could not save the event', {
        details: {
          code: 'INVALID_TRANSITION',
          requestId: 'req-7f3a9c21',
          action: 'Saving the event',
        },
      });
      await toast(page, 'failure').locator('.ocr-toast-more').click();
      await expect(toast(page, 'failure').locator('.ocr-toast-details')).toBeVisible();
      // Each toast fades in over 150 ms; a toast measured mid-fade reads as
      // low contrast. Wait for the fade to end before looking.
      await page.evaluate(() =>
        Promise.all(
          Array.from(document.querySelectorAll('[data-ocr-toast]')).flatMap((el) =>
            el.getAnimations().map((a) => a.finished)
          )
        )
      );
      const results = await new AxeBuilder({ page })
        .include('[data-ocr-toast-region]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const found = results.violations.map(
        (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`
      );
      expect(found, `${scheme}, ${new URL(page.url()).pathname}\n${found.join('\n')}`).toEqual([]);
      // Contrast, measured: the message, every button and the details block,
      // each against its own ground. 4.5:1 is WCAG AA for text this size.
      const contrasts = await toastContrasts(page);
      expect(
        contrasts.length,
        'three messages, the buttons and the details'
      ).toBeGreaterThanOrEqual(8);
      const low = contrasts
        .filter((c) => c.ratio < 4.5)
        .map((c) => `${c.what}: ${c.ratio.toFixed(2)}`);
      expect(low, `${scheme}, ${new URL(page.url()).pathname}\n${low.join('\n')}`).toEqual([]);
    }
  });
}

test('on a phone the toast does not cover the action, and its controls are 44 px', async ({
  page,
}) => {
  await openSponsorHome(page);
  await show(page, 'failure', 'Could not save your answer.', {
    details: { code: 'UNAUTHORIZED', requestId: 'req-7f3a9c21', action: 'Answering a placement' },
  });
  const t = toast(page, 'failure');
  await expect(t).toBeVisible();
  const box = (await t.boundingBox())!;
  expect(box.x, 'inside the screen').toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, 'inside the screen').toBeLessThanOrEqual(PHONE.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    PHONE.width
  );
  for (const id of ['placement-accept', 'placement-decline']) {
    const btn = placementCard(page).getByTestId(id);
    await btn.scrollIntoViewIfNeeded();
    const b = (await btn.boundingBox())!;
    const toastNow = (await t.boundingBox())!;
    const apart = b.y >= toastNow.y + toastNow.height || b.y + b.height <= toastNow.y;
    expect(apart, `${id} is not under the toast`).toBe(true);
  }
  await t.locator('.ocr-toast-more').click();
  for (const sel of ['.ocr-toast-dismiss', '.ocr-toast-more', '.ocr-toast-copy']) {
    const b = (await t.locator(sel).boundingBox())!;
    expect(b.height, `${sel} height`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
    expect(b.width, `${sel} width`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
  }
});

test('round trip, sponsor home: the reference in the toast is the X-Request-Id of the response', async ({
  page,
}) => {
  const problems = watchForBreakage(page);
  await openSponsorHome(page);
  // The page sends its real request; only the link's token is swapped for one
  // the Worker will refuse, so the refusal and its request id are real.
  await page.route('**/api/v2/sponsor/placements/*/respond', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
    await route.continue({ postData: JSON.stringify({ ...body, token: 'not-a-valid-link' }) });
  });
  const answered = page.waitForResponse((r) => r.url().includes('/respond'));
  await placementCard(page).getByTestId('placement-accept').click();
  const res = await answered;
  expect(res.status()).toBe(401);
  const reference = res.headers()['x-request-id'];
  expect(reference, 'the Worker sent a request id').toMatch(/^[A-Za-z0-9_.:-]{8,64}$/);
  const body = (await res.json()) as { code: string; requestId: string };
  expect(body.requestId).toBe(reference);

  const t = toast(page, 'failure');
  await expect(t.locator('.ocr-toast-msg')).toHaveText(
    'Error: Could not save your answer. This link no longer works. Open the link the organizer sent you again.',
    { useInnerText: false }
  );
  await t.locator('.ocr-toast-more').click();
  const block = (await t.locator('.ocr-toast-details-text').textContent()) ?? '';
  expect(block).toContain(`Request reference: ${reference}`);
  expect(block).toContain(`Error code: ${body.code}`);
  expect(block).toContain('Action: Answering a placement');
  // The refusal changed nothing, and the line under the card is not used.
  await expect(placementCard(page).locator('.sh-msg')).toHaveText('');
  await expect(placementCard(page).getByTestId('placement-accept')).toBeEnabled();
  // The browser logs the 401 itself; nothing else may be wrong.
  const real = problems.filter((p) => !/401/.test(p));
  expect(real, real.join('\n')).toEqual([]);
});

test('seeded secret: nothing sensitive in a response reaches the page or the clipboard', async ({
  page,
}) => {
  await spyOnClipboard(page);
  await openSponsorHome(page);
  await page.route('**/api/v2/sponsor/placements/*/respond', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      headers: { 'X-Request-Id': 'req-7f3a9c21', 'X-Seeded-Authorization': SEEDED.bearer },
      body: JSON.stringify({
        ok: false,
        status: 401,
        code: 'UNAUTHORIZED',
        error: `Link not valid for ${SEEDED.email}. Open ${SEEDED.signedLink} token=${SEEDED.jwt} ${SEEDED.cookie} ${SEEDED.attendee} ${SEEDED.stack} ${SEEDED.sql}`,
        requestId: 'req-7f3a9c21',
        token: SEEDED.jwt,
        authorization: SEEDED.bearer,
        cookie: SEEDED.cookie,
        link: SEEDED.signedLink,
        email: SEEDED.email,
        stack: SEEDED.stack,
        query: SEEDED.sql,
        request: { attendee_name: SEEDED.attendee },
      }),
    })
  );
  await placementCard(page).getByTestId('placement-accept').click();
  const t = toast(page, 'failure');
  await expect(t).toBeVisible();
  await t.locator('.ocr-toast-more').click();
  await t.locator('.ocr-toast-copy').click();
  await expect.poll(async () => (await copied(page)).length).toBe(1);
  const block = (await copied(page))[0];
  expect(block.split('\n')).toHaveLength(4);
  expect(block).toContain('Request reference: req-7f3a9c21');
  expect(block).toContain('Error code: UNAUTHORIZED');

  const everything = (await page.content()) + '\n' + block;
  for (const mark of [...SECRET_MARKS, seeded.token]) {
    expect(everything.includes(mark), `leaked: ${mark}`).toBe(false);
  }
});

test('sponsor home: accepting for real shows a success toast and the card follows', async ({
  page,
}) => {
  const problems = watchForBreakage(page);
  await openSponsorHome(page);
  const card = placementCard(page);
  await card.getByTestId('placement-accept').click();
  await expect(toast(page, 'success').locator('.ocr-toast-msg')).toHaveText(
    'Success: Thanks. Your placement is on.',
    { useInnerText: false }
  );
  await expect(card.getByTestId('placement-state')).toHaveText('Accepted');
  await expect(card.locator('.sh-msg')).toHaveText('');
  await expect(toast(page, 'failure')).toHaveCount(0);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('round trip, admin: a failed action shows the X-Request-Id the Worker sent', async ({
  page,
}) => {
  await openAdmin(page);
  // The page's own action, against a poster deployment that does not exist.
  const answered = page.waitForResponse(
    (r) => r.request().method() === 'DELETE' && r.url().includes('/poster-deployments/')
  );
  await page.evaluate(() =>
    (window as unknown as { _confirmDeletePd(id: string): Promise<void> })._confirmDeletePd(
      'pd_does_not_exist'
    )
  );
  const res = await answered;
  expect(res.ok()).toBe(false);
  const reference = res.headers()['x-request-id'];
  expect(reference, 'the Worker sent a request id').toMatch(/^[A-Za-z0-9_.:-]{8,64}$/);
  const body = (await res.json()) as { code?: string };

  const t = toast(page, 'failure');
  await expect(t.locator('.ocr-toast-msg')).toHaveText(
    'Error: Could not deactivate the poster deployment.',
    { useInnerText: false }
  );
  await t.locator('.ocr-toast-more').click();
  const block = (await t.locator('.ocr-toast-details-text').textContent()) ?? '';
  expect(block).toContain(`Request reference: ${reference}`);
  expect(block).toContain(`Error code: ${body.code}`);
  expect(block).toContain('Action: Deactivating a poster deployment');
  // The old status line is not used when the toast is there.
  await expect(page.locator('#admin-status')).toBeHidden();
});
