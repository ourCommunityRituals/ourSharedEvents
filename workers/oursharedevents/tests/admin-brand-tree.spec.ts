/**
 * OSE-668 — brand-scoped event query + rollup tree.
 *
 * The brand SCOPE is enforced server-side (OSE-666 B1/B2 — the list only returns
 * the caller's brands). This story is the UI half: the events list groups those
 * events under collapsible per-brand nodes with a count pill. A single-brand
 * operator sees one implicit group (no header noise); a multi-brand owner gets
 * the tree. Rows carry data-brand-row so a group header can collapse them.
 *
 * Source-shape assertions on the served admin HTML (client grouping runs in the
 * browser), matching admin-ui.spec.ts.
 */

import { SELF } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';

async function fetchAdminHtml(): Promise<string> {
  const res = await SELF.fetch('https://t.test/admin', {
    headers: { Authorization: 'Bearer test-admin-key-e2e-2026' },
  });
  expect(res.status).toBe(200);
  return res.text();
}

describe('OSE-668 — events grouped into a brand tree', () => {
  test('events are grouped by brand_id', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('const byBrand = {}');
    expect(html).toContain("const b = String(e.brand_id || '—')");
    expect(html).toContain('const brandIds = Object.keys(byBrand).sort()');
  });

  test('a per-brand collapsible header + count pill render only when multi-brand', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('const multiBrand = brandIds.length > 1');
    expect(html).toContain('class="brand-group-header"');
    expect(html).toContain('data-testid="brand-count-');
    expect(html).toContain('window.toggleBrandGroup(');
  });

  test('event rows carry data-brand-row so the group can collapse them', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('data-brand-row="${safeBrand}"');
  });

  test('toggleBrandGroup flips aria-expanded + hides matching rows (a11y)', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('window.toggleBrandGroup = function');
    expect(html).toContain("headerEl.getAttribute('aria-expanded') === 'false'");
    expect(html).toContain("r.getAttribute('data-brand-row') === brand");
  });

  test('the group header is keyboard-operable and styled without inline styles', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('tr.brand-group-header');
    expect(html).toContain('.brand-count-pill');
    // keyboard: Enter/Space activates the header. OSE-1239 moved this from an
    // inline onkeydown (refused by the nonce CSP, so it never fired) to the
    // delegated dispatcher; the header opts in with role="button".
    expect(html).toMatch(/data-brand-group="\$\{safeBrand\}"[\s\S]{0,200}?role="button"/);
    expect(html).toContain('data-action="brand-toggle"');
    expect(html).toContain("document.addEventListener('keydown'");
  });
});
