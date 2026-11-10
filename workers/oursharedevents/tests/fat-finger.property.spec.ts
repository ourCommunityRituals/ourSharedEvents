/**
 * Fat-finger property tests — the wizard's input edges, fuzzed.
 *
 * WHY PROPERTY TESTS AND NOT MORE EXAMPLES
 * OSE-663's acceptance reads "Property tests pass at every demand level."
 * What shipped (tests/sponsor-share-covenant.spec.ts) is nine hand-picked
 * examples: the walls are asserted at CHOSEN demand levels, not at every one.
 * Examples prove the cases an author thought of. A fat finger, by definition,
 * is the case nobody thought of.
 *
 * These run with a small case count in CI and a large one overnight, via
 * FC_RUNS (see .github/workflows/overnight-fuzz.yml). A counterexample is
 * reproducible forever from the seed fast-check prints on failure.
 *
 * BORN RED: the surrogate property below FAILS against current trimStr().
 * That is deliberate — fail first, then pass.
 *
 * @born-red ?area= properties (landingZoom) | method: 5 faults injected in
 *   src/lib/landing-area.ts one at a time (the 15-hex shape check removed, the
 *   resolution check removed, toLowerCase removed, every query parameter
 *   carried into the links, the area always written into the link); each
 *   turned a property here red. A sixth, the isValidCell check removed, cannot
 *   go red: h3-js getResolution answers -1 for a string that is not a cell, so
 *   the resolution check refuses it too | date: 2026-11-09
 */
import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { trimStr, isValidEventId } from '../src/lib/form-validation';
import { allocateShares, SPONSOR_ALLOCATION } from '../src/lib/sponsor-allocation';
import type { RotationSponsor } from '../src/lib/sponsor-allocation';
import { cellToCenterChild, cellToParent, getResolution, isValidCell, latLngToCell } from 'h3-js';
import { landingZoom } from '../src/lib/landing-area';
import { renderPreEventHtml, type PublicEventRow } from '../src/handlers/pages';
import { validateProxiedLogoUrl, isBlockedLogoHost } from '../src/lib/sponsor-logo';

const RUNS = Number(process.env.FC_RUNS ?? 200);
const opts = { numRuns: RUNS } as const;

const hasLoneSurrogate = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1);
      if (!(n >= 0xdc00 && n <= 0xdfff)) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
};

describe('fat-finger | trimStr — bounded text fields (event name, sourceId, ...)', () => {
  test('never emits a lone surrogate (emoji pasted at the truncation boundary)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), fc.integer({ min: 0, max: 64 }), (s, max) => {
        const out = trimStr(s, max);
        expect(out === undefined || !hasLoneSurrogate(out)).toBe(true);
      }),
      opts
    );
  });

  test('never exceeds max, and never returns leading whitespace', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 0, max: 256 }), (s, max) => {
        const out = trimStr(s, max);
        if (out === undefined) return;
        expect(out.length).toBeLessThanOrEqual(max);
        expect(out).toBe(out.trimStart());
      }),
      opts
    );
  });

  test('non-strings are rejected, never coerced', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.object(), fc.array(fc.string())),
        // Block body on purpose: an expression-body arrow returns Vitest's
        // Assertion object, which fast-check rejects as a non-boolean result.
        (v) => {
          expect(trimStr(v, 32)).toBeUndefined();
        }
      ),
      opts
    );
  });
});

describe('fat-finger | isValidEventId — pasted/mistyped ids', () => {
  test('never accepts whitespace, control chars, or path separators', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', minLength: 1 }), (s) => {
        if (/[\s/\\. -]/.test(s)) expect(isValidEventId(s)).toBe(false);
      }),
      opts
    );
  });

  test('is total — never throws on any string input', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (s) => {
        expect(() => isValidEventId(s)).not.toThrow();
      }),
      opts
    );
  });
});

