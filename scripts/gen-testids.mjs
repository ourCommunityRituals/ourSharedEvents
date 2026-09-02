#!/usr/bin/env node
/**
 * Generate web/shared/testids.js from the surface templates.
 *
 * The registry is DERIVED, never authored. That is the property that makes it
 * trustworthy: it cannot claim an id the app does not emit, because its only
 * input is the markup that emits them.
 *
 * One output:
 *   - web/shared/testids.js       native-JS module. Playwright and browser code import it.
 *
 * (OSE-1191: the second output — postman/environments/testids.json, a Newman
 * bridge exposing ids as {{testid_admin_header}} — was retired with the
 * Postman→Bruno migration. Bruno's converted assertions inline the ids as
 * literals (expect(body).to.include('data-testid="admin-header"')), so no
 * variable bridge is needed; the postman/ collections + environments are gone.)
 *
 * Dynamically-built ids — `data-testid="row-' + id + '"` — are deliberately
 * EXCLUDED. A registry entry has to be a literal the app definitely emits; a
 * concatenated prefix is not one, and listing it would put an id in the registry
 * that t() would happily accept while nothing ever renders it.
 *
 * Usage:  node scripts/gen-testids.mjs [--check]
 *   --check  exit 1 if the committed files are stale (for CI)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TPL = join(ROOT, 'workers', 'oursharedevents', 'src', 'templates');
const SURFACES = ['admin', 'public', 'display', 'poster', 'shared-report'];
const REG_OUT = join(ROOT, 'web', 'shared', 'testids.js');

// Literal ids only: no {, }, or + inside the quotes.
const LITERAL = /data-testid="([^"{}+]+)"/g;

export function scan() {
  const reg = {};
  for (const s of SURFACES) {
    const f = join(TPL, `${s}.html`);
    if (!existsSync(f)) continue;
    const src = readFileSync(f, 'utf8');
    reg[s] = [...new Set([...src.matchAll(LITERAL)].map((m) => m[1]))].sort();
  }
  return reg;
}

function renderRegistry(reg) {
  const total = Object.values(reg).reduce((a, v) => a + v.length, 0);
  const body = Object.entries(reg)
    .map(([s, ids]) => {
      const key = s.replace(/-/g, '_').toUpperCase();
      return `    // ${s}.html — ${ids.length} ids\n    ${key}: Object.freeze([\n${ids
        .map((i) => `      '${i}',`)
        .join('\n')}\n    ]),`;
    })
    .join('\n');

  return `/**
 * TEST-ID REGISTRY — the single source of truth for data-testid values.
 *
 * UMD, matching the house style in web/shared/ (see apiClient.js): an IIFE that
 * attaches to globalThis, with a CommonJS export when one is available. No
 * React, no Tailwind, no bundler, no dependency, no build step — a browser
 * <script>, a Node script, a vitest suite and a Playwright spec all read the
 * same file.
 *
 * WHY THIS EXISTS
 *   Measured against the five surface templates on 2026-09-01:
 *     381 test-ids emitted · 101 used by Playwright · 2 used by the contract suite
 *     280 (73%) used by NEITHER — instrumentation nobody consumes.
 *   Drift ran in both directions and only one was gated: the Playwright
 *   baseline carries 51 referenced-but-unemitted ids, and the contract suite
 *   referenced four (error-header, error-title, signin-cta, signin-request-access)
 *   emitted nowhere, with nothing checking it.
 *
 *   A string literal in a spec cannot fail when the element it names is
 *   renamed. A t() call can, because every id resolves against this registry.
 *
 * ADOPTION IS ZERO-CHURN
 *   t() takes the SAME string a spec already passes, so migration is one
 *   selector at a time:
 *     page.getByTestId('admin-header')        // before
 *     page.getByTestId(T.t('admin-header'))   // after — now fails on a typo
 *
 * CONTRACT LAYER (Bruno).
 *   The API/pages contract suite lives in bruno/ (OSE-1191, ex-Newman). Its
 *   converted assertions reference test-ids as inlined string literals
 *   (expect(body).to.include('data-testid="admin-header"')), so no generated
 *   variable bridge is needed — Bruno reads no environment file from here.
 *
 * GENERATED, NOT AUTHORED — node scripts/gen-testids.mjs
 *   Derived from the templates, so it can never claim an id the app does not
 *   emit. Dynamically-built ids (\`data-testid="row-' + id + '"\`) are excluded
 *   on purpose: t() would accept one while nothing ever renders it.
 * Generated ${new Date().toISOString().slice(0, 10)} — ${total} ids.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OCR_TESTID = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const TESTID = Object.freeze({
${body}
  });

  const ALL_TESTIDS = Object.freeze(Object.values(TESTID).flatMap((ids) => [...ids]));
  const INDEX = new Set(ALL_TESTIDS);

  /**
   * Resolve a test-id, throwing if the app does not emit it. That is the whole
   * point: a typo or a renamed element fails loudly at the call site instead of
   * silently matching nothing and passing as an absent element.
   */
  function t(id) {
    if (!INDEX.has(id)) {
      throw new Error(
        'unknown test-id "' + id + '" — not emitted by any surface template. ' +
          'Either the element was renamed (update the caller), or the id is ' +
          'aspirational (add it to the template, then regenerate the registry).'
      );
    }
    return id;
  }

  /** True when the app emits this id. Non-throwing, for audits and reporting. */
  function isKnownTestId(id) {
    return INDEX.has(id);
  }

  return { TESTID, ALL_TESTIDS, t, isKnownTestId };
});
`;
}

const reg = scan();
const nextReg = renderRegistry(reg);
const check = process.argv.includes('--check');

if (check) {
  const stale = [];
  const norm = (s) => s.replace(/Generated \d{4}-\d{2}-\d{2}/, '');
  if (!existsSync(REG_OUT) || norm(readFileSync(REG_OUT, 'utf8')) !== norm(nextReg)) stale.push(REG_OUT);
  if (stale.length) {
    console.error(
      `[testids] STALE — a template changed but the registry was not regenerated:\n` +
        stale.map((f) => `  - ${f}`).join('\n') +
        `\nRun: node scripts/gen-testids.mjs`
    );
    process.exit(1);
  }
  console.log('[testids] registry matches the templates.');
  process.exit(0);
}

writeFileSync(REG_OUT, nextReg);
const total = Object.values(reg).reduce((a, v) => a + v.length, 0);
console.log(`[testids] wrote ${total} ids → ${REG_OUT}`);
