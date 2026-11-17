/**
 * OSE-1901 — the one-name sponsor line picks by the covenant share.
 *
 * A spot that shows ONE sponsor name by an event's title (the card line on the
 * landing, /events and the map's place panel; the TV's "also coming up") picks
 * the name by the existing share math (`allocateShares`, OCR-docs invariant 25):
 * a higher paid level comes up more often, up to its cap; locals keep at least
 * 30%; every name prints the same way. The pick reads the event id, the clock
 * hour and the event's own sponsors, and nothing about the visitor.
 *
 * Pure rules: lib/sponsor-line-pick.ts. The read: lib/sponsor-titles.ts, here
 * over a fake D1 (the real D1 is tests/sponsor-line-titles.spec.ts). Staging:
 * bruno/ose-api "21. Sponsor line by covenant share (OSE-1901)"; the last
 * describe block holds that folder's literal cycle to this code.
 *
 * @born-red OSE-1901 | method: each fault below was put into the source, the
 * named tests were seen failing, and the fault was taken out again | date:
 * 2026-11-16 | the list of faults is in the PR text.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { renderEventCard } from '../src/lib/event-list';
import { allocateShares, sovTierOf } from '../src/lib/sponsor-allocation';
import {
  LINE_CYCLE_HOURS,
  hourOf,
  lineCycle,
  lineHours,
  pickSponsorLine,
  type LineCandidate,
} from '../src/lib/sponsor-line-pick';
import { buildSponsorBundle, type SponsorRow } from '../src/lib/sponsor-resolver';
import {
  SPONSOR_TITLE_MAX_PAGES,
  SPONSOR_TITLE_PAGE_ROWS,
  fetchSponsorTitles,
} from '../src/lib/sponsor-titles';

const c = (id: string, tier: string, isLocal = false): LineCandidate => ({
  id,
  title: `Title of ${id}`,
  tier,
  isLocal,
});

/** id -> hours, for a readable expectation. */
const hoursOf = (cands: readonly LineCandidate[]): Record<string, number> =>
  Object.fromEntries(lineHours(cands).map((r) => [r.candidate.id, r.hours]));

