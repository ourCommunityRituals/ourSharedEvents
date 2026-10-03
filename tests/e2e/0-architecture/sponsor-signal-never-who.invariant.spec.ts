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
 *      every sponsor-signal fetch uses `credentials: 'omit'`, and none may use
 *      sendBeacon (it always sends cookies). The identity never reaches the
 *      server, so it structurally cannot be logged.
 *   3. CLICK-OUT — every sponsor link that leaves the site is rel="noreferrer" so
 *      a click leaks no Referer (neither the attendee nor which OSE event they
 *      came from) to the sponsor's external site.
 *
 * Gate shape (README "property or subject?", OSE-1246): 1 names one module's
 * handlers; 2 and 3 are about a CLASS (every surface that shows a sponsor), so
 * they derive their subjects by walking worker `src/`. Until OSE-1166 they named
 * public.html + display.html only, and stayed green while the event page and the
 * sponsor card each gained a sponsor link this file never read.
 *
 * Pyramid coverage for this guarantee (OSE-1164):
 *   L0 STRUCTURAL (this file) — source shape on both sides of the wire.
 *   L1 UNIT/INTEGRATION       — tests/sponsor-signal-anonymity.spec.ts: POST with a
 *                               Cookie header present still persists a row with no
 *                               identity value (Worker + D1, miniflare).
 *   L2 CONTRACT               — Bruno (bruno/ose-api, folder 11): a POST carrying
 *                               the cookie gets no Set-Cookie and no identity back.
 *   E2E RUNTIME               — anonymous-id.invariant.spec.ts: on the sponsored
 *                               smoke event the real request carries no Cookie.
 *
 * Classification: STRUCTURAL (readFileSync only, no deployed worker) — must be
 * listed in the T0 Gate "Architecture: structural invariants" step in
 * oursharedevents-ci.yml (enforced by tests/integration/infra-consistency.test.js).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const WORKER_SRC = join(REPO_ROOT, 'workers', 'oursharedevents', 'src');
const SPONSORS_HANDLER = join(WORKER_SRC, 'handlers', 'sponsors.ts');

/** Every .ts / .html under worker src/, as [repo-style relative path, source]. */
function sourceFiles(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|html)$/.test(entry.name)) {
        out.push([relative(WORKER_SRC, full).replace(/\\/g, '/'), readFileSync(full, 'utf8')]);
      }
    }
  };
  walk(WORKER_SRC);
  return out;
}

// Slice a single exported function body: from its declaration to the next
// top-level `export ` (or EOF). Good enough to scope token checks to the handler.
function fnBody(src: string, name: string): string | null {
  const start = src.indexOf(`export async function ${name}`);
  if (start < 0) return null;
  const next = src.indexOf('\nexport ', start + 1);
  return src.slice(start, next < 0 ? src.length : next);
}

/** The argument text of every `name(` call in src, bounded by its closing paren. */
function callArgs(src: string, name: string): string[] {
  const calls: string[] = [];
  const open = name + '(';
  for (let at = src.indexOf(open); at >= 0; at = src.indexOf(open, at + 1)) {
    let depth = 0;
    let end = at + open.length - 1;
    for (; end < src.length; end++) {
      if (src[end] === '(') depth++;
      else if (src[end] === ')' && --depth === 0) break;
    }
    calls.push(src.slice(at + open.length, end));
  }
  return calls;
}

