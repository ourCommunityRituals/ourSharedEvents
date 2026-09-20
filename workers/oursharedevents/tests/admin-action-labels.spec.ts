/**
 * A11Y (WCAG 4.1.2 Name, Role, Value) — repeated admin action buttons carry an
 * accessible name with context.
 *
 * The sponsor table and poster-deployment cards render rows of short-text
 * buttons ("Edit", "Deactivate", "Delete", "Copy"). Without an aria-label a
 * screen reader announces "Edit button" identically on every row, so the user
 * can't tell which sponsor / deployment they're acting on. These assert the
 * context labels are present in the rendered admin source.
 */
import { describe, test, expect } from 'vitest';
import { handleAdminPage } from '../src/handlers/pages';

function adminHtml(): Promise<string> {
  return handleAdminPage({} as never).text();
}

describe('admin repeated action buttons have contextual aria-labels', () => {
  test('sponsor Edit button names the sponsor', async () => {
    const body = await adminHtml();
    expect(body).toMatch(/data-action="sponsor-edit"[\s\S]{0,120}aria-label="Edit sponsor /);
  });

  test('sponsor Deactivate button names the sponsor', async () => {
    const body = await adminHtml();
    expect(body).toMatch(
      /data-action="sponsor-deactivate"[\s\S]{0,120}aria-label="Deactivate sponsor /
    );
  });

  test('the Shared Report mint Copy button says what it copies', async () => {
    // OSE-1342: the mint-link Copy button now copies the full signed report
    // URL (not just the bearer token), so its label must say "report link".
    expect(await adminHtml()).toContain('aria-label="Copy report link"');
  });

  test('the poster-deployment Delete button matches its Download/Print siblings', async () => {
    const body = await adminHtml();
    expect(body).toMatch(/data-testid="pd-delete-btn"[\s\S]{0,120}aria-label="Delete poster QR"/);
  });
});
