/**
 * INVARIANT: a campaign stays inside its brand, and is public only by consent
 * (showcase S14; OSE ADR-030).
 *
 * A campaign is a brand's named group of sponsor placements. Three owner rules
 * bind it, and this file holds their code shape on every PR:
 *
 *   1. BRAND WALL. Another brand's campaign can never be attached or seen.
 *      - every statement that writes a campaign onto a placement proves, in the
 *        statement itself, that the campaign is in the right brand;
 *      - every statement that joins `campaigns` to read a title does so on a
 *        brand match;
 *      - the by-id admin routes sit under guardAdminObjectScope;
 *      - every statement that puts an event in a campaign (events.campaign_id,
 *        migration 0110, OSE-1552) proves the same brand match in itself.
 *   2. CONSENT. The one public read of a campaign carries the per-placement
 *      on-show rule (the event opted in, both sides accepted), shows only an
 *      active campaign, and hands out an id and a title and nothing else. The
 *      public event projection never names a campaign.
 *   3. NEVER A FILTER. No code reads a query parameter named for a campaign.
 *   4. TWO LINKS, KEPT APART (OSE-1552 scope 4, an open owner decision). A
 *      placement's campaign and its event's campaign are separate columns. No
 *      statement writes one from the other, and only lib/campaigns.ts reads an
 *      event's campaign, so nothing public can name it.
 *
 * Pyramid coverage:
 *   L0 STATIC (this file)  code shape, node:fs only, no deployed worker.
 *   L1 workers pool        workers/oursharedevents/tests/campaigns.spec.ts
 *                          (behaviour, every brand pair) and
 *                          tests/campaign-never-a-filter.spec.ts.
 *   L2 staging             bruno/ose-api/18. Campaigns (S14).
 *
 * What this cannot see: SQL assembled from pieces at run time, and a campaign
 * written by a statement that does not name `campaign_id`. It reads text.
 *
 * @born-red S14 | method: each fault was put in src and this file failed naming
 * the statement, then the fault was removed. (1) the brand-matched subquery in
 * lib/sponsor-promotion.ts replaced by a bare `?`; the same-brand EXISTS dropped
 * from the attach UPDATE in lib/campaigns.ts; (2) the brand match dropped from
 * the report's campaign join, and from the public read; (3) the campaign branch
 * removed from matchAdminObjectTarget; (4) PLACEMENT_ON_SHOW_SQL and the status
 * rule each removed from the public read; a `status` field added to
 * PublicCampaign; (5) `campaign_id` added to the public event projection;
 * (6) `url.searchParams.get('campaign')` added to handlers/events.ts
 * | date: 2026-11-13
 *
 * @born-red event link (OSE-1552) | method: the same. (7) the same-brand EXISTS
 * dropped from the add UPDATE in lib/campaigns.ts; `c.brand_id = e.brand_id`
 * dropped from the member list; (8) `SET campaign_id = e.campaign_id` written
 * into a sponsor_placement UPDATE in lib/sponsor-promotion.ts; (9) `e.campaign_id`
 * selected in handlers/events.ts (this passed at first, because that file builds
 * its SQL from quoted strings; the check now reads the whole file); (10) the
 * classified count in admin-null-actor.invariant.spec.ts left at 3, which failed
 * that spec on the two new actor reads | date: 2026-11-15
 *
 * @born-red locals on a campaign (owner, 2026-11-15) | method: the same. (11) a
 * constant named for a campaign added to lib/sponsor-resolver.ts | date: 2026-11-15
 */

import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', '..', '..', 'workers', 'oursharedevents', 'src');

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}
const rel = (path: string) => relative(SRC, path).replace(/\\/g, '/');

/** Source with JS comments blanked, so prose about a rule is not read as code. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/[^\n]*/gm, '');
}
const read = (file: string) => code(join(SRC, file));

