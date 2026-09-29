/**
 * OSE-1363 — the SharedReport's client-side date formatters must render in UTC.
 *
 * `fmtDate` (signed-link view) and `fmt` (public events list) both format event
 * dates with `toLocaleDateString`. A date-only value ("YYYY-MM-DD") parses as UTC
 * midnight; without an explicit `timeZone: 'UTC'` the browser renders it in the
 * VIEWER's zone, which rolls the day back one across the Americas — the same
 * off-by-one this story fixes on the server-rendered surfaces.
 *
 * This is browser-executed code the node/workers string pools never run, so it is
 * pinned by asserting the template source (the `admin-sponsor-attr-escape` pattern):
 * import the .html as Text (node loader) and require every date formatter to force
 * UTC. Born-red — reverting either `timeZone: 'UTC'` drops a match and fails.
 */
import { describe, test, expect } from 'vitest';
import SHARED_REPORT_HTML from '../src/templates/shared-report.html';

describe('OSE-1363 shared report client-side date formatters force UTC', () => {
  const html = SHARED_REPORT_HTML as unknown as string;

  test('every toLocaleDateString on this surface pins timeZone: UTC', () => {
    const calls = [...html.matchAll(/toLocaleDateString\('en-US',\s*\{([\s\S]*?)\}\)/g)];
    // The two event-date formatters (fmtDate + fmt).
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const [, optionsBody] of calls) {
      expect(optionsBody).toContain("timeZone: 'UTC'");
    }
  });
});
