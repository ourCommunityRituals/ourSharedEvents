/**
 * OSE-1900 — one gate for every sponsor reader, held by reading `src/`.
 *
 * tests/sponsor-opt-in-gate.spec.ts runs the readers that exist today. This
 * file is for the reader someone adds tomorrow: the placement consent rule
 * (`sponsor_accepted = 1`) is written out in several statements, and a new copy
 * of it without the event's own yes would show a sponsor on an event that never
 * chose sponsors. So:
 *
 *   1. every statement in `src/` that carries the consent rule also carries the
 *      opt-in gate from lib/sponsor-card.ts, or is on the short list below with
 *      the reason it is gated another way;
 *   2. the shared rules (SPONSOR_ON_SHOW_SQL, PLACEMENT_ON_SHOW_SQL) and sponsor
 *      discovery include the gate;
 *   3. the settings key itself: only a real `true` is on, in the parser, the
 *      write validator and the SQL; and nothing about it reads a tier or plan.
 *
 * What this cannot see: a statement that shows a sponsor without writing the
 * consent rule at all, and SQL built from pieces at run time. It reads text.
 *
 * @born-red OSE-1900 | method: the gate was removed from each statement in turn
 * (pages.ts, sponsor-asset-route.ts, both in sponsors.ts) and from each shared
 * rule, and this file failed naming that statement; the early return was
 * removed from the resolver and the resolver case failed | date: 2026-11-09
 *
 * Pure Node (fs + src imports) → node project.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  USE_SPONSORS_KEY,
  parseEventSettings,
  resolveEventSettings,
  useSponsorsSql,
  usesSponsors,
  validateSettingsPatch,
} from '../src/lib/event-settings';
import {
  PLACEMENT_EVENT_USES_SPONSORS_SQL,
  PLACEMENT_ON_SHOW_SQL,
  SPONSOR_ON_SHOW_SQL,
  eventUsesSponsorsSql,
} from '../src/lib/sponsor-card';

const SRC = join(__dirname, '..', 'src');

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

/** Source lines with JS comments blanked (a SQL `--` comment inside a statement stays). */
function codeLines(path: string): string[] {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/[^\n]*/gm, '')
    .split(/\r?\n/);
}

