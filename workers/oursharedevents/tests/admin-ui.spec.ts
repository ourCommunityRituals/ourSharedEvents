/**
 * Admin UI Structure Tests
 *
 * Validates the admin page HTML output via SELF.fetch against miniflare.
 * Tests the frontend features added in ADMIN-2 (tier badge), ADMIN-5
 * (inline form config), and ADMIN-12 (CSS classes, zero inline styles).
 *
 * These are NOT browser tests — they verify the HTML template structure
 * returned by the Worker. For full browser interaction tests, use
 * the Playwright suite in tests/e2e/.
 */

import { SELF } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';

const ADMIN_KEY = 'test-admin-key-e2e-2026';

function adminHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${ADMIN_KEY}` };
}

async function fetchAdminHtml(): Promise<string> {
  const res = await SELF.fetch('https://t.test/admin', {
    headers: adminHeaders(),
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toContain('text/html');
  return res.text();
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN-2: Tier badge + gated UI
// ═══════════════════════════════════════════════════════════════════════════════

describe('ADMIN-2: Tier badge in admin header', () => {
  test('admin page returns 200 with HTML', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('OurSharedEvents');
  });

  test('tier badge element exists with data-testid', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('data-testid="tier-badge"');
    expect(html).toContain('id="tierBadge"');
    expect(html).toContain('class="tier-badge"');
  });

  test('tier badge CSS classes defined for all 3 tiers', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('.tier-badge.free');
    expect(html).toContain('.tier-badge.mid');
    expect(html).toContain('.tier-badge.enterprise');
  });

  test('JS fetches current tier and resolved flags on load', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('/api/v2/admin/flags/current-tier');
    expect(html).toContain('/api/v2/admin/flags/resolve');
    expect(html).toContain('window._resolvedFlags');
  });

  test('feature-locked CSS defined for gated elements', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('.feature-locked');
    expect(html).toContain('.lock-overlay');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN-5: Inline form config toggles
// ═══════════════════════════════════════════════════════════════════════════════

describe('ADMIN-5: Form config toggles', () => {
  test('loadForms function resolves per-event flags', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('/api/v2/admin/flags/resolve?eventId=');
  });

  test('JS generates form gate data-testids for all 4 types', async () => {
    const html = await fetchAdminHtml();
    // These are generated dynamically by loadForms() — verify the JS patterns
    expect(html).toContain("form-gate-' + t.key");
    expect(html).toContain("key: 'register'");
    expect(html).toContain("key: 'checkin'");
    expect(html).toContain("key: 'survey'");
    expect(html).toContain("key: 'email'");
  });

  test('toggle switch CSS and config section defined', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('.toggle');
    expect(html).toContain('.toggle .slider');
    expect(html).toContain('.config-section');
    expect(html).toContain('.form-config');
  });

  test('toggleFormFlag function calls PUT event flag API', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('window.toggleFormFlag');
    expect(html).toContain('/api/v2/admin/events/');
    expect(html).toContain("method: 'PUT'");
  });

  test('JS generates form config and toggle data-testid patterns', async () => {
    const html = await fetchAdminHtml();
    // These are generated dynamically — verify the JS template patterns
    expect(html).toContain("form-config-' + t.key");
    expect(html).toContain("form-toggle-' + t.key");
  });

  test('upgrade prompt shown for tier-gated forms', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('Upgrade to');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN-12: Zero inline styles
// ═══════════════════════════════════════════════════════════════════════════════

describe('ADMIN-12: No inline styles in admin HTML', () => {
  test('admin page contains zero style= attributes', async () => {
    const html = await fetchAdminHtml();
    // Extract just the body (exclude <style> block which contains CSS)
    const bodyStart = html.indexOf('<body>');
    const bodyHtml = html.slice(bodyStart);
    expect(bodyHtml).not.toMatch(/style="/);
  });

  test('utility CSS classes exist', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('.clickable-row');
    expect(html).toContain('.muted-sm');
    expect(html).toContain('.sr-only');
    expect(html).toContain('.flex-row');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Auth gate: admin page requires auth
// ═══════════════════════════════════════════════════════════════════════════════

describe('Admin auth gate', () => {
  test('GET /admin without auth returns 401', async () => {
    const res = await SELF.fetch('https://t.test/admin');
    expect(res.status).toBe(401);
  });

  test('GET /admin with valid Bearer token returns 200', async () => {
    const res = await SELF.fetch('https://t.test/admin', {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
  });
});
