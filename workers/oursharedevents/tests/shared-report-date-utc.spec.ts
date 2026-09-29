/**
 * OSE-1363 — the SharedReport's client-side date formatting must render in UTC,
 * from a SINGLE shared helper so the two report views cannot drift.
 *
 * A date-only value ("YYYY-MM-DD") parses as UTC midnight; without an explicit
 * `timeZone: 'UTC'` the browser renders it in the VIEWER's zone, which rolls the
 * day back one across the Americas — the same off-by-one this story fixes on the
 * server-rendered surfaces.
 *
 * The signed-link view (`fmtDate`) and the public events list (`fmt`) originally
 * hand-copied the formatter, so the UTC pin lived in two places and could be
 * fixed in one view and missed in the other. This surface now formats every
 * client-rendered event date through one `window.formatReportDate` — the browser
 * mirror of lib/event-datetime.ts `formatDateOnly`, which client code can't
 * import. Consolidating it makes the off-by-one impossible to reintroduce in
 * just one view.
 *
 * Browser-executed code the node/workers string pools never run, so it is pinned
 * by asserting the template source (the `admin-sponsor-attr-escape` pattern):
 * import the .html as Text (node loader). Born-red — reintroducing a second
 * `toLocaleDateString`, or dropping the UTC pin, or unsharing the helper, fails.
 */
import { describe, test, expect } from 'vitest';
import SHARED_REPORT_HTML from '../src/templates/shared-report.html';

describe('OSE-1363 shared report renders dates through ONE UTC formatter', () => {
  const html = SHARED_REPORT_HTML as unknown as string;

  test('exactly one toLocaleDateString on this surface, and it pins timeZone: UTC', () => {
    const calls = [...html.matchAll(/toLocaleDateString\('en-US',\s*\{([\s\S]*?)\}\)/g)];
    // One shared formatter, not a copy per view — a second call reintroduces
    // the drift hazard and turns this red.
    expect(calls.length).toBe(1);
    expect(calls[0][1]).toContain("timeZone: 'UTC'");
  });

  test('the single formatter is exposed as the shared window.formatReportDate', () => {
    expect(html).toContain('window.formatReportDate = function');
  });

  test('both report views format dates through the shared helper', () => {
    // The signed-link view and the public-list view each alias the one helper
    // rather than defining their own — so neither can silently lose the UTC pin.
    const aliases = [...html.matchAll(/=\s*window\.formatReportDate\b(?!\s*=)/g)];
    expect(aliases.length).toBeGreaterThanOrEqual(2);
  });
});