// A call that targets a sponsor-signal endpoint builds a path ending in
// /impression or /click.
const SIGNAL_PATH = /\/(impression|click)['"`]/;

// Identity-read tokens a never-who signal handler must NEVER contain.
const IDENTITY_TOKENS: Array<[RegExp, string]> = [
  [/getAnonymousId/, 'reads the anonymous id'],
  [/\bose_anon\b/, 'reads the ose_anon cookie'],
  [/\banonymous_id\b/, 'references anonymous_id'],
  [/\bcookie\b/i, 'reads a cookie header'],
  [/getCookie/, 'reads a cookie'],
];

// Sponsor anchors that stay on this site, so there is no Referer to leak. Each
// entry is a data-testid and why its href can only be same-origin.
const SAME_ORIGIN_SPONSOR_LINKS: Record<string, string> = {
  'public-sponsor-card-link': 'href is card_url, the resolver-built /sponsors/:id path',
  'sponsor-card-link': 'href is sponsorCardPath(id), a /sponsors/:id path',
  'sponsor-card-email': 'href is a mailto: built by mailtoHref',
  'sponsor-card-phone': 'href is a tel: built by telHref',
};

// Operator surfaces. The promise is made to attendees; these pages are behind
// admin sign-in and their sponsor anchors point back into the admin.
const OPERATOR_TEMPLATES = ['templates/admin.html', 'templates/admin-signin.html'];

test.describe('Invariant: Sponsor Signal Never-Who — structural lock (OSE-1164)', () => {
  for (const handler of ['handleLogImpression', 'handleLogClick']) {
    test(`OSE-INV-NW | privacy | server | ${handler} reads no identity`, () => {
      expect(existsSync(SPONSORS_HANDLER), 'sponsors.ts must exist').toBe(true);
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
  // sponsor-signal endpoints. Derived: every fetch in worker src/ that targets
  // one must carry credentials:'omit', whichever surface it is on.
  test('OSE-INV-NW | privacy | client | every sponsor-signal fetch omits credentials', () => {
    const found: string[] = [];
    const offenders: string[] = [];
    for (const [file, src] of sourceFiles()) {
      for (const args of callArgs(src, 'fetch')) {
        if (!SIGNAL_PATH.test(args)) continue;
        found.push(file);
        if (!/credentials:\s*['"]omit['"]/.test(args)) {
          offenders.push(`${file}: ${args.slice(0, 160).replace(/\s+/g, ' ')}`);
        }
      }
    }
    // Negative control: a walk that finds nothing passes for the wrong reason.
    for (const known of ['templates/public.html', 'templates/display.html']) {
      expect(
        found,
        `${known} is known to fire sponsor impressions; this gate no longer sees its fetch — ` +
          `the call moved or the detector broke. Update this invariant.`
      ).toContain(known);
    }
    expect(
      offenders,
      `a sponsor-signal fetch does not set credentials:'omit' — the anon_id cookie would be ` +
        `transmitted, making the never-who guarantee behavioral instead of structural. [OSE-1164]`
    ).toEqual([]);
  });

  test('OSE-INV-NW | privacy | client | no sponsor signal is sent with sendBeacon', () => {
    const offenders: string[] = [];
    for (const [file, src] of sourceFiles()) {
      for (const args of callArgs(src, 'sendBeacon')) {
        if (SIGNAL_PATH.test(args)) offenders.push(file);
      }
    }
    expect(
      offenders,
      'navigator.sendBeacon always sends cookies and cannot omit them — a sponsor signal ' +
        'sent that way carries ose_anon to the server. Use fetch with credentials:"omit". [OSE-1164]'
    ).toEqual([]);
  });

  // Click-out. Derived: every <a> in an attendee-facing source file whose tag
  // names a sponsor either stays on this site or carries rel noreferrer.
  test('OSE-INV-NW | privacy | click-out | every outbound sponsor link is rel noreferrer', () => {
    const outbound: string[] = [];
    const offenders: string[] = [];
    for (const [file, src] of sourceFiles()) {
      if (OPERATOR_TEMPLATES.includes(file)) continue;
      for (const tag of src.match(/<a\s[^>]*>/g) ?? []) {
        if (!/sponsor/i.test(tag)) continue;
        const testid = /data-testid="([^"]+)"/.exec(tag)?.[1] ?? '';
        const literalSameOrigin = /href="\/[^/"]/.test(tag);
        if (literalSameOrigin || testid in SAME_ORIGIN_SPONSOR_LINKS) continue;
        outbound.push(file);
        if (!/rel="[^"]*\bnoreferrer\b[^"]*"/.test(tag)) {
          offenders.push(`${file}: ${tag.slice(0, 160).replace(/\s+/g, ' ')}`);
        }
      }
    }
    // Negative control: the three surfaces known to link out to a sponsor.
    for (const known of [
      'templates/public.html',
      'handlers/pages.ts',
      'lib/sponsor-card-render.ts',
    ]) {
      expect(
        outbound,
        `${known} is known to link out to a sponsor's website; this gate no longer sees that ` +
          `anchor — it moved or the detector broke. Update this invariant.`
      ).toContain(known);
    }
    expect(
      offenders,
      'a sponsor link that leaves the site is not rel="noreferrer" — clicking it sends a Referer ' +
        '(the OSE event page the attendee came from) to the sponsor site. Add noreferrer, or if ' +
        'the link is same-origin add its data-testid to SAME_ORIGIN_SPONSOR_LINKS with the reason. ' +
        '[OSE-1164]'
    ).toEqual([]);
  });
});
