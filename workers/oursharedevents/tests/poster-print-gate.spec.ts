/**
 * OSE-286 (OSE-R-030) — the poster Print control must be GATED until the QR
 * codes finish loading, so a bar owner cannot print a poster with 4 empty
 * boxes where the scannable codes should be.
 *
 * Layer: API (vitest inspects the rendered poster HTML for the structure +
 * CSS + wiring that implement the gate; the companion FE interaction test —
 * intercept QR endpoint, delay, click Print before resolve — lives in the
 * component tier at tests/e2e/2-pages/poster-print.spec.ts).
 *
 * Format mirrors poster-print-colors.spec.ts:
 *   `OSE-286 | API | <method + path> (<condition>) | <assertion>`.
 *
 * Two complementary moves are locked here (per the ticket):
 *   1. The Print control is a real <button> that STARTS disabled — a
 *      `javascript:window.print()` anchor can neither be disabled nor survive
 *      the nonce CSP (the OSE-R-020 tie-in the ticket bundles in).
 *   2. `@media print` hides the whole `.qr-section` while any `.qr-loading`
 *      placeholder is still in the DOM (defensive: covers Cmd+P bypassing the
 *      disabled button). The pre-fix rule only hid `.qr-loading` itself, so the
 *      parent `.qr-item`/`.qr-card` printed as empty labeled boxes.
 */

import { describe, test, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

async function fetchPosterHtml(): Promise<string> {
  const res = await SELF.fetch('https://test.local/poster', {
    headers: { Accept: 'text/html' },
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type') ?? '').toContain('text/html');
  return res.text();
}

// Pull the print control element (the tag carrying data-testid="poster-print")
// so assertions can inspect the element itself, not just the whole document.
function extractPrintControl(html: string): string {
  const match = html.match(/<(a|button)\b[^>]*data-testid="poster-print"[^>]*>/);
  expect(match, 'poster HTML must contain a data-testid="poster-print" control').toBeTruthy();
  return match![0];
}

function extractPrintBlock(html: string): string {
  const match = html.match(/@media\s+print\s*\{([\s\S]*?)\}\s*<\/style>/);
  expect(match, 'poster HTML must contain an @media print block').toBeTruthy();
  return match![1];
}

describe('OSE-286 poster Print gate — API layer', () => {
  test('OSE-286 | API | GET /poster (any visitor) | Print control is a <button>, not an anchor', async () => {
    const html = await fetchPosterHtml();
    const control = extractPrintControl(html);
    expect(control.startsWith('<button')).toBe(true);
  });

  test('OSE-286 | API | GET /poster (any visitor) | Print control carries no javascript: URI (OSE-R-020 tie-in)', async () => {
    const html = await fetchPosterHtml();
    const control = extractPrintControl(html);
    // A javascript: href is both undisableable and CSP-blocked under the
    // nonce policy. It must be gone from the print control.
    expect(control).not.toMatch(/href\s*=\s*["']javascript:/i);
  });

  test('OSE-286 | API | GET /poster (any visitor) | Print button STARTS disabled', async () => {
    const html = await fetchPosterHtml();
    const control = extractPrintControl(html);
    // The button element must render with the boolean `disabled` attribute so
    // it is inert before any QR has loaded (AC: "button starts disabled").
    expect(control).toMatch(/\sdisabled(\s|>|=)/);
  });

  test('AS-8 | API | GET /poster (any visitor) | Print button has an aria-label for screen readers', async () => {
    const html = await fetchPosterHtml();
    const control = extractPrintControl(html);
    // AS-8: the print control must expose a clean accessible name. Its visible
    // label is an emoji + "Print"; the printer emoji pollutes the announced
    // name, so an explicit aria-label is the screen-reader label (the emoji is
    // additionally wrapped in aria-hidden). Locks the label against regression.
    expect(control).toMatch(/aria-label="[^"]+"/);
  });

  test('OSE-286 | API | GET /poster (any visitor) | a loading status region sits beside the button', async () => {
    const html = await fetchPosterHtml();
    expect(html).toMatch(/data-testid="poster-print-status"/);
  });

  test('OSE-286 | API | GET /poster (any visitor) | @media print hides .qr-section while a .qr-loading placeholder remains', async () => {
    const html = await fetchPosterHtml();
    const printBlock = extractPrintBlock(html);
    // Defensive move: whole section vanishes on paper if any QR is still a
    // placeholder — no empty labeled boxes. Uses :has(.qr-loading).
    expect(printBlock).toMatch(/\.qr-section:has\(\s*\.qr-loading\s*\)\s*\{[^}]*display:\s*none/);
  });

  test('OSE-286 | API | GET /poster (any visitor) | the .qr-loading placeholder is still hidden in print (OSE-R-006 preserved)', async () => {
    const html = await fetchPosterHtml();
    const printBlock = extractPrintBlock(html);
    expect(printBlock).toMatch(/\.qr-loading\s*\{[^}]*display:\s*none\s*!important/);
  });

  test('OSE-286 | API | GET /poster (any visitor) | the gate is wired: script re-enables Print after QR settle and calls window.print()', async () => {
    const html = await fetchPosterHtml();
    // The gating helpers must be present in the served script so the button
    // toggles with the QR lifecycle rather than being permanently inert.
    expect(html).toMatch(/setPrintReady/);
    expect(html).toMatch(/window\.print\(\)/);
  });
});
