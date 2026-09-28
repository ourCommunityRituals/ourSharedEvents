/**
 * AS-13 — real-browser axe-core WCAG 2.0 AA scan of the served surfaces.
 *
 * Runs on the T0 `component` shard against the local worker started by
 * playwright.component.config.ts (`wrangler dev --local`), on Chromium AND
 * WebKit, and BLOCKS the pipeline (via scripts/pw-guarded.sh) — satisfying the
 * AS-13 criterion "CI blocks merge on critical a11y violations".
 *
 * COMPLEMENTS, does not duplicate, the jsdom axe gate
 * (workers/oursharedevents/tests/a11y-axe.spec.ts, A11Y-7):
 *   - jsdom gate: fast, scans the STATIC HTML of ALL 11 surfaces/forms incl. the
 *     auth/token-gated ones (/admin, /sharedReport, /sponsor) via direct handler
 *     calls. But jsdom cannot compute layout/contrast and does not run scripts.
 *   - this gate: a REAL engine renders + runs scripts, so it catches computed-role,
 *     focus, and colour-contrast issues jsdom is blind to — on the surfaces a
 *     browser can actually reach on the unseeded local worker.
 *
 * SCOPE — the four publicly-reachable surfaces. /admin, /sharedReport and
 * /sponsor need a CF Access JWT / minted signed token that the local worker has
 * no way to satisfy in a headless browser, so they stay on the jsdom gate (which
 * reaches them by calling the handler directly). They are documented here, not
 * silently dropped; wiring browser auth for them is a follow-up.
 *
 * Same axe contract as the jsdom gate: wcag2a + wcag2aa tags, fail on
 * critical/serious, plus the exactly-one-<h1> gate (axe's wcag tags don't include
 * page-has-heading-one — it lives in best-practice — so the headingless-page bug
 * OSE-1312 shipped would pass axe alone).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const SURFACES = [
  { name: 'landing', path: '/' },
  { name: 'public listing', path: '/events' },
  { name: 'display', path: '/display' },
  { name: 'poster', path: '/poster' },
] as const;

test.describe('AS-13: real-browser axe WCAG 2.0 AA — zero critical/serious', () => {
  for (const surface of SURFACES) {
    test(`${surface.name} (${surface.path}) has no critical/serious a11y violations`, async ({
      page,
    }) => {
      const res = await page.goto(surface.path);
      expect(res?.status(), `${surface.path} should render 200`).toBe(200);

      // Exactly-one-<h1> gate — mirrors the jsdom gate. axe's wcag2a/wcag2aa tags
      // do NOT include page-has-heading-one (best-practice), so a headingless page
      // passes axe while failing screen-reader/SEO needs.
      const h1Count = await page.locator('h1').count();
      expect(h1Count, `${surface.name} must have exactly one <h1> (found ${h1Count})`).toBe(1);

      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      );
      if (blocking.length > 0) {
        const summary = blocking
          .map(
            (v) =>
              `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))\n    ${v.nodes
                .map((n) => n.target.join(' '))
                .slice(0, 5)
                .join('\n    ')}`
          )
          .join('\n');
        expect.fail(
          `${surface.name} has ${blocking.length} critical/serious WCAG 2.0 AA violation(s):\n${summary}`
        );
      }
      expect(blocking).toHaveLength(0);
    });
  }
});
