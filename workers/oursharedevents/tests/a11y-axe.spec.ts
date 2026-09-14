/**
 * A11Y-7: axe-core WCAG 2.0 AA scan — all page variants
 *
 * Runs in jsdom environment (vitest.config.a11y.mts) — NOT the CF Workers pool.
 * Scans every page handler's HTML output for critical/serious WCAG violations.
 * Zero critical or serious violations required to pass.
 */

import { describe, test, expect } from 'vitest';
import axe from 'axe-core';
import {
  handleAdminPage,
  handleSharedReportPage,
  handlePosterPage,
  handlePublicPage,
  handleLandingPage,
} from '../src/handlers/pages';
import { handleFormPage } from '../src/handlers/form-pages';

async function axeScan(html: string): Promise<axe.Result[]> {
  document.open();
  document.write(html);
  document.close();
  const results = await axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
  });
  return results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
}

function formReq(type: string): Request {
  return new Request(`https://t.test/forms/evt1?type=${type}&event=Test+Event`);
}

async function scanPage(name: string, html: string): Promise<void> {
  const violations = await axeScan(html);
  // Exactly-one-<h1> gate. axe's wcag2a/wcag2aa tags do NOT include the
  // page-has-heading-one rule (it lives in best-practice), so a page with NO
  // page-level heading passes axe while failing real screen-reader/SEO needs —
  // that is exactly how the OSE-1312 landing shipped with zero <h1>. Every
  // served surface must have precisely one page-level heading; assert it here so
  // the axe scan can't be green on a headingless page.
  const h1Count = document.querySelectorAll('h1').length;
  expect(h1Count, `${name} must have exactly one <h1> (found ${h1Count})`).toBe(1);
  if (violations.length > 0) {
    const summary = violations.map((v) => `  [${v.impact}] ${v.id}: ${v.description}`).join('\n');
    expect.fail(`${name} has ${violations.length} critical/serious violation(s):\n${summary}`);
  }
  expect(violations).toHaveLength(0);
}

describe('A11Y-7: axe-core WCAG 2.0 AA — zero critical/serious violations', () => {
  test('admin page', async () => {
    await scanPage('Admin page', await handleAdminPage({} as never).text());
  });

  test('shared report page', async () => {
    await scanPage(
      'Shared report page',
      await handleSharedReportPage({} as never).then((r) => r.text())
    );
  });

  test('poster page', async () => {
    await scanPage('Poster page', await handlePosterPage({} as never).then((r) => r.text()));
  });

  test('public listing page', async () => {
    await scanPage(
      'Public listing page',
      await handlePublicPage({} as never).then((r) => r.text())
    );
  });

  test('landing page', async () => {
    // handleLandingPage is async as of OSE-1312 slice-2 (data-driven area view) —
    // await the Response, then read it, like the other async handlers above.
    await scanPage('Landing page', await handleLandingPage({} as never).then((r) => r.text()));
  });

  test('register form', async () => {
    await scanPage(
      'Register form',
      await (await handleFormPage(formReq('register'), {} as never, 'evt1')).text()
    );
  });

  test('checkin form', async () => {
    await scanPage(
      'Checkin form',
      await (await handleFormPage(formReq('checkin'), {} as never, 'evt1')).text()
    );
  });

  test('survey form', async () => {
    await scanPage(
      'Survey form',
      await (await handleFormPage(formReq('survey'), {} as never, 'evt1')).text()
    );
  });

  test('email signup form', async () => {
    await scanPage(
      'Email form',
      await (await handleFormPage(formReq('email'), {} as never, 'evt1')).text()
    );
  });
});
