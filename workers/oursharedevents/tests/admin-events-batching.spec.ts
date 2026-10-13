/**
 * OSE-675 — batched events fetch + optimistic display-only flag toggle.
 *
 * (a) The admin-events list is fetched via a memoized in-flight promise reused
 *     by the table, sponsor event options, and the sponsor-name cache — one
 *     request per burst, no stale cache. (b) loadForms resolves flags + all
 *     four counts in a single Promise.all. (c) toggleFormFlag flips the flag
 *     boolean optimistically (display-only UI intent), disables during the
 *     audited PUT, announces via _adminAnnounce, and reverts on error — the
 *     count span is NEVER recomputed (#7: optimism must not reach an aggregate).
 *
 * Source-shape assertions on the served admin HTML, matching admin-ui.spec.ts.
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

describe('OSE-675 — memoized events fetch', () => {
  test('a single memoized in-flight helper is defined', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('window.OSE_events = function');
    expect(html).toContain('window._oseEventsInFlight');
    // In-flight dedup only — cleared once settled (no stale cache).
    expect(html).toContain('const clear = () =>');
  });

  test('the three call sites use the memoized helper, not raw fetches', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('const data = await window.OSE_events();');
    // The old duplicate raw fetches for the events list are gone from those sites.
    expect(html).not.toContain(
      "const res = await fetch('/api/v2/admin/events');\n          const data = await res.json();"
    );
  });
});

describe('OSE-675 — one round-trip loadForms', () => {
  test('flags + four counts resolve in a single Promise.all', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('const [eventFlagsRes, ...counts] = await Promise.all([');
    expect(html).toContain("fetch('/api/v2/admin/flags/resolve?eventId=' + eventId)");
  });
});

describe('OSE-675 — optimistic flag toggle (display-only, never a count)', () => {
  test('the toggle disables during the PUT and re-enables in finally', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('el.disabled = true;');
    expect(html).toContain('el.disabled = false;');
  });

  test('outcome is announced via _adminAnnounce; error reverts the flag', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain("window._adminAnnounce((enabled ? 'Enabled' : 'Disabled')");
    expect(html).toContain('el.checked = !enabled; // revert on failure');
    expect(html).toContain(
      "window._adminRequestFailed('Could not update ' + flagKey + '. It is back as it was.', res, data, 'Turning a form on or off')"
    );
  });
});