/** How often each id is picked over `n` clock hours in a row, from `start`. */
function tally(
  eventId: string,
  cands: readonly LineCandidate[],
  n: number,
  start = 0
): Record<string, number> {
  // A Map, so a sponsor id such as "constructor" counts like any other.
  const seen = new Map<string, number>();
  for (let h = start; h < start + n; h++) {
    const id = pickSponsorLine(eventId, cands, h)!.id;
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  return Object.fromEntries(seen);
}

// One top level, two middle, three base of which one is local.
const SIX = [
  c('s-top', 'title'),
  c('s-mid-a', 'gold'),
  c('s-mid-b', 'silver'),
  c('s-base-a', 'bronze'),
  c('s-base-b', 'primary'),
  c('s-local', 'bronze', true),
];
// The same with a second local.
const SEVEN = [...SIX, c('s-local-b', 'primary', true)];

describe('sunny: the share decides how often a name comes up', () => {
  test('one sponsor is the line in every hour', () => {
    const only = [c('solo', 'bronze')];
    expect(hoursOf(only)).toEqual({ solo: LINE_CYCLE_HOURS });
    expect(tally('evt-1', only, 250)).toEqual({ solo: 250 });
  });

  test('top, middle and a local base: 40, 20 and 40 hours of 100 (worked by hand)', () => {
    // Local floor 30 to the local. The other 70 by weight 7 : 3 : 1: the top
    // level wants 44.5 and stops at its cap, 40; the middle fills to its cap,
    // 20; the local takes the rest, 40.
    const three = [c('top', 'platinum'), c('mid', 'gold'), c('loc', 'bronze', true)];
    expect(hoursOf(three)).toEqual({ top: 40, mid: 20, loc: 40 });
  });

  test('seven sponsors, two of them local (worked by hand): 29, 13, 12, 4, 4, 19, 19', () => {
    // Floor 30, 15 to each local. The other 70 by weight 7 : 3 : 3 : 1 : 1 : 1 : 1
    // (17): top 28.82, middle 12.35 each, base 4.12 each, a local 4.12 + 15.
    // Whole hours come to 98 and leave 2 over; they go to the largest
    // fractions: the top level (.82), then one middle (.35, the lower id of the
    // two that tie).
    expect(hoursOf(SEVEN)).toEqual({
      's-top': 29,
      's-mid-a': 13,
      's-mid-b': 12,
      's-base-a': 4,
      's-base-b': 4,
      's-local': 19,
      's-local-b': 19,
    });
  });

  test('over 1,000 hours in a row the top level is shown most, within its cap, and locals at least 30%', () => {
    const seen = tally('evt-seven', SEVEN, 1000, 481_234);
    expect(Object.values(seen).reduce((a, b) => a + b, 0)).toBe(1000);
    const top = seen['s-top']!;
    for (const [id, n] of Object.entries(seen)) if (id !== 's-top') expect(n).toBeLessThan(top);
    expect(top).toBeLessThanOrEqual(400);
    expect(seen['s-local']! + seen['s-local-b']!).toBeGreaterThanOrEqual(300);
    // 1,000 hours are ten whole cycles, so the numbers are the hours times ten.
    const hours = hoursOf(SEVEN);
    for (const id of Object.keys(hours)) expect(seen[id]).toBe(hours[id]! * 10);
  });

  test('every sponsor of the six comes up in a cycle', () => {
    expect(Object.keys(tally('evt-six', SIX, 100)).sort()).toEqual(SIX.map((s) => s.id).sort());
  });

  test('the same event, sponsors and hour always give the same name', () => {
    for (let h = 0; h < 300; h++) {
      expect(pickSponsorLine('evt-six', SIX, h)).toEqual(pickSponsorLine('evt-six', SIX, h));
    }
  });

  test('two events with the same sponsors do not walk in step', () => {
    const a = Array.from({ length: 100 }, (_, h) => pickSponsorLine('evt-a', SIX, h)!.id);
    const b = Array.from({ length: 100 }, (_, h) => pickSponsorLine('evt-b', SIX, h)!.id);
    expect(a).not.toEqual(b);
    // Same hours each, in another order.
    expect(a.slice().sort()).toEqual(b.slice().sort());
  });
});

describe('edge: the rosters the owner named', () => {
  test('no top level: the same math over whoever consented', () => {
    const noTop = [c('mid', 'gold'), c('base', 'bronze'), c('loc', 'primary', true)];
    const hours = hoursOf(noTop);
    expect(Object.values(hours).reduce((a, b) => a + b, 0)).toBe(100);
    expect(hours.mid).toBeLessThanOrEqual(20);
    expect(hours.loc).toBeGreaterThanOrEqual(30);
    expect(hours.base).toBeGreaterThan(0);
  });

  test('two top-level sponsors split the top share evenly', () => {
    const twoTop = [c('top-a', 'title'), c('top-b', 'platinum'), c('base', 'bronze')];
    expect(hoursOf(twoTop)).toEqual({ 'top-a': 40, 'top-b': 40, base: 20 });
  });

  test('only locals: the cycle is theirs, by level', () => {
    const locals = [c('l-top', 'title', true), c('l-base', 'bronze', true)];
    const hours = hoursOf(locals);
    expect(hours['l-top']! + hours['l-base']!).toBe(100);
    expect(hours['l-top']).toBe(40);
  });

  test('a level the table does not know weighs as base, never more', () => {
    const odd = [c('odd', 'diamond'), c('base', 'bronze'), c('top', 'title')];
    const hours = hoursOf(odd);
    expect(hours.odd).toBe(hours.base);
    expect(hours.odd).toBeLessThan(hours.top!);
    expect(sovTierOf('diamond')).toBe('base');
  });

  test('the local flag changes the hours: the same three with and without it', () => {
    const withLocal = [c('top', 'title'), c('base', 'bronze'), c('loc', 'bronze', true)];
    const without = [c('top', 'title'), c('base', 'bronze'), c('loc', 'bronze', false)];
    expect(hoursOf(withLocal)).toEqual({ top: 40, base: 15, loc: 45 });
    expect(hoursOf(without)).toEqual({ top: 40, base: 30, loc: 30 });
  });

  test('seven locals among 43 top-level sponsors: rounding alone would leave the locals 28 hours, and the floor is 30', () => {
    // Each local is due 4.51 hours (31.6 between them) and each of the 43 is
    // due 1.59. Whole hours give the locals 28, and the 29 hours left over all
    // go to larger fractions (.59 against .51). The floor takes two back.
    const many = [
      ...Array.from({ length: 7 }, (_, i) => c(`loc-${i}`, 'bronze', true)),
      ...Array.from({ length: 43 }, (_, i) => c(`top-${String(i).padStart(2, '0')}`, 'title')),
    ];
    const rows = lineHours(many);
    const local = rows.filter((r) => r.candidate.isLocal).reduce((a, r) => a + r.hours, 0);
    expect(local).toBe(30);
    expect(rows.reduce((a, r) => a + r.hours, 0)).toBe(100);
    // Nobody is left out, and no local is given more than the next whole hour.
    expect(rows.every((r) => r.hours >= 1)).toBe(true);
    expect(rows.filter((r) => r.candidate.isLocal).every((r) => r.hours <= 5)).toBe(true);
  });

  test('what the share math does not promise: with two names the capped top level is not the most shown', () => {
    // Recorded so nobody reads "the top level always leads" into this code. The
    // cap is 40% and a base sponsor has none, so it takes the other 60.
    expect(hoursOf([c('top', 'title'), c('base', 'bronze')])).toEqual({ top: 40, base: 60 });
    expect(hoursOf([c('top', 'title'), c('loc', 'bronze', true)])).toEqual({ top: 40, loc: 60 });
  });

  test('what the share math does not promise: a single local holds the whole floor, and can pass the top level', () => {
    // Six sponsors, one local. The floor (30) is the one local's alone, on top
    // of its share by weight: 34 hours to the top level's 31.
    const hours = hoursOf(SIX);
    expect(hours).toEqual({
      's-top': 31,
      's-mid-a': 13,
      's-mid-b': 13,
      's-base-a': 5,
      's-base-b': 4,
      's-local': 34,
    });
    // Among the sponsors that are not local, the top level is still shown most.
    for (const id of ['s-mid-a', 's-mid-b', 's-base-a', 's-base-b']) {
      expect(hours[id]).toBeLessThan(hours['s-top']!);
    }
  });
});

describe('rainy and fat-finger: odd input', () => {
  test('nobody consented: no line', () => {
    expect(lineHours([])).toEqual([]);
    expect(lineCycle('evt', [])).toEqual([]);
    expect(pickSponsorLine('evt', [], 5)).toBeNull();
  });

  test('the same sponsor twice counts once, the first row kept', () => {
    const twice = [c('a', 'title'), { ...c('a', 'bronze'), title: 'second row' }, c('b', 'bronze')];
    expect(hoursOf(twice)).toEqual(hoursOf([c('a', 'title'), c('b', 'bronze')]));
    expect(lineCycle('evt', twice).some((s) => s.title === 'second row')).toBe(false);
  });

  test('hourOf: whole hours since 1970, and 0 for a moment that is not one', () => {
    expect(hourOf(0)).toBe(0);
    expect(hourOf(3_599_999)).toBe(0);
    expect(hourOf(3_600_000)).toBe(1);
    expect(hourOf(Date.UTC(2026, 10, 16, 21, 59, 59, 999))).toBe(
      hourOf(Date.UTC(2026, 10, 16, 21, 0, 0, 0))
    );
    expect(hourOf(Date.UTC(2026, 10, 16, 22, 0, 0, 0))).toBe(
      hourOf(Date.UTC(2026, 10, 16, 21, 0, 0, 0)) + 1
    );
    for (const bad of [-1, -3_600_000, Number.NaN, Infinity, -Infinity]) {
      expect(hourOf(bad)).toBe(0);
    }
  });

  test('an hour that is negative, a fraction or not a number still picks one of the sponsors', () => {
    const ids = new Set(SIX.map((s) => s.id));
    for (const h of [-1, -100, -101, 7.9, Number.NaN, Infinity, -Infinity, 2 ** 40]) {
      expect(ids.has(pickSponsorLine('evt-six', SIX, h)!.id)).toBe(true);
    }
    expect(pickSponsorLine('evt-six', SIX, 7.9)).toEqual(pickSponsorLine('evt-six', SIX, 7));
    expect(pickSponsorLine('evt-six', SIX, -1)).toEqual(pickSponsorLine('evt-six', SIX, 99));
    expect(pickSponsorLine('evt-six', SIX, Number.NaN)).toEqual(pickSponsorLine('evt-six', SIX, 0));
    // The cycle comes round: hour 100 is hour 0 again.
    expect(pickSponsorLine('evt-six', SIX, 100)).toEqual(pickSponsorLine('evt-six', SIX, 0));
  });

  test('more names than hours: the cycle grows to one hour a name, and the floor still holds', () => {
    const crowd = [
      ...Array.from({ length: 118 }, (_, i) => c(`n-${String(i).padStart(3, '0')}`, 'bronze')),
      c('loc-a', 'bronze', true),
      c('loc-b', 'bronze', true),
    ];
    const rows = lineHours(crowd);
    expect(rows.reduce((a, r) => a + r.hours, 0)).toBe(120);
    const local = rows.filter((r) => r.candidate.isLocal).reduce((a, r) => a + r.hours, 0);
    expect(local).toBeGreaterThanOrEqual(36);
  });
});

// ── Properties ───────────────────────────────────────────────────────────────

const TIERS = ['title', 'platinum', 'gold', 'silver', 'bronze', 'primary', 'standard', '', 'GOLD'];
const rosterArb = (max: number) =>
  fc
    .uniqueArray(
      fc.record({
        id: fc.stringMatching(/^[a-z0-9-]{1,12}$/),
        tier: fc.constantFrom(...TIERS),
        isLocal: fc.boolean(),
      }),
      { minLength: 1, maxLength: max, selector: (r) => r.id }
    )
    .map((rows) => rows.map((r) => ({ ...r, title: `T ${r.id}` })));

describe('properties: any roster', () => {
  test('the hours add up to the cycle, and every pick is one of the sponsors', () => {
    fc.assert(
      fc.property(rosterArb(60), fc.string(), fc.integer(), (cands, eventId, hour) => {
        const rows = lineHours(cands);
        const total = rows.reduce((a, r) => a + r.hours, 0);
        expect(total).toBe(Math.max(LINE_CYCLE_HOURS, cands.length));
        expect(rows.every((r) => Number.isInteger(r.hours) && r.hours >= 0)).toBe(true);
        expect(cands.map((x) => x.id)).toContain(pickSponsorLine(eventId, cands, hour)!.id);
        expect(lineCycle(eventId, cands)).toHaveLength(total);
      }),
      { numRuns: 300 }
    );
  });

  test('wherever a local stands beside a non-local, the locals hold at least 30% of the cycle', () => {
    fc.assert(
      fc.property(rosterArb(60), (cands) => {
        fc.pre(cands.some((x) => x.isLocal) && cands.some((x) => !x.isLocal));
        const rows = lineHours(cands);
        const total = rows.reduce((a, r) => a + r.hours, 0);
        const local = rows.filter((r) => r.candidate.isLocal).reduce((a, r) => a + r.hours, 0);
        expect(local * 100).toBeGreaterThanOrEqual(30 * total);
      }),
      { numRuns: 400 }
    );
  });

  test('up to 50 names: nobody is left out, each is within two hours of its share, and no level passes a cap it met', () => {
    fc.assert(
      fc.property(rosterArb(50), (cands) => {
        const share = new Map(
          allocateShares(
            cands.map((x) => ({ id: x.id, tier: sovTierOf(x.tier), is_local: x.isLocal }))
          ).map((s) => [s.id, s.sharePct])
        );
        for (const r of lineHours(cands)) {
          const pct = share.get(r.candidate.id)!;
          expect(r.hours).toBeGreaterThanOrEqual(1);
          expect(Math.abs(r.hours - pct)).toBeLessThan(2);
          // Rounding gives a sponsor at most the next whole hour above its share.
          expect(r.hours).toBeLessThanOrEqual(Math.ceil(pct - 1e-6));
        }
      }),
      { numRuns: 400 }
    );
  });

  test('the order the rows arrive in changes nothing', () => {
    fc.assert(
      fc.property(rosterArb(30), fc.integer({ min: 0, max: 5000 }), (cands, hour) => {
        const turned = cands.slice().reverse();
        expect(hoursOf(turned)).toEqual(hoursOf(cands));
        expect(pickSponsorLine('evt-p', turned, hour)).toEqual(
          pickSponsorLine('evt-p', cands, hour)
        );
      }),
      { numRuns: 200 }
    );
  });

  test('any stretch of one whole cycle shows each sponsor exactly its hours', () => {
    fc.assert(
      fc.property(rosterArb(20), fc.integer({ min: -5000, max: 5000 }), (cands, start) => {
        expect(tally('evt-c', cands, LINE_CYCLE_HOURS, start)).toEqual(
          Object.fromEntries(Object.entries(hoursOf(cands)).filter(([, n]) => n > 0))
        );
      }),
      { numRuns: 100 }
    );
  });
});

// ── Surfaces that show more than one sponsor ─────────────────────────────────
//
// Owner, 2026-11-09: "The local minimum will be on the poster, digital displays
// when > 1 sponsors are displayed including local. This is how the locals are
// always included." The line shows one name an hour; these surfaces show every
// sponsor at once, or one at a time in a rotation every sponsor has a turn in.

describe('where more than one sponsor shows, a local that agreed is always among them', () => {
  const asRow = (x: LineCandidate): SponsorRow => ({
    id: x.id,
    event_id: 'evt-multi',
    name: x.title,
    logo_url: null,
    website_url: null,
    tier: x.tier,
    placement_formats: '[]',
    click_token: null,
    display_token: null,
    is_active: 1,
    is_local: x.isLocal ? 1 : 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  });

  test('the six: all of them at once, and each with a turn in the rotation', () => {
    const bundle = buildSponsorBundle(SIX.map(asRow), 'evt-multi');
    const all = SIX.map((s) => s.id).sort();
    expect(bundle.surface_sponsors.posterTop.map((s) => s.id).sort()).toEqual(all);
    expect(bundle.surface_sponsors.tvTop.map((s) => s.id).sort()).toEqual(all);
    expect([...new Set(bundle.surface_sponsors.tvSide.map((s) => s.id))].sort()).toEqual(all);
  });

  test('any roster with a local: the local is on the poster and the TV, and has a turn', () => {
    fc.assert(
      fc.property(rosterArb(40), fc.string(), (cands, seed) => {
        fc.pre(cands.some((x) => x.isLocal));
        const bundle = buildSponsorBundle(cands.map(asRow), seed);
        for (const local of cands.filter((x) => x.isLocal)) {
          for (const surface of ['posterTop', 'tvTop', 'tvSide', 'mobileBanner'] as const) {
            expect(bundle.surface_sponsors[surface].some((s) => s.id === local.id)).toBe(true);
          }
        }
      }),
      { numRuns: 200 }
    );
  });
});

// ── The same size and spot for every name ────────────────────────────────────

describe('every name prints the same way', () => {
  test('the card line for a top-level pick and for a base pick differ in the name only', () => {
    const event = { id: 'evt-x', name: 'Harvest Night', startDateISO: '2027-01-10' };
    const a = renderEventCard(event, { sponsorTitle: 'Title of s-top' });
    const b = renderEventCard(event, { sponsorTitle: 'Title of s-base-a' });
    expect(a).toContain('data-testid="public-event-sponsor"');
    expect(a).not.toBe(b);
    expect(a.replace('Title of s-top', 'NAME')).toBe(b.replace('Title of s-base-a', 'NAME'));
  });

  test('the line sits after the title and the date in the card', () => {
    const html = renderEventCard(
      { id: 'evt-x', name: 'Harvest Night', startDateISO: '2027-01-10' },
      { sponsorTitle: 'Title of s-top' }
    );
    const at = html.indexOf('data-testid="public-event-sponsor"');
    const name = html.indexOf('data-testid="public-event-name"');
    const date = html.indexOf('data-testid="public-event-date"');
    expect(name).toBeGreaterThan(-1);
    expect(date).toBeGreaterThan(name);
    expect(at).toBeGreaterThan(date);
  });

  test('what leaves the read is a title and nothing else: no level, no local flag', async () => {
    const titles = await fetchSponsorTitles(fakeDb(rowsFor('evt-1', SIX)), 'root', 0);
    expect([...titles.entries()]).toEqual([['evt-1', pickSponsorLine('evt-1', SIX, 0)!.title]]);
    expect(typeof titles.get('evt-1')).toBe('string');
  });
});

// ── The read, over a fake D1 ─────────────────────────────────────────────────

interface Row {
  event_id: string;
  id: string;
  title: string;
  tier: string | null;
  is_local: number | null;
}
const rowsFor = (eventId: string, cands: readonly LineCandidate[]): Row[] =>
  cands.map((x) => ({
    event_id: eventId,
    id: x.id,
    title: x.title,
    tier: x.tier,
    is_local: x.isLocal ? 1 : 0,
  }));

interface Seen {
  sql?: string;
  /** What each read was bound with, in order. */
  binds?: unknown[][];
}

/**
 * A D1 that answers the statement the way the real one does: rows in event then
 * sponsor order, after the row named by the second and third bound values, one
 * page at a time. (The real statement runs in tests/sponsor-line-titles.spec.ts.)
 */
function fakeDb(rows: Row[], seen: Seen = {}): D1Database {
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const sorted = rows.slice().sort((a, b) => cmp(a.event_id, b.event_id) || cmp(a.id, b.id));
  return {
    prepare(sql: string) {
      seen.sql = sql;
      return {
        bind(...args: unknown[]) {
          (seen.binds ??= []).push(args);
          const [, afterEvent, afterId] = args as string[];
          const results = sorted
            .filter(
              (r) => r.event_id > afterEvent! || (r.event_id === afterEvent && r.id > afterId!)
            )
            .slice(0, SPONSOR_TITLE_PAGE_ROWS);
          return { all: async () => ({ results }) };
        },
      };
    },
  } as unknown as D1Database;
}

describe('fetchSponsorTitles: rows in, one title per event out', () => {
  const HOUR = 3_600_000;

  test('each event gets the pick for the clock hour it is asked in', async () => {
    const rows = [...rowsFor('evt-1', SIX), ...rowsFor('evt-2', [c('solo', 'bronze')])];
    for (const hour of [0, 1, 37, 99, 100, 490_000]) {
      const titles = await fetchSponsorTitles(fakeDb(rows), 'root', hour * HOUR + 1234);
      expect(titles.get('evt-1')).toBe(pickSponsorLine('evt-1', SIX, hour)!.title);
      expect(titles.get('evt-2')).toBe('Title of solo');
      expect(titles.size).toBe(2);
    }
  });

  test('over 100 hours the read shows each sponsor its hours', async () => {
    const three = [c('top', 'platinum'), c('mid', 'gold'), c('loc', 'bronze', true)];
    const seen: Record<string, number> = {};
    for (let h = 0; h < 100; h++) {
      const t = (await fetchSponsorTitles(fakeDb(rowsFor('evt-3', three)), 'root', h * HOUR)).get(
        'evt-3'
      )!;
      seen[t] = (seen[t] ?? 0) + 1;
    }
    expect(seen).toEqual({ 'Title of top': 40, 'Title of mid': 20, 'Title of loc': 40 });
  });

  test('the level and the local flag are read from the row', async () => {
    const asRows = (tier: string | null, local: number | null): Row[] => [
      { event_id: 'e', id: 'top', title: 'Top', tier: 'title', is_local: 0 },
      { event_id: 'e', id: 'base', title: 'Base', tier: 'bronze', is_local: 0 },
      { event_id: 'e', id: 'x', title: 'X', tier, is_local: local },
    ];
    const count = async (rows: Row[]): Promise<number> => {
      let n = 0;
      for (let h = 0; h < 100; h++) {
        if ((await fetchSponsorTitles(fakeDb(rows), 'root', h * HOUR)).get('e') === 'X') n++;
      }
      return n;
    };
    expect(await count(asRows('bronze', 1))).toBe(45); // a local base
    expect(await count(asRows('bronze', 0))).toBe(30); // the same, not local
    expect(await count(asRows('bronze', null))).toBe(30); // no flag stored: not local
    expect(await count(asRows(null, 0))).toBe(30); // no level stored: base
    expect(await count(asRows('title', 0))).toBe(40); // a second top level
  });

  test('the brand is bound, never written into the statement', async () => {
    const seen: Seen = {};
    await fetchSponsorTitles(fakeDb([], seen), "ro'ot", 0);
    expect(seen.binds).toEqual([["ro'ot", '', '']]);
    expect(seen.sql).not.toContain("ro'ot");
    expect(seen.sql).toContain('sb.brand_id = ?1 AND e.brand_id = ?1');
  });

  test('more rows than one read: the next read starts after the last row, and a list split across two reads is whole', async () => {
    // 499 rows of one event, then three of another: the first read ends one row
    // into the second event's sponsors.
    const first = Array.from({ length: SPONSOR_TITLE_PAGE_ROWS - 1 }, (_, i) =>
      c(`a-${String(i).padStart(4, '0')}`, 'bronze')
    );
    const split = [c('z-1', 'title'), c('z-2', 'bronze'), c('z-3', 'bronze', true)];
    const rows = [...rowsFor('evt-a', first), ...rowsFor('evt-z', split)];
    const seen: Seen = {};
    for (const hour of [0, 13, 58, 99]) {
      const titles = await fetchSponsorTitles(fakeDb(rows, seen), 'root', hour * HOUR);
      expect(titles.get('evt-z')).toBe(pickSponsorLine('evt-z', split, hour)!.title);
      expect(titles.has('evt-a')).toBe(true);
    }
    expect(seen.binds!.slice(0, 2)).toEqual([
      ['root', '', ''],
      ['root', 'evt-z', 'z-1'],
    ]);
    // Over a whole cycle the split event shows the hours of all three, not of one.
    const tally: Record<string, number> = {};
    for (let h = 0; h < 100; h++) {
      const t = (await fetchSponsorTitles(fakeDb(rows), 'root', h * HOUR)).get('evt-z')!;
      tally[t] = (tally[t] ?? 0) + 1;
    }
    expect(tally).toEqual({ 'Title of z-1': 40, 'Title of z-2': 15, 'Title of z-3': 45 });
  });

  test('a read that comes back full is followed by another, and an empty one ends it with nothing dropped', async () => {
    const full = Array.from({ length: SPONSOR_TITLE_PAGE_ROWS - 1 }, (_, i) =>
      c(`a-${String(i).padStart(4, '0')}`, 'bronze')
    );
    const rows = [...rowsFor('evt-a', full), ...rowsFor('evt-z', [c('z-1', 'bronze')])];
    expect(rows).toHaveLength(SPONSOR_TITLE_PAGE_ROWS);
    const seen: Seen = {};
    const titles = await fetchSponsorTitles(fakeDb(rows, seen), 'root', 0);
    expect(seen.binds).toHaveLength(2);
    expect(titles.has('evt-a')).toBe(true);
    expect(titles.get('evt-z')).toBe('Title of z-1');
  });

  test('past the last read allowed, the event it stopped in and the ones after it show no line; the ones before keep theirs', async () => {
    // Ten sponsors an event, enough events to fill every read, and one more.
    const ten = Array.from({ length: 10 }, (_, i) => c(`s-${i}`, i === 0 ? 'title' : 'bronze'));
    const events = (SPONSOR_TITLE_PAGE_ROWS * SPONSOR_TITLE_MAX_PAGES) / 10;
    const rows: Row[] = [];
    for (let e = 0; e < events; e++)
      rows.push(...rowsFor(`evt-${String(e).padStart(4, '0')}`, ten));
    rows.push(...rowsFor('evt-zzzz', ten));
    const seen: Seen = {};
    const titles = await fetchSponsorTitles(fakeDb(rows, seen), 'root', 0);
    expect(seen.binds).toHaveLength(SPONSOR_TITLE_MAX_PAGES);
    const lastRead = `evt-${String(events - 1).padStart(4, '0')}`;
    const before = `evt-${String(events - 2).padStart(4, '0')}`;
    expect(titles.has(before)).toBe(true);
    expect(titles.has('evt-0000')).toBe(true);
    expect(titles.has(lastRead)).toBe(false);
    expect(titles.has('evt-zzzz')).toBe(false);
    expect(titles.size).toBe(events - 1);
  });

  test('the statement reads one page, after a given row, in event then sponsor order', async () => {
    const seen: Seen = {};
    await fetchSponsorTitles(fakeDb([], seen), 'root', 0);
    expect(seen.sql).toContain(`LIMIT ${SPONSOR_TITLE_PAGE_ROWS}`);
    expect(seen.sql).toContain('ORDER BY sp.event_id ASC, sb.id ASC');
    expect(seen.sql).toContain('AND (sp.event_id > ?2 OR (sp.event_id = ?2 AND sb.id > ?3))');
  });

  test('one event whose rows cannot be worked out loses its own line; the others keep theirs', async () => {
    // A level that is not a level at all (it names a built-in) makes the share
    // math refuse the list it is in. It is read first of the three, so a
    // failure that was not held to its own event would take the other two with it.
    const rows: Row[] = [
      ...rowsFor('evt-1', SIX),
      { event_id: 'evt-0-bad', id: 'x', title: 'X', tier: 'constructor', is_local: 0 },
      { event_id: 'evt-0-bad', id: 'y', title: 'Y', tier: 'bronze', is_local: 0 },
      ...rowsFor('evt-2', [c('solo', 'bronze')]),
    ];
    const titles = await fetchSponsorTitles(fakeDb(rows), 'root', 0);
    expect(titles.has('evt-0-bad')).toBe(false);
    expect(titles.get('evt-1')).toBe(pickSponsorLine('evt-1', SIX, 0)!.title);
    expect(titles.get('evt-2')).toBe('Title of solo');
  });

  test('no rows, no database, a failing database: an empty map, never a throw', async () => {
    expect((await fetchSponsorTitles(fakeDb([]), 'root', 0)).size).toBe(0);
    expect((await fetchSponsorTitles(null, 'root', 0)).size).toBe(0);
    expect((await fetchSponsorTitles(undefined, 'root', 0)).size).toBe(0);
    const broken = {
      prepare() {
        throw new Error('D1 is down');
      },
    } as unknown as D1Database;
    expect((await fetchSponsorTitles(broken, 'root', 0)).size).toBe(0);
  });

  test('with no time given it reads the clock, and only the clock', async () => {
    const rows = rowsFor('evt-1', SIX);
    const before = hourOf(Date.now());
    const got = (await fetchSponsorTitles(fakeDb(rows), 'root')).get('evt-1');
    const after = hourOf(Date.now());
    expect([
      pickSponsorLine('evt-1', SIX, before)!.title,
      pickSponsorLine('evt-1', SIX, after)!.title,
    ]).toContain(got);
  });
});

// ── Never who ────────────────────────────────────────────────────────────────

describe('never who: nothing about the visitor can reach the pick', () => {
  const read = (file: string): string =>
    readFileSync(resolve(__dirname, '..', 'src', 'lib', file), 'utf8')
      // Comments say what the code does not do; only the code is read here.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  test('the pick takes the event id, the sponsors and the hour, and the read takes a database, a brand and a time', () => {
    expect(pickSponsorLine.length).toBe(3);
    expect(lineCycle.length).toBe(2);
    expect(lineHours.length).toBe(1);
    // The time has a default, so it is not counted.
    expect(fetchSponsorTitles.length).toBe(2);
  });

  test.each(['sponsor-line-pick.ts', 'sponsor-titles.ts'])(
    '%s names no request, header, cookie, address or random source',
    (file) => {
      const code = read(file);
      for (const word of [
        /\brequest\b/i,
        /\bheaders?\b/i,
        /\bcookie/i,
        /\bcf\b/i,
        /CF-/i,
        /user-?agent/i,
        /\bip\b/i,
        /Math\.random/,
        /\bcrypto\b/,
        /ose_anon/,
      ]) {
        expect(code, `${file} must not read ${word}`).not.toMatch(word);
      }
    }
  );

  test('the three callers pass a database and a brand, and no third value: the time is the clock, never theirs to give', () => {
    const src = (f: string): string =>
      readFileSync(resolve(__dirname, '..', 'src', 'handlers', f), 'utf8');
    const calls = [
      ...(src('pages.ts') + src('events.ts')).matchAll(/fetchSponsorTitles\(([^;]*?)\)\s*[,;)]/g),
    ];
    expect(calls.length).toBe(3);
    for (const m of calls) {
      const args = m[1]!.split(',').map((a) => a.trim());
      expect(args, m[0]).toHaveLength(2);
      expect(args[0]).toMatch(/\.DB$/);
      expect(args[1]).toMatch(/^('root'|brand)$/);
    }
  });

  test('the shuffle the pick borrows is seeded from its text alone', () => {
    const resolver = read('sponsor-resolver.ts');
    const shuffle = resolver.slice(
      resolver.indexOf('function xmur3'),
      resolver.indexOf('const ROTATION_GRANULARITY')
    );
    expect(shuffle).toContain('export function seededShuffle');
    for (const word of [/Math\.random/, /\bcrypto\b/, /Date\./, /\brequest\b/i, /\bheaders?\b/i]) {
      expect(shuffle).not.toMatch(word);
    }
  });
});

