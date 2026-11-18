/**
 * OSE-2144 — nothing is more live than its container, held by reading `src/`.
 *
 * tests/event-live-container.spec.ts runs the four public reads that were open.
 * This file is for the read someone adds tomorrow:
 *
 *   1. there is ONE test for "the parent event is live": eventLiveSql in
 *      domain/event-state.ts, derived from the state machine (the states that
 *      render on 'public'), and the shared sponsor rules are built on it;
 *   2. every statement in `src/` that carries the sponsor consent rule
 *      (`sponsor_accepted = 1`) also carries the live test, through
 *      eventLiveSql or one of the shared rules that include it, or is one of
 *      the TWO written exceptions (owner, 2026-11-18) below;
 *   3. the four reads this story closed ask the shared test by name: the
 *      sponsor resolver, impression/click, the logo and asset proxy, and /q.
 *
 * What this cannot see: a statement that shows a sponsor without writing the
 * consent rule at all, and SQL built from pieces at run time. It reads text.
 *
 * @born-red OSE-2144 | method: run against main 43a25c1, where eventLiveSql
 * does not exist and the shared rules spell `status = 'active'`: sections 1 and
 * 3 failed on import and on each read; section 2 failed naming the resolver,
 * sponsors.ts (logo, beacon) and sponsor-asset-route.ts. Then, on this branch,
 * `AND ${eventLiveSql('e')}` was removed from the /q lookup and the resolver's
 * stop was removed, and each named case failed | date: 2026-11-18
 *
 * Pure Node (fs + src imports) → node project.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  VALID_EVENT_STATES,
  canRender,
  eventLiveSql,
  type EventState,
} from '../src/domain/event-state';
import { PLACEMENT_ON_SHOW_SQL, SPONSOR_ON_SHOW_SQL } from '../src/lib/sponsor-card';

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
const code = (file: string) => codeLines(join(SRC, file)).join('\n');

const CONSENT_RULE = /sponsor_accepted\s*=\s*1/;
/** The live test, as it appears in a statement's source text. */
const LIVE = /\$\{\s*(eventLiveSql\(|PLACEMENT_ON_SHOW_SQL\s*\}|SPONSOR_ON_SHOW_SQL\s*\})/;
/**
 * How far around the consent rule the same WHERE clause reaches. Kept short on
 * purpose: the recap statement asks the live test in its SELECT (art only) and
 * must still read as the exception it is.
 */
const BEFORE = 6;
const AFTER = 8;

/**
 * The two written exceptions (owner, 2026-11-18). Nothing else may be added
 * here without a new owner decision recorded on the story.
 */
const WRITTEN_EXCEPTIONS: Record<string, string> = {
  'handlers/pages.ts':
    'the recap page of an archived event that was listed keeps its sponsor strip (fetchEventPageSocialData)',
  'lib/shared-report-builder.ts':
    'an archived event’s SharedReport opens with an unexpired signed link (campaign links read the placements)',
};

interface Hit {
  file: string;
  line: number;
  live: boolean;
}

function consentStatements(): Hit[] {
  const hits: Hit[] = [];
  for (const path of filesUnder(SRC)) {
    const lines = codeLines(path);
    lines.forEach((text, i) => {
      if (!CONSENT_RULE.test(text)) return;
      const window = lines.slice(Math.max(0, i - BEFORE), i + AFTER + 1).join('\n');
      hits.push({ file: rel(path), line: i + 1, live: LIVE.test(window) });
    });
  }
  return hits;
}

describe('1. one test for "the parent event is live"', () => {
  test('it is the state machine’s public rule, written as SQL', () => {
    const live = VALID_EVENT_STATES.filter((s: EventState) => canRender(s, 'public'));
    expect(live).toEqual(['active']);
    expect(eventLiveSql('e')).toBe(`e.status = 'active'`);
    expect(eventLiveSql('')).toBe(`status = 'active'`);
    expect(eventLiveSql()).toBe(`e.status = 'active'`);
  });

  test('the shared sponsor rules are built on it', () => {
    expect(SPONSOR_ON_SHOW_SQL).toContain(eventLiveSql('e_show'));
    expect(PLACEMENT_ON_SHOW_SQL).toContain(eventLiveSql('e'));
    // and spell no status of their own
    const sc = code('lib/sponsor-card.ts');
    expect(sc).not.toMatch(/status\s*=\s*'active'/);
  });
});

