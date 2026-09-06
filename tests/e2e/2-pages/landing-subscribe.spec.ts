/**
 * E2E Tests: Landing Page + Subscribe — Deep Functional Coverage
 *
 * Tests / (landing) served by the Cloudflare Worker.
 * The landing page is the marketing front door with:
 *   - Hero section with value prop
 *   - Email subscribe form (POST /subscribe)
 *   - Neighborhood ring visualization (6 Southside communities)
 *   - Feature cards (Shared Events, Local Sponsors, Community First)
 *   - Navigation to /events and /admin
 *
 * Source: workers/oursharedevents/src/handlers/pages.ts (LANDING_HTML)
 *
 * Data-testids:
 *   landing-header, landing-logo, landing-nav, nav-events, nav-admin
 *   landing-main, hero-section, subscribe-form, subscribe-email, subscribe-submit
 *   ring-section, ring-layout, ring-node-ep/br/bv/bi/mg/ol
 *   features-section, feature-events, feature-sponsors, feature-community
 *   landing-footer
 *
 * Subscribe API: POST /subscribe { email } → { success, persisted } or { success:false, error }
 */

import { test, expect, Page } from '@playwright/test';

const TIMEOUT = 20_000;

async function navigateToLanding(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await page.waitForLoadState('networkidle');
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. PAGE STRUCTURE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Landing — Structure', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToLanding(page);
  });

  test('returns HTTP 200', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.status()).toBe(200);
  });

  test('Content-Type is text/html', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.headers()['content-type']).toContain('text/html');
  });

  test('has <title> OurSharedEvents', async ({ page }) => {
    expect(await page.title()).toContain('OurSharedEvents');
  });

  test('has lang="en"', async ({ page }) => {
    expect(await page.locator('html').getAttribute('lang')).toBe('en');
  });

  test('has meta description', async ({ page }) => {
    const desc = await page.locator('meta[name="description"]').getAttribute('content');
    expect(desc?.length).toBeGreaterThan(10);
    expect(desc).toContain('Chicago');
  });

  test('has meta viewport', async ({ page }) => {
    const vp = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(vp).toContain('width=device-width');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. HEADER + NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Landing — Header & Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToLanding(page);
  });

  test('header is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="landing-header"]')).toBeVisible();
  });

  test('logo shows brand name', async ({ page }) => {
    await expect(page.locator('[data-testid="landing-logo"]')).toContainText('OurSharedEvents');
  });

  test('nav has Events link pointing to /events', async ({ page }) => {
    const link = page.locator('[data-testid="nav-events"]');
    await expect(link).toBeVisible();
    await expect(link).toContainText('Events');
    expect(await link.getAttribute('href')).toBe('/events');
  });

  test('nav has Admin link pointing to /admin', async ({ page }) => {
    const link = page.locator('[data-testid="nav-admin"]');
    await expect(link).toBeVisible();
    await expect(link).toContainText('Admin');
    expect(await link.getAttribute('href')).toBe('/admin');
  });

  test('clicking Events nav goes to /events', async ({ page }) => {
    await page.locator('[data-testid="nav-events"]').click();
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/events');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. HERO SECTION
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Landing — Hero Section', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToLanding(page);
  });

  test('hero section is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="hero-section"]')).toBeVisible();
  });

  test('hero has h1 headline', async ({ page }) => {
    const h1 = page.locator('[data-testid="hero-section"] h1');
    await expect(h1).toBeVisible();
    const text = await h1.textContent();
    expect(text?.length).toBeGreaterThan(10);
    expect(text).toContain('neighborhood');
  });

  test('hero has descriptive paragraph', async ({ page }) => {
    const p = page.locator('[data-testid="hero-section"] p');
    await expect(p).toBeVisible();
    const text = await p.textContent();
    expect(text).toContain('Community events');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. SUBSCRIBE FORM — STRUCTURE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Landing — Subscribe Form Structure', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToLanding(page);
  });

  test('form is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="subscribe-form"]')).toBeVisible();
  });

  test('email input is visible and editable', async ({ page }) => {
    const input = page.locator('[data-testid="subscribe-email"]');
    await expect(input).toBeVisible();
    await expect(input).toBeEditable();
  });

  test('email input has type="email"', async ({ page }) => {
    expect(await page.locator('[data-testid="subscribe-email"]').getAttribute('type')).toBe(
      'email'
    );
  });

  test('email input has placeholder', async ({ page }) => {
    const ph = await page.locator('[data-testid="subscribe-email"]').getAttribute('placeholder');
    expect(ph?.length).toBeGreaterThan(0);
  });

  test('email input has aria-label', async ({ page }) => {
    const ariaLabel = await page
      .locator('[data-testid="subscribe-email"]')
      .getAttribute('aria-label');
    expect(ariaLabel).toContain('Email');
  });

  test('email input has associated sr-only <label>', async ({ page }) => {
    const label = page.locator('label[for="email-input"]');
    await expect(label).toBeAttached();
    const classes = await label.getAttribute('class');
    expect(classes).toContain('sr-only');
  });

  test('submit button is visible and enabled', async ({ page }) => {
    const btn = page.locator('[data-testid="subscribe-submit"]');
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await expect(btn).toContainText('Stay in the Loop');
  });

  test('form message area has role="status" and aria-live="polite"', async ({ page }) => {
    const msg = page.locator('#form-message');
    expect(await msg.getAttribute('role')).toBe('status');
    expect(await msg.getAttribute('aria-live')).toBe('polite');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. SUBSCRIBE FORM — SUBMISSION
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Landing — Subscribe Form Submission', () => {
  test('valid email → success message', async ({ page }) => {
    await page.route('**/subscribe', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, persisted: true }),
      })
    );
    await navigateToLanding(page);

    await page.locator('[data-testid="subscribe-email"]').fill('test@example.com');
    await page.locator('[data-testid="subscribe-submit"]').click();

    const msg = page.locator('#form-message');
    await expect(msg).toContainText("you're in", { timeout: 5000 });
    const classes = await msg.getAttribute('class');
    expect(classes).toContain('success');
  });

  test('email input clears after successful submit', async ({ page }) => {
    await page.route('**/subscribe', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      })
    );
    await navigateToLanding(page);

    await page.locator('[data-testid="subscribe-email"]').fill('clear@example.com');
    await page.locator('[data-testid="subscribe-submit"]').click();
    await page.waitForTimeout(1000);

    expect(await page.locator('[data-testid="subscribe-email"]').inputValue()).toBe('');
  });

  test('button shows "Sending…" during submission', async ({ page }) => {
    await page.route('**/subscribe', async (route) => {
      await new Promise((r) => setTimeout(r, 500));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });
    await navigateToLanding(page);

    await page.locator('[data-testid="subscribe-email"]').fill('wait@example.com');
    await page.locator('[data-testid="subscribe-submit"]').click();

    // Button should be disabled during submission
    await expect(page.locator('[data-testid="subscribe-submit"]')).toBeDisabled();
  });

  test('button re-enables after submission completes', async ({ page }) => {
    await page.route('**/subscribe', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      })
    );
    await navigateToLanding(page);

    await page.locator('[data-testid="subscribe-email"]').fill('reenable@example.com');
    await page.locator('[data-testid="subscribe-submit"]').click();
    await page.waitForTimeout(1000);

    await expect(page.locator('[data-testid="subscribe-submit"]')).toBeEnabled();
  });

  test('API error → error message shown', async ({ page }) => {
    await page.route('**/subscribe', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Invalid email.' }),
      })
    );
    await navigateToLanding(page);

    await page.locator('[data-testid="subscribe-email"]').fill('bad@email');
    await page.locator('[data-testid="subscribe-submit"]').click();

    const msg = page.locator('#form-message');
    await expect(msg).toContainText('Invalid', { timeout: 5000 });
    const classes = await msg.getAttribute('class');
    expect(classes).toContain('error');
  });

  test('network failure → fallback error message', async ({ page }) => {
    await page.route('**/subscribe', (route) => route.abort('failed'));
    await navigateToLanding(page);

    await page.locator('[data-testid="subscribe-email"]').fill('fail@example.com');
    await page.locator('[data-testid="subscribe-submit"]').click();

    const msg = page.locator('#form-message');
    await expect(msg).toContainText('wrong', { timeout: 5000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. NEIGHBORHOOD RING
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Landing — Neighborhood Ring', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToLanding(page);
  });

  test('ring section is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="ring-section"]')).toBeVisible();
  });

  test('ring has h2 heading', async ({ page }) => {
    await expect(page.locator('[data-testid="ring-section"] h2')).toContainText(
      'Neighborhood Ring'
    );
  });

  test('ring has aria-label', async ({ page }) => {
    const ariaLabel = await page.locator('[data-testid="ring-section"]').getAttribute('aria-label');
    expect(ariaLabel).toContain('neighborhoods');
  });

  test('ring layout container is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="ring-layout"]')).toBeVisible();
  });

  test('all 6 neighborhood nodes are visible', async ({ page }) => {
    const nodes = ['ep', 'br', 'bv', 'bi', 'mg', 'ol'];
    for (const n of nodes) {
      await expect(page.locator(`[data-testid="ring-node-${n}"]`)).toBeVisible();
    }
  });

  test('each node has aria-label with neighborhood name', async ({ page }) => {
    const expected: Record<string, string> = {
      ep: 'Evergreen Park',
      br: 'Brainard',
      bv: 'Beverly',
      bi: 'Blue Island',
      mg: 'Mt Greenwood',
      ol: 'Oak Lawn',
    };
    for (const [key, name] of Object.entries(expected)) {
      const ariaLabel = await page
        .locator(`[data-testid="ring-node-${key}"]`)
        .getAttribute('aria-label');
      expect(ariaLabel).toContain(name);
    }
  });

  test('ring path is aria-hidden (decorative)', async ({ page }) => {
    const path = page.locator('.ring-path');
    expect(await path.getAttribute('aria-hidden')).toBe('true');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. FEATURE CARDS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Landing — Feature Cards', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToLanding(page);
  });

  test('features section is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="features-section"]')).toBeVisible();
  });

  test('3 feature cards are visible', async ({ page }) => {
    await expect(page.locator('[data-testid="feature-events"]')).toBeVisible();
    await expect(page.locator('[data-testid="feature-sponsors"]')).toBeVisible();
    await expect(page.locator('[data-testid="feature-community"]')).toBeVisible();
  });

  test('each feature card has h3 and description', async ({ page }) => {
    const cards = ['feature-events', 'feature-sponsors', 'feature-community'];
    for (const id of cards) {
      const card = page.locator(`[data-testid="${id}"]`);
      const h3 = await card.locator('h3').textContent();
      expect(h3?.trim().length).toBeGreaterThan(0);
      const p = await card.locator('p').textContent();
      expect(p?.trim().length).toBeGreaterThan(10);
    }
  });

  test('feature icons are aria-hidden (decorative)', async ({ page }) => {
    const icons = page.locator('.feature-icon');
    const count = await icons.count();
    expect(count).toBe(3);
    for (let i = 0; i < count; i++) {
      expect(await icons.nth(i).getAttribute('aria-hidden')).toBe('true');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. FOOTER
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Landing — Footer', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToLanding(page);
  });

  test('footer is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="landing-footer"]')).toBeVisible();
  });

  // The year is derived at render time (OSE-1232), not hard-coded in the
  // template — so assert the CURRENT year. A literal '2026' here would have
  // passed all year and then failed at midnight on 1 January for no reason
  // anyone would connect to this change.
  test('footer has copyright', async ({ page }) => {
    await expect(page.locator('[data-testid="landing-footer-copyright"]')).toContainText(
      String(new Date().getUTCFullYear())
    );
  });

  // Addressed by test-id, not by position. Until OSE-1232 the landing footer
  // held exactly one link, so `[data-testid="landing-footer"] a` resolved
  // uniquely — and the moment Privacy was added it became a strict-mode
  // violation. Position is not an identity.
  test('footer has Browse Events link', async ({ page }) => {
    const link = page.locator('[data-testid="landing-footer-browse"]');
    await expect(link).toContainText('Browse Events');
    expect(await link.getAttribute('href')).toBe('/events');
  });

  test('footer links the privacy policy', async ({ page }) => {
    const link = page.locator('[data-testid="landing-footer-privacy"]');
    await expect(link).toContainText('Privacy');
    expect(await link.getAttribute('href')).toBe('/privacy');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. URL ALIASES
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Landing — URL Aliases', () => {
  const ALIASES = ['/', '/home', '/welcome', '/landing', '/about', '/info'];

  for (const path of ALIASES) {
    test(`${path} returns 200 with HTML`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      expect(res?.status()).toBe(200);
      expect(res?.headers()['content-type']).toContain('text/html');
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. SECURITY + STABILITY
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Landing — Security & Stability', () => {
  test('has CSP with nonce', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.headers()['content-security-policy']).toContain('nonce-');
  });

  test('no GAS markers', async ({ page }) => {
    await navigateToLanding(page);
    const content = await page.content();
    expect(content).not.toContain('userCodeAppPanel');
    expect(content).not.toContain('script.google.com');
  });

  test('no JS errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await navigateToLanding(page);
    await page.waitForTimeout(2000);
    expect(errors).toHaveLength(0);
  });

  test('response time < 15s', async ({ page }) => {
    const start = Date.now();
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 15_000 });
    expect(Date.now() - start).toBeLessThan(15_000);
  });
});
