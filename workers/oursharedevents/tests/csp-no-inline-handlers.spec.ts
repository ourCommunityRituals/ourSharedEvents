/**
 * No inline event handlers in served templates (OSE-1239).
 *
 * WHAT THIS PREVENTS
 *   `securityHeaders()` serves `script-src 'self' 'nonce-<per-request>'`. A
 *   nonce authorises <script> ELEMENTS. It does not authorise inline
 *   event-handler ATTRIBUTES — those need 'unsafe-inline' or 'unsafe-hashes',
 *   and neither is present, correctly: /admin is the one authenticated surface
 *   that renders operator-supplied strings, so the nonce is doing real work.
 *
 *   The result, measured 2026-09-05: all 36 inline handlers in admin.html were
 *   refused at click time. Copy URL did nothing. "+ Add Deployment" never
 *   opened its form. Clicking an event row never scoped the cards to it. Plain
 *   <a href> links still navigated, which is exactly why it went unnoticed —
 *   the page looked alive.
 *
 * WHY A STATIC GATE AND NOT ONLY BEHAVIOURAL TESTS
 *   A behavioural test only covers the control someone thought to test. The
 *   failure mode here is silent and additive: one `onclick=` added to a
 *   runtime-built HTML string ships a dead button, and every existing test
 *   still passes because the element renders and is visible. Visibility was
 *   never the problem.
 *
 *   So this asserts the SHAPE: zero inline handlers, anywhere in the served
 *   templates. Controls wire up through the delegated dispatcher instead —
 *   `data-action` / `data-change` resolved by one listener on document, which
 *   also survives the innerHTML rebuilds these panels do constantly.
 *
 * @born-red OSE-1239 | method: 36 inline handlers, all refused by CSP
 * | date: 2026-09-05
 */
import { describe, test, expect } from 'vitest';
import { env } from 'cloudflare:test';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}

/**
 * Every on*= attribute a browser treats as an inline handler. Not just onclick:
 * the same CSP rule kills onchange and onkeydown, and admin.html carried both.
 */
const HANDLER_ATTR =
  /\son(click|change|keydown|keyup|keypress|input|submit|focus|blur|mouse[a-z]+|touch[a-z]+|load|error)\s*=\s*["']/gi;

/** Strip HTML comments and CSS/JS block comments so prose about the rule doesn't trip it. */
function stripComments(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function templates(): Array<[string, string]> {
  const files = JSON.parse((env as unknown as TestEnv).TEST_SOURCE_FILES_JSON) as Record<
    string,
    string
  >;
  return Object.entries(files).filter(([p]) => p.includes('/templates/') && p.endsWith('.html'));
}

describe('OSE-1239 — CSP: served templates carry no inline event handlers', () => {
  test('the template set is non-empty (guards against a vacuous pass)', () => {
    // Without this, a path-shape change would make every assertion below
    // iterate zero files and pass while proving nothing.
    expect(templates().length).toBeGreaterThanOrEqual(7);
  });

  for (const [path, src] of templates()) {
    const name = path.split('/').pop();
    test(`${name} has no inline on*= handlers`, () => {
      const found = [...stripComments(src).matchAll(HANDLER_ATTR)].map((m) => m[0].trim());
      expect(
        found,
        `${name} carries ${found.length} inline handler attribute(s): ${[...new Set(found)].join(', ')}. ` +
          `A nonce CSP refuses these at click time — the control will render and do nothing. ` +
          `Use data-action / data-change and the delegated dispatcher instead.`
      ).toEqual([]);
    });
  }
});

describe('OSE-1239 — the dispatcher that replaces them exists', () => {
  function adminSrc(): string {
    const hit = templates().find(([p]) => p.endsWith('admin.html'));
    expect(hit, 'admin.html not found in the template set').toBeTruthy();
    return hit![1];
  }

  test('admin.html registers delegated click, change and keydown listeners', () => {
    const src = adminSrc();
    for (const evt of ['click', 'change', 'keydown']) {
      expect(src, `no delegated '${evt}' listener`).toContain(`document.addEventListener('${evt}'`);
    }
  });

  test('every data-action used in markup has a handler in the dispatcher', () => {
    const src = adminSrc();
    // Actions declared on elements…
    const used = new Set([...src.matchAll(/data-action="([a-z-]+)"/g)].map((m) => m[1]));
    // …and the keys the dispatcher defines. Both are literals, so a typo on
    // either side is a dead control — which is the bug this whole story is about.
    const dispatcherBlock = src.slice(
      src.indexOf('var ACTIONS = {'),
      src.indexOf('var CHANGES = {')
    );
    const defined = new Set(
      [...dispatcherBlock.matchAll(/'([a-z-]+)':\s*function/g)].map((m) => m[1])
    );

    expect(
      used.size,
      'no data-action attributes found — did the markup change shape?'
    ).toBeGreaterThan(5);
    const orphans = [...used].filter((a) => !defined.has(a));
    expect(
      orphans,
      `data-action value(s) with no handler in ACTIONS: ${orphans.join(', ')} — these render as dead controls`
    ).toEqual([]);
  });

  test('every data-change used in markup has a handler', () => {
    const src = adminSrc();
    const used = new Set([...src.matchAll(/data-change="([a-z-]+)"/g)].map((m) => m[1]));
    const block = src.slice(src.indexOf('var CHANGES = {'));
    const defined = new Set([...block.matchAll(/'([a-z-]+)':\s*function/g)].map((m) => m[1]));
    const orphans = [...used].filter((a) => !defined.has(a));
    expect(orphans, `data-change value(s) with no handler: ${orphans.join(', ')}`).toEqual([]);
  });
});