describe('2. every statement with the consent rule asks the live test, or is a written exception', () => {
  const hits = consentStatements();

  test('the scan finds the statements it is meant to hold (it is not reading nothing)', () => {
    const files = [...new Set(hits.map((h) => h.file))].sort();
    expect(files).toEqual([
      'handlers/pages.ts',
      'lib/shared-report-builder.ts',
      'lib/sponsor-card.ts',
    ]);
  });

  test('none of them lacks it', () => {
    const bare = hits
      .filter((h) => !h.live && !(h.file in WRITTEN_EXCEPTIONS))
      .map((h) => `${h.file}:${h.line}`);
    expect(
      bare,
      'a statement shows a sponsor on the consent rule without asking whether the event is live: ' +
        'use ${PLACEMENT_ON_SHOW_SQL} / ${SPONSOR_ON_SHOW_SQL} (lib/sponsor-card.ts) or ' +
        '${eventLiveSql(alias)} (domain/event-state.ts)'
    ).toEqual([]);
  });

  test('each written exception is still an exception (no stale entry)', () => {
    for (const file of Object.keys(WRITTEN_EXCEPTIONS)) {
      expect(
        hits.some((h) => h.file === file && !h.live),
        `${file} is listed but asks the live test now: remove it from the list`
      ).toBe(true);
    }
  });

  test('the recap exception is stated once, beside its statement', () => {
    const pages = readFileSync(join(SRC, 'handlers', 'pages.ts'), 'utf8');
    expect(pages.split('THE RECAP EXCEPTION').length - 1).toBe(1);
  });
});

describe('3. the reads this story closed ask the shared test by name', () => {
  test('the resolver stops on a non-live event before either path, and Path 1 asks the rule', () => {
    const text = code('lib/sponsor-resolver.ts');
    const read = text.indexOf("CASE WHEN ${eventLiveSql('')} THEN 1 ELSE 0 END AS is_live");
    const stop = text.indexOf('if (Number(event.is_live) !== 1) return [];');
    const path1 = text.indexOf('WHERE sp.event_id = ? AND ${PLACEMENT_ON_SHOW_SQL}');
    const path2 = text.indexOf('opts.geoMatchEnabled && event.template_id');
    expect(read).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(read);
    expect(path1).toBeGreaterThan(stop);
    expect(path2).toBeGreaterThan(stop);
  });

  test('impression and click (resolvePlacementGeo) ask PLACEMENT_ON_SHOW_SQL', () => {
    const text = code('handlers/sponsors.ts');
    const fn = text.slice(text.indexOf('async function resolvePlacementGeo('));
    expect(fn.slice(0, fn.indexOf('.bind('))).toContain(
      'WHERE e.id = ?1 AND sb.id = ?2 AND ${PLACEMENT_ON_SHOW_SQL}'
    );
  });

  test('the logo proxy and the asset route ask SPONSOR_ON_SHOW_SQL', () => {
    const sponsors = code('handlers/sponsors.ts');
    const logo = sponsors.slice(sponsors.indexOf('export async function handleSponsorLogo('));
    expect(logo.slice(0, logo.indexOf('.bind('))).toContain(
      'WHERE sb.id = ? AND ${SPONSOR_ON_SHOW_SQL}'
    );
    const asset = code('handlers/sponsor-asset-route.ts');
    const fn = asset.slice(asset.indexOf('export async function handleSponsorAsset('));
    expect(fn.slice(0, fn.indexOf('.bind('))).toContain('AND ${SPONSOR_ON_SHOW_SQL}');
  });

  test('/q looks a code up only on a live event', () => {
    const text = code('handlers/qr-scan.ts');
    const lookup = text.slice(text.indexOf('const lookupDeployment = () =>'));
    expect(lookup.slice(0, lookup.indexOf('.bind('))).toContain(
      "WHERE pd.qr_token = ? AND pd.is_active = 1 AND ${eventLiveSql('e')}"
    );
  });
});
