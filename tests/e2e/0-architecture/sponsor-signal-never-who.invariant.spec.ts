/**
 * INVARIANT: Sponsor Signal — Never-Who (impossible by construction)  [OSE-1164]
 *
 * The attendee-facing promise "even if you click a sponsor link there is no link
 * back to you, because you scanned in anonymously" must be TRUE BY CONSTRUCTION,
 * not merely by a handler that chooses not to read identity. Transparency by
 * construction, not by promise — see governance-floor-truth-doctrine / OSE-1012.
 *
 * The sponsor impression + click endpoints are aggregate-only (never-who): they
 * record {sponsor_id, event_id, surface, placement, event_type, h3_res7} and
 * nothing that identifies a person. This L0 spec locks that on BOTH sides of the
 * wire so it cannot silently regress:
 *
 *   1. SERVER — handleLogImpression / handleLogClick source references no cookie /
 *      anonymous-id read. Even if a future edit tried to attach identity, CI fails.
 *   2. CLIENT — the browser never even SENDS the anon_id cookie to these endpoints:
 *      every sponsor-signal fetch uses `credentials: 'omit'`. The identity never
 *      reaches the server, so it structurally cannot be logged.
 *   3. CLICK-OUT — the public sponsor link uses rel="noopener noreferrer" so a
 *      click leaks no Referer (neither the attendee nor which OSE event they came
 *      from) to the sponsor's external site.
 *
 * Pyramid coverage for this guarantee (OSE-1164):
 *   L0 STRUCTURAL (this file) — source shape on both sides of the wire.
 *   L1 UNIT/INTEGRATION       — tests/sponsor-signal-anonymity.spec.ts: POST with a
 *                               Cookie header present still persists a row with no
 *                               identity value (Worker + D1, miniflare).
 *   L2 CONTRACT               — Bruno (bruno/ose-api): endpoint 201 + response carries no identity.
 *   E2E RUNTIME               — anonymous-id.invariant.spec.ts: real request carries
 *                               no Cookie; anchor rel has noreferrer.
 *
 * Classification: STRUCTURAL (readFileSync only, no deployed worker) — must be
 * listed in the T0 Gate "Architecture: structural invariants" step in
 * oursharedevents-ci.yml (enforced by tests/integration/infra-consistency.test.js).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SPONSORS_HANDLER = join(
  REPO_ROOT,
  'workers',
  'oursharedevents',
  'src',
  'handlers',
  'sponsors.ts'
);
const TEMPLATES = join(REPO_ROOT, 'workers', 'oursharedevents', 'src', 'templates');
const PUBLIC_HTML = join(TEMPLATES, 'public.html');
const DISPLAY_HTML = join(TEMPLATES, 'display.html');

// Slice a single exported function body: from its declaration to the next
// top-level `export ` (or EOF). Good enough to scope token checks to the handler.
function fnBody(src: string, name: string): string | null {
  const start = src.indexOf(`export async function ${name}`);
  if (start < 0) return null;
  const next = src.indexOf('\nexport ', start + 1);
  return src.slice(start, next < 0 ? src.length : next);
}

// Identity-read tokens a never-who signal handler must NEVER contain.
const IDENTITY_TOKENS: Array<[RegExp, string]> = [
  [/getAnonymousId/, 'reads the anonymous id'],
  [/\bose_anon\b/, 'reads the ose_anon cookie'],
  [/\banonymous_id\b/, 'references anonymous_id'],
  [/\bcookie\b/i, 'reads a cookie header'],
  [/getCookie/, 'reads a cookie'],
];

test.describe('Invariant: Sponsor Signal Never-Who — structural lock (OSE-1164)', () => {
  test('OSE-INV-NW | privacy | existence | sponsors handler + templates exist', () => {
    expect(existsSync(SPONSORS_HANDLER), 'sponsors.ts must exist').toBe(true);
    expect(existsSync(PUBLIC_HTML), 'public.html must exist').toBe(true);
    expect(existsSync(DISPLAY_HTML), 'display.html must exist').toBe(true);
  });

  for (const handler of ['handleLogImpression', 'handleLogClick']) {
    test(`OSE-INV-NW | privacy | server | ${handler} reads no identity`, () => {
      const src = readFileSync(SPONSORS_HANDLER, 'utf8');
      const body = fnBody(src, handler);
      expect(
        body,
        `${handler} must exist in sponsors.ts — it is the sponsor-signal write path`
      ).not.toBeNull();
      for (const [re, why] of IDENTITY_TOKENS) {
        expect(
          re.test(body!),
          `${handler} ${why} (matched ${re}) — the sponsor signal must be aggregate-only ` +
            `(never-who). Identity must never touch this handler. [OSE-1164]`
        ).toBe(false);
      }
    });
  }

  // Client side: the browser must not even SEND the anon_id cookie to the
  // sponsor-signal endpoints. Every fetch to /impression or /click carries
  // credentials:'omit'. We scan each fetch(...) segment that targets a signal
  // endpoint and require the omit.
  for (const [label, path] of [
    ['public.html', PUBLIC_HTML],
    ['display.html', DISPLAY_HTML],
  ] as const) {
    test(`OSE-INV-NW | privacy | client | ${label} sponsor-signal fetches omit credentials`, () => {
      const src = readFileSync(path, 'utf8');
      const segments = src.split('fetch(');
      let checked = 0;
      for (let i = 1; i < segments.length; i++) {
        const seg = segments[i];
        // Each split segment already ends at the next fetch(, so it holds exactly
        // one fetch's args + options. Bound generously (comments/whitespace vary)
        // without reaching a later fetch's options.
        const window = seg.slice(0, 2000);
        const isSignal = /\/impression|\/click/.test(window);
        const isPost = /method:\s*['"]POST['"]/.test(window);
        if (!isSignal || !isPost) continue;
        checked++;
        expect(
          /credentials:\s*['"]omit['"]/.test(window),
          `${label}: a sponsor-signal POST fetch does not set credentials:'omit' — the ` +
            `anon_id cookie would be transmitted, making the never-who guarantee behavioral ` +
            `instead of structural. [OSE-1164]\n  near: ${window.slice(0, 160).replace(/\n/g, ' ')}`
        ).toBe(true);
      }
      expect(
        checked,
        `${label}: expected at least one sponsor-signal POST fetch to verify — the call site ` +
          `moved or was removed; update this invariant.`
      ).toBeGreaterThan(0);
    });
  }

  test('OSE-INV-NW | privacy | click-out | public sponsor link is rel="noopener noreferrer"', () => {
    const src = readFileSync(PUBLIC_HTML, 'utf8');
    expect(
      /rel="noopener noreferrer"[^>]*data-testid="public-sponsor-link"/.test(src),
      'public.html sponsor link must be rel="noopener noreferrer" so clicking a sponsor ' +
        'leaks no Referer (attendee nor originating OSE event) to the sponsor site. [OSE-1164]'
    ).toBe(true);
    expect(
      /rel="noopener"\s+data-testid="public-sponsor-link"/.test(src),
      'public.html still has the old rel="noopener" (no noreferrer) sponsor link — Referer leaks.'
    ).toBe(false);
  });
});
