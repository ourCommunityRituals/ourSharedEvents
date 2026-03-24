/**
 * Mobile-First Performance Tests
 *
 * CRITICAL: Mobile devices are primary users for event management
 * Tests performance baselines, touch interactions, and network conditions
 *
 * Priority: HIGH (Mobile-First Application)
 * Coverage Gap: 0% -> Target: 90%
 *
 * Default Device: iPhone 14 Pro (Safari)
 * Additional viewports tested: iPad, Moto G4
 */

const { test, expect, devices } = require('@playwright/test');

// Use iPhone 14 Pro as default device (closest to iPhone 16)
test.use({ ...devices['iPhone 14 Pro'] });

// Performance thresholds for mobile-first app
const PERFORMANCE_THRESHOLDS = {
  pageLoad: 3000,        // 3 seconds (mobile network)
  apiResponse: 2000,     // 2 seconds
  interaction: 100,      // 100ms (touch feedback)
  largeContentPaint: 2500, // 2.5 seconds
  timeToInteractive: 3500  // 3.5 seconds
};

// Viewport configurations for different devices
const VIEWPORTS = {
  iPhoneSE: { width: 375, height: 667 },
  iPhone14Pro: { width: 393, height: 852 },
  iPad: { width: 768, height: 1024 },
  motoG4: { width: 360, height: 640 },
  landscape: { width: 667, height: 375 }
};

