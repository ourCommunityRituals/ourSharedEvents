/**
 * OSE-2196 — no exact stored point reaches a public page: a place given as a
 * coordinate equals its res-9 cell's point (owner, 2026-11-19: "It should
 * resolve to the H3"; "it should go to the Res9 if possible").
 *
 * A property over the public surfaces that can give a place, for any stored
 * point: a listed event is seeded with that point and the cells
 * lib/h3-tagging.ts would write for it, then
 *   - its event page (pre-event or live, at random),
 *   - its poster bundle's `directions` (the one text the poster's map buttons
 *     search; the bundle's `event` projection still carries lat and lon, which is
 *     the public-JSON story OSE-2197, not this one),
 *   - its calendar file (.ics)
 * are read. On each: the stored latitude and longitude never appear as a
 * number, and every coordinate pair in a link is exactly the res-9 cell's
 * point. The page's Directions menu exists and points at that cell point.
 *
 * Runtime-bound (SELF.fetch, env.DB) → workers pool. Fixed seed, so a failure
 * replays.
 *
 * @born-red OSE-2196 | method: the raw stored lat and lon passed to
 * directionsUrls (eventDirections reading the row's lat/lon, and the event
 * page's SELECT given lat, lon back) → red on the first run, counterexample
 * printed; reverted → green | date: 2026-11-19
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import fc from 'fast-check';
import { cellToLatLng } from 'h3-js';
import { tagCoordinates } from '../src/lib/h3-tagging';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const E = env as unknown as TestEnv;
const ORIGIN = 'https://localhost';
const AS_PERSON = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

async function applyAll(db: D1Database, json: string): Promise<void> {
  for (const stmt of JSON.parse(json) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (
        m.includes('duplicate column') ||
        m.includes('already exists') ||
        m.includes('no such column')
      ) {
        continue;
      }
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyAll(E.DB, E.TEST_MIGRATION_STATEMENTS);
  await applyAll(E.FORMS_DB, E.TEST_FORMS_MIGRATION_STATEMENTS);
  await E.DB.prepare("DELETE FROM events WHERE id LIKE 'nsp-%'").run();
});

/** Every decimal number in a text, as numbers. */
const numbers = (text: string): number[] =>
  [...text.matchAll(/-?\d+\.\d+/g)].map((m) => Number(m[0]));

/** The values of every href / src / content attribute, decoded enough to read. */
const linkValues = (html: string): string[] =>
  [...html.matchAll(/\s(?:href|src|content)="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));

/** Coordinate pairs in a link: "lat,lon" or "lat%2Clon". */
const pairs = (text: string): Array<[number, number]> =>
  [...text.matchAll(/(-?\d{1,3}\.\d{3,})(?:%2C|,)(-?\d{1,3}\.\d{3,})/gi)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);

let n = 0;

describe('OSE-2196 | no exact stored point reaches a public page', () => {
  test('for any stored point, every public coordinate is the res-9 cell point', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          // Six decimals, as a stored point is; lands are wide enough.
          // Six decimals with a non-zero sixth, as a stored point is: it can
          // never equal a five-decimal cell point by chance.
          lat: fc
            .tuple(fc.integer({ min: -5_500_000, max: 7_000_000 }), fc.integer({ min: 1, max: 9 }))
            .map(([v, d]) => (v * 10 + (v < 0 ? -d : d)) / 1e6),
          lon: fc
            .tuple(
              fc.integer({ min: -17_900_000, max: 17_900_000 }),
              fc.integer({ min: 1, max: 9 })
            )
            .map(([v, d]) => (v * 10 + (v < 0 ? -d : d)) / 1e6),
          live: fc.boolean(),
          address: fc.boolean(),
        }),
        async ({ lat, lon, live, address }) => {
          const id = `nsp-${++n}`;
          const { h3_res9, h3_res7 } = tagCoordinates(lat, lon);
          // The point as cellPoint writes it: the cell centre, five decimals.
          const [cLat, cLon] = cellToLatLng(h3_res9).map((v) => v.toFixed(5));
          await E.DB.prepare(
            `INSERT INTO events (id, brand_id, title, slug, status, is_published, listed_from,
                                 location, where_address, lat, lon, h3_res9, h3_res7,
                                 start_date, end_date, timezone, created_at, updated_at)
             VALUES (?, 'root', ?, ?, 'active', 1, NULL, 'Property Hall', ?, ?, ?, ?, ?,
                     ${live ? "date('now', '-1 day')" : "date('now', '+3 day')"},
                     ${live ? "date('now', '+1 day')" : "date('now', '+3 day')"},
                     'America/Chicago', datetime('now'), datetime('now'))`
          )
            .bind(
              id,
              `Title ${id}`,
              id,
              address ? '1 Property St' : null,
              lat,
              lon,
              h3_res9,
              h3_res7
            )
            .run();

          const pageRes = await SELF.fetch(`${ORIGIN}/events/${id}`, { headers: AS_PERSON });
          expect(pageRes.status).toBe(200);
          const html = await pageRes.text();
          const bundleRes = await SELF.fetch(`${ORIGIN}/api/v2/events/${id}/poster-bundle`);
          expect(bundleRes.status).toBe(200);
          const bundle = (await bundleRes.json()) as { directions: unknown };
          const directions = JSON.stringify(bundle.directions);
          const icsRes = await SELF.fetch(`${ORIGIN}/events/${id}/calendar.ics`);
          expect(icsRes.status).toBe(200);
          const ics = await icsRes.text();

          const surfaces: Array<[string, string, string[]]> = [
            ['event page', html, linkValues(html)],
            ['poster directions', directions, [directions]],
            ['calendar file', ics, [ics]],
          ];
          for (const [name, text, links] of surfaces) {
            const nums = numbers(text);
            expect(nums, `${name}: the stored latitude ${lat}`).not.toContain(lat);
            expect(nums, `${name}: the stored longitude ${lon}`).not.toContain(lon);
            for (const link of links) {
              for (const [a, b] of pairs(link)) {
                expect([a, b], `${name}: a coordinate in ${link}`).toEqual([
                  Number(cLat),
                  Number(cLon),
                ]);
              }
            }
          }

          // The listed event has its Directions, at the res-9 cell point.
          const testid = live ? 'geo-link-live' : 'geo-link';
          expect(html).toContain(`data-testid="${testid}"`);
          expect(html).toContain(`query=${cLat}%2C${cLon}"`);
          expect(bundle.directions).toEqual({ query: `${cLat},${cLon}` });
        }
      ),
      { numRuns: 30, seed: 2196 }
    );
  });
});
