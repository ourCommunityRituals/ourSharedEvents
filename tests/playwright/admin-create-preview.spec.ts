/**
 * The create flow shows what you are making as you make it (OSE-1528, first slice).
 *
 * In a real browser, against the local worker:
 *   - the preview sits beside the form from tablet width and below it (foldable)
 *     on a phone, with nothing running off the side at 320px;
 *   - it follows typing and sends no request while it does;
 *   - the review before Publish names what the server would refuse, Publish
 *     sends nothing until it is fixed, and Change goes back to the right field
 *     and returns with Save;
 *   - touch targets are 44px or more, and axe finds nothing serious in light or dark.
 *
 * jsdom specs (workers/oursharedevents/tests/admin-wizard-preview-review.spec.ts)
 * run the logic; this adds what only a browser can show: layout.
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER ?? '';
const MIN_TOUCH = 44;
const PHONE = { width: 375, height: 812 };
const TABLET = { width: 820, height: 1180 };
const DESKTOP = { width: 1280, height: 900 };

async function openWizard(page: Page, size: { width: number; height: number }): Promise<void> {
  expect(ADMIN_BEARER, 'the local audit worker supplies OSE_ADMIN_BEARER').not.toBe('');
  await page.setViewportSize(size);
  await page.setExtraHTTPHeaders({ Authorization: `Bearer ${ADMIN_BEARER}` });
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('admin-path-wizard').click();
  await expect(page.getByTestId('wizard-step-1')).toBeVisible();
}

async function box(page: Page, testid: string) {
  const b = await page.getByTestId(testid).first().boundingBox();
  expect(b, `${testid} is rendered`).not.toBeNull();
  return b!;
}

async function noSidewaysScroll(page: Page, label: string): Promise<void> {
  const o = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(o.sw, `${label}: ${o.sw}px wide on a ${o.cw}px screen`).toBeLessThanOrEqual(o.cw + 1);
}

/** Name, place and date, then to the step with the event type; Create; on to step 5. */
async function createAndReview(
  page: Page,
  o: { time?: string; type?: boolean; map?: boolean }
): Promise<{ id: string; title: string }> {
  const title = `Preview night ${Date.now()}`;
  await page.getByTestId('wizard-event-name').fill(title);
  await page.getByTestId('wizard-event-venue').fill('Eagles Hall');
  // A new event is off the map unless the organizer says yes; this journey wants it reachable.
  if (o.map) await page.getByTestId('wizard-publish-yes').click();
  const start = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  await page.getByTestId('wizard-event-date').fill(start);
  if (o.time) await page.getByTestId('wizard-event-time').fill(o.time);
  await page.getByTestId('wizard-next-btn').click();
  if (o.type) {
    await page.getByTestId('wizard-category').selectOption({ index: 1 });
    await page.getByTestId('wizard-event-type').selectOption({ index: 1 });
  }
  await page.getByTestId('wizard-next-btn').click();
  await page.getByTestId('wizard-next-btn').click();
  const preview = page.getByTestId('wizard-preview-public');
  await expect(preview).toBeVisible();
  const href = await preview.getAttribute('href');
  const id = /\/events\/([^/]+)\/preview$/.exec(href ?? '')?.[1];
  expect(id, `preview href ${href}`).toBeTruthy();
  await page.getByTestId('wizard-next-btn').click();
  await expect(page.getByTestId('wizard-step-5')).toBeVisible();
  return { id: id!, title };
}

