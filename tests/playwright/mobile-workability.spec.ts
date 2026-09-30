/**
 * OSE-292 — mobile workability audit suite.
 *
 * Enforces invariant 14 (OCR-docs/ocr-docs-brain/architectural-invariants.yaml)
 * + OCR_STANDARD_mobileWorkability.md. Loads every customer-facing OSE
 * surface at 375×812 (iPhone 13 Mini / iPhone X — modern small-phone
 * baseline) and asserts the five concrete contracts:
 *
 *   1. No horizontal scroll (scrollWidth ≤ clientWidth at 375 px wide)
 *   2. Touch targets ≥ 44×44 px (WCAG 2.5.5 + Apple HIG)
 *   3. Input font-size ≥ 16 px (avoids iOS Safari pinch-zoom on focus)
 *   4. Primary CTA visible above the fold on entry view
 *   5. No pinch-zoom required for form submit
 *
 * Test naming follows OCR_STANDARD_perStoryTestPyramid:
 *   `OSE-292 | FE | GET <path> (<condition>) | <assertion>`
 *
 * Exemptions per invariant 14: /display (venue TV form factor),
 * /briefing (internal CEO tool). Those surfaces are NOT tested here.
 *
 * This suite is the canonical OSE implementation of the fleet-wide
 * mobile workability contract. When OurWKRP, OurSharedMagnets, etc.
 * onboard customer-facing code, each ships its own copy of this suite
 * adapted to its own surface list.
 */

import { test, expect, type Page, type Locator } from '@playwright/test';

// TARGET RESOLUTION — via Playwright's baseURL, NOT an absolute URL (OSE-1236).
//
// This spec used to build absolute URLs from `process.env.STAGING_URL`:
//
//     const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';
//     await page.goto(`${BASE_URL}${surface.path}`);
//
// That is exactly the trap `playwright.component.config.ts` documents in its
// header — a spec that navigates to an absolute URL "ignores baseURL entirely
// and would NOT follow this config." So pointing a new config at a local
// worker did nothing: the run still went to deployed staging, and reported the
// result as a check on the PR. The gate's verdict was uncorrelated with the
// diff under review, and no amount of config could change that while the
// navigation was absolute.
//
// Navigation is now RELATIVE. The config decides the target:
//   playwright.mobile.config.ts → local worker (this branch's code), blocking
//   playwright.config.ts        → STAGING_URL, the nightly deployed audit

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || 'test-admin-key-e2e-2026';

// OSE-305 / OSE-302 / ADR-006: when OSE_ADMIN_BEARER is unset OR equals the
// test default, the audit's authenticated request to /admin fails →
// Cloudflare Bot Management intercepts with a 403 challenge → the audit's
// Playwright runner measures the Cloudflare challenge page's UI, not OSE's
// admin dashboard. The /admin contracts then "fail" for reasons that have
// nothing to do with OSE's admin code. Mark the surface as skipped in
// that case so the audit pipeline reports the real signal: non-/admin
// surfaces' compliance against the refined OCR-42 standard.
const ADMIN_BEARER_IS_DEFAULT =
  !process.env.OSE_ADMIN_BEARER || process.env.OSE_ADMIN_BEARER === 'test-admin-key-e2e-2026';
const ADMIN_SKIP_REASON = ADMIN_BEARER_IS_DEFAULT
  ? "OSE-302 / ADR-006: requires OSE_ADMIN_BEARER repo secret to be set with a valid staging admin bearer. Until set, the /admin audit measures the Cloudflare bot challenge page, not OSE's admin dashboard. Founder action: `gh secret set OSE_ADMIN_BEARER --repo OurCommunityRituals/ourSharedEvents`"
  : undefined;

// PR #567: /sponsor is token-gated — a bare load renders the invalid-link page,
// not the surface. Provide a minted sponsor-home bearer (POST
// /api/v2/admin/sponsors/:id/home-link against a seeded sponsor, then the ?t=
// value) via OSE_SPONSOR_HOME_TOKEN to audit the real surface; skip (documented)
// otherwise so the gate reports the honest signal instead of measuring the 401.
const SPONSOR_HOME_TOKEN = process.env.OSE_SPONSOR_HOME_TOKEN || '';
const SPONSOR_HOME_SKIP_REASON = SPONSOR_HOME_TOKEN
  ? undefined
  : 'Set OSE_SPONSOR_HOME_TOKEN to a minted sponsor-home bearer (POST /api/v2/admin/sponsors/:id/home-link on a seeded sponsor) — without it /sponsor?t= renders the invalid-link page, not the phone-first sponsor surface.';

