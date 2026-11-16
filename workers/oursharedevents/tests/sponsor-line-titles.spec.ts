/**
 * OSE-1901 — the one-name sponsor line, over the real D1 and through the Worker.
 *
 * tests/sponsor-line-pick.spec.ts holds the pick and the read over a fake D1.
 * This spec holds what only a database and a served page can show:
 *   - the statement reads the placement's level and local flag as stored;
 *   - a sponsor counts toward the hours only when the event opted in and both
 *     sides agreed (pairwise over the consent columns), and one that does not
 *     count is never named in any hour;
 *   - the list API, /events and the landing name the same sponsor in the same
 *     hour, in the same markup whoever it is.
 *
 * Staging twin: bruno/ose-api "21. Sponsor line by covenant share (OSE-1901)".
 *
 * @born-red OSE-1901 | method: each fault was put into the source, the named
 * tests were seen failing, and the fault was taken out again | date: 2026-11-16
 * | the list of faults is in the PR text.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, test } from 'vitest';
import { hourOf, pickSponsorLine, type LineCandidate } from '../src/lib/sponsor-line-pick';
import { fetchSponsorTitles } from '../src/lib/sponsor-titles';
import { seedSplitSponsor } from './helpers/seed-sponsor';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = env as unknown as TestEnv;

const HOUR = 3_600_000;
// 'root' is the brand the landing and /events read.
const ROOT = 'root';
const BRAND = 'ose-line';
const OTHER = 'ose-line-other';

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function applyMigrations(): Promise<void> {
  const statements: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of statements) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

async function seedEvent(
  id: string,
  brand: string,
  settingsJson = '{"useSponsors":true}',
  status = 'active'
): Promise<void> {
  await tenv.DB.prepare(
    `INSERT OR REPLACE INTO events
       (id, brand_id, title, slug, status, start_date, location, is_published, settings_json)
     VALUES (?, ?, ?, ?, ?, ?, 'Eagles Hall', 1, ?)`
  )
    .bind(id, brand, `Line ${id}`, `slug-${id}`, status, day(10), settingsJson)
    .run();
}

interface Seeded extends LineCandidate {
  eventId: string;
  brand?: string;
}

async function seedSponsor(s: Seeded): Promise<void> {
  await seedSplitSponsor(tenv.DB, {
    id: s.id,
    eventId: s.eventId,
    name: s.title,
    brandId: s.brand ?? BRAND,
    tier: s.tier,
    isLocal: s.isLocal ? 1 : 0,
  });
}

/** How often each title is the line over one whole cycle of clock hours. */
async function cycleOf(eventId: string, brand = BRAND): Promise<Record<string, number>> {
  const seen: Record<string, number> = {};
  for (let h = 0; h < 100; h++) {
    const t = (await fetchSponsorTitles(tenv.DB, brand, h * HOUR + 17)).get(eventId) ?? '(none)';
    seen[t] = (seen[t] ?? 0) + 1;
  }
  return seen;
}

beforeAll(async () => {
  await applyMigrations();
});