describe('fat-finger | allocateShares — Invariant #25 walls at EVERY demand level', () => {
  const walls = SPONSOR_ALLOCATION.share_of_voice.walls;
  const sponsorArb = fc.record({
    id: fc.string({ minLength: 1, maxLength: 8 }),
    tier: fc.constantFrom<'base' | 'mid' | 'premium'>('base', 'mid', 'premium'),
    is_local: fc.boolean(),
  });
  // Distinct ids: a duplicate id is a caller bug, not a wall breach.
  const rosterArb = fc
    .uniqueArray(sponsorArb, { minLength: 1, maxLength: 40, selector: (s) => s.id })
    .map((a) => a as RotationSponsor[]);

  test('WALL: shares always sum to 100', () => {
    fc.assert(
      fc.property(rosterArb, (roster) => {
        const total = allocateShares(roster).reduce((a, e) => a + e.sharePct, 0);
        expect(total).toBeCloseTo(100, 6);
      }),
      opts
    );
  });

  test('WALL: local floor — is_local collectively holds >= floor whenever present', () => {
    fc.assert(
      fc.property(rosterArb, (roster) => {
        if (!roster.some((s) => s.is_local)) return;
        const localIds = new Set(roster.filter((s) => s.is_local).map((s) => s.id));
        const got = allocateShares(roster)
          .filter((e) => localIds.has(e.id))
          .reduce((a, e) => a + e.sharePct, 0);
        expect(got).toBeGreaterThanOrEqual(walls.local_floor_pct - 1e-6);
      }),
      opts
    );
  });

  test('WALL: no is_local sponsor is ever zeroed', () => {
    fc.assert(
      fc.property(rosterArb, (roster) => {
        const localIds = new Set(roster.filter((s) => s.is_local).map((s) => s.id));
        for (const e of allocateShares(roster)) {
          if (localIds.has(e.id)) expect(e.sharePct).toBeGreaterThan(0);
        }
      }),
      opts
    );
  });

  // The cap is only claimed to bind where it is SATISFIABLE. allocateShares'
  // docstring carves out the "sponsor-sparse regime": with too few sponsors to
  // fill the surface, shares are forced above the cap (one sponsor is
  // necessarily 100%). A premium's raw weighted share is w.premium/totalWeight,
  // so the cap can only bind once totalWeight >= w.premium / (cap/100) — with
  // the ratified 1/3/7 weights and a 40% cap, that is 17.5.
  const w = SPONSOR_ALLOCATION.share_of_voice.weights;
  const totalWeight = (r: RotationSponsor[]) =>
    r.reduce(
      (a, s) => a + (s.tier === 'premium' ? w.premium : s.tier === 'mid' ? w.mid : w.base),
      0
    );
  const capIsSatisfiable = (r: RotationSponsor[]) =>
    totalWeight(r) >= w.premium / (walls.premium_cap_pct / 100);

  test('WALL: premium cap holds wherever the cap is satisfiable', () => {
    fc.assert(
      fc.property(rosterArb.filter(capIsSatisfiable), (roster) => {
        const byId = new Map(roster.map((s) => [s.id, s]));
        for (const e of allocateShares(roster)) {
          if (byId.get(e.id)?.tier === 'premium') {
            expect(e.sharePct).toBeLessThanOrEqual(walls.premium_cap_pct + 1e-6);
          }
        }
      }),
      opts
    );
  });

  test('WALL: output carries ONLY {id, sharePct} — size/slot unpurchasable by construction', () => {
    fc.assert(
      fc.property(rosterArb, (roster) => {
        for (const e of allocateShares(roster)) {
          expect(Object.keys(e).sort()).toEqual(['id', 'sharePct']);
        }
      }),
      opts
    );
  });

  test('deterministic — identical input yields identical output', () => {
    fc.assert(
      fc.property(rosterArb, (roster) => {
        expect(allocateShares(roster)).toEqual(allocateShares(roster));
      }),
      opts
    );
  });
});

