/**
 * A11Y-6: Keyboard navigation & focus trap
 *
 * Verifies:
 *   - Skip-to-content link present on all pages with a #main-content target
 *   - button:focus-visible CSS in every page that has buttons
 *   - .clickable-row has tabindex="0" and onkeydown for Enter/Space
 *   - Focus-visible styles for interactive elements beyond buttons
 */

import { describe, test, expect } from 'vitest';
import { handleAdminPage, handlePosterPage, handleSharedReportPage } from '../src/handlers/pages';
import { handleFormPage } from '../src/handlers/form-pages';

// ─── Helpers ────────────────────────────────────────────────────────────────

function adminHtml(): Promise<string> {
  return handleAdminPage({} as never).text();
}
function reportHtml(): Promise<string> {
  return handleSharedReportPage({} as never).text();
}
function posterHtml(): Promise<string> {
  return handlePosterPage({} as never).text();
}
function formHtml(type: string): Promise<string> {
  const req = new Request(`https://t.test/forms/evt1?type=${type}&event=Test`);
  return handleFormPage(req, {}, 'evt1').text();
}

// ─── Skip links ──────────────────────────────────────────────────────────────

describe('A11Y-6: skip-to-content link present on all pages', () => {
  test('admin page has skip link targeting #main-content', async () => {
    const body = await adminHtml();
    expect(body).toContain('href="#main-content"');
    expect(body).toContain('class="skip-link"');
    expect(body).toContain('id="main-content"');
  });

  test('shared report page has skip link targeting #main-content', async () => {
    const body = await reportHtml();
    expect(body).toContain('href="#main-content"');
    expect(body).toContain('class="skip-link"');
    expect(body).toContain('id="main-content"');
  });

  test('poster page has skip link targeting #main-content', async () => {
    const body = await posterHtml();
    expect(body).toContain('href="#main-content"');
    expect(body).toContain('class="skip-link"');
    expect(body).toContain('id="main-content"');
  });

  test('register form has skip link targeting #main-content', async () => {
    const body = await formHtml('register');
    expect(body).toContain('href="#main-content"');
    expect(body).toContain('class="skip-link"');
    expect(body).toContain('id="main-content"');
  });

  test('email form has skip link targeting #main-content', async () => {
    const body = await formHtml('email');
    expect(body).toContain('href="#main-content"');
    expect(body).toContain('class="skip-link"');
    expect(body).toContain('id="main-content"');
  });

  test('checkin form has skip link targeting #main-content', async () => {
    const body = await formHtml('checkin');
    expect(body).toContain('href="#main-content"');
    expect(body).toContain('id="main-content"');
  });

  test('survey form has skip link targeting #main-content', async () => {
    const body = await formHtml('survey');
    expect(body).toContain('href="#main-content"');
    expect(body).toContain('id="main-content"');
  });
});

describe('A11Y-6: skip-link CSS hides off-screen and reveals on focus', () => {
  test('admin page skip-link CSS: hidden by default, visible on focus', async () => {
    const body = await adminHtml();
    expect(body).toContain('.skip-link');
    expect(body).toMatch(/\.skip-link\s*\{[^}]*left:\s*-9999px/);
    expect(body).toMatch(/\.skip-link:focus\s*\{[^}]*position:\s*fixed/);
  });

  test('form page skip-link CSS: hidden by default, visible on focus', async () => {
    const body = await formHtml('register');
    expect(body).toMatch(/\.skip-link\s*\{[^}]*left:\s*-9999px/);
    expect(body).toMatch(/\.skip-link:focus\s*\{[^}]*position:\s*fixed/);
  });
});

// ─── button:focus-visible ────────────────────────────────────────────────────

describe('A11Y-6: button:focus-visible present in all pages with buttons', () => {
  test('admin page has button:focus-visible CSS', async () => {
    expect(await adminHtml()).toMatch(/button:focus-visible\s*\{[^}]*outline/);
  });

  test('register form has button:focus-visible CSS', async () => {
    expect(await formHtml('register')).toMatch(/button:focus-visible\s*\{[^}]*outline/);
  });

  test('survey form has button:focus-visible CSS', async () => {
    expect(await formHtml('survey')).toMatch(/button:focus-visible\s*\{[^}]*outline/);
  });

  test('checkin form has button:focus-visible CSS', async () => {
    expect(await formHtml('checkin')).toMatch(/button:focus-visible\s*\{[^}]*outline/);
  });
});

// ─── .btn:focus-visible (report page) ───────────────────────────────────────

describe('A11Y-6: .btn:focus-visible on shared report page', () => {
  test('shared report page has .btn:focus-visible CSS', async () => {
    expect(await reportHtml()).toMatch(/\.btn:focus-visible\s*\{[^}]*outline/);
  });
});

// ─── .clickable-row keyboard access ─────────────────────────────────────────

describe('A11Y-6: .clickable-row is keyboard accessible', () => {
  test('admin event rows have tabindex="0"', async () => {
    expect(await adminHtml()).toContain('tabindex="0"');
  });

  test('admin event rows have onkeydown handler for Enter/Space', async () => {
    const body = await adminHtml();
    expect(body).toContain('onkeydown=');
    expect(body).toContain("event.key==='Enter'");
    expect(body).toContain("event.key===' '");
  });

  test('admin page has .clickable-row:focus-visible CSS', async () => {
    expect(await adminHtml()).toMatch(/\.clickable-row:focus-visible\s*\{[^}]*outline/);
  });
});

// ─── Additional focus-visible for interactive elements ───────────────────────

describe('A11Y-6: focus-visible on links and form controls', () => {
  test('admin page has .form-link:focus-visible CSS', async () => {
    expect(await adminHtml()).toMatch(/\.form-link:focus-visible\s*\{[^}]*outline/);
  });

  test('poster page has .page-header a:focus-visible CSS', async () => {
    expect(await posterHtml()).toMatch(/\.page-header a:focus-visible\s*\{[^}]*outline/);
  });

  test('poster page has select:focus CSS for event picker', async () => {
    expect(await posterHtml()).toMatch(/\.event-select select:focus\s*\{[^}]*border-color/);
  });
});