describe('sunny: the stored level and local flag decide the hours', () => {
  test('top, middle and a local base, as stored: 40, 20 and 40 hours of 100', async () => {
    await seedEvent('line-sunny', BRAND);
    await seedSponsor({
      id: 'ls-top',
      title: 'Sunny Top',
      tier: 'platinum',
      isLocal: false,
      eventId: 'line-sunny',
    });
    await seedSponsor({
      id: 'ls-mid',
      title: 'Sunny Middle',
      tier: 'gold',
      isLocal: false,
      eventId: 'line-sunny',
    });
    await seedSponsor({
      id: 'ls-loc',
      title: 'Sunny Local',
      tier: 'bronze',
      isLocal: true,
      eventId: 'line-sunny',
    });
    expect(await cycleOf('line-sunny')).toEqual({
      'Sunny Top': 40,
      'Sunny Middle': 20,
      'Sunny Local': 40,
    });
  });

  test('the local flag is read from the placement: the same three with and without it', async () => {
    await seedEvent('line-flag', BRAND);
    await seedSponsor({
      id: 'lf-top',
      title: 'Flag Top',
      tier: 'title',
      isLocal: false,
      eventId: 'line-flag',
    });
    await seedSponsor({
      id: 'lf-base',
      title: 'Flag Base',
      tier: 'bronze',
      isLocal: false,
      eventId: 'line-flag',
    });
    await seedSponsor({
      id: 'lf-loc',
      title: 'Flag Local',
      tier: 'bronze',
      isLocal: true,
      eventId: 'line-flag',
    });
    expect(await cycleOf('line-flag')).toEqual({
      'Flag Top': 40,
      'Flag Base': 15,
      'Flag Local': 45,
    });
    await tenv.DB.prepare(
      `UPDATE sponsor_placement SET locality_band = 0 WHERE sponsor_business_id = 'lf-loc'`
    ).run();
    expect(await cycleOf('line-flag')).toEqual({
      'Flag Top': 40,
      'Flag Base': 30,
      'Flag Local': 30,
    });
  });

  test('the level is the placement level, not the level on the business', async () => {
    await seedEvent('line-level', BRAND);
    await seedSponsor({
      id: 'lv-a',
      title: 'Level A',
      tier: 'bronze',
      isLocal: false,
      eventId: 'line-level',
    });
    await seedSponsor({
      id: 'lv-b',
      title: 'Level B',
      tier: 'bronze',
      isLocal: false,
      eventId: 'line-level',
    });
    await seedSponsor({
      id: 'lv-c',
      title: 'Level C',
      tier: 'bronze',
      isLocal: false,
      eventId: 'line-level',
    });
    // Three base sponsors: a third each (34 to the lowest id by remainder).
    expect(await cycleOf('line-level')).toEqual({ 'Level A': 34, 'Level B': 33, 'Level C': 33 });
    // The business row says top level; the placement still says base.
    await tenv.DB.prepare(`UPDATE sponsor_business SET tier = 'title' WHERE id = 'lv-c'`).run();
    expect(await cycleOf('line-level')).toEqual({ 'Level A': 34, 'Level B': 33, 'Level C': 33 });
    // The placement moves up: 40 at the cap, 30 each for the other two.
    await tenv.DB.prepare(
      `UPDATE sponsor_placement SET tier = 'title' WHERE sponsor_business_id = 'lv-c'`
    ).run();
    expect(await cycleOf('line-level')).toEqual({ 'Level A': 30, 'Level B': 30, 'Level C': 40 });
  });

  test('the display name is what prints, the business name when it is blank', async () => {
    await seedEvent('line-name', BRAND);
    await seedSponsor({
      id: 'ln-a',
      title: 'Legal Name LLC',
      tier: 'gold',
      isLocal: false,
      eventId: 'line-name',
    });
    expect((await fetchSponsorTitles(tenv.DB, BRAND, 0)).get('line-name')).toBe('Legal Name LLC');
    await tenv.DB.prepare(
      `UPDATE sponsor_business SET display_name = 'Front Door Name' WHERE id = 'ln-a'`
    ).run();
    expect((await fetchSponsorTitles(tenv.DB, BRAND, 0)).get('line-name')).toBe('Front Door Name');
    await tenv.DB.prepare(`UPDATE sponsor_business SET display_name = '' WHERE id = 'ln-a'`).run();
    expect((await fetchSponsorTitles(tenv.DB, BRAND, 0)).get('line-name')).toBe('Legal Name LLC');
  });
});

// ── Consent, pairwise ────────────────────────────────────────────────────────
//
// One event with a base sponsor that always shows, and beside it a top-level
// local sponsor whose row varies. When the varied one counts, it holds 40 hours
// and the base sponsor 60; when it does not, the base sponsor is alone and holds
// all 100, and the varied one is named in no hour.
//
// Factors: the event's switch (on, off, absent) x sponsor accepted (1, 0, null)
// x organizer accepted (1, 0, null) x source (organizer, sponsor_request) x the
// placement on or off x the business on or off. Every pair of values of two
// factors appears in a row below (checked by the first test).

