/**
 * The fold gate can fail, and fails for the right reason (OSE-2160, F-45).
 *
 * The "primary action above the fold" gate in mobile-workability.spec.ts was
 * green for months while measuring the brand link in the header. A gate that
 * cannot fail counts as absent, so this spec keeps the proof next to the gate:
 * it plants the fault the gate exists to catch and expects red, and it checks
 * the red says what it should. An empty `toThrow()` also passes on a typo in a
 * selector, so each case matches the message.
 *
 * Runs in the blocking phone audit (playwright.mobile.config.ts), against the
 * local worker. Relative URLs only: the config owns the host.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { assertActionAboveFold, FOLD_BELOW, FOLD_NO_MATCH } from './helpers/fold-gate';

const PHONE = { width: 375, height: 812 };
const SPACER_PX = 600;

test.describe('fold gate meta: the gate fails, and for the right reason', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('control: the landing action is above the fold as shipped', async ({ page }) => {
    const found = await assertActionAboveFold(
      page,
      'landing',
      '[data-testid="where-submit"]',
      PHONE.height
    );
    expect(found.selector).toBe('[data-testid="where-submit"]');
    expect(found.top).toBeLessThan(PHONE.height);
  });

  test(`a ${SPACER_PX} px spacer above where-submit turns the gate red, and the message says below the fold`, async ({
    page,
  }) => {
    // The fault: something tall lands above the action. Same place a hero image
    // or a banner would go.
    await page.evaluate((px) => {
      const spacer = document.createElement('div');
      spacer.setAttribute('data-testid', 'meta-spacer');
      spacer.style.cssText = `height:${px}px;display:block`;
      document.querySelector('[data-testid="landing-where"]')!.before(spacer);
    }, SPACER_PX);
    const err = await assertActionAboveFold(
      page,
      'landing',
      '[data-testid="where-submit"]',
      PHONE.height
    ).then(
      () => null,
      (e: Error) => e
    );
    expect(err, 'the gate must throw when the action is pushed below the fold').not.toBeNull();
    expect(err!.message).toContain(FOLD_BELOW);
    // Red for the wrong reason (a selector that matches nothing) would also throw.
    expect(err!.message).not.toContain(FOLD_NO_MATCH);
  });

  test('a selector that matches nothing is red too, with its own message', async ({ page }) => {
    await expect(
      assertActionAboveFold(page, 'landing', '[data-testid="no-such-action"]', PHONE.height)
    ).rejects.toThrow(FOLD_NO_MATCH);
  });

  test('a header link is not a fallback: the brand link does not satisfy the landing gate', async ({
    page,
  }) => {
    // The brand link is above the fold on every page. The gate used to land on it.
    await page.evaluate((px) => {
      const spacer = document.createElement('div');
      spacer.style.cssText = `height:${px}px;display:block`;
      document.querySelector('[data-testid="landing-where"]')!.before(spacer);
    }, SPACER_PX);
    await expect(page.getByTestId('landing-logo')).toBeVisible();
    await expect(
      assertActionAboveFold(page, 'landing', '[data-testid="where-submit"]', PHONE.height)
    ).rejects.toThrow(FOLD_BELOW);
  });
});

test.describe('fold gate meta: the surfaces name the real action', () => {
  const source = readFileSync(join(__dirname, 'mobile-workability.spec.ts'), 'utf8');

  /** The `primaryCtaSelector` of the surface at `path`/`name`, as written in the spec. */
  function selectorOf(name: string): string {
    const at = source.indexOf(`name: '${name}',`);
    expect(at, `surface "${name}" is in the audit`).toBeGreaterThan(-1);
    const m = /primaryCtaSelector:\s*(?:\n\s*)?'([^']*)'/.exec(source.slice(at));
    expect(m, `surface "${name}" names a primaryCtaSelector`).not.toBeNull();
    return m![1];
  }

  test('the landing gates on where-submit only, the map on area-map only', () => {
    expect(selectorOf('landing')).toBe('[data-testid="where-submit"]');
    expect(selectorOf('attendee map')).toBe('[data-testid="area-map"]');
  });

  test('no surface falls back to a header link or the hero', () => {
    // The landing and the map were the two that ended in `header a`. Admin's own
    // header links are named on purpose (settings-nav-*), so only the two surfaces
    // that fell through to the brand link are held to this.
    for (const name of ['landing', 'attendee map']) {
      expect(selectorOf(name)).not.toMatch(/header a|\.hero|subscribe-submit|cta-primary/);
    }
  });
});
