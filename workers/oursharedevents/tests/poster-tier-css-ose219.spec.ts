/**
 * OSE-219: Poster sponsor tier CSS — 6-tier model maps API tiers to print sizes.
 *
 * Verifies:
 *   - Poster CSS defines all 6 tier modifier classes (title/platinum/gold/silver/bronze/primary)
 *   - Legacy 3-tier classes (premium/mid/local) are gone
 *   - loadPosterSponsors() appends `poster-sponsor--<tier>` from `s.tier`
 *   - Unknown tier values fall through to `primary` (defensive default)
 *   - Tier constraints from acceptance criteria: 40px / 34px / 28px / 22px
 */

import { describe, test, expect } from 'vitest';
import { handlePosterPage } from '../src/handlers/pages';

function posterHtml(): Promise<string> {
  return handlePosterPage({} as never).text();
}

describe('OSE-219: Poster CSS — 6-tier sponsor classes', () => {
  const tiers = ['title', 'platinum', 'gold', 'silver', 'bronze', 'primary'] as const;

  for (const tier of tiers) {
    test(`poster CSS defines .poster-sponsor--${tier}`, async () => {
      expect(await posterHtml()).toContain(`.poster-sponsor--${tier}`);
    });
  }

  test('poster CSS no longer references legacy --premium / --mid / --local classes', async () => {
    const body = await posterHtml();
    expect(body).not.toContain('.poster-sponsor--premium');
    expect(body).not.toContain('.poster-sponsor--mid');
    expect(body).not.toContain('.poster-sponsor--local');
  });

  test('title/platinum logo height is 40px', async () => {
    const body = await posterHtml();
    expect(body).toMatch(
      /\.poster-sponsor--title[\s\S]*?\.poster-sponsor--platinum img\s*\{\s*height:\s*40px/
    );
  });

  test('gold logo height is 34px', async () => {
    expect(await posterHtml()).toMatch(/\.poster-sponsor--gold img\s*\{\s*height:\s*34px/);
  });

  test('silver/bronze logo height is 28px', async () => {
    expect(await posterHtml()).toMatch(
      /\.poster-sponsor--silver[\s\S]*?\.poster-sponsor--bronze img\s*\{\s*height:\s*28px/
    );
  });

  test('primary logo height is 22px', async () => {
    expect(await posterHtml()).toMatch(/\.poster-sponsor--primary img\s*\{\s*height:\s*22px/);
  });

  test('primary tier name uses #6c757d color', async () => {
    expect(await posterHtml()).toMatch(
      /\.poster-sponsor--primary \.poster-sponsor-name[\s\S]*?color:\s*#6c757d/
    );
  });
});

describe('OSE-219: Poster renderer — sponsor div carries tier class', () => {
  test('loadPosterSponsors appends poster-sponsor--<tier> class', async () => {
    const body = await posterHtml();
    expect(body).toContain("'<div class=\"poster-sponsor poster-sponsor--' + esc(tier) +");
  });

  test('renderer reads from s.tier', async () => {
    const body = await posterHtml();
    expect(body).toContain('s.tier');
  });

  test('renderer guards against unknown tier — defaults to primary', async () => {
    const body = await posterHtml();
    const fnStart = body.indexOf('async function loadPosterSponsors');
    const fnEnd = body.indexOf('init();', fnStart);
    const fn = fnStart >= 0 && fnEnd > fnStart ? body.slice(fnStart, fnEnd) : '';
    expect(fn).toContain("['title','platinum','gold','silver','bronze','primary']");
    expect(fn).toMatch(/'primary'/);
  });

  test('renderer also writes data-tier attribute', async () => {
    const body = await posterHtml();
    expect(body).toContain('data-tier="\' + esc(tier)');
  });
});