interface Case {
  uses: 'on' | 'off' | 'absent';
  sponsor: 1 | 0 | null;
  organizer: 1 | 0 | null;
  source: 'organizer' | 'sponsor_request';
  placement: 1 | 0;
  business: 1 | 0;
}

const CASES: Case[] = [
  { uses: 'on', sponsor: 1, organizer: 1, source: 'organizer', placement: 1, business: 1 },
  { uses: 'on', sponsor: 1, organizer: null, source: 'organizer', placement: 1, business: 1 },
  { uses: 'on', sponsor: 1, organizer: 1, source: 'sponsor_request', placement: 1, business: 1 },
  { uses: 'on', sponsor: 1, organizer: null, source: 'sponsor_request', placement: 1, business: 1 },
  { uses: 'on', sponsor: 0, organizer: 0, source: 'sponsor_request', placement: 0, business: 0 },
  { uses: 'on', sponsor: null, organizer: 1, source: 'organizer', placement: 0, business: 1 },
  { uses: 'on', sponsor: 1, organizer: 0, source: 'organizer', placement: 1, business: 0 },
  { uses: 'off', sponsor: 1, organizer: 1, source: 'organizer', placement: 1, business: 1 },
  {
    uses: 'off',
    sponsor: 0,
    organizer: null,
    source: 'sponsor_request',
    placement: 1,
    business: 0,
  },
  { uses: 'off', sponsor: null, organizer: 0, source: 'organizer', placement: 0, business: 1 },
  { uses: 'off', sponsor: 1, organizer: 0, source: 'sponsor_request', placement: 0, business: 0 },
  {
    uses: 'absent',
    sponsor: 1,
    organizer: 1,
    source: 'sponsor_request',
    placement: 1,
    business: 1,
  },
  { uses: 'absent', sponsor: 0, organizer: 1, source: 'organizer', placement: 0, business: 0 },
  {
    uses: 'absent',
    sponsor: null,
    organizer: null,
    source: 'organizer',
    placement: 1,
    business: 0,
  },
  {
    uses: 'absent',
    sponsor: 1,
    organizer: 0,
    source: 'sponsor_request',
    placement: 0,
    business: 1,
  },
  { uses: 'on', sponsor: 0, organizer: 1, source: 'organizer', placement: 1, business: 1 },
  {
    uses: 'on',
    sponsor: null,
    organizer: null,
    source: 'sponsor_request',
    placement: 1,
    business: 1,
  },
  {
    uses: 'off',
    sponsor: null,
    organizer: 1,
    source: 'sponsor_request',
    placement: 1,
    business: 1,
  },
  {
    uses: 'absent',
    sponsor: 0,
    organizer: null,
    source: 'sponsor_request',
    placement: 0,
    business: 1,
  },
  { uses: 'on', sponsor: 0, organizer: 0, source: 'organizer', placement: 0, business: 1 },
  { uses: 'on', sponsor: null, organizer: 0, source: 'sponsor_request', placement: 1, business: 0 },
  { uses: 'absent', sponsor: null, organizer: 0, source: 'organizer', placement: 1, business: 1 },
  { uses: 'on', sponsor: 0, organizer: null, source: 'organizer', placement: 1, business: 1 },
];

/** The rule, written out apart from the SQL under test. */
const counts = (k: Case): boolean =>
  k.uses === 'on' &&
  k.sponsor === 1 &&
  k.placement === 1 &&
  k.business === 1 &&
  (k.organizer === 1 || (k.organizer === null && k.source === 'organizer'));

const SETTINGS: Record<Case['uses'], string> = {
  on: '{"useSponsors":true}',
  off: '{"useSponsors":false}',
  absent: '{}',
};

