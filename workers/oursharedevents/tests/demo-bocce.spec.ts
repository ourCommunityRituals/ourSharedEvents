/**
 * The practice bocce family on the demo site (OSE-2219), as the worker serves it.
 *
 * Five stand-in brands, each page wearing its own look through `data-brand`
 * (themes from @ocr/ui), and a parent page that adds every venture up. The
 * real groups have not agreed to appear, so this also pins that no real name
 * reaches the page, that counts publish through the floor ("Fewer than 5"
 * under 5, multiples of 5 above), and that the brand attribute never comes
 * from the request.
 *
 * Born red: give a page the wrong brand in demo-bocce.ts, print a raw count
 * instead of `bocceCountText`, or build `data-brand` from the path, and a case
 * here fails.
 */

import { SELF } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';
import { bocceCountText, bocceDemoPaths } from '../src/handlers/demo-bocce';

const PAGES: Array<{ path: string; brand: string; name: string }> = [
  { path: '/demo/bocce', brand: 'lakeside-co', name: 'Lakeside Bocce Co.' },
  { path: '/demo/bocce/club', brand: 'lakeside-club', name: 'Lakeside Bocce Club' },
  { path: '/demo/bocce/semipro', brand: 'lakeside-semipro', name: 'Lakeside Semi-Pro League' },
  { path: '/demo/bocce/league', brand: 'lakeside-league', name: 'Lakeside Bocce League' },
  { path: '/demo/bocce/network', brand: 'lakeside-network', name: 'Lakeside Bocce Network' },
];

async function get(path: string): Promise<{ status: number; html: string }> {
  const res = await SELF.fetch(`https://t.test${path}`);
  return { status: res.status, html: await res.text() };
}

describe('the practice bocce family', () => {
  test('every family page is listed here', () => {
    expect(PAGES.map((p) => p.path)).toEqual(bocceDemoPaths());
  });

  for (const p of PAGES) {
    test(`${p.path} wears its own brand and links the whole family`, async () => {
      const { status, html } = await get(p.path);
      expect(status).toBe(200);
      expect(html).toMatch(new RegExp(`<html lang="en" data-brand="${p.brand}">`));
      expect(html).toContain(p.name);
      for (const other of PAGES) expect(html).toContain(`href="${other.path}"`);
      expect(html).toContain('both said yes');
    });

    test(`${p.path} names no real group`, async () => {
      const { html } = await get(p.path);
      for (const real of [
        'American Bocce',
        'Chicago Bocce',
        'Bocce Broadcasting',
        'BocceLabs',
        'Paulina',
      ]) {
        expect(html).not.toContain(real);
      }
    });
  }

  test('the parent adds every venture up, floored', async () => {
    const { html } = await get('/demo/bocce');
    // Club 6428 + semi-pro 1305 + league 5180 + network 3960 + tournaments 2310 = 19 183 → 19,180
    expect(html).toContain('19,180');
    expect(html).toContain('Fewer than 5'); // the new area, 4 scans
    expect(html).not.toMatch(/<td>\s*4\s*<\/td>/);
  });

  test('a count under 5 reads in words, never as the number', async () => {
    const { html } = await get('/demo/bocce/league');
    expect(html).toContain('Fewer than 5');
    expect(html).not.toMatch(/<td>\s*3\s*<\/td>/);
  });

  test('the unknown site is a 404 with no brand, whatever the path says', async () => {
    for (const path of [
      '/demo/bocce/no-such-site',
      '/demo/bocce/lakeside-club',
      '/demo/bocce/acme',
    ]) {
      const { status, html } = await get(path);
      expect(status).toBe(404);
      expect(html).not.toContain('data-brand=');
    }
  });

  test('counts publish like every other count', () => {
    expect(bocceCountText(null)).toBe('Not started yet');
    expect(bocceCountText(0)).toBe('Fewer than 5');
    expect(bocceCountText(4)).toBe('Fewer than 5');
    expect(bocceCountText(5)).toBe('5');
    expect(bocceCountText(1612)).toBe('1,610');
  });
});