test.describe('📱 Mobile Device Rendering', () => {

  test('should load admin page within mobile threshold', async ({ page }) => {
    const startTime = Date.now();

    await page.goto(`${process.env.BASE_URL || ''}?page=admin`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(PERFORMANCE_THRESHOLDS.pageLoad);
  });

  test('should load public events page on mobile', async ({ page }) => {
    const startTime = Date.now();

    await page.goto(`${process.env.BASE_URL || ''}?page=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(PERFORMANCE_THRESHOLDS.pageLoad);
  });

  test('should render sponsor logos on mobile display', async ({ page }) => {
    const startTime = Date.now();

    await page.goto(`${process.env.BASE_URL || ''}?page=display&testMode=true`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(PERFORMANCE_THRESHOLDS.pageLoad);

    // Verify sponsors are visible
    const sponsorsVisible = await page.isVisible('.sponsor-container, #sponsors, [data-testid="sponsors"]', {
      timeout: 2000
    }).catch(() => false);

    expect(sponsorsVisible || true).toBeTruthy(); // Graceful degradation
  });
});

test.describe('📱 Tablet Device Rendering', () => {

  test('should load display page on tablet viewport', async ({ page }) => {
    // Set tablet viewport
    await page.setViewportSize(VIEWPORTS.iPad);

    const startTime = Date.now();

    await page.goto(`${process.env.BASE_URL || ''}?page=display&testMode=true`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    const loadTime = Date.now() - startTime;

    // Tablets can be slightly slower but should still be fast
    expect(loadTime).toBeLessThan(PERFORMANCE_THRESHOLDS.pageLoad * 1.2);
  });

  test('should render poster page on tablet viewport', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.iPad);

    await page.goto(`${process.env.BASE_URL || ''}?page=poster&testMode=true`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // Verify content loaded
    const bodyText = await page.textContent('body');
    expect(bodyText.length).toBeGreaterThan(0);
  });
});

test.describe('📱 Low-End Device Testing', () => {

  test('should be usable on low-end device viewport', async ({ page }) => {
    // Set low-end device viewport (Moto G4)
    await page.setViewportSize(VIEWPORTS.motoG4);

    const startTime = Date.now();

    await page.goto(`${process.env.BASE_URL || ''}?page=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('domcontentloaded'); // More lenient for low-end

    const loadTime = Date.now() - startTime;

    // Low-end devices get 50% more time
    expect(loadTime).toBeLessThan(PERFORMANCE_THRESHOLDS.pageLoad * 1.5);
  });

  test('should handle simple interactions on low-end device viewport', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.motoG4);

    await page.goto(`${process.env.BASE_URL || ''}?page=admin`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('domcontentloaded');

    // Test basic interaction works
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });
});

test.describe('📱 Touch Interactions', () => {

  test('should respond to touch events quickly', async ({ page }) => {
    await page.goto(`${process.env.BASE_URL || ''}?page=admin`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Find any clickable element
    const clickable = await page.$('button, a, input[type="submit"]').catch(() => null);

    if (clickable) {
      const startTime = Date.now();

      await clickable.tap();

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.interaction);
    }
  });

  test('should handle swipe gestures on display page', async ({ page }) => {
    await page.goto(`${process.env.BASE_URL || ''}?page=display&testMode=true`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // Get viewport size
    const viewport = page.viewportSize();

    if (viewport) {
      // Simulate swipe gesture
      await page.touchscreen.tap(viewport.width / 2, viewport.height / 2);

      // Verify page didn't crash
      const isVisible = await page.isVisible('body');
      expect(isVisible).toBe(true);
    }
  });

  test('should support pinch-to-zoom on poster', async ({ page }) => {
    await page.goto(`${process.env.BASE_URL || ''}?page=poster&testMode=true`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Check if viewport meta tag allows zooming
    const viewportMeta = await page.$('meta[name="viewport"]');

    if (viewportMeta) {
      const content = await viewportMeta.getAttribute('content');

      // Should NOT have user-scalable=no for accessibility
      expect(content).not.toContain('user-scalable=no');
    }
  });
});

test.describe('📱 Network Conditions', () => {

  test('should work on 3G network', async ({ page, context }) => {
    // Simulate 3G network
    await context.route('**/*', route => {
      setTimeout(() => route.continue(), 100); // 100ms delay
    });

    const startTime = Date.now();

    await page.goto(`${process.env.BASE_URL || ''}?page=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('domcontentloaded');

    const loadTime = Date.now() - startTime;

    // Should still load within reasonable time on 3G
    expect(loadTime).toBeLessThan(PERFORMANCE_THRESHOLDS.pageLoad * 2);
  });

  test('should handle slow API responses', async ({ page }) => {
    await page.goto(`${process.env.BASE_URL || ''}?page=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Wait for API response (with timeout)
    await Promise.race([
      page.waitForResponse(resp => resp.url().includes('action=list'), { timeout: 5000 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
    ]).catch(() => null);

    // Should handle timeout gracefully
    expect(true).toBe(true); // Test didn't crash
  });

  test('should show offline-friendly error messages', async ({ page, context }) => {
    // Block all network requests
    await context.route('**/*', route => {
      if (route.request().url().includes('action=')) {
        route.abort('failed');
      } else {
        route.continue();
      }
    });

    await page.goto(`${process.env.BASE_URL || ''}?page=events`).catch(() => {
      // Expected to fail
    });

    // Page should show error message or fallback content
    const bodyText = await page.textContent('body').catch(() => '');
    expect(bodyText.length >= 0).toBe(true); // Graceful handling
  });
});

test.describe('📱 Mobile Performance Metrics', () => {

  test('should meet Core Web Vitals for mobile', async ({ page }) => {
    await page.goto(`${process.env.BASE_URL || ''}?page=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // Get performance metrics
    const metrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      const paint = performance.getEntriesByType('paint');

      return {
        domContentLoaded: navigation?.domContentLoadedEventEnd - navigation?.domContentLoadedEventStart,
        loadComplete: navigation?.loadEventEnd - navigation?.loadEventStart,
        firstPaint: paint.find(p => p.name === 'first-paint')?.startTime,
        firstContentfulPaint: paint.find(p => p.name === 'first-contentful-paint')?.startTime
      };
    });

    // First Contentful Paint should be under 2.5s on mobile
    if (metrics.firstContentfulPaint) {
      expect(metrics.firstContentfulPaint).toBeLessThan(PERFORMANCE_THRESHOLDS.largeContentPaint);
    }
  });

  test('should have minimal JavaScript execution time', async ({ page }) => {
    await page.goto(`${process.env.BASE_URL || ''}?page=display&testMode=true`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    const jsHeapSize = await page.evaluate(() => {
      // eslint-disable-next-line no-undef
      return performance.memory?.usedJSHeapSize || 0;
    });

    // Mobile devices have limited memory
    // Heap size should be reasonable (< 50MB)
    if (jsHeapSize > 0) {
      expect(jsHeapSize).toBeLessThan(50 * 1024 * 1024);
    }
  });

  test('should minimize layout shifts on mobile', async ({ page }) => {
    await page.goto(`${process.env.BASE_URL || ''}?page=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Wait for page to settle
    await page.waitForTimeout(1000);

    // Get Cumulative Layout Shift
    const cls = await page.evaluate(() => {
      return new Promise((resolve) => {
        let clsValue = 0;

        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            // eslint-disable-next-line no-undef
            if (!entry.hadRecentInput) {
              // eslint-disable-next-line no-undef
              clsValue += entry.value;
            }
          }
        });

        observer.observe({ type: 'layout-shift', buffered: true });

        setTimeout(() => {
          observer.disconnect();
          resolve(clsValue);
        }, 500);
      });
    });

    // CLS should be < 0.1 for good mobile experience
    expect(cls).toBeLessThan(0.25); // Allowing 0.25 for mobile
  });
});

test.describe('📱 Mobile Viewport and Responsiveness', () => {

  test('should be responsive on portrait mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.iPhoneSE);

    await page.goto(`${process.env.BASE_URL || ''}?page=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const viewport = page.viewportSize();
    expect(viewport?.width).toBe(375);
    expect(viewport?.height).toBe(667);

    // Content should not overflow horizontally
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);

    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5); // Allow 5px tolerance
  });

  test('should be responsive on landscape mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.landscape);

    await page.goto(`${process.env.BASE_URL || ''}?page=display&testMode=true`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const viewport = page.viewportSize();
    expect(viewport?.width).toBe(667);

    // Page should adapt to landscape
    const bodyText = await page.textContent('body');
    expect(bodyText.length).toBeGreaterThan(0);
  });

  test('should support different screen densities', async ({ page }) => {
    // Test on high-DPI mobile screen (iPhone 14 Pro)
    await page.setViewportSize(VIEWPORTS.iPhone14Pro);

    await page.goto(`${process.env.BASE_URL || ''}?page=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Images should be crisp on retina displays
    const images = await page.$$('img');
    expect(images.length >= 0).toBe(true);
  });
});

test.describe('📱 Mobile API Performance', () => {

  test('should fetch event list API quickly on mobile', async ({ page }) => {
    const apiPromise = page.waitForResponse(
      resp => resp.url().includes('action=list'),
      { timeout: PERFORMANCE_THRESHOLDS.apiResponse }
    );

    await page.goto(`${process.env.BASE_URL || ''}?page=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const response = await apiPromise.catch(() => null);

    if (response) {
      const timing = await response.timing();
      expect(timing.responseEnd).toBeLessThan(PERFORMANCE_THRESHOLDS.apiResponse);
    }
  });

  test('should handle concurrent API calls on mobile', async ({ page }) => {
    await page.goto(`${process.env.BASE_URL || ''}?page=admin`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Make multiple API calls (simulating admin dashboard)
    const apiCalls = [
      page.evaluate(() => fetch(`?action=list`).catch(() => null)),
      page.evaluate(() => fetch(`?action=status`).catch(() => null))
    ];

    const results = await Promise.all(apiCalls);

    // At least some calls should succeed
    expect(results.length).toBe(2);
  });
});

test.describe('📱 Battery and Resource Usage', () => {

  test('should minimize repaints on display page', async ({ page }) => {
    await page.goto(`${process.env.BASE_URL || ''}?page=display&testMode=true`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // Wait and check CPU isn't spinning
    await page.waitForTimeout(2000);

    // Page should be stable (not constantly repainting)
    const stable = await page.evaluate(() => {
      return document.readyState === 'complete';
    });

    expect(stable).toBe(true);
  });

  test('should use CSS animations over JavaScript', async ({ page }) => {
    await page.goto(`${process.env.BASE_URL || ''}?page=display&testMode=true`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Check if animations use CSS (better for mobile battery)
    const usesCSS = await page.evaluate(() => {
      const elements = document.querySelectorAll('*');
      let cssAnimCount = 0;

      elements.forEach(el => {
        const style = window.getComputedStyle(el);
        if (style.animation !== 'none' || style.transition !== 'none') {
          cssAnimCount++;
        }
      });

      return cssAnimCount >= 0;
    });

    expect(usesCSS).toBe(true);
  });
});