const CONSENT_RULE = /sponsor_accepted\s*=\s*1/;
/** The gate, as it appears in a statement's source text. */
const GATE = /\$\{\s*(PLACEMENT_EVENT_USES_SPONSORS_SQL|eventUsesSponsorsSql\()/;
/** How far around the consent rule the same statement can reach. */
const BEFORE = 14;
const AFTER = 6;

/**
 * Statements gated another way. Each entry says how, and a test below holds it.
 * Adding a file here is a decision: say why the event's yes still comes first.
 */
const GATED_ELSEWHERE: Record<string, string> = {
  'lib/sponsor-resolver.ts':
    'resolveSponsorsForEvent reads the gate with the event row and returns [] before either path runs',
};

interface Hit {
  file: string;
  line: number;
  gated: boolean;
}

function consentStatements(): Hit[] {
  const hits: Hit[] = [];
  for (const path of filesUnder(SRC)) {
    const lines = codeLines(path);
    lines.forEach((text, i) => {
      if (!CONSENT_RULE.test(text)) return;
      const window = lines.slice(Math.max(0, i - BEFORE), i + AFTER + 1).join('\n');
      hits.push({ file: rel(path), line: i + 1, gated: GATE.test(window) });
    });
  }
  return hits;
}

describe('every statement that carries the consent rule carries the opt-in gate', () => {
  const hits = consentStatements();

  test('the scan finds the statements it is meant to hold (it is not reading nothing)', () => {
    const files = [...new Set(hits.map((h) => h.file))].sort();
    expect(files).toEqual([
      'handlers/pages.ts',
      'handlers/sponsor-asset-route.ts',
      'handlers/sponsors.ts',
      'lib/sponsor-card.ts',
      'lib/sponsor-resolver.ts',
    ]);
    // The logo route and the display/click gate are two statements in one file.
    expect(hits.filter((h) => h.file === 'handlers/sponsors.ts')).toHaveLength(2);
    // SPONSOR_ON_SHOW_SQL and PLACEMENT_ON_SHOW_SQL.
    expect(hits.filter((h) => h.file === 'lib/sponsor-card.ts')).toHaveLength(2);
  });

  test('none of them lacks the gate', () => {
    const bare = hits
      .filter((h) => !h.gated && !(h.file in GATED_ELSEWHERE))
      .map((h) => `${h.file}:${h.line}`);
    expect(
      bare,
      'a statement shows a sponsor on the consent rule alone: add ' +
        '${PLACEMENT_EVENT_USES_SPONSORS_SQL} or ${eventUsesSponsorsSql(alias)} ' +
        '(lib/sponsor-card.ts), so an event that did not choose sponsors shows none'
    ).toEqual([]);
  });

  test('the short list of statements gated another way has no stale entry', () => {
    for (const file of Object.keys(GATED_ELSEWHERE)) {
      expect(
        hits.some((h) => h.file === file && !h.gated),
        `${file} is listed but has no ungated statement left: remove it from the list`
      ).toBe(true);
    }
  });

  test('the resolver asks the gate with the event row and stops before either path', () => {
    const text = codeLines(join(SRC, 'lib', 'sponsor-resolver.ts')).join('\n');
    const read = text.indexOf("${eventUsesSponsorsSql('')} AS uses_sponsors");
    const stop = text.indexOf('if (Number(event.uses_sponsors) !== 1) return [];');
    const path1 = text.indexOf('FROM sponsor_placement sp');
    const path2 = text.indexOf('opts.geoMatchEnabled && event.template_id');
    expect(read).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(read);
    // Path 1 (direct placements) and Path 2 (the dark geo match) both come after.
    expect(path1).toBeGreaterThan(stop);
    expect(path2).toBeGreaterThan(stop);
  });
});

describe('a write of the switch is recorded where it cannot be lost', () => {
  const text = codeLines(join(SRC, 'handlers', 'events.ts')).join('\n');

  // Dr of Security, 2026-11-09: the audit row used to be written after the
  // cell recompute and the place lookup, so a failure there left a changed
  // switch with no row.
  test('the update records it as soon as the UPDATE has landed, before any later step', () => {
    const update = text.indexOf("env.DB.prepare('UPDATE events SET ' + sets.join(', ') + where)");
    const record = text.indexOf(
      'await recordSponsorsSwitch(request, env, eventId, useSponsorsWrite, rid);'
    );
    expect(update).toBeGreaterThan(-1);
    expect(record).toBeGreaterThan(update);
    expect(text.indexOf('if (geoUpdated) {', update)).toBeGreaterThan(record);
    expect(text.indexOf('lookUpEventPlace(env, newPlace', update)).toBeGreaterThan(record);
  });

  test('the create records it once the row is in, before the shortlink and the place lookup', () => {
    const record = text.indexOf(
      'await recordSponsorsSwitch(request, env, id, useSponsorsAtCreate, rid);'
    );
    expect(record).toBeGreaterThan(text.indexOf('INSERT INTO events (id, brand_id, title, slug'));
    expect(text.indexOf('await createShortlink(env, id)')).toBeGreaterThan(record);
  });

  test('one helper writes the row, and it is the only place the action is named', () => {
    expect(text.split("action: 'EVENT_SPONSORS_SWITCH'")).toHaveLength(2);
    expect(text.split('await recordSponsorsSwitch(')).toHaveLength(3);
  });

  test('the request insert asks the event’s own yes again, in the same statement', () => {
    const disc = codeLines(join(SRC, 'lib', 'sponsor-discovery.ts')).join('\n');
    const insert = disc.indexOf('INSERT INTO sponsor_placement');
    const end = disc.indexOf('.bind(', insert);
    expect(insert).toBeGreaterThan(-1);
    expect(disc.slice(insert, end)).toContain("${eventUsesSponsorsSql('e')}");
  });
});

describe('the shared rules include the gate', () => {
  test('PLACEMENT_ON_SHOW_SQL asks the placement’s event', () => {
    expect(PLACEMENT_ON_SHOW_SQL).toContain(useSponsorsSql('e'));
  });

  test('SPONSOR_ON_SHOW_SQL asks the event of the placement it found', () => {
    expect(SPONSOR_ON_SHOW_SQL).toContain(useSponsorsSql('e_show'));
  });

  test('the placement-only form looks the event up by the placement’s own event id', () => {
    expect(PLACEMENT_EVENT_USES_SPONSORS_SQL).toContain('e_uses.id = sp.event_id');
    expect(PLACEMENT_EVENT_USES_SPONSORS_SQL).toContain(useSponsorsSql('e_uses'));
  });

  test('there is one spelling of the gate: sponsor-card hands out the settings SQL unchanged', () => {
    expect(eventUsesSponsorsSql()).toBe(useSponsorsSql('e'));
    expect(eventUsesSponsorsSql('')).toBe(useSponsorsSql(''));
  });

  test('sponsor discovery offers and takes requests only through the gate', () => {
    const text = codeLines(join(SRC, 'lib', 'sponsor-discovery.ts')).join('\n');
    const rest = text.slice(text.indexOf('const DISCOVERABLE_REST'));
    expect(rest.slice(0, rest.indexOf('`;'))).toContain("${eventUsesSponsorsSql('e')}");
    // Both the list and the request write read the one predicate.
    expect(text.match(/\$\{DISCOVERABLE_REST\}/g)).toHaveLength(2);
  });

  test('only event-settings.ts spells the key in SQL', () => {
    const spellers = filesUnder(SRC)
      .filter((p) => /\$\.useSponsors|\$\.\$\{USE_SPONSORS_KEY\}/.test(codeLines(p).join('\n')))
      .map(rel);
    expect(spellers).toEqual(['lib/event-settings.ts']);
  });
});

describe('the key: only a real true is on', () => {
  test('the SQL is true only for a stored JSON true, and guards text that is not JSON', () => {
    const sql = useSponsorsSql('e');
    expect(sql).toContain(`json_type(e.settings_json, '$.${USE_SPONSORS_KEY}') = 'true'`);
    expect(sql).toContain('json_valid(e.settings_json)');
    expect(sql).toContain('ELSE 0 END');
    expect(useSponsorsSql()).toContain("json_type(settings_json, '$.useSponsors')");
  });

  test.each([
    ['absent', '{}', false],
    ['true', '{"useSponsors":true}', true],
    ['false', '{"useSponsors":false}', false],
    ['the number 1', '{"useSponsors":1}', false],
    ['the string "true"', '{"useSponsors":"true"}', false],
    ['null', '{"useSponsors":null}', false],
    ['text that is not JSON', 'not json', false],
    ['an array', '[true]', false],
  ])('stored %s reads as %s → uses sponsors: %s', (_n, stored, on) => {
    expect(usesSponsors(parseEventSettings(stored))).toBe(on);
  });

  test('a stored false is kept as false, not dropped (the organizer chose off)', () => {
    expect(parseEventSettings('{"useSponsors":false}')).toEqual({ useSponsors: false });
  });

  test.each([true, false])('a write of %s is accepted as it is', (v) => {
    expect(validateSettingsPatch({ useSponsors: v })).toEqual({
      ok: true,
      value: { useSponsors: v },
    });
  });

  test.each([['yes'], [1], [0], [null], [[]], [{}]])('a write of %j is refused', (v) => {
    const r = validateSettingsPatch({ useSponsors: v });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('settings.useSponsors must be true or false');
  });

  test('it is not one of the absent-means-on section switches', () => {
    expect(Object.keys(resolveEventSettings({}))).not.toContain(USE_SPONSORS_KEY);
  });

  test('no tier or plan is read to decide it (invariant 7)', () => {
    expect(useSponsorsSql('e')).not.toMatch(/tier|plan/i);
    expect(PLACEMENT_EVENT_USES_SPONSORS_SQL).not.toMatch(/tier|plan/i);
  });
});
