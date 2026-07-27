/**
 * INVARIANT 6: Inert Monetization Hooks
 *
 * Every HTTP response from the OSE worker must carry the header:
 *   X-Monetization-Inert: true
 *
 * This asserts that no billing logic executed during the request.
 * OSE is pre-revenue by contract, not by choice. The header is the
 * machine-readable evidence of that contract on every response.
 *
 * Brain Invariant #6 (inert_monetization_hooks):
 *   - status: partial (wired to T0 from 2026-07-26; flips to live once
 *     the full story-f4 contract test suite ships with the header assertion)
 *   - brain canonical: OCR-docs/ocr-docs-brain/architectural-invariants.yaml
 *   - research_note: this invariant is the reason research data can be
 *     collected cleanly before revenue activation
 *
 * Pyramid coverage for this invariant:
 *   L0 STATIC (this file)     — code shape: X-Monetization-Inert is set
 *                               at the index.ts fetch() wrapper; no billing
 *                               constants or charge-per-request patterns exist
 *   L1 IN-PROCESS (T0)        — testid-pyramid.spec.ts asserts the header
 *                               appears in real responses (added 2026-07-26)
 *   T3/T4 (planned)           — story-f4-monetization-hooks contract test
 *                               against staging
 *
 * What this invariant catches:
 *   - Someone removes the patched-response block from index.ts fetch()
 *     → CI fails (regex misses) → header disappears from every response
 *     without a test catching it
 *   - Someone adds billing-like patterns (charge, bill, stripe, billable_units
 *     write path) to the worker source → L0 catch prevents silent activation
 *   - The patched response must use new Response(response.body, response)
 *     pattern — not a manual Header copy that could miss headers from handlers
 *
 * Pattern reference: aggregate-only.invariant.spec.ts (same readFileSync
 * L0 structural approach using Playwright with Node fs access).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const INDEX_PATH = join(REPO_ROOT, 'workers', 'oursharedevents', 'src', 'index.ts');

test.describe('Invariant 6: Inert Monetization Hooks — structural code-shape lock', () => {
  test('OSE-INV6 | commercial | existence | src/index.ts exists (entry point)', () => {
    expect(
      existsSync(INDEX_PATH),
      'workers/oursharedevents/src/index.ts must exist — it is the entry point that wraps all responses'
    ).toBe(true);
  });

  test('OSE-INV6 | commercial | header | X-Monetization-Inert header is set on every response', () => {
    const src = readFileSync(INDEX_PATH, 'utf8');
    // The fetch() handler must explicitly set the X-Monetization-Inert header.
    // The canonical implementation uses new Response(response.body, response)
    // to clone the response and then patches the header.
    expect(
      src,
      'index.ts fetch() must set X-Monetization-Inert header on every response — ' +
        'removing this means the monetization-inert contract is asserted nowhere'
    ).toMatch(/X-Monetization-Inert/);

    expect(
      src,
      'X-Monetization-Inert must be set to "true" — any other value breaks the contract'
    ).toMatch(/X-Monetization-Inert.*true/);
  });

  test('OSE-INV6 | commercial | wrapper | response patching uses new Response(response.body, response)', () => {
    const src = readFileSync(INDEX_PATH, 'utf8');
    // The patching pattern must copy the full response (status, headers, body)
    // via new Response(body, init) — this ensures all handler-set headers survive.
    // A naive approach (e.g., only copying selected headers) could silently drop
    // critical headers like Cache-Control, Content-Type, or Set-Cookie.
    expect(
      src,
      'fetch() must clone the response via new Response(response.body, response) before patching — ' +
        'directly mutating handler responses would break the read-only headers guarantee'
    ).toMatch(/new\s+Response\s*\(\s*response\.body\s*,\s*response\s*\)/);
  });

  test('OSE-INV6 | commercial | inert | no Stripe, billing, or charge-per-request patterns in src/', () => {
    // This is a future-proofing gate. If any file in src/ introduces billing
    // primitives (Stripe SDK calls, charge_customer(), billable_units write
    // paths), it would violate the pre-revenue contract. The header asserts
    // the contract at runtime; this test asserts it at code-shape level.
    // Note: 'billable' as a READ reference is OK (reading a unit count for
    // reporting). Only write patterns (charge, bill, debit, pay) are forbidden.
    const srcDir = join(REPO_ROOT, 'workers', 'oursharedevents', 'src');
    const { readdirSync } = require('node:fs');

    function walkTs(dir: string): string[] {
      const files: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) files.push(...walkTs(full));
        else if (entry.name.endsWith('.ts')) files.push(full);
      }
      return files;
    }

    const BILLING_PATTERNS = [
      /stripe\.(charge|createPaymentIntent|confirmPayment)/i,
      /charge_customer\s*\(/i,
      /createInvoice\s*\(/i,
      /processPayment\s*\(/i,
      /\.debit\s*\(/i,
    ];

    const tsFiles = walkTs(srcDir);
    for (const filePath of tsFiles) {
      const content = readFileSync(filePath, 'utf8');
      const relPath = filePath.replace(REPO_ROOT + '\\', '').replace(/\\/g, '/');
      for (const pattern of BILLING_PATTERNS) {
        expect
          .soft(
            pattern.test(content),
            `Billing pattern found in ${relPath}: ${pattern} — violates pre-revenue contract (Invariant #6)`
          )
          .toBe(false);
      }
    }
  });

  test('OSE-INV6 | commercial | inert | fetch() handler wraps both success and error response paths', () => {
    const src = readFileSync(INDEX_PATH, 'utf8');
    // The patching must happen AFTER both the try (success) and catch (error)
    // branches. If it only patches the success path, 500 error responses would
    // lack the header — which could be interpreted as "error = billing active"
    // by observability tooling.
    //
    // Structural signal: the `let response` assignment pattern means both
    // branches assign to the same variable, and the patch runs once after both.
    expect(
      src,
      'fetch() should use a single let response variable to capture both try+catch paths — ' +
        'ensures X-Monetization-Inert is set on errors too'
    ).toMatch(/let\s+response\s*:\s*Response/);
  });
});
