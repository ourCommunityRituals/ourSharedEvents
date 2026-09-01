#!/usr/bin/env node
/**
 * Generate web/shared/testids.js and postman/environments/testids.json from the
 * surface templates.
 *
 * The registry is DERIVED, never authored. That is the property that makes it
 * trustworthy: it cannot claim an id the app does not emit, because its only
 * input is the markup that emits them.
 *
 * Two outputs, because the two consumers cannot share one file:
 *   - web/shared/testids.js       native-JS module. Playwright and browser code import it.
 *   - postman/environments/testids.json
 *                                 Postman scripts run sandboxed with no module
 *                                 resolution (verified: no require() anywhere in
 *                                 postman/collections/), so Newman reads the same
 *                                 registry as {{testid_admin_header}} instead.
 *
 * Dynamically-built ids — `data-testid="row-' + id + '"` — are deliberately
 * EXCLUDED. A registry entry has to be a literal the app definitely emits; a
 * concatenated prefix is not one, and listing it would put an id in the registry
 * that t() would happily accept while nothing ever renders it.
 *
 * Usage:  node scripts/gen-testids.mjs [--check]
 *   --check  exit 1 if the committed files are stale (for CI)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TPL = join(ROOT, 'workers', 'oursharedevents', 'src', 'templates');
const SURFACES = ['admin', 'public', 'display', 'poster', 'shared-report'];
const REG_OUT = join(ROOT, 'web', 'shared', 'testids.js');
const ENV_OUT = join(ROOT, 'postman', 'environments', 'testids.json');

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
 *     381 test-ids emitted · 101 used by Playwright · 2 used by Newman
 *     280 (73%) used by NEITHER — instrumentation nobody consumes.
 *   Drift ran in both directions and only one was gated: the Playwright
 *   baseline carries 51 referenced-but-unemitted ids, and Newman referenced
 *   four (error-header, error-title, signin-cta, signin-request-access)
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
 * NEWMAN CANNOT IMPORT THIS FILE.
 *   Postman scripts are sandboxed with no module resolution — verified: no
 *   require() appears anywhere in postman/collections/. The bridge is a
 *   generated environment, postman/environments/testids.json, so Newman reads
 *   the same registry as {{testid_admin_header}}.
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

function renderEnv(reg) {
  const values = Object.entries(reg).flatMap(([, ids]) =>
    ids.map((id) => ({ key: `testid_${id.replace(/-/g, '_')}`, value: id, type: 'default', enabled: true }))
  );
  return `${JSON.stringify(
    {
      id: 'ocr-testids',
      name: 'OSE test-ids (generated)',
      _postman_comment:
        'GENERATED by scripts/gen-testids.mjs from the surface templates. Do not hand-edit. ' +
        'Postman scripts cannot import the native-JS registry (sandbox, no module resolution), ' +
        'so the same ids arrive here as variables: {{testid_admin_header}}.',
      values,
      _postman_variable_scope: 'environment',
    },
    null,
    2
  )}\n`;
}

const reg = scan();
const nextReg = renderRegistry(reg);
const nextEnv = renderEnv(reg);
const check = process.argv.includes('--check');

if (check) {
  const stale = [];
  const norm = (s) => s.replace(/Generated \d{4}-\d{2}-\d{2}/, '');
  if (!existsSync(REG_OUT) || norm(readFileSync(REG_OUT, 'utf8')) !== norm(nextReg)) stale.push(REG_OUT);
  if (!existsSync(ENV_OUT) || readFileSync(ENV_OUT, 'utf8') !== nextEnv) stale.push(ENV_OUT);
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

mkdirSync(dirname(ENV_OUT), { recursive: true });
writeFileSync(REG_OUT, nextReg);
writeFileSync(ENV_OUT, nextEnv);
const total = Object.values(reg).reduce((a, v) => a + v.length, 0);
console.log(`[testids] wrote ${total} ids → ${REG_OUT} and ${ENV_OUT}`);