/** Template literals: where this codebase writes SQL. SQL `--` comments are dropped. */
function statements(source: string): string[] {
  return (source.match(/`[^`]*`/g) ?? []).map((s) => s.replace(/--[^\n]*/g, ' '));
}
const flat = (sql: string) => sql.replace(/\s+/g, ' ');

/** A statement that puts a campaign on a placement (an INSERT or an UPDATE … SET). */
export function writesPlacementCampaign(sql: string): boolean {
  const s = flat(sql);
  if (/INSERT INTO sponsor_placement\b/i.test(s)) {
    const cols = s.match(/INSERT INTO sponsor_placement\s*\(([^)]*)\)/i)?.[1] ?? '';
    return /\bcampaign_id\b/.test(cols);
  }
  if (/UPDATE sponsor_placement\b/i.test(s)) {
    const set = s.match(/\bSET\b(.*?)(\bWHERE\b|$)/i)?.[1] ?? '';
    // Clearing a campaign crosses no wall.
    return /\bcampaign_id\s*=/.test(set) && !/\bcampaign_id\s*=\s*NULL\b/i.test(set);
  }
  return false;
}

/** A statement that puts an event in a campaign (an INSERT, an upsert or an UPDATE … SET). */
export function writesEventCampaign(sql: string): boolean {
  const s = flat(sql);
  if (/INSERT (OR \w+ )?INTO events\b/i.test(s)) {
    const cols = s.match(/INTO events\s*\(([^)]*)\)/i)?.[1] ?? '';
    if (/\bcampaign_id\b/.test(cols)) return true;
    const upsert = s.match(/\bDO UPDATE SET\b(.*)$/i)?.[1] ?? '';
    return /\bcampaign_id\s*=/.test(upsert) && !/\bcampaign_id\s*=\s*NULL\b/i.test(upsert);
  }
  if (/UPDATE events\b/i.test(s)) {
    const set = s.match(/\bSET\b(.*?)(\bWHERE\b|$)/i)?.[1] ?? '';
    // Clearing a campaign crosses no wall.
    return /\bcampaign_id\s*=/.test(set) && !/\bcampaign_id\s*=\s*NULL\b/i.test(set);
  }
  return false;
}

/** A statement that reads an event's own campaign (`e.campaign_id`, `events.campaign_id`). */
const readsEventCampaign = (sql: string) => /\b(e|ev|evt|events)\.campaign_id\b/i.test(flat(sql));

/** The statement proves the campaign's brand: it reads `campaigns` and matches its brand_id. */
export function provesCampaignBrand(sql: string): boolean {
  const s = flat(sql);
  return /\bcampaigns c\b/i.test(s) && /\bc\.brand_id\s*=/.test(s);
}

/** A statement that joins `campaigns` (to read a title or to test membership). */
const joinsCampaigns = (sql: string) => /\bJOIN campaigns\b/i.test(flat(sql));

const FILES = filesUnder(SRC);

test.describe('Invariant: a campaign stays in its brand and is public only by consent (S14)', () => {
  test('S14-INV | negative control | the walk sees the statements it is meant to hold', () => {
    const writers = FILES.filter((f) => statements(code(f)).some(writesPlacementCampaign)).map(rel);
    expect(writers.sort()).toEqual(['lib/campaigns.ts', 'lib/sponsor-promotion.ts']);
    const joiners = FILES.filter((f) => statements(code(f)).some(joinsCampaigns)).map(rel);
    expect(joiners.sort()).toEqual(['lib/campaigns.ts', 'lib/shared-report-builder.ts']);
    const eventWriters = FILES.filter((f) => statements(code(f)).some(writesEventCampaign)).map(
      rel
    );
    expect(eventWriters).toEqual(['lib/campaigns.ts']);
  });

  test('OSE-1552-INV | negative control | the event-link detectors flag the forbidden shapes', () => {
    const bare = `UPDATE events SET campaign_id = ?1 WHERE id = ?2`;
    expect(writesEventCampaign(bare)).toBe(true);
    expect(provesCampaignBrand(bare)).toBe(false);
    // Reading the table without matching its brand proves nothing.
    expect(
      provesCampaignBrand(
        `UPDATE events SET campaign_id = ?1 WHERE id = ?2 AND EXISTS (SELECT 1 FROM campaigns c WHERE c.id = ?1)`
      )
    ).toBe(false);
    expect(
      provesCampaignBrand(
        `UPDATE events SET campaign_id = ?1 WHERE id = ?2 AND EXISTS (SELECT 1 FROM campaigns c WHERE c.id = ?1 AND c.brand_id = events.brand_id)`
      )
    ).toBe(true);
    expect(writesEventCampaign(`UPDATE events SET campaign_id = NULL WHERE id = ?`)).toBe(false);
    expect(writesEventCampaign(`UPDATE events SET series_id = ? WHERE id = ?`)).toBe(false);
    expect(writesEventCampaign(`UPDATE sponsor_placement SET campaign_id = ? WHERE id = ?`)).toBe(
      false
    );
    expect(
      writesEventCampaign(`INSERT INTO events (id, brand_id, campaign_id) VALUES (?, ?, ?)`)
    ).toBe(true);
    expect(
      writesEventCampaign(
        `INSERT INTO events (id, title) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET campaign_id = excluded.title`
      )
    ).toBe(true);
    expect(writesEventCampaign(`INSERT INTO events (id, brand_id) VALUES (?, ?)`)).toBe(false);
    expect(readsEventCampaign(`SELECT e.campaign_id FROM events e`)).toBe(true);
    expect(readsEventCampaign(`SELECT sp.campaign_id FROM sponsor_placement sp`)).toBe(false);
  });

  test('OSE-1552-INV | brand wall | every write of a campaign onto an event proves the campaign brand', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      for (const sql of statements(code(f))) {
        if (writesEventCampaign(sql) && !provesCampaignBrand(sql)) {
          offenders.push(`${rel(f)}: ${flat(sql).slice(0, 140)}`);
        }
      }
    }
    expect(
      offenders,
      'A statement that sets events.campaign_id must read `campaigns c` and match `c.brand_id` ' +
        'in the same statement, so no caller can put an event in another brand’s campaign:\n' +
        offenders.join('\n')
    ).toEqual([]);
  });

  test('OSE-1552-INV | two links | no statement writes a placement campaign from its event, or the reverse', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      for (const sql of statements(code(f))) {
        const s = flat(sql);
        const placementFromEvent = /UPDATE sponsor_placement\b/i.test(s) && readsEventCampaign(s);
        const placementWrite =
          /(UPDATE|INTO) sponsor_placement\b/i.test(s) && /\bcampaign_id\b/.test(s);
        const eventWrite =
          /(UPDATE|INTO) events\b/i.test(s) &&
          /\bcampaign_id\s*=/.test(s.replace(/\bWHERE\b.*$/i, ''));
        const eventFromPlacement = eventWrite && /\bsponsor_placement\b/i.test(s);
        if (placementFromEvent || eventFromPlacement || (placementWrite && readsEventCampaign(s))) {
          offenders.push(`${rel(f)}: ${s.slice(0, 140)}`);
        }
      }
    }
    expect(
      offenders,
      'Which campaign wins when a placement and its event differ is an open owner decision ' +
        '(OSE-1552 scope 4). Until it is made, no statement may copy one link onto the other:\n' +
        offenders.join('\n')
    ).toEqual([]);
  });

  test('OSE-1552-INV | not public | only lib/campaigns.ts reads an event’s campaign', () => {
    // The whole file is read, not only its template literals: handlers/events.ts
    // builds its SQL from quoted strings.
    const readers = FILES.filter((f) => readsEventCampaign(code(f))).map(rel);
    expect(readers).toEqual(['lib/campaigns.ts']);
    // The admin member list is the one read, and it is on the brand match.
    const lib = read('lib/campaigns.ts');
    const fn = lib.slice(lib.indexOf('export async function listCampaignEvents'));
    const sql = statements(fn).find(readsEventCampaign) ?? '';
    expect(flat(sql)).toMatch(/JOIN campaigns c ON c\.id = e\.campaign_id/);
    expect(flat(sql)).toMatch(/c\.brand_id = e\.brand_id/);
    // Nothing public uses it: the projection and the public handlers never name it.
    expect(read('lib/public-event-projection.ts')).not.toMatch(/campaign/i);
    const users = FILES.filter(
      (f) =>
        rel(f) !== 'lib/campaigns.ts' &&
        /\b(listCampaignEvents|addEventToCampaign|removeEventFromCampaign)\b/.test(code(f))
    ).map(rel);
    expect(users).toEqual(['handlers/campaigns.ts']);
  });

  test('S14-INV | negative control | the detectors flag the forbidden shapes', () => {
    const bareInsert = `INSERT INTO sponsor_placement (id, event_id, campaign_id) VALUES (?, ?, ?)`;
    expect(writesPlacementCampaign(bareInsert)).toBe(true);
    expect(provesCampaignBrand(bareInsert)).toBe(false);
    const bareUpdate = `UPDATE sponsor_placement SET campaign_id = ?1 WHERE id = ?2`;
    expect(writesPlacementCampaign(bareUpdate)).toBe(true);
    expect(provesCampaignBrand(bareUpdate)).toBe(false);
    // Reading the table without matching its brand proves nothing.
    expect(
      provesCampaignBrand(
        `UPDATE sponsor_placement SET campaign_id = ? WHERE EXISTS (SELECT 1 FROM campaigns c WHERE c.id = ?)`
      )
    ).toBe(false);
    expect(
      writesPlacementCampaign(`UPDATE sponsor_placement SET campaign_id = NULL WHERE id = ?`)
    ).toBe(false);
    expect(
      writesPlacementCampaign(`INSERT INTO sponsor_placement (id, event_id) VALUES (?, ?)`)
    ).toBe(false);
    expect(
      provesCampaignBrand(
        `INSERT INTO sponsor_placement (id, campaign_id) VALUES (?, (SELECT c.id FROM campaigns c WHERE c.id = ? AND c.brand_id = ?))`
      )
    ).toBe(true);
  });

  test('S14-INV | brand wall | every write of a campaign onto a placement proves the campaign brand', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      for (const sql of statements(code(f))) {
        if (writesPlacementCampaign(sql) && !provesCampaignBrand(sql)) {
          offenders.push(`${rel(f)}: ${flat(sql).slice(0, 140)}`);
        }
      }
    }
    expect(
      offenders,
      'A statement that sets sponsor_placement.campaign_id must read `campaigns c` and match ' +
        '`c.brand_id` in the same statement, so no caller can attach another brand’s campaign:\n' +
        offenders.join('\n')
    ).toEqual([]);
  });

  test('S14-INV | brand wall | every join to campaigns is on a brand match', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      for (const sql of statements(code(f))) {
        if (joinsCampaigns(sql) && !/\bc\.brand_id\s*=/.test(flat(sql))) {
          offenders.push(`${rel(f)}: ${flat(sql).slice(0, 140)}`);
        }
      }
    }
    expect(
      offenders,
      'A JOIN to campaigns must match `c.brand_id` to the event’s brand, so a placement linked ' +
        'to another brand’s campaign reads as having none:\n' +
        offenders.join('\n')
    ).toEqual([]);
  });

  test('S14-INV | brand wall | the by-id campaign routes sit under guardAdminObjectScope', () => {
    const guard = read('lib/admin-object-scope.ts');
    expect(guard).toMatch(
      /ADMIN_CAMPAIGN_OBJECT_PATH\s*=\s*\/\^\\\/api\\\/v2\\\/admin\\\/campaigns\\\/\(\[\^\/\]\+\)/
    );
    expect(guard).toMatch(/pathname\.match\(ADMIN_CAMPAIGN_OBJECT_PATH\)/);
    expect(guard).toMatch(/FROM campaigns WHERE id = \? AND brand_id IN \(/);

    // Every campaign route with an id in it starts with the prefix the guard matches.
    const router = read('router.ts');
    const byId = [...router.matchAll(/\/\^\\\/api\\\/v2\\\/admin\\\/campaigns([^$]*)\$\//g)].map(
      (m) => m[1]
    );
    expect(byId.length, 'the router has a by-id campaign route').toBeGreaterThan(0);
    for (const tail of byId) expect(tail.startsWith('\\/([^/]+)'), tail).toBe(true);
    // The guard runs before the first campaign route.
    expect(router.indexOf('guardAdminObjectScope(request, env, pathname)')).toBeGreaterThan(-1);
    expect(router.indexOf('guardAdminObjectScope(request, env, pathname)')).toBeLessThan(
      router.indexOf("'/api/v2/admin/campaigns'")
    );
  });

  test('S14-INV | consent | the one public read carries the on-show rule and shows only an active campaign', () => {
    const lib = readFileSync(join(SRC, 'lib', 'campaigns.ts'), 'utf8');
    const fn = lib.slice(lib.indexOf('export async function readShownPlacementCampaigns'));
    const sql = statements(fn.slice(0, fn.indexOf('\n}\n')))[0] ?? '';
    expect(sql, 'the public read is one statement').toMatch(/JOIN campaigns c\b/);
    expect(sql).toContain('${PLACEMENT_ON_SHOW_SQL}');
    expect(flat(sql)).toMatch(/c\.status = 'active'/);
    expect(flat(sql)).toMatch(/c\.brand_id = e\.brand_id/);
    expect(lib).toMatch(/import \{ PLACEMENT_ON_SHOW_SQL \} from '\.\/sponsor-card'/);

    // The rule it names still holds both sides and the event's own yes.
    const card = readFileSync(join(SRC, 'lib', 'sponsor-card.ts'), 'utf8');
    const rule = card.slice(card.indexOf('export const PLACEMENT_ON_SHOW_SQL'));
    const ruleSql = rule.slice(0, rule.indexOf('`;'));
    expect(ruleSql).toMatch(/sp\.sponsor_accepted = 1/);
    expect(ruleSql).toMatch(/COALESCE\(sp\.organizer_accepted,/);
    expect(ruleSql).toContain('${eventUsesSponsorsSql(');
  });

  test('S14-INV | consent | a public campaign is an id and a title, and nothing else', () => {
    const lib = read('lib/campaigns.ts');
    const body = lib.match(/export interface PublicCampaign \{([^}]*)\}/)?.[1] ?? '';
    const fields = [...body.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]).sort();
    expect(fields).toEqual(['id', 'title']);
  });

  test('S14-INV | consent | only the sponsor bundle hands a campaign to the public', () => {
    const users = FILES.filter(
      (f) => rel(f) !== 'lib/campaigns.ts' && /\breadShownPlacementCampaigns\b/.test(code(f))
    ).map(rel);
    expect(users).toEqual(['handlers/sponsors.ts']);
    expect(read('lib/public-event-projection.ts')).not.toMatch(/campaign/i);
  });

  test('OSE-1552-INV | locals | nothing that orders or picks sponsors reads a campaign', () => {
    // Owner, 2026-11-15: "The locals still apply even on a campaign." The Local
    // Sponsor Covenant is a floor on the local sponsors' share of rotation (brain
    // invariant 25; lib/sponsor-allocation.ts, lib/sponsor-resolver.ts). A
    // campaign is a label on a sponsor the bundle already shows; it must never
    // become an input to which sponsor shows, in what order, or with what share.
    for (const file of [
      'lib/sponsor-resolver.ts',
      'lib/sponsor-allocation.ts',
      'lib/sponsor-card.ts',
    ]) {
      expect(read(file), `${file} must not name a campaign`).not.toMatch(/campaign/i);
    }
    // The covenant's own inputs are still there to be held.
    expect(read('lib/sponsor-resolver.ts')).toMatch(/is_local/);
    expect(read('lib/sponsor-resolver.ts')).toMatch(/buildShareRotation/);
  });

  test('S14-INV | never a filter | no query parameter is named for a campaign', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const hits = code(f).match(
        /searchParams\s*\.\s*(get|getAll|has)\(\s*['"`][^'"`]*campaign[^'"`]*['"`]/gi
      );
      if (hits) offenders.push(`${rel(f)}: ${hits.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });
});
