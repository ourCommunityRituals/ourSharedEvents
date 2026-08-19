/**
 * OSE-864 / #25: Poster sponsor rendering is UNIFORM across tiers.
 *
 * INVERTED from the retired OSE-219 6-tier model (title>...>primary logo sizes
 * 40/34/28/22px). Invariant #25 (sponsor_share_covenant, live) forbids tier-keyed
 * sponsor GEOMETRY — money buys frequency-share + report depth only, never size,
 * slot, or position. These assertions guard the covenant at the poster template
 * seam; the CI render-lock is WALL-3b (OSE-835,
 * sponsor-share-covenant.invariant.spec.ts). Inverted in the same commit as the
 * CSS deletion so the covenant cannot walk back in behind a green suite.
 *
 * Verifies:
 *   - NO .poster-sponsor--<tier> modifier classes exist (all six removed)
 *   - NO tier-keyed logo heights or name typography remain
 *   - Every sponsor renders at the ONE uniform responsive .poster-sponsor img box
 *   - The renderer emits no tier class; data-tier remains for rotation identity
 */

import { describe, test, expect } from 'vitest';
import { handlePosterPage } from '../src/handlers/pages';

function posterHtml(): Promise<string> {
  return handlePosterPage({} as never).text();
}

describe('OSE-864 / #25: Poster CSS — uniform sponsor treatment (no tier geometry)', () => {
  const tiers = ['title', 'platinum', 'gold', 'silver', 'bronze', 'primary'] as const;

  for (const tier of tiers) {
    test(`poster CSS defines NO .poster-sponsor--${tier} modifier`, async () => {
      expect(await posterHtml()).not.toContain(`.poster-sponsor--${tier}`);
    });
  }

  test('poster CSS references no legacy --premium / --mid / --local classes either', async () => {
    const body = await posterHtml();
    expect(body).not.toContain('.poster-sponsor--premium');
    expect(body).not.toContain('.poster-sponsor--mid');
    expect(body).not.toContain('.poster-sponsor--local');
  });

  test('no tier-keyed logo height remains (the retired 40/34/28/22px spread is gone)', async () => {
    const body = await posterHtml();
    expect(body).not.toMatch(/\.poster-sponsor--\w+ img\s*\{\s*height:/);
  });

  test('no tier-keyed sponsor-name typography remains', async () => {
    const body = await posterHtml();
    expect(body).not.toMatch(/\.poster-sponsor--\w+ \.poster-sponsor-name/);
  });

  test('every sponsor logo uses the ONE uniform, responsive box', async () => {
    const body = await posterHtml();
    // A single tier-blind rule: clamp() height + max-width on .poster-sponsor img.
    expect(body).toMatch(/\.poster-sponsor img\s*\{[\s\S]*?height:\s*clamp\(/);
    expect(body).toMatch(/\.poster-sponsor img\s*\{[\s\S]*?max-width:\s*clamp\(/);
  });
});

describe('OSE-864 / #25: Poster renderer — no tier class, data-tier retained', () => {
  test('renderer does NOT emit a poster-sponsor--<tier> class', async () => {
    const body = await posterHtml();
    expect(body).not.toContain("poster-sponsor poster-sponsor--' + esc(tier)");
    expect(body).toContain('class="poster-sponsor"');
  });

  test('renderer still reads s.tier (rotation identity)', async () => {
    expect(await posterHtml()).toContain('s.tier');
  });

  test('renderer still normalizes an unknown tier to primary (rotation default)', async () => {
    const body = await posterHtml();
    const fnStart = body.indexOf('async function loadPosterSponsors');
    const fnEnd = body.indexOf('init();', fnStart);
    const fn = fnStart >= 0 && fnEnd > fnStart ? body.slice(fnStart, fnEnd) : '';
    expect(fn).toContain("['title','platinum','gold','silver','bronze','primary']");
    expect(fn).toMatch(/'primary'/);
  });

  test('renderer still writes the data-tier attribute (frequency-share identity)', async () => {
    expect(await posterHtml()).toContain('data-tier="\' + esc(tier)');
  });
});