// ── The staging layer's literal ──────────────────────────────────────────────
//
// Bruno cannot run this code, and what staging shows depends on the hour. So the
// staging folder carries the fixture event's whole cycle as a literal (one
// letter a sponsor, one letter an hour) and reads the letter for the hour of the
// request. This block is what ties that literal, and the fixture's rows, to the
// code: change the pick and this goes red until the folder is regenerated.

describe('staging fixture: the Bruno folder and its seed match this code', () => {
  const ROOT = resolve(__dirname, '..', '..', '..');
  const EVENT = 'covline-evt';
  const FIXTURE: Array<LineCandidate & { letter: string }> = [
    { letter: 'T', id: 'covline-top', title: 'Covline Top Level', tier: 'title', isLocal: false },
    { letter: 'M', id: 'covline-mid', title: 'Covline Middle', tier: 'gold', isLocal: false },
    { letter: 'B', id: 'covline-base', title: 'Covline Base', tier: 'bronze', isLocal: false },
    { letter: 'L', id: 'covline-local', title: 'Covline Local', tier: 'bronze', isLocal: true },
  ];
  const letters = lineCycle(EVENT, FIXTURE)
    .map((s) => FIXTURE.find((f) => f.id === s.id)!.letter)
    .join('');

  test('the cycle is 100 hours: top 40, middle 18, base 6, local 36 (worked by hand)', () => {
    // Floor 30 to the local. The other 70 by weight 7 : 3 : 1 : 1: the top level
    // wants 40.8 and stops at 40; the 0.8 it leaves goes on by weight 3 : 1 : 1.
    expect(letters).toHaveLength(100);
    const n = (l: string): number => letters.split(l).length - 1;
    expect({ T: n('T'), M: n('M'), B: n('B'), L: n('L') }).toEqual({ T: 40, M: 18, B: 6, L: 36 });
    // Printed for whoever regenerates the Bruno folder after a change to the pick.
    expect(letters).toMatch(/^[TMBL]{100}$/);
  });

  test('every request in the folder that reads the line carries this cycle', () => {
    const dir = resolve(ROOT, 'bruno', 'ose-api', '21. Sponsor line by covenant share (OSE-1901)');
    const files = [
      'OSE-1901 - events list API - the line is the covenant pick for this hour.yml',
      'OSE-1901 - events page - the card line is the covenant pick for this hour.yml',
    ];
    for (const f of files) {
      const text = readFileSync(resolve(dir, f), 'utf8');
      expect(text, f).toContain(`'${letters}'`);
      for (const s of FIXTURE) expect(text, f).toContain(`${s.letter}: '${s.title}'`);
    }
  });

  test('the seed gives each fixture sponsor the level and local flag the cycle was worked out for', () => {
    const seed = readFileSync(resolve(ROOT, 'bruno', 'fixtures', 'sponsor-line-seed.sql'), 'utf8');
    for (const s of FIXTURE) {
      expect(seed).toContain(`('${s.id}', 'root', '${s.title}'`);
      expect(seed).toContain(
        `('pl-${s.id}', '${s.id}', '${EVENT}', '${s.tier}', ${s.isLocal ? 1 : 0}, 'organizer', 1, 1, 1)`
      );
    }
    // The column order those rows are read in.
    expect(seed).toContain(
      '(id, sponsor_business_id, event_id, tier, locality_band, source, is_active, sponsor_accepted, organizer_accepted)'
    );
    // Exactly four placements show; the other three each lack one thing.
    expect(seed.split("'organizer', 1, 1, 1)").length - 1).toBe(4);
  });
});