describe('rainy: only a sponsor both sides agreed to, on an event that opted in, has hours', () => {
  test('the cases cover every pair of values, and both outcomes', () => {
    const keys = ['uses', 'sponsor', 'organizer', 'source', 'placement', 'business'] as const;
    const values = (key: (typeof keys)[number]) => [...new Set(CASES.map((k) => String(k[key])))];
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        for (const a of values(keys[i]!)) {
          for (const b of values(keys[j]!)) {
            const hit = CASES.some((k) => String(k[keys[i]!]) === a && String(k[keys[j]!]) === b);
            expect(hit, `${keys[i]}=${a} with ${keys[j]}=${b}`).toBe(true);
          }
        }
      }
    }
    expect(CASES.filter(counts).length).toBeGreaterThanOrEqual(3);
    expect(CASES.filter((k) => !counts(k)).length).toBeGreaterThanOrEqual(10);
  });

  test.each(CASES.map((k, i) => [i, k] as const))('case %i: %o', async (i, k) => {
    const eventId = `line-case-${i}`;
    await seedEvent(eventId, BRAND, SETTINGS[k.uses]);
    // The steady one: its switch aside, nothing about it varies. It shows
    // whenever the event opted in.
    await seedSponsor({
      id: `lc-steady-${i}`,
      title: `Steady ${i}`,
      tier: 'bronze',
      isLocal: false,
      eventId,
    });
    await seedSponsor({
      id: `lc-varied-${i}`,
      title: `Varied ${i}`,
      tier: 'title',
      isLocal: true,
      eventId,
    });
    await tenv.DB.prepare(
      `UPDATE sponsor_placement
          SET sponsor_accepted = ?, organizer_accepted = ?, source = ?, is_active = ?
        WHERE sponsor_business_id = ?`
    )
      .bind(k.sponsor, k.organizer, k.source, k.placement, `lc-varied-${i}`)
      .run();
    await tenv.DB.prepare(`UPDATE sponsor_business SET is_active = ? WHERE id = ?`)
      .bind(k.business, `lc-varied-${i}`)
      .run();

    const seen = await cycleOf(eventId);
    if (k.uses !== 'on') {
      expect(seen).toEqual({ '(none)': 100 });
    } else if (counts(k)) {
      // A top-level local beside one base sponsor: the floor (30) is the
      // local's own, its level takes it to the cap (40) and no further, and the
      // base sponsor, which has no cap, takes the other 60.
      expect(seen).toEqual({ [`Varied ${i}`]: 40, [`Steady ${i}`]: 60 });
    } else {
      expect(seen).toEqual({ [`Steady ${i}`]: 100 });
    }
  });

  test('an event that is not live shows no line, whatever its sponsors', async () => {
    for (const status of ['draft', 'ready', 'archived']) {
      const eventId = `line-${status}`;
      await seedEvent(eventId, BRAND, '{"useSponsors":true}', status);
      await seedSponsor({
        id: `lst-${status}`,
        title: `Status ${status}`,
        tier: 'gold',
        isLocal: false,
        eventId,
      });
      expect((await fetchSponsorTitles(tenv.DB, BRAND, 0)).has(eventId)).toBe(false);
    }
  });

  test("another brand's sponsor on this brand's event has no hours, and another brand's events are not read", async () => {
    await seedEvent('line-brand', BRAND);
    await seedSponsor({
      id: 'lb-own',
      title: 'Own Brand',
      tier: 'bronze',
      isLocal: false,
      eventId: 'line-brand',
    });
    await seedSponsor({
      id: 'lb-far',
      title: 'Far Brand',
      tier: 'title',
      isLocal: true,
      eventId: 'line-brand',
      brand: OTHER,
    });
    expect(await cycleOf('line-brand')).toEqual({ 'Own Brand': 100 });

    await seedEvent('line-other-evt', OTHER);
    await seedSponsor({
      id: 'lb-other',
      title: 'Other Own',
      tier: 'bronze',
      isLocal: false,
      eventId: 'line-other-evt',
      brand: OTHER,
    });
    const mine = await fetchSponsorTitles(tenv.DB, BRAND, 0);
    expect(mine.has('line-other-evt')).toBe(false);
    expect((await fetchSponsorTitles(tenv.DB, OTHER, 0)).get('line-other-evt')).toBe('Other Own');
    expect((await fetchSponsorTitles(tenv.DB, OTHER, 0)).has('line-brand')).toBe(false);
  });
});

