/**
 * OSE-2196 — every route the site offers passes the routable rule, and none is
 * built from an event's stored point. A structural gate over src/.
 *
 * Owner rulings, 2026-11-19: "Anything that is listed as private or off map
 * cannot be routed to", and "it should resolve to the H3". The behaviour is
 * tested surface by surface (tests/routable-directions.spec.ts,
 * tests/no-stored-point.property.spec.ts, tests/poster-digital-actions.spec.ts).
 * This file makes a NEW surface fail until it is gated: a maps link written
 * anywhere but the known builders, a new importer of lib/geo-link, an
 * isRoutable gate taken off a caller, or a stored lat/lon handed to a builder.
 *
 * The known routes:
 *   handlers/pages.ts        the event page's Directions menu (pre and live),
 *                            renderEventGeoLink under isRoutable;
 *   handlers/poster-bundle.ts the poster's `directions`, under isRoutable; the
 *                            poster (templates/poster.html) builds its two links
 *                            from it, in directionsBlock only;
 *   lib/map-place-panel.ts   "Take me there"; its events come only from the
 *                            list query (lib/data-provider.ts fetchEvents), which
 *                            is eventRoutableSql.
 *
 * @born-red OSE-2196 | method: each fault applied alone, this file run, the
 * named test red, reverted: a display handler importing directionsUrls (the
 * importer list); isRoutable taken off the pre-event Directions (the pages
 * gate); `routable ?` taken off the bundle's directions (the bundle gate);
 * fetchEvents back to a hand-written WHERE (the panel source); row.lat handed
 * to renderGeoLink in pages.ts (the stored-point rule); a second Google Maps
 * link written in poster.html (the maps-link rule) | date: 2026-11-19
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

const SRC = join(__dirname, '..', 'src');

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|html|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const ALL = files(SRC).map((p) => ({
  path: relative(SRC, p).replace(/\\/g, '/'),
  text: readFileSync(p, 'utf8'),
}));
const src = (path: string): string => {
  const f = ALL.find((x) => x.path === path);
  if (!f) throw new Error(`missing ${path}`);
  return f.text;
};

/** The source without comments, so a mention in prose is not a call. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

const BUILDERS =
  /\b(directionsUrls|renderGeoLink|renderEventGeoLink|eventDirections|eventDirectionsQuery)\b/;
const KNOWN_ROUTE_FILES = [
  'handlers/pages.ts',
  'handlers/poster-bundle.ts',
  'lib/map-place-panel.ts',
];

describe('OSE-2196 | every route passes the routable rule', () => {
  test('only the known surfaces use the directions builders', () => {
    const users = ALL.filter(
      (f) =>
        f.path !== 'lib/geo-link.ts' &&
        (/lib\/geo-link|\.\/geo-link/.test(f.text) || BUILDERS.test(code(f.text)))
    ).map((f) => f.path);
    // A new surface that offers a route: gate it on isRoutable (or feed it only
    // routable events), test it, then add it here.
    expect(users.sort()).toEqual([...KNOWN_ROUTE_FILES].sort());
  });

  test('no maps link is written anywhere but the builders and the poster', () => {
    const MAPS = /google\.[a-z.]+\/maps|maps\.google\.|maps\.apple\.com|['"`]geo:|['"`]maps:/;
    const writers = ALL.filter((f) => MAPS.test(code(f.text))).map((f) => f.path);
    expect(writers.sort()).toEqual(['lib/geo-link.ts', 'templates/poster.html']);
  });

  test('the event page: every Directions menu is under isRoutable, and from the cells', () => {
    const page = code(src('handlers/pages.ts'));
    const calls = [...page.matchAll(/renderEventGeoLink\(/g)];
    expect(calls.length).toBe(2);
    for (const m of calls) {
      const before = page.slice(Math.max(0, m.index! - 120), m.index);
      expect(before, 'a Directions menu outside isRoutable').toMatch(
        /isRoutable\([^)]*\)[^?]*\?\s*$/
      );
    }
    // Never the point-taking builders on the page.
    expect(page).not.toMatch(/\b(renderGeoLink|directionsUrls)\(/);
  });

  test('the poster bundle: directions only when routable', () => {
    const bundle = code(src('handlers/poster-bundle.ts'));
    expect(bundle).toMatch(/const routable = isRoutable\(/);
    expect(bundle).toMatch(/directions: routable \? directionsFor\(row\) : null/);
  });

  test('the poster draws its map links in one place, from the bundle', () => {
    const poster = src('templates/poster.html');
    expect([...poster.matchAll(/google\.com\/maps/g)].length).toBe(1);
    expect([...poster.matchAll(/maps\.apple\.com/g)].length).toBe(1);
    const i = poster.indexOf('function directionsBlock(');
    const j = poster.indexOf('google.com/maps');
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    expect(j - i).toBeLessThan(1200);
  });

  test('the map panel: its events come only from the routable list query', () => {
    const provider = code(src('lib/data-provider.ts'));
    expect(provider).toMatch(/FROM events\s+WHERE \$\{eventRoutableSql\(\)\} AND brand_id = \?/);
  });

  test('no builder is ever handed a stored lat or lon', () => {
    const offenders: string[] = [];
    for (const f of ALL) {
      if (f.path === 'lib/geo-link.ts') continue;
      const c = code(f.text);
      for (const m of c.matchAll(/\b(directionsUrls|renderGeoLink)\(([^)]*)\)/g)) {
        if (/\.(lat|lon|latitude|longitude)\b/.test(m[2])) offenders.push(`${f.path}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
