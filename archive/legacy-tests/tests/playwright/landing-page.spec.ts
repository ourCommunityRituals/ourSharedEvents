import { test, expect, Page } from '@playwright/test';

// ─── Config ───────────────────────────────────────────────────────────────────
const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';
const VALID_EMAIL = `ose-pw-${Date.now()}@mailinator.com`;

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function getEmailInput(page: Page) {
  return page
    .locator('input[type="email"], input[placeholder*="email" i], input[name*="email" i]')
    .first();
}

async function getSubmitButton(page: Page) {
  return page
    .locator(
      'button[type="submit"], button:has-text("Loop"), button:has-text("Stay"), button:has-text("Notify"), button:has-text("Submit")'
    )
    .first();
}

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 1: SECURITY
// ═════════════════════════════════════════════════════════════════════════════
test.describe('SECURITY', () => {
  test('SEC-PAGE-01 | No Mailchimp credentials in DOM', async ({ page }) => {
    await page.goto(BASE_URL);
    const html = await page.content();
    expect(html).not.toMatch(/us\d+\.list-manage\.com/i);
    expect(html).not.toMatch(/mailchimp\.com\/subscribe/i);
    expect(html).not.toMatch(/[a-f0-9]{32}-us\d+/i); // API key pattern
  });

  test('SEC-PAGE-02 | No source maps exposed', async ({ page }) => {
    const responses: string[] = [];
    page.on('response', (r) => responses.push(r.url()));
    await page.goto(BASE_URL);
    const sourceMaps = responses.filter((u) => u.endsWith('.map'));
    expect(sourceMaps).toHaveLength(0);
  });

  test('SEC-PAGE-03 | No author or developer meta tags', async ({ page }) => {
    await page.goto(BASE_URL);
    const author = await page.locator('meta[name="author"]').count();
    expect(author).toBe(0);
  });

  test('SEC-PAGE-04 | No internal comments in HTML', async ({ page }) => {
    await page.goto(BASE_URL);
    const html = await page.content();
    // Catch dev comments but allow conditional comments
    const comments = html.match(/<!--(?!\[if)[\s\S]*?-->/g) || [];
    const leakyComments = comments.filter((c) =>
      /todo|fixme|hack|key|token|mailchimp|password|api|secret/i.test(c)
    );
    expect(leakyComments).toHaveLength(0);
  });

  test('SEC-PAGE-05 | CSP header present', async ({ page }) => {
    const response = await page.goto(BASE_URL);
    const csp = response?.headers()['content-security-policy'];
    expect(csp).toBeTruthy();
  });

  test('SEC-PAGE-06 | X-Frame-Options or CSP frame-ancestors set', async ({ page }) => {
    const response = await page.goto(BASE_URL);
    const headers = response?.headers() || {};
    const xfo = headers['x-frame-options'];
    const csp = headers['content-security-policy'] || '';
    const hasFrameProtection = !!xfo || csp.includes('frame-ancestors');
    expect(hasFrameProtection).toBe(true);
  });

  test('SEC-PAGE-07 | No console errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });

  test('SEC-PAGE-08 | No LLC or personal name in page source', async ({ page }) => {
    await page.goto(BASE_URL);
    const html = await page.content();
    // Generic check — update strings as needed
    expect(html).not.toMatch(/OurCommunityRituals LLC/i);
    expect(html).not.toMatch(/Wolters Kluwer/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 2: FEATURE
// ═════════════════════════════════════════════════════════════════════════════
test.describe('FEATURE', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
  });

  // ── Content ────────────────────────────────────────────────────────────────

  test('FEAT-01 | Page title is set', async ({ page }) => {
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
    expect(title).not.toBe('Vite App');
    expect(title).not.toBe('React App');
  });

  test('FEAT-02 | Hero headline renders', async ({ page }) => {
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible();
    const text = await h1.textContent();
    expect(text!.length).toBeGreaterThan(5);
  });

  test('FEAT-03 | Copy contains community framing', async ({ page }) => {
    const body = await page.locator('body').textContent();
    const communityTerms = ['community', 'neighborhood', 'southside', 'gather', 'chicago'];
    const found = communityTerms.some((term) => body!.toLowerCase().includes(term));
    expect(found).toBe(true);
  });

  test('FEAT-04 | Stay in the loop CTA is visible', async ({ page }) => {
    const body = await page.locator('body').textContent();
    const ctaTerms = ['loop', 'email', 'notify', 'ready', 'reach out'];
    const found = ctaTerms.some((term) => body!.toLowerCase().includes(term));
    expect(found).toBe(true);
  });

  // ── Email capture form ─────────────────────────────────────────────────────

  test('FEAT-05 | Email input is present and visible', async ({ page }) => {
    const input = await getEmailInput(page);
    await expect(input).toBeVisible();
  });

  test('FEAT-06 | Submit button is present', async ({ page }) => {
    const btn = await getSubmitButton(page);
    await expect(btn).toBeVisible();
  });

  test('FEAT-07 | Empty submit shows validation feedback', async ({ page }) => {
    const btn = await getSubmitButton(page);
    await btn.click();
    await page.waitForTimeout(500);
    // Either native validation or custom error message
    const input = await getEmailInput(page);
    const validationMessage = await input.evaluate((el: HTMLInputElement) => el.validationMessage);
    const hasError =
      validationMessage.length > 0 ||
      (await page.locator('[class*="error"], [role="alert"], [aria-live]').count()) > 0;
    expect(hasError).toBe(true);
  });

  test('FEAT-08 | Invalid email format shows validation', async ({ page }) => {
    const input = await getEmailInput(page);
    await input.fill('notanemail');
    const btn = await getSubmitButton(page);
    await btn.click();
    await page.waitForTimeout(500);
    const validationMessage = await input.evaluate((el: HTMLInputElement) => el.validationMessage);
    expect(validationMessage.length).toBeGreaterThan(0);
  });

  test('FEAT-09 | Valid email submits and shows success state', async ({ page }) => {
    const input = await getEmailInput(page);
    await input.fill(VALID_EMAIL);
    const btn = await getSubmitButton(page);

    // Intercept the subscribe call
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('subscribe') && r.request().method() === 'POST'),
      btn.click(),
    ]);

    expect(response.status()).toBe(200);

    // Success UI should appear
    await expect(
      page
        .locator(
          '[class*="success"], [role="status"], :has-text("Thank"), :has-text("ready"), :has-text("you\'re in")'
        )
        .first()
    ).toBeVisible({ timeout: 5000 });
  });

  test('FEAT-10 | Form POST goes to own domain, not Mailchimp directly', async ({ page }) => {
    const externalMailchimpCall = { triggered: false };
    page.on('request', (req) => {
      if (req.url().includes('mailchimp.com') || req.url().includes('list-manage.com')) {
        externalMailchimpCall.triggered = true;
      }
    });

    const input = await getEmailInput(page);
    await input.fill(VALID_EMAIL);
    const btn = await getSubmitButton(page);
    await btn.click();
    await page.waitForTimeout(2000);

    expect(externalMailchimpCall.triggered).toBe(false);
  });

  test('FEAT-11 | Email input clears after successful submit', async ({ page }) => {
    const input = await getEmailInput(page);
    await input.fill(VALID_EMAIL);
    const btn = await getSubmitButton(page);
    await Promise.all([page.waitForResponse((r) => r.url().includes('subscribe')), btn.click()]);
    await page.waitForTimeout(1000);
    const value = await input.inputValue();
    expect(value).toBe('');
  });

  // ── Visual / Layout ────────────────────────────────────────────────────────

  test('FEAT-12 | Page renders without layout shift over 0.1 CLS', async ({ page }) => {
    let cls = 0;
    await page.addInitScript(() => {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!(entry as any).hadRecentInput) {
            (window as any).__cls = ((window as any).__cls || 0) + (entry as any).value;
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    cls = await page.evaluate(() => (window as any).__cls || 0);
    expect(cls).toBeLessThan(0.1);
  });

  test('FEAT-13 | No broken images', async ({ page }) => {
    await page.goto(BASE_URL);
    const images = await page.locator('img').all();
    for (const img of images) {
      const naturalWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
      expect(naturalWidth).toBeGreaterThan(0);
    }
  });

  test('FEAT-14 | No broken links (href="#" or empty)', async ({ page }) => {
    await page.goto(BASE_URL);
    const links = await page.locator('a[href=""], a[href="#"]').count();
    expect(links).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 3: ACCESSIBILITY
// ═════════════════════════════════════════════════════════════════════════════
test.describe('ACCESSIBILITY', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test('A11Y-01 | Email input has label or aria-label', async ({ page }) => {
    const input = await getEmailInput(page);
    const id = await input.getAttribute('id');
    const ariaLabel = await input.getAttribute('aria-label');
    const ariaLabelledBy = await input.getAttribute('aria-labelledby');
    const hasLabel = id ? (await page.locator(`label[for="${id}"]`).count()) > 0 : false;
    expect(ariaLabel || ariaLabelledBy || hasLabel).toBeTruthy();
  });

  test('A11Y-02 | Submit button has accessible name', async ({ page }) => {
    const btn = await getSubmitButton(page);
    const text = await btn.textContent();
    const ariaLabel = await btn.getAttribute('aria-label');
    expect(text?.trim() || ariaLabel).toBeTruthy();
  });

  test('A11Y-03 | Page has one H1', async ({ page }) => {
    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBe(1);
  });

  test('A11Y-04 | Images have alt text', async ({ page }) => {
    const images = await page.locator('img').all();
    for (const img of images) {
      const alt = await img.getAttribute('alt');
      expect(alt).not.toBeNull();
    }
  });

  test('A11Y-05 | Page is keyboard navigable to submit', async ({ page }) => {
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    // At some point focus should reach the email input or submit
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(['INPUT', 'BUTTON', 'A']).toContain(focused);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 4: PERFORMANCE
// ═════════════════════════════════════════════════════════════════════════════
test.describe('PERFORMANCE', () => {
  test('PERF-01 | Page loads in under 4s on fast 3G simulation', async ({ page, context }) => {
    await context.route('**/*', (route) => route.continue());
    // Simulate Fast 3G
    const client = await context.newCDPSession(page);
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: (1.5 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
      latency: 40,
    });

    const start = Date.now();
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(4000);
  });

  test('PERF-02 | No render-blocking scripts in head', async ({ page }) => {
    await page.goto(BASE_URL);
    const blockingScripts = await page
      .locator('head script:not([async]):not([defer]):not([type="module"])')
      .count();
    expect(blockingScripts).toBe(0);
  });

  test('PERF-03 | LCP element loads within 2.5s', async ({ page }) => {
    let lcp = 0;
    await page.addInitScript(() => {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        (window as any).__lcp = entries[entries.length - 1]?.startTime || 0;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    });
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    lcp = await page.evaluate(() => (window as any).__lcp || 0);
    expect(lcp).toBeLessThan(2500);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 5: E2E SMOKE
// ═════════════════════════════════════════════════════════════════════════════
test.describe('E2E SMOKE', () => {
  test('SMOKE-01 | Landing page loads and critical elements visible', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.locator('h1').first()).toBeVisible();
    const input = await getEmailInput(page);
    await expect(input).toBeVisible();
    const btn = await getSubmitButton(page);
    await expect(btn).toBeVisible();
  });

  test('SMOKE-02 | Full capture flow end to end', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    const input = await getEmailInput(page);
    await input.fill(`ose-smoke-${Date.now()}@mailinator.com`);

    const btn = await getSubmitButton(page);
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('subscribe')),
      btn.click(),
    ]);

    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('SMOKE-03 | Page renders on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); // iPhone 14
    await page.goto(BASE_URL);
    await expect(page.locator('h1').first()).toBeVisible();
    const input = await getEmailInput(page);
    await expect(input).toBeVisible();
  });

  test('SMOKE-04 | Page renders on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 }); // iPad
    await page.goto(BASE_URL);
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('SMOKE-05 | Page renders on desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE_URL);
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('SMOKE-06 | No 4xx or 5xx on page assets', async ({ page }) => {
    const failed: string[] = [];
    page.on('response', (r) => {
      if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    expect(failed).toHaveLength(0);
  });
});