// ── A brand with more placements than one read ───────────────────────────────

describe('edge: more placements than one read holds', () => {
  const MANY = 'ose-line-many';

  /** `n` sponsors on one event, written straight in (the helper is a row at a time). */
  async function seedMany(eventId: string, prefix: string, n: number): Promise<LineCandidate[]> {
    const list: LineCandidate[] = Array.from({ length: n }, (_, i) => ({
      id: `${prefix}-${String(i).padStart(3, '0')}`,
      title: `Many ${prefix} ${i}`,
      tier: i % 50 === 0 ? 'title' : i % 7 === 0 ? 'gold' : 'bronze',
      isLocal: i % 5 === 0,
    }));
    for (let at = 0; at < list.length; at += 40) {
      const part = list.slice(at, at + 40);
      await tenv.DB.batch([
        ...part.map((s) =>
          tenv.DB.prepare(
            `INSERT INTO sponsor_business (id, brand_id, name, tier, is_active) VALUES (?, ?, ?, ?, 1)`
          ).bind(s.id, MANY, s.title, s.tier)
        ),
        ...part.map((s) =>
          tenv.DB.prepare(
            `INSERT INTO sponsor_placement
               (id, sponsor_business_id, event_id, tier, locality_band, source, is_active, sponsor_accepted, organizer_accepted)
             VALUES (?, ?, ?, ?, ?, 'organizer', 1, 1, 1)`
          ).bind(`pl-${s.id}`, s.id, eventId, s.tier, s.isLocal ? 1 : 0)
        ),
      ]);
    }
    return list;
  }

  test('602 placements on three events: every event has its line, worked out over all of its sponsors', async () => {
    // In event order: 300, then 300 (the first read ends 200 rows into this one),
    // then 2 (read wholly by the second read).
    await seedEvent('many-a', MANY);
    await seedEvent('many-b', MANY);
    await seedEvent('many-c', MANY);
    const a = await seedMany('many-a', 'ma', 300);
    const b = await seedMany('many-b', 'mb', 300);
    const c2 = await seedMany('many-c', 'mc', 2);
    for (const hour of [0, 1, 157, 299, 300, 4321]) {
      const titles = await fetchSponsorTitles(tenv.DB, MANY, hour * HOUR);
      expect(titles.size).toBe(3);
      expect(titles.get('many-a')).toBe(pickSponsorLine('many-a', a, hour)!.title);
      expect(titles.get('many-b')).toBe(pickSponsorLine('many-b', b, hour)!.title);
      expect(titles.get('many-c')).toBe(pickSponsorLine('many-c', c2, hour)!.title);
    }
  });
});

// ── Through the Worker ───────────────────────────────────────────────────────