// The landing map's zoom reads one thing a visitor can type: `?area=<cell>`
// (owner, 2026-11-09). The rule: it is a res-7 H3 cell written as exactly 15 hex
// digits, or it is nothing; and the links the page builds from the address carry
// the search (where, zip, nozip) and nothing else. map-zoom.spec.ts holds the
// chosen examples; these hold the rule for input nobody chose.
describe('fat-finger | ?area= — the landing map zoom (landingZoom)', () => {
  const KEPT = ['where', 'zip', 'nozip'] as const;
  const BASE = 'https://t.test/';

  /** The landing address with these parameters, encoded as a browser would. */
  const address = (params: readonly (readonly [string, string])[]): URL => {
    const u = new URL(BASE);
    for (const [k, v] of params) u.searchParams.append(k, v);
    return u;
  };
  const read = (area: string) => landingZoom(address([['area', area]]), '/');

  /** Any real res-7 cell: a point anywhere on Earth, tagged at the area resolution. */
  const cellArb = fc
    .tuple(
      fc.double({ min: -90, max: 90, noNaN: true }),
      fc.double({ min: -180, max: 180, noNaN: true })
    )
    .map(([lat, lng]) => latLngToCell(lat, lng, 7));
  /** Fifteen hex digits in either case: the right shape, almost never a real cell. */
  const hex15Arb = fc
    .array(fc.constantFrom(...'0123456789abcdefABCDEF'), { minLength: 15, maxLength: 15 })
    .map((a) => a.join(''));
  /** What a slip adds round a cell: zeros, spaces, a prefix, a pasted character. */
  const noiseArb = fc.oneof(
    fc.string({ minLength: 1, maxLength: 12 }),
    fc.string({ unit: 'binary', minLength: 1, maxLength: 12 }),
    fc.constantFrom('0', '00', ' ', '\t', '\n', '0x', '%00', '​', '+', 'f'),
    fc.integer({ min: 1, max: 3000 }).map((n) => '0'.repeat(n))
  );
  const searchArb = fc.record(
    { where: fc.string(), zip: fc.string(), nozip: fc.string() },
    { requiredKeys: [] }
  );
  const searchPairs = (s: Partial<Record<(typeof KEPT)[number], string>>) =>
    KEPT.filter((k) => s[k] !== undefined).map((k) => [k, s[k]!] as const);

  test('whatever is typed, the answer is nothing or the typed res-7 cell itself', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.string({ unit: 'binary' }), hex15Arb, cellArb),
        (typed) => {
          const { cell } = read(typed);
          if (cell === null) return;
          expect(cell).toMatch(/^[0-9a-f]{15}$/);
          expect(isValidCell(cell)).toBe(true);
          expect(getResolution(cell)).toBe(7);
          expect(cell).toBe(typed.toLowerCase());
        }
      ),
      opts
    );
  });

  test('a real res-7 cell zooms, typed in either case, and comes back lower case', () => {
    fc.assert(
      fc.property(cellArb, fc.boolean(), (cell, upper) => {
        expect(read(upper ? cell.toUpperCase() : cell).cell).toBe(cell);
      }),
      opts
    );
  });

  test('a real cell with anything before or after it never zooms', () => {
    fc.assert(
      fc.property(cellArb, noiseArb, fc.boolean(), (cell, noise, before) => {
        expect(read(before ? noise + cell : cell + noise).cell).toBeNull();
      }),
      opts
    );
  });

  test('a real cell cut short never zooms', () => {
    fc.assert(
      fc.property(cellArb, fc.integer({ min: 0, max: 14 }), (cell, keep) => {
        expect(read(cell.slice(0, keep)).cell).toBeNull();
      }),
      opts
    );
  });

  test('a cell at any other resolution never zooms', () => {
    fc.assert(
      fc.property(
        cellArb,
        fc.integer({ min: 0, max: 15 }).filter((r) => r !== 7),
        (cell, res) => {
          const other = res < 7 ? cellToParent(cell, res) : cellToCenterChild(cell, res);
          expect(getResolution(other)).toBe(res);
          expect(read(other).cell).toBeNull();
        }
      ),
      opts
    );
  });

  test('the links carry the search and nothing else, whatever else is in the address', () => {
    fc.assert(
      fc.property(
        searchArb,
        fc.array(fc.tuple(fc.string(), fc.string()), { maxLength: 6 }),
        fc.oneof(fc.string(), cellArb),
        cellArb,
        (search, others, typedArea, target) => {
          const kept = searchPairs(search);
          const extra = others.filter(([k]) => !(KEPT as readonly string[]).includes(k));
          const z = landingZoom(address([...extra, ['area', typedArea], ...kept]), '/');

          const back = new URL(z.href(), BASE);
          expect(back.pathname).toBe('/');
          expect([...back.searchParams.entries()]).toEqual(kept.map(([k, v]) => [k, v]));

          const zoomIn = new URL(z.href(target), BASE);
          expect(zoomIn.pathname).toBe('/');
          expect([...zoomIn.searchParams.entries()]).toEqual([
            ...kept.map(([k, v]) => [k, v]),
            ['area', target],
          ]);
        }
      ),
      opts
    );
  });

  test('a zoom link, followed, zooms on that cell and keeps the same way back', () => {
    fc.assert(
      fc.property(searchArb, cellArb, (search, cell) => {
        const first = landingZoom(address(searchPairs(search)), '/');
        const followed = landingZoom(new URL(first.href(cell), BASE), '/');
        expect(followed.cell).toBe(cell);
        expect(followed.href()).toBe(first.href());
      }),
      opts
    );
  });
});

