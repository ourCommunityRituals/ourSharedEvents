/**
 * OSE-667 — single selected-event store + survive create-reload.
 *
 * Replaces four imperative loader calls wired into every row with one store:
 * selectEvent() persists ONLY the opaque event id (#1 — no PII/anonymous_id),
 * dispatches one `ose:event-selected` event, and the four management cards fan
 * out from it. Selection is restored across the create-forced reload.
 *
 * Source-shape assertions on the served admin HTML (inline script), matching
 * admin-ui.spec.ts.
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

describe('OSE-667 — single selected-event store', () => {
  test('selectEvent + the store are defined', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('window.selectEvent = function');
    expect(html).toContain('window.OSE_selection');
    expect(html).toContain("window.SELECTED_EVENT_KEY = 'ose_selected_event_id'");
  });

  test('the row gesture selects via the store, not four imperative loader calls', async () => {
    const html = await fetchAdminHtml();
    // OSE-1239: the row's selection gesture is now a data-action the delegated
    // dispatcher resolves. The previous assertion required an inline onclick —
    // the exact shape the nonce CSP refuses — so it passed while clicking a
    // row selected nothing at all.
    expect(html).toContain('data-action="event-select"');
    expect(html).toContain("'event-select': function (el)");
    expect(html).toContain('window.selectEvent(');
    // The old shape — four loaders inline in the row handler — is still gone.
    expect(html).not.toContain("onclick=\"window.loadForms('${safeId}'");
  });

  test('one ose:event-selected event fans out to all four management cards', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain("window.dispatchEvent(new CustomEvent('ose:event-selected'");
    expect(html).toContain("addEventListener('ose:event-selected'");
    expect(html).toContain('window.loadForms(d.id, d.name, d.phase)');
    expect(html).toContain('window.loadPosterDeployments(d.id)');
    expect(html).toContain('window._loadSponsorsForEvent(d.id)');
    expect(html).toContain('window.scopeSurfaceCards(d.id, d.name)');
  });

  test('only the opaque event id is persisted (#1 — no PII/anonymous_id)', async () => {
    const html = await fetchAdminHtml();
    // sessionStorage stores the id under the key — never a name/email/anon id.
    expect(html).toContain(
      'sessionStorage.setItem(window.SELECTED_EVENT_KEY, window.OSE_selection.id)'
    );
    expect(html).not.toContain(
      'sessionStorage.setItem(window.SELECTED_EVENT_KEY, window.OSE_selection.name'
    );
  });

  test('selection is restored across reload (re-select + scrollIntoView), stale id cleared', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('sessionStorage.getItem(window.SELECTED_EVENT_KEY)');
    expect(html).toContain("scrollIntoView({ block: 'center' })");
    // A saved id that no longer matches a row is removed, not left dangling.
    expect(html).toContain('sessionStorage.removeItem(window.SELECTED_EVENT_KEY)');
  });

  test('creating an event stashes its id so the forced reload re-selects it', async () => {
    const html = await fetchAdminHtml();
    // In the create-success branch, the new id is persisted before reload.
    expect(html).toContain('sessionStorage.setItem(window.SELECTED_EVENT_KEY, String(data.id))');
    expect(html).toContain('location.reload()');
  });
});
