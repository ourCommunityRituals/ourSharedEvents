/**
 * OSE-665 (2026-08-08) — admin operational count tiles: three-state, uniform floor.
 *
 * Governance decision: "0-5 consistency so everyone sees the same information."
 * A sub-5 cohort is suppressed on EVERY surface using the same K as the
 * SharedReport (CORRIDOR_MAP_MIN_COUNT), enforced server-side, so no surface
 * side-channels an exact small count. The tile renders three server-decided
 * states: an exact count (>=5), a suppressed band (<5 → "<5"), or a failed
 * fetch (retry — never a masked 0). The old `.catch(() => 0)` mask is gone.
 *
 * Source-shape assertions on the served admin HTML (inline script), matching
 * admin-ui.spec.ts — not browser execution. Server floor behaviour is covered
 * by count-floor.spec.ts (unit) and the forms count handlers.
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

describe('OSE-665 — count tiles are three-state, never a masked 0', () => {
  test('the old error-masking pattern (.catch(() => 0)) is gone from the counts fetch', async () => {
    const html = await fetchAdminHtml();
    expect(html).not.toContain(".then(d => d.count || 0).catch(() => 0)");
  });

  test('a failed count resolves to an explicit error sentinel, not 0', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain(".catch(() => 'error')");
    expect(html).toContain("typeof d.count === 'number'");
  });

  test('suppression is server-decided: the tile reads the server `suppressed` flag', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('if (d.suppressed) return');
    expect(html).toContain('data-testid="count-suppressed"');
    // The suppressed band renders "<5", never the exact sub-floor number.
    expect(html).toContain('&lt;5');
  });

  test('an errored tile renders a retry affordance (never a masked 0)', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('renderCount');
    expect(html).toContain('data-testid="count-retry"');
    expect(html).toContain('window.reloadForms()');
  });

  test('retry re-runs the load for the currently-selected event', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('window.reloadForms');
    expect(html).toContain('window._lastFormsArgs');
  });

  test('the retry control keeps a >=44px tap target and an accessible label (#14)', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('min-width:44px;min-height:44px');
    expect(html).toContain('aria-label="Count failed to load. Retry."');
  });
});