// ── OSE-1955: the event page's sponsor thumbnails, for any title, id and link ──
//
// The killer spec (sponsor-thumb-render.spec.ts) pins each branch with chosen
// inputs. These properties hold the same rule for ANY input an admin or a
// sponsor can type: the item is always well-formed markup with one link, the
// title is always escaped text (alt or link text), the src always names the
// same-origin proxy, and no logo URL that would leave the Worker as written
// passes the write check. The oracles below are written here, not imported.

/** Independent oracle for the five-character HTML escape. */
const oracleEsc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );

function thumbRow(): PublicEventRow {
  return {
    id: 'evt_prop',
    brand_id: 'root',
    title: 'Prop Party',
    slug: 'prop-party',
    status: 'active',
    location: 'Hall',
    start_date: '2026-10-24',
    end_date: '2026-10-24',
    timezone: 'America/Chicago',
    starts_at: '2026-10-24T23:00:00Z',
    is_published: 1,
  } as PublicEventRow;
}

type ThumbSponsor = NonNullable<Parameters<typeof renderPreEventHtml>[2]>['sponsors'][number];

/** The one rendered <li> body for one sponsor, exactly as the page carries it. */
function renderOneItem(s: ThumbSponsor): string {
  const html = renderPreEventHtml(
    thumbRow(),
    'https://oursharedevents.com/events/evt_prop',
    { sponsors: [s], regCount: 0, checkinCount: 0, surveyCount: 0, emailCount: 0 },
    { nonce: 'n', lang: 'en' }
  );
  const open = '<li class="ose-sponsor-item" data-testid="sponsor-item">';
  const at = html.indexOf(open);
  expect(at).toBeGreaterThan(-1);
  expect(html.indexOf(open, at + 1), 'one item per sponsor').toBe(-1);
  return html.slice(at + open.length, html.indexOf('</li>', at));
}

const printable = fc.string({ minLength: 1, maxLength: 40 }).filter((s) => !hasLoneSurrogate(s));
const sponsorArb = fc.record({
  id: printable,
  name: printable,
  display_name: fc.option(
    fc.string({ maxLength: 30 }).filter((s) => !hasLoneSurrogate(s)),
    { nil: null }
  ),
  website_url: fc.option(
    fc.oneof(
      fc.webUrl(),
      fc.constantFrom(
        'javascript:alert(1)',
        'http://plain.example',
        'HTTPS://UP.EXAMPLE',
        'https://a.example/"><x'
      ),
      printable
    ),
    { nil: null }
  ),
  address_line: fc.option(printable, { nil: null }),
  has_logo: fc.constantFrom(0, 1, null),
});