test.describe('create flow: live preview and review', () => {
  test('beside the form from tablet width, below it and foldable on a phone', async ({ page }) => {
    await openWizard(page, PHONE);
    const form = await box(page, 'wizard-step-1');
    const phonePreview = await box(page, 'wizard-preview');
    expect(phonePreview.y, 'phone: the preview is below the form').toBeGreaterThanOrEqual(
      form.y + form.height - 1
    );
    const toggle = page.getByTestId('wizard-preview-toggle');
    await expect(toggle).toBeVisible();
    expect((await box(page, 'wizard-preview-toggle')).height).toBeGreaterThanOrEqual(MIN_TOUCH);
    await expect(page.getByTestId('wizard-preview-card')).toBeVisible();
    await toggle.click();
    await expect(page.getByTestId('wizard-preview-card')).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(page.getByTestId('wizard-preview-card')).toBeVisible();

    for (const size of [TABLET, DESKTOP]) {
      await page.setViewportSize(size);
      const f = await box(page, 'wizard-step-1');
      const p = await box(page, 'wizard-preview');
      expect(p.x, `${size.width}px: the preview is beside the form`).toBeGreaterThanOrEqual(
        f.x + f.width - 1
      );
      expect(p.y, `${size.width}px: it starts at the top of the form`).toBeLessThan(f.y + 200);
      await expect(page.getByTestId('wizard-preview-toggle')).toBeHidden();
      await expect(page.getByTestId('wizard-preview-card')).toBeVisible();
      await noSidewaysScroll(page, `${size.width}px`);
    }
  });

  test('nothing runs off the side at 320px, with the preview open', async ({ page }) => {
    await openWizard(page, { width: 320, height: 700 });
    await page
      .getByTestId('wizard-event-name')
      .fill('A very long event name that keeps going and going');
    await noSidewaysScroll(page, '320px');
  });

  test('the preview follows typing, and typing sends no request', async ({ page }) => {
    await openWizard(page, TABLET);
    await page.waitForLoadState('networkidle');
    const sent: string[] = [];
    page.on('request', (r) => sent.push(`${r.method()} ${r.url()}`));
    const preview = page.getByTestId('wizard-preview');
    await expect(page.getByTestId('wizard-preview-title')).toHaveText('Your event name');
    await page.getByTestId('wizard-event-name').pressSequentially('Thursday Trivia');
    await page.getByTestId('wizard-event-venue').pressSequentially('Rock Island Public House');
    await page.getByTestId('wizard-event-date').fill('2026-10-24');
    await page.getByTestId('wizard-event-time').fill('18:00');
    await page.getByTestId('wizard-event-what').evaluate((el) => {
      (el as HTMLInputElement).value = '<b>Bold?</b> Teams and snacks';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.getByTestId('wizard-preview-title')).toHaveText('Thursday Trivia');
    await expect(page.getByTestId('wizard-preview-where')).toContainText(
      'Rock Island Public House'
    );
    await expect(page.getByTestId('wizard-preview-when')).toContainText(
      'Saturday, October 24, 2026'
    );
    await expect(page.getByTestId('wizard-preview-when')).toContainText('6:00');
    await expect(page.getByTestId('wizard-preview-what')).toHaveText(
      '<b>Bold?</b> Teams and snacks'
    );
    expect(await preview.locator('b').count(), 'typed markup is shown as text').toBe(0);
    expect(sent, `requests while typing:\n${sent.join('\n')}`).toEqual([]);
  });

  test('a draft that is missing its time and type: review says so, Publish sends nothing and opens the field, Change fixes the rest', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await openWizard(page, PHONE);
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    const { id } = await createAndReview(page, { map: true });

    // The review names what the server would refuse, in the server's words.
    await expect(page.getByTestId('wizard-review-missing')).toHaveText(
      'Add a start time and an event type before this event goes further'
    );
    for (const k of ['title', 'when', 'type', 'where']) {
      expect(
        (await box(page, `wizard-review-change-${k}`)).height,
        `${k} Change`
      ).toBeGreaterThanOrEqual(MIN_TOUCH);
    }

    // Publish says why and sends nothing: no status change, still a draft.
    const sent: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET') sent.push(`${r.method()} ${r.url()}`);
    });
    // It also takes the organizer to the first missing field, marked and in
    // focus, with the reason on that step (OSE-1644).
    await page.getByTestId('wizard-go-live-btn').click();
    await expect(page.getByTestId('wizard-msg')).toHaveText(
      'Add a start time and an event type before this event goes further'
    );
    expect(sent, 'Publish sent nothing').toEqual([]);
    expect((await request.get(`/events/${id}`)).status()).toBe(404);
    await expect(page.getByTestId('wizard-event-time')).toBeFocused();
    await expect(page.getByTestId('wizard-event-time')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('wizard-next-btn')).toBeHidden();

    // Filling it clears the mark; the preview is there to see the change.
    await page.getByTestId('wizard-event-time').fill('18:30');
    await expect(page.getByTestId('wizard-event-time')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('wizard-preview-when')).toContainText('6:30');
    await page.getByTestId('wizard-save-edit-btn').click();
    await expect(page.getByTestId('wizard-step-5')).toBeVisible();
    await expect(page.getByTestId('wizard-review-missing')).toHaveText(
      'Add an event type before this event goes further'
    );

    // Change on the type goes to the type picker, and marks nothing: only a
    // refused Publish marks a field.
    await page.getByTestId('wizard-review-change-type').click();
    await expect(page.getByTestId('wizard-category')).toBeFocused();
    await expect(page.getByTestId('wizard-category')).not.toHaveAttribute('aria-invalid', 'true');
    await page.getByTestId('wizard-category').selectOption({ index: 1 });
    await page.getByTestId('wizard-event-type').selectOption({ index: 1 });
    await expect(page.getByTestId('wizard-preview-type')).toContainText('>');
    await page.getByTestId('wizard-save-edit-btn').click();
    await expect(page.getByTestId('wizard-step-5')).toBeVisible();
    await expect(page.getByTestId('wizard-review-missing')).toBeHidden();

    // Now Publish goes through and the page is live by link.
    await page.getByTestId('wizard-go-live-btn').click();
    await expect(page.getByTestId('wizard-go-live-msg')).toContainText('published');
    expect((await request.get(`/events/${id}`)).status()).toBe(200);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('Back to review puts the old value back and saves nothing', async ({ page }) => {
    test.setTimeout(90_000);
    await openWizard(page, PHONE);
    await createAndReview(page, { time: '18:30', type: true });
    await expect(page.getByTestId('wizard-review-missing')).toBeHidden();
    const sent: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET') sent.push(`${r.method()} ${r.url()}`);
    });
    await page.getByTestId('wizard-review-change-title').click();
    await expect(page.getByTestId('wizard-event-name')).toBeFocused();
    await page.getByTestId('wizard-event-name').fill('Something else entirely');
    await expect(page.getByTestId('wizard-preview-title')).toHaveText('Something else entirely');
    await page.getByTestId('wizard-cancel-edit-btn').click();
    await expect(page.getByTestId('wizard-step-5')).toBeVisible();
    await expect(page.getByTestId('wizard-preview-title')).toContainText('Preview night');
    expect(sent, 'nothing was saved').toEqual([]);
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`axe WCAG 2.1 AA with the preview open, ${colorScheme}: nothing serious`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.emulateMedia({ colorScheme });
      await openWizard(page, TABLET);
      await page.getByTestId('wizard-event-name').fill('Thursday Trivia');
      const scan = async (where: string) => {
        await page.evaluate(() =>
          Promise.all(
            document
              .getAnimations()
              .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
              .map((a) => a.finished)
          )
        );
        const results = await new AxeBuilder({ page })
          .include('[data-testid="launch-wizard"]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        const found = results.violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map(
            (v) =>
              `${v.id} (${v.impact}):\n` +
              v.nodes
                .map((n) => `  ${n.target.join(' ')} :: ${n.any.map((a) => a.message).join(' | ')}`)
                .join('\n')
          );
        expect(found, `${where}, ${colorScheme}:\n${found.join('\n')}`).toEqual([]);
      };
      await scan('step 1 with the preview');
      await createAndReview(page, {});
      await scan('step 5 review');
    });
  }
});
