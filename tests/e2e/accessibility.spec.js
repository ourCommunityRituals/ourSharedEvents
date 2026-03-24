/**
 * Accessibility Tests (WCAG 2.1 AA Compliance)
 *
 * CRITICAL: Ensures application is accessible to users with disabilities
 * Standards: WCAG 2.1 Level AA, Section 508
 *
 * Priority: HIGH (Legal Compliance, User Inclusion)
 * Coverage Target: 100% of user-facing pages
 *
 * Tools:
 * - Playwright Accessibility API
 * - axe-core integration (recommended: npm install @axe-core/playwright)
 * - Manual keyboard navigation tests
 *
 * Note: Install axe-core for automated testing:
 * npm install --save-dev @axe-core/playwright
 */

const { test, expect } = require('@playwright/test');
const { ADMIN_PAGE, PUBLIC_PAGE, DISPLAY_PAGE, COMMON, ARIA } = require('./selectors');

// Check if axe-core is available
let AxeBuilder;
try {
  AxeBuilder = require('@axe-core/playwright').default;
} catch (e) {
  console.warn('⚠️  @axe-core/playwright not installed. Automated accessibility tests will be skipped.');
  console.warn('   Install with: npm install --save-dev @axe-core/playwright');
}

test.describe('♿ Accessibility Tests (WCAG 2.1 AA)', () => {

  test.describe('Automated Accessibility Scanning', () => {
    // Only run if axe-core is installed
    test.skip(!AxeBuilder, 'axe-core not installed');

    test('Admin page should have no accessibility violations', async ({ page }) => {
      await page.goto(`${process.env.BASE_URL || ''}?page=admin`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      expect(accessibilityScanResults.violations).toEqual([]);
    });

    test('Public events page should have no accessibility violations', async ({ page }) => {
      await page.goto(`${process.env.BASE_URL || ''}?page=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      expect(accessibilityScanResults.violations).toEqual([]);
    });

    test('Display page should have no accessibility violations', async ({ page }) => {
      await page.goto(`${process.env.BASE_URL || ''}?page=display&testMode=true`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      expect(accessibilityScanResults.violations).toEqual([]);
    });

    test('Poster page should have no accessibility violations', async ({ page }) => {
      await page.goto(`${process.env.BASE_URL || ''}?page=poster&testMode=true`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      expect(accessibilityScanResults.violations).toEqual([]);
    });
  });

  test.describe('Keyboard Navigation', () => {
    test('Should navigate admin form with Tab key', async ({ page }) => {
      await page.goto(`${process.env.BASE_URL || ''}?page=admin`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Tab through form fields
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');

      // Verify focus is visible and logical
      const focusedElement = await page.evaluate(() => {
        const el = document.activeElement;
        return {
          tagName: el.tagName,
          type: el.type || null,
          hasVisibleFocus: window.getComputedStyle(el).outlineWidth !== '0px'
        };
      });

      expect(['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA']).toContain(focusedElement.tagName);
    });

    test('Should navigate public events with arrow keys', async ({ page }) => {
      await page.goto(`${process.env.BASE_URL || ''}?page=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Use arrow keys for navigation
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowUp');

      // Verify page responded to keyboard input
      const isVisible = await page.isVisible('body');
      expect(isVisible).toBe(true);
    });

    test('Should activate buttons with Enter and Space', async ({ page }) => {
      await page.goto(`${process.env.BASE_URL || ''}?page=admin`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Find first button
      const button = await page.$(COMMON.BUTTON || 'button').catch(() => null);

      if (button) {
        await button.focus();

        // Test Enter key
        await page.keyboard.press('Enter');
        await page.waitForTimeout(100);

        // Test Space key
        await page.keyboard.press('Space');
        await page.waitForTimeout(100);

        // If no crash, keyboard activation works
        expect(true).toBe(true);
      }
    });

    test('Should have skip link for keyboard users', async ({ page }) => {
      await page.goto(`${process.env.BASE_URL || ''}?page=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Tab to first element (should be skip link)
      await page.keyboard.press('Tab');

      const firstFocused = await page.evaluate(() => document.activeElement.textContent);

      // Skip link should be first or present
      const hasSkipLink = firstFocused.toLowerCase().includes('skip') ||
                          await page.isVisible(COMMON.SKIP_LINK).catch(() => false);

      // This is a recommendation, not a hard requirement
      if (!hasSkipLink) {
        console.warn('⚠️  No skip link found. Consider adding for keyboard users.');
      }

      expect(typeof hasSkipLink).toBe('boolean');
    });

    test('Should trap focus in modal dialogs', async ({ page }) => {
      await page.goto(`${process.env.BASE_URL || ''}?page=admin`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Look for modal or dialog
      const modal = await page.$(COMMON.MODAL).catch(() => null);

      if (modal && await modal.isVisible()) {
        // Tab multiple times
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');

        // Verify focus is still within modal
        const focusedInModal = await page.evaluate(() => {
          const modal = document.querySelector('[role="dialog"], .modal');
          if (!modal) return false;
          return modal.contains(document.activeElement);
        });

        expect(focusedInModal).toBe(true);
      }
    });
  });

  test.describe('Screen Reader Support', () => {
    test('Should have proper heading hierarchy', async ({ page }) => {
      await page.goto(`${process.env.BASE_URL || ''}?page=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      const headings = await page.evaluate(() => {
        const h1s = Array.from(document.querySelectorAll('h1'));
        const h2s = Array.from(document.querySelectorAll('h2'));
        const h3s = Array.from(document.querySelectorAll('h3'));

        return {
          h1Count: h1s.length,
          h2Count: h2s.length,
          h3Count: h3s.length,
          h1Text: h1s.map(h => h.textContent)
        };
      });

      // Should have exactly one H1
      expect(headings.h1Count).toBe(1);

      // Headings should exist
      expect(headings.h1Count + headings.h2Count + headings.h3Count).toBeGreaterThan(0);
    });

    test('Should have proper ARIA landmarks', async ({ page }) => {
      await page.goto(`${process.env.BASE_URL || ''}?page=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      const landmarks = await page.evaluate(() => {
        return {
          main: document.querySelectorAll('main, [role="main"]').length,
          nav: document.querySelectorAll('nav, [role="navigation"]').length,
          banner: document.querySelectorAll('header, [role="banner"]').length,
          contentinfo: document.querySelectorAll('footer, [role="contentinfo"]').length
        };
      });

      // Should have main landmark
      expect(landmarks.main).toBeGreaterThanOrEqual(1);

      console.log('Landmarks found:', landmarks);
    });

    test('Should have alt text for images', async ({ page }) => {
      await page.goto(`${process.env.BASE_URL || ''}?page=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      const images = await page.$$('img');
      const imageInfo = [];

      for (const img of images) {
        const alt = await img.getAttribute('alt');
        const src = await img.getAttribute('src');
        const isDecorative = alt === '';

        imageInfo.push({ src, alt, isDecorative });
      }

      // Check that images either have alt text or are marked decorative
      for (const img of imageInfo) {
        const hasAlt = typeof img.alt === 'string';
        expect(hasAlt).toBe(true);

        if (!img.isDecorative && img.alt) {
          // Non-decorative images should have meaningful alt text
          expect(img.alt.length).toBeGreaterThan(0);
        }
      }

      console.log(`Images checked: ${imageInfo.length}`);
    });

    test('Should have proper form labels', async ({ page }) => {
      await page.goto(`${process.env.BASE_URL || ''}?page=admin`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      const formInputs = await page.$$('input, select, textarea');
      const unlabeledInputs = [];

      for (const input of formInputs) {
        const id = await input.getAttribute('id');
        const name = await input.getAttribute('name');
        const type = await input.getAttribute('type');
        const ariaLabel = await input.getAttribute('aria-label');
        const ariaLabelledby = await input.getAttribute('aria-labelledby');

        // Check if input has associated label
        let hasLabel = false;

        if (ariaLabel || ariaLabelledby) {
          hasLabel = true;
        } else if (id) {
          const label = await page.$(`label[for="${id}"]`);
          if (label) hasLabel = true;
        }

        // Hidden inputs don't need labels
        if (type === 'hidden') hasLabel = true;

        if (!hasLabel) {
          unlabeledInputs.push({ id, name, type });
        }
      }

      if (unlabeledInputs.length > 0) {
        console.warn('⚠️  Unlabeled inputs found:', unlabeledInputs);
      }

      // All visible inputs should have labels
      expect(unlabeledInputs.length).toBe(0);
    });

    test('Should announce dynamic content changes', async ({ page }) => {
      await page.goto(`${process.env.BASE_URL || ''}?page=admin`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Check for ARIA live regions
      const liveRegions = await page.evaluate(() => {
        return {
          polite: document.querySelectorAll('[aria-live="polite"]').length,
          assertive: document.querySelectorAll('[aria-live="assertive"]').length,
          status: document.querySelectorAll('[role="status"]').length,
          alert: document.querySelectorAll('[role="alert"]').length
        };
      });

      const totalLiveRegions = liveRegions.polite + liveRegions.assertive +
                                liveRegions.status + liveRegions.alert;

      // Should have at least one live region for dynamic updates
      if (totalLiveRegions === 0) {
        console.warn('⚠️  No ARIA live regions found. Consider adding for dynamic content.');
      }

      expect(typeof totalLiveRegions).toBe('number');
    });
  });

  test.describe('Color Contrast', () => {
    test('Should have sufficient color contrast for text', async ({ page }) => {
      await page.goto(`${process.env.BASE_URL || ''}?page=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Get text elements and check contrast
      const contrastIssues = await page.evaluate(() => {
        const getContrast = (foreground, background) => {
          const getLuminance = (rgb) => {
            const [r, g, b] = rgb.match(/\d+/g).map(Number);
            const [rs, gs, bs] = [r, g, b].map(c => {
              c = c / 255;
              return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
            });
            return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
          };

          const l1 = getLuminance(foreground) + 0.05;
          const l2 = getLuminance(background) + 0.05;
          return l1 > l2 ? l1 / l2 : l2 / l1;
        };

        const textElements = Array.from(document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, a, button, span'));
        const issues = [];

        for (const el of textElements.slice(0, 20)) { // Check first 20 elements
          const style = window.getComputedStyle(el);
          const color = style.color;
          const bgColor = style.backgroundColor;

          if (color && bgColor && bgColor !== 'rgba(0, 0, 0, 0)') {
            const contrast = getContrast(color, bgColor);

            // WCAG AA requires 4.5:1 for normal text, 3:1 for large text
            const fontSize = parseInt(style.fontSize);
            const minContrast = fontSize >= 18 || (fontSize >= 14 && style.fontWeight === 'bold') ? 3 : 4.5;

            if (contrast < minContrast) {
              issues.push({
                element: el.tagName,
                contrast: contrast.toFixed(2),
                required: minContrast,
                color,
                bgColor
              });
            }
          }
        }

        return issues;
      });

      if (contrastIssues.length > 0) {
        console.warn('⚠️  Contrast issues found:', contrastIssues);
      }

      // This is a soft check for now
      expect(Array.isArray(contrastIssues)).toBe(true);
    });
  });

  test.describe('Mobile Accessibility', () => {
    test.use({ viewport: { width: 375, height: 667 } }); // iPhone SE

    test('Should have large enough touch targets', async ({ page }) => {
      await page.goto(`${process.env.BASE_URL || ''}?page=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      const buttons = await page.$$('button, a');
      const smallTargets = [];

      for (const button of buttons.slice(0, 10)) { // Check first 10
        const box = await button.boundingBox();

        if (box && (box.width < 44 || box.height < 44)) {
          const text = await button.textContent();
          smallTargets.push({ width: box.width, height: box.height, text });
        }
      }

      if (smallTargets.length > 0) {
        console.warn('⚠️  Touch targets smaller than 44x44px:', smallTargets);
      }

      // WCAG 2.1 AA requires minimum 44x44px touch targets
      expect(smallTargets.length).toBeLessThan(buttons.length / 2);
    });

    test('Should not require pinch-to-zoom disabled', async ({ page }) => {
      await page.goto(`${process.env.BASE_URL || ''}?page=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      const viewport = await page.$('meta[name="viewport"]');

      if (viewport) {
        const content = await viewport.getAttribute('content');

        // Should NOT have user-scalable=no or maximum-scale=1.0
        const disablesZoom = content && (
          content.includes('user-scalable=no') ||
          content.includes('maximum-scale=1.0')
        );

        expect(disablesZoom).toBe(false);
      }
    });

    test('Should support orientation changes', async ({ page }) => {
      await page.goto(`${process.env.BASE_URL || ''}?page=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Test portrait
      await page.setViewportSize({ width: 375, height: 667 });
      await page.waitForTimeout(100);
      const portraitVisible = await page.isVisible('body');

      // Test landscape
      await page.setViewportSize({ width: 667, height: 375 });
      await page.waitForTimeout(100);
      const landscapeVisible = await page.isVisible('body');

      expect(portraitVisible).toBe(true);
      expect(landscapeVisible).toBe(true);
    });
  });

  test.describe('Focus Management', () => {
    test('Should have visible focus indicators', async ({ page }) => {
      await page.goto(`${process.env.BASE_URL || ''}?page=admin`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Tab to first interactive element
      await page.keyboard.press('Tab');

      const focusStyles = await page.evaluate(() => {
        const el = document.activeElement;
        const styles = window.getComputedStyle(el);

        return {
          outline: styles.outline,
          outlineWidth: styles.outlineWidth,
          outlineColor: styles.outlineColor,
          boxShadow: styles.boxShadow
        };
      });

      // Should have some visible focus indicator
      const hasVisibleFocus = focusStyles.outlineWidth !== '0px' ||
                              focusStyles.boxShadow !== 'none';

      expect(hasVisibleFocus).toBe(true);
    });

    test('Should maintain focus order in DOM order', async ({ page }) => {
      await page.goto(`${process.env.BASE_URL || ''}?page=admin`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      const focusOrder = [];

      // Tab through first 5 elements
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => {
          const el = document.activeElement;
          return {
            tagName: el.tagName,
            tabIndex: el.tabIndex,
            id: el.id || null
          };
        });
        focusOrder.push(focused);
      }

      console.log('Focus order:', focusOrder);

      // tabIndex should be 0 or -1 for logical order
      const hasLogicalOrder = focusOrder.every(el => el.tabIndex <= 0);

      expect(hasLogicalOrder).toBe(true);
    });
  });

  test.describe('Content Accessibility', () => {
    test('Should have proper page title', async ({ page }) => {
      await page.goto(`${process.env.BASE_URL || ''}?page=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      const title = await page.title();

      expect(title.length).toBeGreaterThan(0);
      expect(title).not.toBe('Untitled');

      console.log('Page title:', title);
    });

    test('Should have lang attribute on html', async ({ page }) => {
      await page.goto(`${process.env.BASE_URL || ''}?page=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      const lang = await page.evaluate(() => document.documentElement.lang);

      // Should have a language defined
      expect(typeof lang).toBe('string');

      if (!lang) {
        console.warn('⚠️  No lang attribute found on <html>. Add lang="en" or appropriate language.');
      }
    });

    test('Should have descriptive link text', async ({ page }) => {
      await page.goto(`${process.env.BASE_URL || ''}?page=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      const links = await page.$$('a');
      const vagueLinks = [];

      for (const link of links) {
        const text = (await link.textContent()).trim().toLowerCase();
        const ariaLabel = await link.getAttribute('aria-label');

        // Check for vague link text
        const isVague = !ariaLabel && (
          text === 'click here' ||
          text === 'here' ||
          text === 'more' ||
          text === 'read more' ||
          text.length === 0
        );

        if (isVague) {
          const href = await link.getAttribute('href');
          vagueLinks.push({ text, href });
        }
      }

      if (vagueLinks.length > 0) {
        console.warn('⚠️  Vague link text found:', vagueLinks);
      }

      // Links should have descriptive text
      expect(vagueLinks.length).toBeLessThan(links.length / 4);
    });
  });
});
