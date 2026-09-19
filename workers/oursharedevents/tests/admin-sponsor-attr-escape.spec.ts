import { describe, expect, test } from 'vitest';
import ADMIN_HTML from '../src/templates/admin.html';

// M1 (CCR-PR567): the admin sponsor-row client script's esc() is
// `textContent -> innerHTML`, which escapes & < > but NOT " or '. The sponsor
// NAME (operator-controlled) flows into `aria-label="..."` ATTRIBUTE contexts,
// so a name containing a quote would break out of the attribute. Attribute
// sinks must use a quote-safe escaper (escAttr), mirroring form-pages.ts.
describe('admin sponsor rows escape the name for attribute context (M1)', () => {
  test('a quote-safe escAttr helper is defined in the admin sponsor script', () => {
    expect(ADMIN_HTML).toMatch(/escAttr\s*=\s*s\s*=>/);
  });

  test('the three sponsor aria-labels route the name through escAttr, not the quote-blind esc', () => {
    expect(ADMIN_HTML).toMatch(/aria-label="Edit sponsor '\s*\+\s*escAttr\(s\.name/);
    expect(ADMIN_HTML).toMatch(/aria-label="Get sponsor page link for '\s*\+\s*escAttr\(s\.name/);
    expect(ADMIN_HTML).toMatch(/aria-label="Deactivate sponsor '\s*\+\s*escAttr\(s\.name/);
  });
});
