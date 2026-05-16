/**
 * OSE-305 — Lock the post-OCR-42 / OSE-301 refinement state as a
 * regression guard.
 *
 * Layer: API-static (Node vitest reads the Playwright audit spec
 * source + matches expected patterns; no browser, no staging hit,
 * no Cloudflare worker sandbox).
 *
 * Context: the post-OCR-42 + OSE-301 success claim is "non-/admin
 * surfaces report 0 audit violations against staging." That claim
 * unblocks OCR-40 (flip invariant 14 partial → live). Until this
 * spec existed, the claim was validated only by manual audit-log
 * reading. This spec encodes the claim's CODE-level preconditions
 * so a future change that silently reverts any of OCR-42 / OSE-301
 * breaks at PR-time, not at next audit dispatch.
 *
 * Six preconditions asserted:
 *   1. /admin surface has skipReason referencing OSE_ADMIN_BEARER
 *      and OSE-302 (so audit doesn't measure CF challenge page)
 *   2. /events/:id primaryCtaSelector includes "error-cta" (OCR-42
 *      error-page sub-contract)
 *   3. getInteractiveLocators implements WCAG 2.5.5 inline-text
 *      exemption (OCR-42 contract 2 refinement)
 *   4. loadSurface implements page-state steady-state wait (OCR-42
 *      contract 4 refinement)
 *   5. Touch-target violation comparison uses Math.round() precision
 *      fix (OCR-42 contract 2 precision refinement)
 *   6. The audit spec references OCR-42 in change comments (so future
 *      maintainers can trace the refinement provenance)
 *
 * If any of these fail, the post-OCR-42 audit-clean claim is no
 * longer defensible — OCR-40 promote-to-live should be reverted
 * or held until the regression is repaired.
 *
 * Lives under tests/unit/ (root-level Node vitest with fs access)
 * rather than workers/oursharedevents/tests/ (cloudflare:test pool
 * sandbox without host fs access).
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const AUDIT_SPEC_PATH = join(process.cwd(), 'tests', 'playwright', 'mobile-workability.spec.ts');

function readAuditSpec(): string {
  return readFileSync(AUDIT_SPEC_PATH, 'utf8');
}

describe('OSE-305 post-OCR-42 refinement regression guard — audit spec preconditions', () => {
  test('audit spec exists at expected path', () => {
    expect(() => readAuditSpec()).not.toThrow();
    const content = readAuditSpec();
    expect(content.length).toBeGreaterThan(1000);
  });

  test('/admin surface has skipReason referencing OSE_ADMIN_BEARER + OSE-302 (OSE-305 / ADR-006)', () => {
    // When OSE_ADMIN_BEARER is unset / default-test-value, /admin
    // requests hit the Cloudflare bot challenge → audit measures the
    // CF challenge page, not OSE's admin dashboard. The skipReason
    // logic prevents this false-positive failure mode from polluting
    // the audit's signal about non-/admin surfaces' real compliance.
    const audit = readAuditSpec();
    expect(audit).toMatch(/ADMIN_SKIP_REASON/);
    expect(audit).toContain('OSE_ADMIN_BEARER');
    expect(audit).toContain('OSE-302');
    // /admin surface entry must reference the skipReason variable.
    expect(audit).toMatch(/path:\s*['"]\/admin['"][\s\S]{0,400}?skipReason:\s*ADMIN_SKIP_REASON/);
  });

  test('/sharedReport surface has skipReason referencing ADMIN_SKIP_REASON (OSE-309)', () => {
    // Same root cause as /admin: /sharedReport returns 403 JSON when
    // the audit bearer is unset/the feature flag is off. The audit's
    // Playwright runner has no DOM to measure CTAs against — better
    // to skip with the documented founder action than silently report
    // false-positive violations. Both /admin AND /sharedReport
    // unblock together when OSE-302's secret-set lands.
    const audit = readAuditSpec();
    expect(audit).toMatch(
      /path:\s*['"]\/sharedReport['"][\s\S]{0,500}?skipReason:\s*ADMIN_SKIP_REASON/
    );
  });

  test('/events/:id primaryCtaSelector includes "error-cta" (OCR-42 error-page sub-contract)', () => {
    // The OCR-42 error-page sub-contract says: when the audit's test
    // fixture (evt_test_2026) doesn't exist on staging, the rendered
    // OSE-R-004 404 page is itself a customer surface and its recovery
    // action satisfies contract (4). The audit's CTA selector list
    // MUST accept either the happy-path CTAs or the error page's
    // data-testid="error-cta".
    const audit = readAuditSpec();
    expect(audit).toMatch(
      /path:\s*['"]\/events\/[^'"]+['"][\s\S]{0,400}?primaryCtaSelector[\s\S]{0,400}?error-cta/
    );
  });

  test('getInteractiveLocators implements WCAG 2.5.5 inline-text exemption (OCR-42 contract 2)', () => {
    // Anchors with computed display:inline inside text-flow parents
    // (p, li, dt, dd, span, em, strong, label) are exempt from the
    // 44x44 floor per WCAG 2.5.5. Without this exemption check, the
    // audit false-positives on footer links, in-paragraph privacy
    // links, error-page recovery anchors, etc.
    const audit = readAuditSpec();
    // Accept either === or !== form (the audit uses an early-return
    // !== pattern; a future refactor might use === inside an if).
    expect(audit).toMatch(/display\s*(===|!==)\s*['"]inline['"]/);
    expect(audit).toContain('textFlowParents');
    // The set must include all text-flow tag names the standard names.
    for (const tag of ['p', 'li', 'dt', 'dd', 'span', 'em', 'strong', 'label']) {
      expect(audit, `inline-text exemption set missing '${tag}'`).toMatch(
        new RegExp(`['"]${tag}['"]`)
      );
    }
  });

  test('loadSurface implements page-state steady-state wait (OCR-42 contract 4)', () => {
    // Contract (4) "primary CTA above the fold" applies to the
    // steady-state rendered page, not the initial DOM. Audit must
    // wait for aria-busy="false" on main OR data-ready="true" on
    // body OR a 3-second steady-state timeout (fallback) before
    // measuring CTA visibility. Without this, /sharedReport's
    // disabled-but-visible export buttons get reported as "missing
    // primary CTA" because they render after the audit measures.
    const audit = readAuditSpec();
    expect(audit).toMatch(/aria-busy="false"/);
    expect(audit).toMatch(/data-ready="true"/);
    // The 3-second timeout — locked at 3000ms specifically because
    // anything longer is itself a workability failure per refined
    // standard ("no unbounded wait required").
    expect(audit).toMatch(/3000/);
    // Must be wired via Promise.race so first signal wins.
    expect(audit).toMatch(/Promise\.race/);
  });

  test('touch-target comparison uses Math.round() precision fix (OCR-42 contract 2)', () => {
    // A 43.99-rendered element visually meets the 44px contract;
    // without rounding, sub-pixel rendering caused false-positive
    // violations on 295x44 inputs that visually meet WCAG.
    const audit = readAuditSpec();
    expect(audit).toMatch(/Math\.round\(box\.width\)/);
    expect(audit).toMatch(/Math\.round\(box\.height\)/);
  });

  test('audit spec references OCR-42 in change comments (provenance trace)', () => {
    // Every change OSE-301 made to align the audit to the refined
    // standard is commented "OCR-42" so future maintainers can trace
    // any one line back to the standard refinement that justified it.
    // If OCR-42 references disappear, the changes are at risk of
    // being silently reverted as "unexplained complexity."
    const audit = readAuditSpec();
    const ocr42Mentions = (audit.match(/OCR-42/g) || []).length;
    expect(ocr42Mentions).toBeGreaterThanOrEqual(3);
  });
});
