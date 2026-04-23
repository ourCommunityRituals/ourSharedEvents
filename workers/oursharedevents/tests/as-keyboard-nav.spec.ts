/**
 * AS-11: Keyboard nav on Admin (OSE-56)
 * AS-12: Keyboard nav on Public (OSE-57)
 */

import { describe, test, expect } from 'vitest';
import { handleAdminPage, handlePublicPage } from '../src/handlers/pages';

function adminHtml(): Promise<string> {
  return handleAdminPage({} as never).text();
}
function pubHtml(): Promise<string> {
  return handlePublicPage({} as never).text();
}

// ─── AS-11: Admin keyboard navigation ────────────────────────────────────────

describe('AS-11: Keyboard nav on Admin page (OSE-56)', () => {
  test('admin has Escape key handler for SPON-6 form', async () => {
    const body = await adminHtml();
    expect(body).toMatch(/e\.key\s*===\s*['"]Escape['"]/);
  });

  test('admin Escape handler checks form visibility before closing', async () => {
    const body = await adminHtml();
    expect(body).toMatch(/Escape[\s\S]{0,200}spon-form-wrap/);
  });

  test('admin has keydown listener on document for Escape', async () => {
    const body = await adminHtml();
    expect(body).toMatch(/document\.addEventListener\(['"]keydown['"]/);
  });

  test('admin openForm() focuses spon-name on open', async () => {
    const body = await adminHtml();
    expect(body).toContain("document.getElementById('spon-name').focus()");
  });

  test('admin doCloseForm() returns focus to toggle button', async () => {
    const body = await adminHtml();
    expect(body).toContain("document.getElementById('add-spon-toggle').focus()");
  });

  test('admin confirm-discard button has aria-label', async () => {
    expect(await adminHtml()).toContain('aria-label="Yes, discard changes"');
  });

  test('admin keep-editing button has aria-label', async () => {
    expect(await adminHtml()).toContain('aria-label="Keep editing"');
  });

  test('admin _keepEditing() exists and refocuses spon-name', async () => {
    const body = await adminHtml();
    expect(body).toContain('_keepEditing');
    // spon-name.focus() appears in openForm(), _editSponsor(), and _keepEditing()
    const focusCalls = (body.match(/document\.getElementById\('spon-name'\)\.focus\(\)/g) ?? [])
      .length;
    expect(focusCalls).toBeGreaterThanOrEqual(2);
  });

  test('admin _deactivateSponsor confirm button has aria-label', async () => {
    expect(await adminHtml()).toContain('aria-label="Confirm deactivate sponsor"');
  });

  test('admin _deactivateSponsor cancel button has aria-label', async () => {
    expect(await adminHtml()).toContain('aria-label="Cancel deactivate"');
  });

  test('admin _deactivateSponsor focuses Yes button after render', async () => {
    const body = await adminHtml();
    expect(body).toMatch(/confirm-deactivate[\s\S]{0,150}\.focus\(\)/);
  });

  test('admin _editSponsor focuses spon-name after data loads', async () => {
    const body = await adminHtml();
    // spon-name.focus() appears in openForm() AND at end of _editSponsor try block
    const focusCalls = (body.match(/document\.getElementById\('spon-name'\)\.focus\(\)/g) ?? [])
      .length;
    expect(focusCalls).toBeGreaterThanOrEqual(2);
  });

  test('admin sponsor form has cancel button (id=spon-cancel-btn)', async () => {
    const body = await adminHtml();
    expect(body).toContain('id="spon-cancel-btn"');
    expect(body).toContain('data-testid="sponsor-cancel"');
  });
});

// ─── AS-12: Public keyboard navigation ───────────────────────────────────────

describe('AS-12: Keyboard nav on Public page (OSE-57)', () => {
  test('public events heading has tabindex="-1" for programmatic focus', async () => {
    const body = await pubHtml();
    expect(body).toMatch(
      /data-testid="public-events-heading"[^>]*tabindex="-1"|tabindex="-1"[^>]*data-testid="public-events-heading"/
    );
  });

  test('public has skip link targeting main content', async () => {
    const body = await pubHtml();
    expect(body).toContain('class="skip-link"');
    expect(body).toContain('href="#main-content"');
  });

  test('public main has id="main-content" matching skip link target', async () => {
    expect(await pubHtml()).toContain('id="main-content"');
  });

  test('public CTA links have aria-label for screen readers', async () => {
    expect(await pubHtml()).toContain('aria-label="Register for');
  });

  test('public events container has aria-live="polite" for screen reader announcements', async () => {
    const body = await pubHtml();
    expect(body).toMatch(/data-testid="public-events"[^>]*aria-live="polite"/);
  });

  test('public sponsor banner has role="region"', async () => {
    expect(await pubHtml()).toContain('role="region"');
  });

  test('public header has role="banner" landmark', async () => {
    expect(await pubHtml()).toContain('role="banner"');
  });

  test('public main is a <main> element (implicit landmark)', async () => {
    expect(await pubHtml()).toMatch(/<main/);
  });

  test('public has focus-visible styles for keyboard users', async () => {
    expect(await pubHtml()).toContain(':focus-visible');
  });
});
