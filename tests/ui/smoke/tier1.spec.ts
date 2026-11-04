/**
 * Tier-1 parameterized smoke — ONE spec file for every page in the fleet.
 *
 * Select the app via env:  SMOKE_APP=ose | wkrp   (defaults by baseURL port
 * is deliberately avoided — explicit beats clever.)
 *
 * What each route gets, driven by its manifest flags:
 *   1. Expected status + HTML content-type (or JSON for health-style routes)
 *   2. Anchor visible — the page actually rendered
 *   3. Zero uncaught page errors (pageerror) — catches broken inline JS free
 *   4. <title>, <html lang>, viewport meta — cheap a11y/SEO floor
 *   5. No horizontal scroll at mobile viewport (unless allowHScroll)
 *   6. Tap targets: visible .btn/.cta/nav links meet the app's min height
 *   7. gate: unauthenticated view renders a humane gate (empty-state, sign-in,
 *      or the legacy denied element), never a blank page
 *   8. sharedSheet (post-migration): exactly one /ui.css link, no big <style>
 *
 * Wire into each repo's Playwright config testMatch. Runtime target: the whole
 * table in ~1–2 min on one worker. Journey specs (Tier 2) stay separate.
 */
import { test, expect, type BrowserContextOptions, type Page } from '@playwright/test';
import type { AppManifest, RouteSpec } from './types';
import { resolvePath } from './types';
import { oseManifest } from './ose.routes';
import { wkrpManifest } from './wkrp.routes';

const manifest: AppManifest = process.env.SMOKE_APP === 'wkrp' ? wkrpManifest : oseManifest;

const HAS_ADMIN = !!process.env.SMOKE_ADMIN_READY; // set when config injects auth headers

function cfAccessHeaders(): Record<string, string> {
  const { CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET } = process.env;
  if (!CF_ACCESS_CLIENT_ID || !CF_ACCESS_CLIENT_SECRET) return {};
  return {
    'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID,
    'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET,
  };
}

for (const route of manifest.routes) {
  const title = `[T1:${manifest.app}] ${route.name}`;

  test(title, async ({ page, browser, baseURL }) => {
    const path = resolvePath(route);
    test.skip(path === null, `fixture ${route.fixtureEnv} not provided`);
    test.skip(route.auth === 'admin' && !HAS_ADMIN, 'admin credentials not wired');
    test.skip(
      route.edgeAuth === 'cf-access' && Object.keys(cfAccessHeaders()).length === 0,
      'CF Access service-token credentials not wired'
    );

    let scopedContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    const testPage =
      route.edgeAuth === 'cf-access'
        ? await (async () => {
            const options: BrowserContextOptions = {
              baseURL: baseURL ?? undefined,
              extraHTTPHeaders: cfAccessHeaders(),
              ignoreHTTPSErrors: true,
              viewport: page.viewportSize(),
            };
            scopedContext = await browser.newContext(options);
            return scopedContext.newPage();
          })()
        : page;

    const pageErrors: string[] = [];
    testPage.on('pageerror', (e) => pageErrors.push(String(e)));

    try {
      const resp = await testPage.goto(path!, { waitUntil: 'domcontentloaded' });
      expect(resp, 'response received').toBeTruthy();
      expect(resp!.status(), 'status code').toBe(route.status ?? 200);

      const ctype = resp!.headers()['content-type'] ?? '';
      if (route.anchor !== 'body' || ctype.includes('text/html')) {
        // HTML checks only apply to HTML responses (health may be JSON).
        if (!ctype.includes('text/html')) return;
      } else if (!ctype.includes('text/html')) {
        return; // JSON route: status was the whole assertion
      }

      // 2. Rendered
      await expect(testPage.locator(route.anchor).first(), 'anchor rendered').toBeVisible();

      // 3. No uncaught JS errors during load
      expect(pageErrors, 'uncaught page errors').toEqual([]);

      // 4. Document floor
      await expect(testPage).toHaveTitle(/.+/);
      expect(await testPage.locator('html').getAttribute('lang'), '<html lang>').toBeTruthy();
      expect(
        await testPage.locator('meta[name="viewport"]').count(),
        'viewport meta'
      ).toBeGreaterThan(0);

      // 5. Mobile workability: no horizontal scroll
      if (!route.allowHScroll) {
        const overflow = await testPage.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow, 'horizontal overflow px').toBeLessThanOrEqual(1);
      }

      // 6. Tap targets
      await assertTapTargets(testPage, route.minTap ?? manifest.minTap);

      // 7. Humane gate
      if (route.gate && route.auth !== 'admin') {
        const gate = testPage.locator(
          '.empty-state, [data-testid="signin-heading"], [data-testid="signin-cta"], [data-testid="access-denied"], .access-denied, [data-testid="loading-view"]'
        );
        await expect(gate.first(), 'gate/loading surface present').toBeVisible();
        // A gate must offer a way forward once partials land; tolerate legacy
        // until sharedSheet is flipped for the page.
        if (route.sharedSheet) {
          await expect(
            testPage.locator('.empty-state a.btn, .empty-state .btn').first(),
            'gate offers a next step'
          ).toBeVisible();
        }
      }

      // 8. Stylesheet policy (post-migration only)
      if (route.sharedSheet) {
        await expect(testPage.locator('link[rel="stylesheet"][href$="/ui.css"]')).toHaveCount(1);
        const inlineCss = await testPage.evaluate(() =>
          Array.from(document.querySelectorAll('style')).reduce(
            (n, s) => n + (s.textContent?.length ?? 0),
            0
          )
        );
        expect(inlineCss, 'inline CSS chars (budget 400)').toBeLessThanOrEqual(400);
      }
    } finally {
      await scopedContext?.close();
    }
  });
}

// The "Testing purposes only." band on every staging page
// (workers/oursharedevents/src/lib/test-site-notice.ts). T4d runs this file
// against staging, so a page that loses the band, gains a second <h1>, or has
// the band covered by a fixed layer goes red there. The band renders only where
// WORKER_ENV is staging, which is this config's default base URL; pointed at any
// other host, these cases fail rather than skip.
const NOTICE = '[data-testid="test-site-notice"]';
const noticeRoutes =
  manifest.app === 'ose'
    ? manifest.routes.filter((r) => r.name === 'landing' || r.name === 'display board')
    : [];

for (const route of noticeRoutes) {
  test(`[T1:${manifest.app}] testing-only notice: ${route.name}`, async ({ page }) => {
    await page.goto(resolvePath(route)!, { waitUntil: 'networkidle' });
    const band = page.locator(NOTICE);
    await expect(band, 'one notice').toHaveCount(1);
    await expect(band).toBeVisible();
    await expect(band).toContainText('Testing purposes only.');
    await expect(page.locator('h1'), 'exactly one <h1>').toHaveCount(1);

    // nothing fixed sits over it: the topmost element at its centre is the band
    const onTop = await band.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (hit === el || el.contains(hit));
    });
    expect(onTop, 'elementFromPoint at the band centre is the band').toBe(true);
  });
}

async function assertTapTargets(page: Page, min: number): Promise<void> {
  const targets = page.locator('.btn:visible, .cta:visible, .nav-item:visible, .add-btn:visible');
  const n = Math.min(await targets.count(), 12); // sample cap keeps Tier-1 fast
  for (let i = 0; i < n; i++) {
    const box = await targets.nth(i).boundingBox();
    if (!box) continue;
    expect(box.height, `tap target #${i} height >= ${min}px`).toBeGreaterThanOrEqual(min);
  }
}