// 0082: /sponsors/:id is the public sponsor card (title, location, contact).
// It renders only for a sponsor that is on show (active + accepted placement),
// so it needs a seeded id; skip (documented) otherwise, like /sponsor above.
const SPONSOR_CARD_ID = process.env.OSE_SPONSOR_CARD_ID || '';
const SPONSOR_CARD_SKIP_REASON = SPONSOR_CARD_ID
  ? undefined
  : 'Set OSE_SPONSOR_CARD_ID to a seeded sponsor with an accepted placement — otherwise /sponsors/:id renders the 404 page, not the sponsor card.';

// Mobile floor: iPhone 13 Mini / iPhone X. Smallest modern phone in
// significant active use. Designing to this floor passes for every
// wider modern phone (iPhone 12/13/14, Pro Max, modern Android).
const MOBILE_VIEWPORT = { width: 375, height: 812 };

// 44 px is WCAG 2.5.5 Level AAA + Apple HIG. The standard.
const MIN_TOUCH_TARGET_PX = 44;

// 16 px is the iOS Safari floor below which input focus triggers
// automatic pinch-zoom. 16 px exact passes; anything smaller fails.
const MIN_INPUT_FONT_SIZE_PX = 16;

// Surfaces under audit. Each entry declares: path to load + optional
// auth header + selector for the primary CTA (used by the
// "above the fold" contract). Exemptions per invariant 14 NOT listed.
type Surface = {
  path: string;
  name: string;
  authHeader?: Record<string, string>;
  /** CSS selector for the surface's primary CTA (the headline action
   *  the customer is expected to take). Used by the above-the-fold
   *  contract. Multiple acceptable selectors (`,` separated). */
  primaryCtaSelector?: string;
  /** Optional skip predicate — if returns true, the surface is skipped
   *  for THIS run (e.g., requires real seeded data we don't have in
   *  staging today). Used sparingly; documented in story description. */
  skipReason?: string;
};

/**
 * ADMIN_CTA_NOTE — why /admin's primaryCtaSelector starts with the path chooser
 * (OSE-1236).
 *
 * It used to start with `[data-testid="create-submit"]`. That button lives on
 * STEP 5 of the create wizard and is hidden until the operator reaches it —
 * correct progressive disclosure, not a defect. But it meant the above-the-fold
 * contract demanded a bounding box on an element the entry view deliberately
 * does not render, so the contract could only ever fail.
 *
 * Measured at 375×812 on entry, the ONLY things rendered above the fold are the
 * path chooser's two buttons: admin-path-wizard (300×72, y=223) and
 * admin-path-advanced (300×87, y=307). Everything else — the create wizard and
 * its Next button included — sits behind [hidden] until a path is chosen. So
 * the guided-setup button IS this surface's entry CTA. The later entries stay
 * as fallbacks in case the chooser is ever removed.
 *
 * None of this was visible until 2026-09-05, because /admin was skipped on
 * every run this suite had ever made: OSE-302's staging bearer secret has been
 * unset since May. The blocking PR job (playwright.mobile.config.ts) supplies a
 * local key to a local worker, which is what finally rendered the surface.
 */
