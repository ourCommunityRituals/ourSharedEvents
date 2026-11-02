/**
 * OSE-1752 — the public recap's "Walked in" line, on the deployed Worker.
 *
 * A walk-in count is withheld for two reasons: it is under 5, or it is 5 or more and
 * what is left of the check-ins (registered and attended) would be 1 to 4. The second
 * used to print "held, so a group under 5 cannot be worked out", which told a reader
 * that walk-ins were 5 or more AND the rest a small group. Both must read the same.
 *
 * Fixture (tests/ui/smoke/fixtures/forms-smoke.sql, seeded earlier in this job): the
 * smoke event has 7 check-ins and 5 walk-ins. 5 clears the floor, the 2 left do not,
 * so this is the case that used to leak. The unit spec (recap-stat-lines.spec.ts) holds
 * the full grid; this one reads the deployed markup.
 *
 * File: tests/e2e/3-flows/recap-walk-in-wording.spec.ts
 */

import { test, expect } from '@playwright/test';

const EVENT = process.env.SMOKE_EVENT_POST ?? '';
const BASE = process.env.BASE_URL ?? '';

test.describe('Public recap walk-in wording', () => {
  test('a walk-in count the nested floor withholds reads like one under 5', async ({ request }) => {
    expect(EVENT, 'SMOKE_EVENT_POST names the seeded event').not.toBe('');
    // This is a plain HTTP read, not a browser. The config's Chrome user agent on a
    // non-browser client draws Cloudflare's bot challenge (403, cf-mitigated), so the
    // request says what it is. Playwright's own default passes the edge.
    const res = await request.get(`${BASE}/events/${EVENT}`, {
      headers: { 'User-Agent': 'ose-recap-walk-in-wording-check' },
    });
    expect(
      res.headers()['cf-mitigated'],
      'the edge challenged this client; the Worker never saw the request'
    ).toBeUndefined();
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-testid="event-stats-card"');

    const line = html.match(/<p data-testid="stat-walk-ins">[\s\S]*?<\/p>/)?.[0];
    expect(line, 'the recap draws a walk-in line (7 check-ins, 5 walk-ins seeded)').toBeDefined();
    expect(line).toBe('<p data-testid="stat-walk-ins">Fewer than 5 Walked in</p>');
    // Nothing on the page tells the two withheld cases apart.
    expect(html).not.toMatch(/: held|cannot be worked out/i);
    // The share is withheld in the same cases, so it is not drawn either.
    expect(html).not.toContain('data-testid="stat-walk-in-share"');
  });
});
