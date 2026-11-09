/* eslint-disable security/detect-non-literal-fs-filename -- reads the repo's own stock files */
/**
 * The stg poster showcase (owner 2026-11-08): each stock poster carries the code
 * set its event type suggests (events; + registration; + registration + donation),
 * and every run shows each set with landscape AND portrait art. Stock data only:
 * the app reads none of this, and an organizer's choice of codes stays free.
 */
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../../..');
const readJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const SEED = readJson('stock/seed/seed.json');
const CODE_SETS = readJson('stock/poster-code-sets.json');
const ART_TAGS = readJson('stock/art-tags.json');

let P;
let S;
let pickArt;
let localPosts;
beforeAll(async () => {
  P = await import('../../../scripts/stock/poster-showcase.mjs');
  S = await import('../../../scripts/stock/seed.mjs');
  ({ pickArt } = await import('../../../scripts/stock/instagram.mjs'));
  ({ localPosts } = await import('../../../scripts/stock/local-art.mjs'));
});

// The catalog's category per type, read from the migration that seeds it: the
// second value of each row is '<CATEGORY>-<NAME>-<NNN>'.
const TYPE_CATEGORY = (() => {
  const dir = path.join(ROOT, 'workers/oursharedevents/migrations');
  const map = new Map();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql'))) {
    const sql = readFileSync(path.join(dir, f), 'utf8');
    for (const m of sql.matchAll(/\(\s*'(etr-[a-z0-9-]+)'\s*,\s*'([A-Z]+)-/g)) map.set(m[1], m[2]);
  }
  return map;
})();

const posts = () => localPosts(require('node:fs'), path.join(ROOT, 'stock/art'));
const pick = (row, list) => pickArt(row, list, ART_TAGS, TYPE_CATEGORY);

const SETS = ['events', 'events+registration', 'events+registration+donation'];

describe('stock/poster-code-sets.json', () => {
  test('reads clean, and names only the three sets', () => {
    const cs = P.readCodeSets(CODE_SETS);
    expect(P.SET_NAMES).toEqual(SETS);
    expect(SETS).toContain(cs.default);
    for (const v of Object.values(CODE_SETS.types)) expect(SETS).toContain(v);
  });

  test('every type it names is in the catalog, and every seed type has a set', () => {
    for (const id of Object.keys(CODE_SETS.types)) expect(TYPE_CATEGORY.has(id)).toBe(true);
    const cs = P.readCodeSets(CODE_SETS);
    for (const e of SEED.events) expect(SETS).toContain(P.setFor(cs, e.event_type_id));
  });

  test('the seed holds every set', () => {
    const cs = P.readCodeSets(CODE_SETS);
    const used = new Set(SEED.events.map((e) => P.setFor(cs, e.event_type_id)));
    expect([...used].sort()).toEqual([...SETS].sort());
  });

  test('a type it does not name starts at the default set', () => {
    const cs = P.readCodeSets(CODE_SETS);
    expect(P.setFor(cs, 'etr-not-a-type')).toBe('events');
  });

  // Failure cases: a bad file stops the build loudly.
  test.each([
    ['no types', { ...CODE_SETS, types: undefined }, /types/],
    ['an unknown set', { ...CODE_SETS, types: { 'etr-x': 'events+tickets' } }, /unknown set/],
    ['an unknown default', { ...CODE_SETS, default: 'all' }, /default/],
    ['a plain http donate link', { ...CODE_SETS, donateUrl: 'http://example.org/d' }, /https/],
    ['a javascript: donate link', { ...CODE_SETS, donateUrl: 'javascript:alert(1)' }, /https/],
    ['a data: donate link', { ...CODE_SETS, donateUrl: 'data:text/html,x' }, /https/],
    ['a donate link with a space', { ...CODE_SETS, donateUrl: 'https://a b' }, /https/],
  ])('refuses %s', (_name, raw, msg) => {
    expect(() => P.readCodeSets(raw)).toThrow(msg);
  });
});

describe('posterCodesBody', () => {
  const URL = 'https://example.org/donate';
  test('events: nothing to save (the event page code is always first)', () => {
    expect(P.posterCodesBody('events', URL)).toBeNull();
  });
  test('events + registration: the event own form, no link sent', () => {
    expect(P.posterCodesBody('events+registration', URL)).toEqual({
      codes: [{ kind: 'register' }],
    });
  });
  test('events + registration + donation: the donate link is the https address', () => {
    expect(P.posterCodesBody('events+registration+donation', URL)).toEqual({
      codes: [{ kind: 'register' }, { kind: 'donation', target_url: URL }],
    });
  });
  test('every set fits the Free plan (3 codes, counting the event page)', () => {
    for (const s of SETS) {
      const body = P.posterCodesBody(s, URL);
      expect(1 + (body ? body.codes.length : 0)).toBeLessThanOrEqual(3);
    }
  });
  test('an unknown set throws', () => {
    expect(() => P.posterCodesBody('events+tickets', URL)).toThrow(/unknown set/);
  });
});

describe('planShowcase', () => {
  test.each(['2026-11-08', '2026-11-09', '2026-11-10', '2026-12-24', '2027-03-01'])(
    'the real seed on %s shows every set with landscape and portrait art',
    (day) => {
      const { accepted } = S.rebaseSeed(SEED, day);
      const plan = P.planShowcase(accepted, {
        codeSets: P.readCodeSets(CODE_SETS),
        posts: posts(),
        pick,
      });
      expect(plan.size).toBe(SEED.events.length);
      expect(P.missingPairs(plan)).toEqual([]);
    }
  );

  test('the plan is the same each time for the same day', () => {
    const { accepted } = S.rebaseSeed(SEED, '2026-11-08');
    const opts = { codeSets: P.readCodeSets(CODE_SETS), posts: posts(), pick };
    const a = P.planShowcase(accepted, opts);
    const b = P.planShowcase(accepted, opts);
    const key = (m) => [...m.values()].map((v) => `${v.set}|${v.post && v.post.id}`);
    expect(key(a)).toEqual(key(b));
  });

  test('a row keeps its pick when its set already has both orientations', () => {
    const { accepted } = S.rebaseSeed(SEED, '2026-11-08');
    const opts = { codeSets: P.readCodeSets(CODE_SETS), posts: posts(), pick };
    const plan = P.planShowcase(accepted, opts);
    const changed = accepted.filter((r) => {
      const natural = pick(r, opts.posts);
      return (natural && natural.id) !== (plan.get(r).post && plan.get(r).post.id);
    });
    // at most one forced pick per set and orientation
    expect(changed.length).toBeLessThanOrEqual(SETS.length * 2);
  });

  test('a set with one event cannot show both: the gap is named, not hidden', () => {
    const lib = posts();
    const rows = [
      { title: 'A', venue: 'v', event_type_id: 'etr-soc-dinner', starts_at: 'x' },
      { title: 'B', venue: 'v', event_type_id: 'etr-ent-film', starts_at: 'x' },
      { title: 'C', venue: 'v', event_type_id: 'etr-ent-film', starts_at: 'y' },
    ];
    const plan = P.planShowcase(rows, {
      codeSets: P.readCodeSets(CODE_SETS),
      posts: lib,
      pick: () => lib.find((p) => p.orientation === 'landscape'),
    });
    expect(P.missingPairs(plan)).toEqual([
      'events+registration landscape',
      'events+registration portrait',
      'events+registration+donation portrait',
    ]);
  });

  test('no portrait photo in the library: every portrait pair is named missing', () => {
    const lib = posts().filter((p) => p.orientation === 'landscape');
    const { accepted } = S.rebaseSeed(SEED, '2026-11-08');
    const plan = P.planShowcase(accepted, {
      codeSets: P.readCodeSets(CODE_SETS),
      posts: lib,
      pick,
    });
    expect(P.missingPairs(plan)).toEqual(SETS.map((s) => `${s} portrait`));
  });
});

describe('renderShowcase: where each pair can be seen after a run', () => {
  const BASE = 'https://stg.oursharedevents.com';
  const q = (eventId, set, orientation, codes = {}) => ({
    eventId,
    node: 'oak-lawn',
    qPath: `/q/qrt_${eventId}`,
    sPath: `/s/S${eventId}`,
    set,
    orientation,
    codes,
  });

  test('one row per pair: the poster, its /q and every /s code', () => {
    const manifest = {
      qr: [
        q('evt_1', 'events', 'landscape'),
        q('evt_2', 'events', 'portrait'),
        q('evt_3', 'events+registration', 'landscape', { register: '/s/R3' }),
        q('evt_4', 'events+registration', 'portrait', { register: '/s/R4' }),
        q('evt_5', 'events+registration+donation', 'landscape', {
          register: '/s/R5',
          donation: '/s/D5',
        }),
        q('evt_6', 'events+registration+donation', 'portrait', {
          register: '/s/R6',
          donation: '/s/D6',
        }),
        q('evt_7', 'events', 'landscape'),
      ],
    };
    const md = P.renderShowcase(manifest, BASE);
    expect(md).toContain('### Poster showcase');
    expect(md).toContain(
      `| events+registration+donation | portrait | ${BASE}/events/evt_6/poster | ${BASE}/q/qrt_evt_6 | ${BASE}/s/Sevt_6 · REGISTER ${BASE}/s/R6 · DONATE ${BASE}/s/D6 |`
    );
    // the first event of a pair is the one named
    expect(md).toContain(`| events | landscape | ${BASE}/events/evt_1/poster |`);
    expect(md).not.toContain('evt_7');
  });

  test('a pair no event shows is named, not left out', () => {
    const md = P.renderShowcase({ qr: [q('evt_1', 'events', 'landscape')] }, BASE);
    expect(md).toContain('| events+registration | portrait | not shown this run | | |');
  });

  test('a manifest from a build without code sets renders nothing', () => {
    expect(P.renderShowcase({ qr: [{ eventId: 'evt_1', qPath: '/q/x' }] }, BASE)).toBe('');
    expect(P.renderShowcase(null, BASE)).toBe('');
  });

  test('an entry with no art orientation counts for no pair', () => {
    const md = P.renderShowcase({ qr: [q('evt_1', 'events', null)] }, BASE);
    expect(md).toContain('| events | landscape | not shown this run | | |');
  });
});
