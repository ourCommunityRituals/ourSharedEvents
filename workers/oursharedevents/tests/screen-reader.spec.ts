/**
 * A11Y-8: Screen reader testing & polish
 *
 * Verifies ARIA patterns that axe-core doesn't catch statically:
 *   - aria-describedby links inputs to their error message container
 *   - Survey rating buttons have explicit aria-label values
 *   - Advanced-metrics section title is a proper h2 (heading hierarchy)
 *   - Loading state has role="status" for polite announcements
 *   - aria-required on required inputs
 */

import { describe, test, expect } from 'vitest';
import { handleSharedReportPage } from '../src/handlers/pages';
import { handleFormPage } from '../src/handlers/form-pages';

function reportHtml(): Promise<string> {
  return handleSharedReportPage({} as never).then((r) => r.text());
}
async function formHtml(type: string): Promise<string> {
  const req = new Request(`https://t.test/forms/evt1?type=${type}&event=Test`);
  return (await handleFormPage(req, {} as never, 'evt1')).text();
}

// ─── aria-describedby — inputs linked to error container ─────────────────────

describe('A11Y-8: aria-describedby links inputs to error message', () => {
  test('register name input has aria-describedby="error-msg"', async () => {
    const html = await formHtml('register');
    expect(html).toMatch(/id="name"[^>]*aria-describedby="error-msg"/);
  });

  test('register email input has aria-describedby="error-msg"', async () => {
    const html = await formHtml('register');
    // The optional email also points at its one-line note (owner 2026-10-11);
    // the error message must still be one of the ids it names.
    expect(html).toMatch(/id="email"[^>]*aria-describedby="(?:[^"]* )?error-msg(?: [^"]*)?"/);
  });

  test('survey textarea has aria-describedby="error-msg"', async () => {
    const html = await formHtml('survey');
    expect(html).toMatch(/id="comments"[^>]*aria-describedby="error-msg"/);
  });

  test('email signup input has aria-describedby="error-msg"', async () => {
    const html = await formHtml('email');
    expect(html).toMatch(/id="email"[^>]*aria-describedby="error-msg"/);
  });
});

// ─── Rating buttons: explicit aria-label ─────────────────────────────────────

describe('A11Y-8: survey rating buttons have aria-label', () => {
  test('rating-1 has aria-label="Rate 1 out of 5"', async () => {
    const html = await formHtml('survey');
    expect(html).toContain('aria-label="Rate 1 out of 5"');
  });

  test('rating-2 has aria-label="Rate 2 out of 5"', async () => {
    expect(await formHtml('survey')).toContain('aria-label="Rate 2 out of 5"');
  });

  test('rating-3 has aria-label="Rate 3 out of 5"', async () => {
    expect(await formHtml('survey')).toContain('aria-label="Rate 3 out of 5"');
  });

  test('rating-4 has aria-label="Rate 4 out of 5"', async () => {
    expect(await formHtml('survey')).toContain('aria-label="Rate 4 out of 5"');
  });

  test('rating-5 has aria-label="Rate 5 out of 5"', async () => {
    expect(await formHtml('survey')).toContain('aria-label="Rate 5 out of 5"');
  });
});

// ─── Heading hierarchy: advanced-metrics section title is h2 ─────────────────

describe('A11Y-8: shared report heading hierarchy', () => {
  test('advanced-metrics section title is an h2 element', async () => {
    const html = await reportHtml();
    expect(html).toMatch(/<h2[^>]*id="section-advanced-metrics"/);
  });

  test('existing section titles are h2 elements', async () => {
    const html = await reportHtml();
    expect(html).toMatch(/<h2[^>]*id="section-stats"/);
    expect(html).toMatch(/<h2[^>]*id="section-events"/);
    expect(html).toMatch(/<h2[^>]*id="section-sponsors"/);
  });
});

// ─── Loading state announcement ───────────────────────────────────────────────

describe('A11Y-8: loading state has role=status for polite SR announcement', () => {
  test('advanced-metrics loading paragraph has role="status"', async () => {
    const html = await reportHtml();
    expect(html).toMatch(/class="loading"[^>]*role="status"/);
  });

  test('advanced-metrics loading paragraph has aria-live="polite"', async () => {
    const html = await reportHtml();
    expect(html).toMatch(/class="loading"[^>]*aria-live="polite"/);
  });
});

// ─── aria-required on required form inputs ────────────────────────────────────

describe('A11Y-8: required inputs have aria-required="true"', () => {
  test('register name input has aria-required="true"', async () => {
    const html = await formHtml('register');
    expect(html).toMatch(/id="name"[^>]*aria-required="true"/);
  });

  test('email signup input has aria-required="true"', async () => {
    const html = await formHtml('email');
    expect(html).toMatch(/id="email"[^>]*aria-required="true"/);
  });
});

// ─── Regression: existing ARIA from A11Y-2 still intact ──────────────────────

describe('A11Y-8: A11Y-2 ARIA patterns still intact', () => {
  test('form error elements still have role="alert" aria-live="assertive"', async () => {
    for (const type of ['register', 'checkin', 'survey', 'email']) {
      const html = await formHtml(type);
      expect(html).toContain('role="alert" aria-live="assertive"');
    }
  });

  test('survey rating group still has role="group" aria-labelledby', async () => {
    const html = await formHtml('survey');
    expect(html).toContain('role="group" aria-labelledby="rating-label"');
  });
});
