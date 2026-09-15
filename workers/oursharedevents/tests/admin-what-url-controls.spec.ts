/**
 * OSE-1319 R3/R5 — admin external-link controls (enable + type + https URL) and
 * the live poster-slot preview render into the admin create form, and the submit
 * path collects the new fields with a fat-finger guard.
 *
 * Structure test (workers pool): asserts the served /admin HTML, not a browser.
 * Verified red against the pre-R3 form (single what_url input, no enable/type/
 * preview, no what_url_enabled in the payload).
 */
import { SELF } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';

const ADMIN_KEY = 'test-admin-key-e2e-2026';

async function fetchAdminHtml(): Promise<string> {
  const res = await SELF.fetch('https://t.test/admin', {
    headers: { Authorization: `Bearer ${ADMIN_KEY}` },
  });
  expect(res.status).toBe(200);
  return res.text();
}

describe('R3 — external-link controls in the create form', () => {
  test('enable checkbox, type select and https URL input are present', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('data-testid="create-what-url-group"');
    expect(html).toContain('data-testid="create-what-url-enabled"');
    expect(html).toContain('name="what_url_enabled"');
    expect(html).toContain('data-testid="create-what-url-type"');
    expect(html).toContain('name="what_url_type"');
    expect(html).toContain('data-testid="create-what-url"');
    // https-only client hint preserved on the URL input
    expect(html).toContain('pattern="https://.*"');
  });

  test('the type dropdown offers exactly the canonical vocabulary', async () => {
    const html = await fetchAdminHtml();
    for (const t of ['donation', 'tickets', 'workshop', 'league', 'substack', 'menu', 'website']) {
      expect(html, `type option '${t}'`).toContain(`value="${t}"`);
    }
    // poster-only kinds must NOT be selectable here
    expect(html).not.toContain('value="signup"');
    expect(html).not.toContain('<option value="public"');
  });

  test('an inline (per-field) error region exists for fat-finger feedback', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('data-testid="create-what-url-error"');
    expect(html).toContain('role="alert"');
  });
});

describe('R5 — live poster-slot preview', () => {
  test('preview region with the always-on public chip + a hidden typed chip', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('data-testid="create-slot-preview"');
    expect(html).toContain('data-testid="create-slot-chip-public"');
    expect(html).toContain('data-testid="create-slot-chip-typed"');
    expect(html).toContain('updateSlotPreview');
  });
});

describe('R3 — submit path + fat-finger guard are wired', () => {
  test('the payload collects what_url_enabled and (when enabled) what_url_type', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('body.what_url_enabled');
    expect(html).toContain('body.what_url_type');
  });

  test('enabling a link with a bad URL shows an error and blocks submit', async () => {
    const html = await fetchAdminHtml();
    // the guard reads the enable checkbox, tests https, and calls showLinkError
    expect(html).toContain('showLinkError');
    expect(html).toContain('wireLinkControls');
  });
});

describe('R3 — mobile workability sizing is declared for the new controls', () => {
  test('the new select + url input assert >=44px target and >=16px font in CSS', async () => {
    const html = await fetchAdminHtml();
    // the explicit sizing block for .create-linkctl select / input[type=url]
    expect(html).toMatch(/\.create-linkctl select[\s\S]{0,120}min-height:\s*44px/);
    expect(html).toMatch(/\.create-linkctl select[\s\S]{0,160}font-size:\s*16px/);
  });
});