describe('edge: the list API, /events and the landing agree, in the same markup for every name', () => {
  const FOUR: LineCandidate[] = [
    { id: 'lw-top', title: 'Worker Top Level', tier: 'title', isLocal: false },
    { id: 'lw-mid', title: 'Worker Middle', tier: 'gold', isLocal: false },
    { id: 'lw-base', title: 'Worker Base', tier: 'bronze', isLocal: false },
    { id: 'lw-local', title: 'Worker Local', tier: 'bronze', isLocal: true },
  ];
  const EVENT = 'line-worker-evt';

  beforeAll(async () => {
    await seedEvent(EVENT, ROOT);
    for (const s of FOUR) await seedSponsor({ ...s, eventId: EVENT, brand: ROOT });
    await seedSponsor({
      id: 'lw-pending',
      title: 'Worker Pending',
      tier: 'title',
      isLocal: false,
      eventId: EVENT,
      brand: ROOT,
    });
    await tenv.DB.prepare(
      `UPDATE sponsor_placement SET sponsor_accepted = NULL WHERE sponsor_business_id = 'lw-pending'`
    ).run();
  });

  /** The names due around now: this hour, and the one a request may cross into. */
  const due = (before: number, after: number): string[] => [
    pickSponsorLine(EVENT, FOUR, hourOf(before))!.title,
    pickSponsorLine(EVENT, FOUR, hourOf(after))!.title,
  ];

  const cardOf = (html: string): string => {
    const start = html.indexOf(`data-event-id="${EVENT}"`);
    expect(start, 'the fixture card is on the page').toBeGreaterThan(-1);
    return html.slice(start, html.indexOf('</article>', start));
  };

  test('GET /api/v2/events: sponsor_titles is the pick for this hour, a plain string', async () => {
    const before = Date.now();
    const body = (await (
      await SELF.fetch(`https://t.test/api/v2/events?brand=${ROOT}`)
    ).json()) as {
      sponsor_titles: Record<string, unknown>;
    };
    expect(due(before, Date.now())).toContain(body.sponsor_titles[EVENT]);
    expect(typeof body.sponsor_titles[EVENT]).toBe('string');
    expect(JSON.stringify(body.sponsor_titles)).not.toContain('Worker Pending');
  });

  test.each(['/events', '/'])(
    'GET %s: the card names one sponsor, the pick for this hour',
    async (path) => {
      const before = Date.now();
      const html = await (await SELF.fetch(`https://t.test${path}`)).text();
      const card = cardOf(html);
      const shown = FOUR.map((s) => s.title).filter((t) => card.includes(t));
      expect(shown).toHaveLength(1);
      expect(due(before, Date.now())).toContain(shown[0]);
      expect(html).not.toContain('Worker Pending');
      // One line, the plain card line, below the name and the date.
      expect(card.split('data-testid="public-event-sponsor"').length - 1).toBe(1);
      const line = card.indexOf('<p class="meta" data-testid="public-event-sponsor">');
      expect(line).toBeGreaterThan(card.indexOf('-name"'));
      expect(line).toBeGreaterThan(card.indexOf('-meta"'));
    }
  );

  test('the response says nothing about a level or a local flag, and sets no cookie', async () => {
    const res = await SELF.fetch(`https://t.test/api/v2/events?brand=${ROOT}`);
    expect(res.headers.get('set-cookie')).toBeNull();
    const text = await res.text();
    for (const word of ['locality_band', 'is_local', '"tier"', 'lw-top', 'lw-local']) {
      expect(text, word).not.toContain(word);
    }
  });

  test('two visitors in the same hour read the same name, whatever they send', async () => {
    const before = Date.now();
    const read = async (headers: Record<string, string>, query = ''): Promise<unknown> =>
      (
        (await (
          await SELF.fetch(`https://t.test/api/v2/events?brand=${ROOT}${query}`, { headers })
        ).json()) as { sponsor_titles: Record<string, unknown> }
      ).sponsor_titles[EVENT];
    const seen = new Set<unknown>();
    seen.add(await read({}));
    seen.add(await read({ 'User-Agent': 'Mozilla/5.0 (iPhone)', 'Accept-Language': 'es-MX' }));
    seen.add(await read({ Cookie: 'ose_anon=someone-else', 'CF-Connecting-IP': '203.0.113.9' }));
    seen.add(await read({ 'X-Forwarded-For': '198.51.100.7', Referer: 'https://example.org/x' }));
    // Nor can a visitor ask for another hour, or another name, in the address.
    seen.add(await read({}, '&at=0&hour=7&nowMs=3600000&now=1&t=99&sponsor=lw-base'));
    seen.add(await read({}, `&time=${Date.now() + 5 * HOUR}&seed=x&h=42`));
    // One name, unless the hour turned while the reads ran.
    if (hourOf(before) === hourOf(Date.now())) expect(seen.size).toBe(1);
    for (const name of seen) expect(due(before, Date.now())).toContain(name);
  });
});
