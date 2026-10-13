/**
 * No blocking browser dialogs in the admin surface.
 *
 * Idea #2 from the invariant-first frontend fleet. Five blocking dialogs
 * (four alert(), one confirm()) were the last outliers against a pattern the
 * codebase already endorses: the sponsor deactivate flow rewrites a table cell
 * into an inline Yes/No confirm, and feedback flows through an aria-live
 * region. This spec is the enforcing gate — it fails if any alert()/confirm()
 * returns to admin.html, and it pins the INVARIANT #1 guard that the shared
 * announce helper writes with textContent, never innerHTML.
 *
 * @born-red invariant#1 | method: design-time-negative-assertion | date: 2026-08-07
 */

import { describe, test, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

const ADMIN_KEY = 'test-admin-key-e2e-2026';

async function fetchAdmin(): Promise<string> {
  const res = await SELF.fetch('https://t.test/admin', {
    headers: { Authorization: `Bearer ${ADMIN_KEY}`, Accept: 'text/html' },
  });
  expect(res.status, '/admin should render 200').toBe(200);
  return res.text();
}

describe('admin | no blocking browser dialogs', () => {
  test('rendered /admin contains zero alert( calls', async () => {
    const html = await fetchAdmin();
    expect(html).not.toMatch(/\balert\(/);
  });

  test('rendered /admin contains zero confirm( calls', async () => {
    const html = await fetchAdmin();
    // Note: identifiers like _confirmDeletePd( and test-ids like
    // confirm-delete-pd are NOT `confirm(` and must not trip this.
    expect(html).not.toMatch(/\bconfirm\(/);
  });

  test('a single shared assertive aria-live region is present', async () => {
    const html = await fetchAdmin();
    expect(html).toContain('data-testid="admin-status"');
    expect(html).toMatch(/id="admin-status"[\s\S]{0,200}role="alert"/);
    expect(html).toMatch(/aria-live="assertive"/);
    expect(html).toMatch(/aria-atomic="true"/);
  });

  test('INVARIANT #1: _adminAnnounce writes via textContent, never innerHTML', async () => {
    const html = await fetchAdmin();
    // The helper hands the message to the toast (text only) and, when the
    // toast script is not there, assigns it to the status line with textContent…
    const helper = html.slice(
      html.indexOf('window._adminAnnounce = function'),
      html.indexOf('window._adminRequestFailed = function')
    );
    expect(helper.length, 'the helper was found').toBeGreaterThan(100);
    expect(helper).toMatch(/\.textContent\s*=\s*message/);
    const code = helper.replace(/\/\/.*/g, ''); // the comments name innerHTML to forbid it
    expect(code).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
    // …and never routes the status region through innerHTML.
    expect(html).not.toMatch(/admin-status[\s\S]{0,120}\.innerHTML\s*=/);
  });

  test('poster delete uses the inline two-step confirm (not a dialog)', async () => {
    const html = await fetchAdmin();
    // The reveal + confirm/cancel test-ids the inline flow renders.
    expect(html).toContain('confirm-delete-pd-');
    expect(html).toContain('cancel-delete-pd-');
    expect(html).toContain('window._confirmDeletePd(');
  });
});
