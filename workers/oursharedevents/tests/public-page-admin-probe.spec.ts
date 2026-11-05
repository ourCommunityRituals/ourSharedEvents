/**
 * A public page that asks an admin endpoint "am I an admin?" must not follow the
 * answer into the Cloudflare Access login.
 *
 * The SharedReport page probes /api/v2/admin/flags/current-tier twice: once for
 * the advanced-metrics tier, once to show "Repeat this event" to an admin. For a
 * visitor who is not signed in to Access, staging and production answer that
 * admin path with a 302 to the Access login on another origin. A plain fetch()
 * follows it and, from a public page, never settles: the probe hangs, the page
 * never goes network-idle, and T4's SharedReport invariant has timed out on every
 * main SHA since the report page started rendering on the Free plan (#1085).
 *
 * The rule: every fetch from a public page template to /api/v2/admin/ passes
 * `redirect: 'manual'` (a redirect then reads as "not an admin", at once), and
 * every probe (a call made before the page knows the viewer is an admin:
 * flags/current-tier) also passes a timeout signal, so no probe can hold the page
 * open. Calls made after a probe said "admin" (the counts, Repeat) are not
 * timed out: a slow repeat must not be cut off.
 *
 * @born-red OSE-1562 | method: deliberate-fixture-break | date: 2026-11-04 |
 *   verified: red against main's shared-report.html (both probes lack the
 *   options), green with them.
 */
import { describe, test, expect } from 'vitest';
import SHARED_REPORT_HTML from '../src/templates/shared-report.html';
import DISPLAY_HTML from '../src/templates/display.html';
import PUBLIC_HTML from '../src/templates/public.html';
import LANDING_HTML from '../src/templates/landing.html';
import SPONSOR_CARD_HTML from '../src/templates/sponsor-card.html';
import SPONSOR_HOME_HTML from '../src/templates/sponsor-home.html';

/** Public pages: no admin session is assumed when they load. */
const PUBLIC_TEMPLATES: Record<string, string> = {
  'shared-report.html': SHARED_REPORT_HTML,
  'display.html': DISPLAY_HTML,
  'public.html': PUBLIC_HTML,
  'landing.html': LANDING_HTML,
  'sponsor-card.html': SPONSOR_CARD_HTML,
  'sponsor-home.html': SPONSOR_HOME_HTML,
};

/** Each `fetch(` call whose first argument starts with '/api/v2/admin/', as its full call text. */
function adminFetchCalls(src: string): string[] {
  const calls: string[] = [];
  const re = /fetch\(\s*['"`]\/api\/v2\/admin\//g;
  for (const m of src.matchAll(re)) {
    const start = m.index!;
    let depth = 0;
    let i = start + 'fetch'.length;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')' && --depth === 0) break;
    }
    calls.push(src.slice(start, i + 1));
  }
  return calls;
}

describe('a public page never follows an admin probe into the Access login', () => {
  test('the SharedReport page does probe an admin endpoint (the rule below is not vacuous)', () => {
    expect(adminFetchCalls(SHARED_REPORT_HTML).length).toBeGreaterThanOrEqual(2);
  });

  test.each(Object.keys(PUBLIC_TEMPLATES))(
    "%s: every fetch to /api/v2/admin/ has redirect: 'manual'",
    (name) => {
      const bad = adminFetchCalls(PUBLIC_TEMPLATES[name]!).filter(
        (call) => !/redirect:\s*'manual'/.test(call)
      );
      expect(bad, bad.join('\n---\n')).toEqual([]);
    }
  );

  test.each(Object.keys(PUBLIC_TEMPLATES))(
    '%s: every admin probe (flags/current-tier) has a timeout signal',
    (name) => {
      const bad = adminFetchCalls(PUBLIC_TEMPLATES[name]!)
        .filter((call) => call.includes('/api/v2/admin/flags/current-tier'))
        .filter((call) => !/signal:/.test(call));
      expect(bad, bad.join('\n---\n')).toEqual([]);
    }
  );
});