describe('fat-finger | OSE-1955 sponsor thumbnail — any title, any id, any link', () => {
  test('the item is one link of known tags, with no handler attribute', () => {
    fc.assert(
      fc.property(sponsorArb, (s) => {
        const item = renderOneItem(s);
        const bare = item.replace(/="[^"]*"/g, '=""');
        const tags = [...bare.matchAll(/<\/?([a-zA-Z][\w-]*)/g)].map((m) => m[1].toLowerCase());
        expect(new Set(tags)).toEqual(
          new Set(tags.filter((t) => ['a', 'img', 'div', 'small'].includes(t)))
        );
        expect(tags.filter((t) => t === 'a')).toHaveLength(2); // <a …> and </a>
        expect(bare).not.toMatch(/\son[a-z]+\s*=/i);
      }),
      opts
    );
  });

  test('art when there is a logo: the proxy src for the id, the escaped title as alt, no address', () => {
    fc.assert(
      fc.property(sponsorArb, (s) => {
        const item = renderOneItem(s);
        const title = (s.display_name ?? '').trim() || s.name;
        if (s.has_logo) {
          const src = `/api/v2/sponsors/${encodeURIComponent(s.id)}/logo?slot=sidebar`;
          expect(item).toContain(`src="${oracleEsc(src)}" alt="${oracleEsc(title)}"`);
          expect(item).not.toContain('sponsor-item-address');
        } else {
          expect(item).not.toContain('<img');
          expect(item).toContain(`>${oracleEsc(title)}</a>`);
        }
      }),
      opts
    );
  });

  test('the tap goes to an https website with noreferrer, or to the sponsor card — never elsewhere', () => {
    fc.assert(
      fc.property(sponsorArb, (s) => {
        const item = renderOneItem(s);
        const href = item.match(/<a href="([^"]*)"/)![1];
        if ((s.website_url ?? '').startsWith('https://')) {
          expect(href).toBe(oracleEsc(s.website_url!));
          expect(item).toContain('rel="noopener noreferrer nofollow"');
        } else {
          expect(href).toBe(oracleEsc(`/sponsors/${encodeURIComponent(s.id)}`));
          expect(item).not.toContain('rel=');
        }
      }),
      opts
    );
  });
});

describe('fat-finger | OSE-1955 a logo URL the Worker will fetch (validateProxiedLogoUrl)', () => {
  const urlArb = fc.oneof(
    fc.webUrl({
      authoritySettings: { withUserInfo: true, withIPv4: true, withIPv6: true, withPort: true },
    }),
    fc.webUrl().map((u) => `  ${u}  `),
    fc.webUrl().map((u) => u.toUpperCase()),
    fc.webUrl().map((u) => u.replace(/^https?:/, 'javascript:')),
    fc.webUrl().map((u) => u.replace(/^https?:/, 'data:')),
    fc.webUrl().map((u) => `${u}/${'a'.repeat(500)}`),
    fc.string({ unit: 'binary' })
  );

  test('anything accepted is http(s), at most 500 characters, carries no credentials, on a public host', () => {
    fc.assert(
      fc.property(urlArb, (raw) => {
        const r = validateProxiedLogoUrl(raw);
        if (!r.valid) {
          expect(r.url).toBeNull();
          return;
        }
        if (r.url === null) return; // empty means "no logo"
        expect(r.url.length).toBeLessThanOrEqual(500);
        const u = new URL(r.url);
        expect(['http:', 'https:']).toContain(u.protocol);
        expect(u.username).toBe('');
        expect(u.password).toBe('');
        expect(isBlockedLogoHost(u.hostname)).toBe(false);
      }),
      opts
    );
  });
});