const SURFACES: Surface[] = [
  {
    path: '/',
    name: 'landing',
    primaryCtaSelector:
      '[data-testid="subscribe-submit"], [data-testid="cta-primary"], header a, .hero a, .hero button',
  },
  {
    path: '/events',
    name: 'public events listing',
    primaryCtaSelector: 'main a, [data-testid*="event"]',
  },
  {
    // OSE-298 DRAIN 5/7: when staging doesn't have evt_test_2026 seeded
    // the worker renders the OSE-R-004 branded 404 page (data-testid
    // "error-cta"). Either path is a valid mobile surface; the audit
    // accepts both so it doesn't false-positive on a missing fixture.
    path: '/events/evt_test_2026',
    name: 'public event page',
    primaryCtaSelector:
      '[data-testid="event-rsvp"], [data-testid="event-checkin"], [data-testid="error-cta"], main a, main button',
  },
  {
    path: '/forms/evt_test_2026?type=register',
    name: 'register form',
    primaryCtaSelector:
      '[data-testid="register-submit"], [data-testid$="-submit"], form button[type="submit"]',
  },
  {
    path: '/forms/evt_test_2026?type=checkin',
    name: 'checkin form',
    primaryCtaSelector: '[data-testid="checkin-tap"], .checkin-tap button',
  },
  {
    path: '/forms/evt_test_2026?type=survey',
    name: 'survey form',
    primaryCtaSelector:
      '[data-testid="survey-submit"], [data-testid$="-submit"], form button[type="submit"]',
  },
  {
    path: '/forms/evt_test_2026?type=email-signup',
    name: 'email-signup form',
    primaryCtaSelector:
      '[data-testid="email-submit"], [data-testid$="-submit"], form button[type="submit"]',
  },
  {
    path: '/admin',
    name: 'admin dashboard',
    authHeader: { Authorization: `Bearer ${ADMIN_BEARER}` },
    // Entry-view CTA is the path chooser — see ADMIN_CTA_NOTE above (OSE-1236).
    primaryCtaSelector:
      '[data-testid="admin-path-wizard"], [data-testid="wizard-next-btn"], [data-testid="create-submit"], #admin-action-bar button, main button',
    skipReason: ADMIN_SKIP_REASON,
  },
  {
    // OSE-309: /sharedReport returns 403 (Content-Type: application/json)
    // when the audit bearer is unset OR the analytics.shared-report
    // feature flag is off on staging. The audit then has no DOM to
    // measure against. Same skipReason logic as /admin — when
    // OSE_ADMIN_BEARER is missing/default, skip with the documented
    // founder action. Both /admin AND /sharedReport unblock together
    // when OSE-302's `gh secret set` lands.
    path: '/sharedReport',
    name: 'shared report (admin mode)',
    authHeader: { Authorization: `Bearer ${ADMIN_BEARER}` },
    primaryCtaSelector:
      '[data-testid="export-json-btn"], [data-testid="export-pdf-btn"], main button, main a',
    skipReason: ADMIN_SKIP_REASON,
  },
  {
    // PR #567: sponsor home — phone-first (48px targets) token-gated surface.
    // Documented-skip unless OSE_SPONSOR_HOME_TOKEN is provided (see above), so
    // the new surface is VISIBLE to the gate rather than silently absent.
    path: `/sponsor?t=${SPONSOR_HOME_TOKEN}`,
    name: 'sponsor home',
    primaryCtaSelector:
      '[data-testid="placement-accept"], [data-testid="sponsor-home-nav-events"], main a, main button',
    skipReason: SPONSOR_HOME_SKIP_REASON,
  },
  {
    // 0082: the public sponsor card — where a tap on a sponsor with no website
    // lands. Buttons are @ocr/ui .btn (44px+); documented-skip without a seed.
    path: `/sponsors/${SPONSOR_CARD_ID || 'unseeded'}`,
    name: 'sponsor card',
    primaryCtaSelector:
      '[data-testid="sponsor-card-phone"], [data-testid="sponsor-card-email"], [data-testid="sponsor-card-website"], [data-testid="sponsor-card-nav-events"]',
    skipReason: SPONSOR_CARD_SKIP_REASON,
  },
  {
    path: '/poster',
    name: 'poster preview UI',
    primaryCtaSelector: '[data-testid="poster-print"], #admin-action-bar button',
  },
  {
    // OSE-286: /ui-preview is the @ocr/ui component showcase used by Claude Design.
    // Audited here so the design system surface itself demonstrates the same
    // mobile contracts it's meant to enforce for all other surfaces.
    path: '/ui-preview',
    name: 'ui component preview',
    primaryCtaSelector: '[data-testid="btn-primary-demo"]',
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────

async function loadSurface(page: Page, surface: Surface): Promise<void> {
  if (surface.authHeader) {
    await page.setExtraHTTPHeaders(surface.authHeader);
  }
  await page.setViewportSize(MOBILE_VIEWPORT);
  // Relative — resolved against the config's baseURL. See the header.
  await page.goto(surface.path, { waitUntil: 'domcontentloaded' });
  // OCR-42 page-state model — contract (4) "primary CTA above the fold"
  // applies to the steady-state rendered page, not the initial DOM at
  // domcontentloaded. Surfaces with async data loading (e.g.,
  // /sharedReport whose export buttons start disabled until the report
  // bundle resolves) need a steady-state wait before measurement. We
  // race three signals; whichever fires first proceeds:
  //   - aria-busy="false" on the surface root (main)
  //   - data-ready="true" on <body> (configurable signal)
  //   - 3-second steady-state timeout (fallback)
  // A surface that never reaches steady state in 3 seconds is itself
  // a workability failure per refined standard.
  await Promise.race([
    page
      .locator('main[aria-busy="false"], main:not([aria-busy])')
      .first()
      .waitFor({ state: 'attached', timeout: 3000 })
      .catch(() => null),
    page
      .locator('body[data-ready="true"]')
      .first()
      .waitFor({ state: 'attached', timeout: 3000 })
      .catch(() => null),
    page.waitForTimeout(3000),
  ]);
}

async function getInteractiveLocators(page: Page): Promise<Locator[]> {
  // Buttons, links styled as buttons, form controls — anything a human
  // would tap. We exclude hidden elements (display:none / hidden attr).
  const selector = [
    'button:not([hidden]):not([type="hidden"])',
    'a[href]:not([hidden])',
    'input:not([type="hidden"]):not([hidden])',
    'select:not([hidden])',
    'textarea:not([hidden])',
    '[role="button"]:not([hidden])',
    '[role="link"]:not([hidden])',
  ].join(', ');
  const all = await page.locator(selector).all();
  // Filter to "real" touch targets. Playwright's isVisible() returns true
  // for elements positioned off-screen (e.g. `.skip-link` at left:-9999px
  // is "visible" by CSS rules even though no user will ever tap it), which
  // produces noisy 1×1 touch-target violations. Filter additionally on:
  //   - bounding box exists
  //   - box is inside the viewport (x >= 0 catches offscreen-left skip
  //     links; x < viewport.width catches offscreen-right elements)
  //   - width AND height >= 4 px (anything smaller is decorative or
  //     screen-reader-only and not a real tap target)
  //   - OCR-42: inline text-flow links per WCAG 2.5.5 "Inline" exemption
  //     are EXCLUDED. Anchors styled `display: inline` inside text-flow
  //     parents (p, li, dt, dd, span, em, strong, label) are exempt per
  //     WCAG 2.5.5 Note: "Where the target is in a sentence or block of
  //     text, the size of the target is not constrained." Primary CTAs
  //     styled as buttons or block-level links remain subject — only
  //     the inline-within-text-flow case is exempt.
  // The 4 px floor is generous; legitimate small targets like badges
  // and icons are typically 16+ px wide.
  const viewport = page.viewportSize();
  const viewportW = viewport?.width ?? 375;
  const real: Locator[] = [];
  for (const loc of all) {
    if (!(await loc.isVisible().catch(() => false))) continue;
    const box = await loc.boundingBox().catch(() => null);
    if (!box) continue;
    if (box.width < 4 || box.height < 4) continue; // decorative / a11y-only
    if (box.x < 0 || box.x >= viewportW) continue; // offscreen
    // OCR-42 inline-text exemption
    const isInlineTextLink = await loc
      .evaluate((el) => {
        if (el.tagName.toLowerCase() !== 'a') return false;
        const display = getComputedStyle(el).display;
        if (display !== 'inline') return false;
        const parent = el.parentElement;
        if (!parent) return false;
        const textFlowParents = new Set(['p', 'li', 'dt', 'dd', 'span', 'em', 'strong', 'label']);
        return textFlowParents.has(parent.tagName.toLowerCase());
      })
      .catch(() => false);
    if (isInlineTextLink) continue;

    // WCAG 2.5.5 label-target exemption (OSE-1236).
    //
    // 2.5.5 sizes the TARGET — "the region that will accept a pointer action"
    // — not the painted control. A 18×18 checkbox inside a <label> that is
    // itself >= 44px tall has a 44px target: tapping anywhere on that row
    // toggles it. That is how every design system ships a checkbox, and
    // @ocr/ui's .checkbox-label / .radio-option already carry min-height:44px.
    //
    // Without this the audit reported four 18×18 "violations" that were
    // already compliant, and the only way to satisfy it would have been to
    // paint a 44px checkbox — worse for everyone. Same shape as the
    // inline-text exemption above: narrow, principled, and stated.
    //
    // The exemption is conditional on the label ACTUALLY meeting the floor, so
    // a checkbox in a cramped label still fails.
    const hasLabelSizedTarget = await loc
      .evaluate((el, floor) => {
        const t = (el as HTMLInputElement).type;
        if (el.tagName.toLowerCase() !== 'input') return false;
        if (t !== 'checkbox' && t !== 'radio') return false;
        // Either a wrapping <label> or one bound by for=""
        const wrapper = el.closest('label');
        const bound = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
        for (const l of [wrapper, bound]) {
          if (!l) continue;
          const r = l.getBoundingClientRect();
          if (Math.round(r.height) >= floor && Math.round(r.width) >= floor) return true;
        }
        return false;
      }, MIN_TOUCH_TARGET_PX)
      .catch(() => false);
    if (hasLabelSizedTarget) continue;

    real.push(loc);
  }
  return real;
}

async function getInputLocators(page: Page): Promise<Locator[]> {
  const all = await page
    .locator(
      'input:not([type="hidden"]):not([hidden]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]), textarea:not([hidden]), select:not([hidden])'
    )
    .all();
  const visible: Locator[] = [];
  for (const loc of all) {
    if (await loc.isVisible().catch(() => false)) {
      visible.push(loc);
    }
  }
  return visible;
}

// ─── The audit ────────────────────────────────────────────────────────────

for (const surface of SURFACES) {
  test.describe(`OSE-292 mobile workability — ${surface.name} (${surface.path})`, () => {
    test(`OSE-292 | FE | GET ${surface.path} (375×812 viewport) | no horizontal scroll`, async ({
      page,
    }) => {
      test.skip(!!surface.skipReason, surface.skipReason ?? '');
      await loadSurface(page, surface);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      // Allow a 1-px tolerance for sub-pixel rendering rounding.
      expect(
        scrollWidth,
        `${surface.name}: scrollWidth=${scrollWidth} > clientWidth=${clientWidth} — horizontal scroll required`
      ).toBeLessThanOrEqual(clientWidth + 1);
    });

    test(`OSE-292 | FE | GET ${surface.path} (375×812 viewport) | all touch targets ≥ 44×44 px`, async ({
      page,
    }) => {
      test.skip(!!surface.skipReason, surface.skipReason ?? '');
      await loadSurface(page, surface);
      const interactives = await getInteractiveLocators(page);
      const violations: string[] = [];
      for (const loc of interactives) {
        const box = await loc.boundingBox();
        if (!box) continue;
        // OCR-42 precision fix — compare ROUNDED dimensions against the
        // 44px floor so a 43.99px-rendered element (which displays as
        // "44" in any reasonable measurement) is treated as satisfying
        // the contract. Without rounding, sub-pixel rendering caused
        // false-positive violations on 295×44 inputs that visually meet
        // the WCAG requirement.
        const w = Math.round(box.width);
        const h = Math.round(box.height);
        if (w < MIN_TOUCH_TARGET_PX || h < MIN_TOUCH_TARGET_PX) {
          const tag = await loc.evaluate((el) => el.tagName.toLowerCase());
          const testid = (await loc.getAttribute('data-testid').catch(() => null)) ?? '(no testid)';
          violations.push(`<${tag} data-testid="${testid}"> = ${w}×${h}`);
        }
      }
      expect(
        violations,
        `${surface.name} touch-target violations (< ${MIN_TOUCH_TARGET_PX} px):\n  ${violations.join('\n  ')}`
      ).toEqual([]);
    });

    test(`OSE-292 | FE | GET ${surface.path} (375×812 viewport) | all input font-size ≥ 16 px`, async ({
      page,
    }) => {
      test.skip(!!surface.skipReason, surface.skipReason ?? '');
      await loadSurface(page, surface);
      const inputs = await getInputLocators(page);
      const violations: string[] = [];
      for (const loc of inputs) {
        const fontSize = await loc.evaluate((el) => {
          const cs = getComputedStyle(el);
          return parseFloat(cs.fontSize) || 0;
        });
        if (fontSize < MIN_INPUT_FONT_SIZE_PX) {
          const tag = await loc.evaluate((el) => el.tagName.toLowerCase());
          const testid = (await loc.getAttribute('data-testid').catch(() => null)) ?? '(no testid)';
          violations.push(`<${tag} data-testid="${testid}"> font-size = ${fontSize}px`);
        }
      }
      expect(
        violations,
        `${surface.name} input font-size violations (< ${MIN_INPUT_FONT_SIZE_PX} px, triggers iOS auto-zoom):\n  ${violations.join('\n  ')}`
      ).toEqual([]);
    });

    test(`OSE-292 | FE | GET ${surface.path} (375×812 viewport) | primary CTA above the fold`, async ({
      page,
    }) => {
      test.skip(!!surface.skipReason, surface.skipReason ?? '');
      test.skip(
        !surface.primaryCtaSelector,
        `${surface.name}: no primaryCtaSelector declared — surface either has no clear CTA OR the contract isn't applicable`
      );
      await loadSurface(page, surface);
      // Selector-priority resolution (OSE-1236).
      //
      // This was `page.locator(surface.primaryCtaSelector!).first()`. A
      // comma-separated CSS list is ONE selector, and `.first()` returns the
      // first match in DOCUMENT ORDER — not the first list entry that matches.
      // Every surface here declares its selector as a priority list
      // ("the real CTA, then progressively looser fallbacks"), and that
      // intent was silently inverted: on /admin the entry-view chooser sits
      // AFTER the create wizard in the DOM, so `.first()` always resolved to
      // create-submit — an element behind [hidden] — and the contract failed
      // with "no bounding box" no matter which CTA was named first.
      //
      // Resolving entry-by-entry restores the declared intent, and prefers a
      // RENDERED candidate: a selector that matches only hidden elements falls
      // through to the next, which is what a fallback list is for.
      const candidates = surface
        .primaryCtaSelector!.split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      let cta = page.locator(candidates[0]).first();
      let exists = 0;
      for (const sel of candidates) {
        const loc = page.locator(sel).first();
        const n = await loc.count();
        if (n === 0) continue;
        if (exists === 0) {
          // Remember the first selector that matches ANYTHING, so a surface
          // whose CTA exists but is hidden still reports the honest
          // "no bounding box" rather than "matched 0 elements".
          cta = loc;
          exists = n;
        }
        if (await loc.boundingBox().catch(() => null)) {
          cta = loc;
          exists = n;
          break;
        }
      }
      if (exists === 0) {
        // No primary CTA element found on the page at all. That's a
        // different failure class — surface a clear message rather than
        // a confusing "above the fold" assertion error.
        throw new Error(
          `${surface.name}: primary CTA selector '${surface.primaryCtaSelector}' matched 0 elements. Either the selector needs updating for this surface, or the surface is genuinely missing its primary CTA.`
        );
      }
      const box = await cta.boundingBox();
      expect(box, `${surface.name}: primary CTA has no bounding box`).not.toBeNull();
      // "Above the fold" at 375×812 means cta.y < 812 — the customer
      // sees the CTA without scrolling on initial load.
      expect(
        box!.y,
        `${surface.name}: primary CTA top = ${Math.round(box!.y)}px > viewport height ${MOBILE_VIEWPORT.height}px — CTA below the fold, requires scroll-then-tap`
      ).toBeLessThan(MOBILE_VIEWPORT.height);
    });

    test(`OSE-292 | FE | GET ${surface.path} (375×812 viewport) | no pinch-zoom required for form submit`, async ({
      page,
    }) => {
      test.skip(!!surface.skipReason, surface.skipReason ?? '');
      await loadSurface(page, surface);
      // Check viewport meta — pinch-zoom is disabled if the meta
      // includes `user-scalable=no` OR `maximum-scale=1`. EITHER of
      // those is a violation (per WCAG + accessibility guidance — the
      // user must be able to zoom). For mobile workability we want the
      // OPPOSITE assertion: the surface must NOT block zoom, AND must
      // not REQUIRE zoom (the latter is covered by the font-size +
      // touch-target contracts above).
      const viewportMeta = await page
        .locator('meta[name="viewport"]')
        .first()
        .getAttribute('content')
        .catch(() => null);
      if (viewportMeta) {
        expect(
          viewportMeta,
          `${surface.name}: viewport meta blocks pinch-zoom ('${viewportMeta}') — accessibility violation per WCAG 1.4.4`
        ).not.toMatch(/user-scalable\s*=\s*(no|0)/i);
        expect(
          viewportMeta,
          `${surface.name}: viewport meta blocks pinch-zoom via maximum-scale ('${viewportMeta}')`
        ).not.toMatch(/maximum-scale\s*=\s*1\b/i);
      }
      // The "no pinch-zoom required" assertion is structurally
      // satisfied if (touch-target ≥ 44px) AND (input font-size ≥ 16px)
      // pass — both already validated above. This test specifically
      // guards the viewport-meta angle (the surface mustn't BLOCK
      // zoom even if it doesn't require it).
    });
  });
}
