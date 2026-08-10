/**
 * OSE-638 | DESIGN-SEC-1 — CSP nonce + HSTS gate
 *
 * Source-level gates asserting that form-pages.ts:
 *   1. Defines generateNonce() returning a base64 string from crypto.getRandomValues
 *   2. Defines buildSecurityHeaders(nonce) with HSTS and nonce-based CSP
 *   3. CSP script-src uses 'nonce-${nonce}' — NOT 'unsafe-inline'
 *   4. HSTS header is present with max-age=31536000 and includeSubDomains
 *   5. All four form builder functions accept and pass nonce to <script nonce="...">
 *   6. No inline onsubmit, onclick, or ontouchend handlers remain in any form builder
 *   7. formPage() passes nonce to each form builder and to the sponsor <script>
 *   8. handleFormPage() calls generateNonce() and buildSecurityHeaders(nonce)
 */

import { env } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}

function getFormPagesTs(): string {
  const sources: Record<string, string> = JSON.parse(
    (env as unknown as TestEnv).TEST_SOURCE_FILES_JSON
  );
  const entry = Object.entries(sources).find(([p]) =>
    p.replace(/\\/g, '/').endsWith('handlers/form-pages.ts')
  );
  if (!entry) throw new Error('handlers/form-pages.ts not found in TEST_SOURCE_FILES_JSON');
  return entry[1];
}

describe('OSE-638 | DESIGN-SEC-1 | CSP nonce + HSTS gate', () => {
  test('generateNonce is defined using crypto.getRandomValues', () => {
    const src = getFormPagesTs();
    expect(src).toContain('function generateNonce()');
    expect(src).toContain('crypto.getRandomValues');
    expect(src).toContain('btoa(');
  });

  test('buildSecurityHeaders is defined and accepts a nonce parameter', () => {
    const src = getFormPagesTs();
    expect(src).toContain('function buildSecurityHeaders(nonce');
  });

  test('CSP script-src uses nonce — not unsafe-inline', () => {
    const src = getFormPagesTs();
    expect(src).toContain("'nonce-${nonce}'");
    // Must NOT appear in the script-src directive
    const cspLine = src.match(/Content-Security-Policy[^`]*`[^`]*`/s)?.[0] ?? src;
    expect(cspLine).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  test('HSTS header is present with max-age=31536000 and includeSubDomains', () => {
    const src = getFormPagesTs();
    expect(src).toContain('Strict-Transport-Security');
    expect(src).toContain('max-age=31536000');
    expect(src).toContain('includeSubDomains');
  });

  test('registrationForm <script> tag uses nonce attribute', () => {
    const src = getFormPagesTs();
    // Find registrationForm function and assert its <script nonce= pattern
    expect(src).toMatch(/registrationForm[\s\S]{1,5000}<script nonce="\$\{nonce\}"/);
  });

  test('checkinForm <script> tag uses nonce attribute', () => {
    const src = getFormPagesTs();
    expect(src).toMatch(/checkinForm[\s\S]{1,5000}<script nonce="\$\{nonce\}"/);
  });

  test('surveyForm <script> tag uses nonce attribute', () => {
    const src = getFormPagesTs();
    expect(src).toMatch(/surveyForm[\s\S]{1,5000}<script nonce="\$\{nonce\}"/);
  });

  test('emailSignupForm <script> tag uses nonce attribute', () => {
    const src = getFormPagesTs();
    expect(src).toMatch(/emailSignupForm[\s\S]{1,5000}<script nonce="\$\{nonce\}"/);
  });

  test('no inline onsubmit handlers remain in form builder functions', () => {
    const src = getFormPagesTs();
    // Strip the comment block at the top (OSE-R-007 mentions onsubmit in a comment about old behavior)
    // We only care about actual HTML attribute usage — search for onsubmit=" in template literals
    const templateLiterals = src.match(/`[^`]*`/gs) ?? [];
    for (const tpl of templateLiterals) {
      expect(tpl).not.toMatch(/\bonsubmit\s*=/);
    }
  });

  test('no inline onclick handlers remain on form submit elements', () => {
    const src = getFormPagesTs();
    // Rating buttons previously had onclick="setRating(...)" — all moved to addEventListener
    // Look only in template literals (HTML output)
    const templateLiterals = src.match(/`[^`]*`/gs) ?? [];
    for (const tpl of templateLiterals) {
      // onclick is OK on admin-level JS wiring (e.g. admin.html buttons) but should
      // not appear on form page template literals in form-pages.ts
      expect(tpl).not.toMatch(/\bonclick\s*=["'][^"']*setRating/);
      expect(tpl).not.toMatch(/\bonclick\s*=["'][^"']*handleCheckin/);
    }
  });

  test('no inline ontouchend handlers remain in form builders', () => {
    const src = getFormPagesTs();
    const templateLiterals = src.match(/`[^`]*`/gs) ?? [];
    for (const tpl of templateLiterals) {
      expect(tpl).not.toMatch(/\bontouchend\s*=/);
    }
  });

  test('formPage sponsor <script> tag includes nonce attribute', () => {
    const src = getFormPagesTs();
    // The FORM_JS_SPONSOR script tag in formPage() must use nonce
    expect(src).toMatch(/FORM_JS_SPONSOR[\s\S]{0,200}nonce="\$\{nonce\}"|nonce="\$\{nonce\}"[\s\S]{0,200}FORM_JS_SPONSOR/);
  });

  test('handleFormPage calls generateNonce() and buildSecurityHeaders(nonce)', () => {
    const src = getFormPagesTs();
    // Extract the handleFormPage function body and assert both calls are present within it
    const fnIdx = src.indexOf('export async function handleFormPage(');
    expect(fnIdx).toBeGreaterThan(-1);
    const fnBody = src.slice(fnIdx);
    expect(fnBody).toContain('generateNonce()');
    expect(fnBody).toContain('buildSecurityHeaders(nonce)');
  });
});
