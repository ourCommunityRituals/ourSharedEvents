/**
 * OSE-626 / INT-09 — email-signup type dispatch in form-pages.ts.
 *
 * CRITICAL BUG (silent data-collection failure): poster-bundle.ts emits form
 * URLs with `?type=email-signup`, but the formPage() switch only mapped
 * `case 'email'` to emailSignupForm(). Any `email-signup` QR fell through the
 * default case to the REGISTRATION form — so every printed email-signup poster
 * silently collected registration data (name) instead of email signups.
 *
 * The fix adds `case 'email-signup'` alongside `case 'email'`. These functional
 * tests drive handleFormPage directly (no DB binding required — an unknown
 * event falls back to the generic "Event" label) and assert the rendered markup
 * is the email-signup form, not registration.
 */

import { describe, test, expect } from 'vitest';
import { handleFormPage } from '../src/handlers/form-pages';

function renderFormPage(type?: string, extra = ''): Promise<Response> {
  const q = type ? `?type=${type}${extra}` : extra ? `?${extra.replace(/^&/, '')}` : '';
  const req = new Request(`https://t.test/forms/evt_dispatch${q}`);
  // Empty env → no DB → canonical title falls back to "Event". Enough to
  // exercise the form-type switch, which is the unit under test.
  return handleFormPage(req, {}, 'evt_dispatch');
}

const EMAIL_MARKER = 'data-testid="form-email"';
const REGISTER_MARKER = 'data-testid="form-register"';

describe('OSE-626 | email-signup type dispatch', () => {
  test('?type=email-signup renders the email signup form, NOT registration', async () => {
    const html = await (await renderFormPage('email-signup')).text();
    expect(html).toContain(EMAIL_MARKER);
    expect(html).not.toContain(REGISTER_MARKER);
    // The submit handler must POST to the email-signup endpoint.
    expect(html).toContain("'email-signup'");
  });

  test('?type=email still renders the email signup form (backward compatibility)', async () => {
    const html = await (await renderFormPage('email')).text();
    expect(html).toContain(EMAIL_MARKER);
    expect(html).not.toContain(REGISTER_MARKER);
  });

  test('no type param falls back to the registration form (default preserved)', async () => {
    const html = await (await renderFormPage()).text();
    expect(html).toContain(REGISTER_MARKER);
    expect(html).not.toContain(EMAIL_MARKER);
  });

  test('an unrelated type still falls back to registration (default case intact)', async () => {
    const html = await (await renderFormPage('nonsense-type')).text();
    expect(html).toContain(REGISTER_MARKER);
  });
});
