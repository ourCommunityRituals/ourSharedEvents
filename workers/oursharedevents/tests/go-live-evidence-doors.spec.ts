/**
 * Going live needs a code that works: the rule, and where it is asked
 * (OSE-1420, with OSE-1426 folded in).
 *
 * Three things are checked here, with no runtime:
 *   1. The rule itself (lib/code-validity.ts): which share-link rows and which
 *      poster rows count as a working code.
 *   2. The read (lib/go-live-evidence.ts) over a stand-in database: it counts
 *      by that rule, it throws when a read fails, and it returns no scan count.
 *   3. The source of the two doors: each asks before it writes `active`, and
 *      the read holds no second copy of the rule.
 *
 * WHAT PART 3 IS, AND IS NOT. It reads source text with comments blanked, the
 * way event-status-writers.spec.ts does, and it misses what that misses: a call
 * hidden behind another name, a write built from variables. The behaviour of
 * the doors on real rows is tests/go-live-evidence.spec.ts (workers pool).
 * "One rule, two callers" is checked as: the read imports the rule and holds no
 * condition of its own. The second caller the tickets name, an admin view of
 * each code with its reason, is not built; nothing here proves it will call
 * the rule when it is.
 *
 * @born-red go-live evidence doors | method: injected fault | date: 2026-11-18 |
 *   verified: each check below went red on a planted fault; the list is in the
 *   pull request.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';
import { isWorkingPoster, isWorkingShareLink } from '../src/lib/code-validity';
import {
  collectGoLiveEvidence,
  evidenceUnavailable,
  goLiveRefusal,
  hasGoLiveEvidence,
} from '../src/lib/go-live-evidence';

const WORKER = join(__dirname, '..');
const SRC = join(WORKER, 'src');

/** Text with its comments blanked, so prose about a call is not a call. */
const blank = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');

function code(...path: string[]): string {
  return blank(readFileSync(join(SRC, ...path), 'utf8'));
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

// ── 1. The rule ──────────────────────────────────────────────────────────────

describe('a share link works when the resolver accepts its code and its target', () => {
  test.each([
    ['a minted code with no target', { code: 'Ab3xY9', target_url: null }, true],
    ['an empty target is no target', { code: 'Ab3xY9', target_url: '' }, true],
    ['an https target', { code: 'Ab3xY9', target_url: 'https://example.org/give' }, true],
    ['5 characters', { code: 'Ab3xY', target_url: null }, false],
    ['7 characters', { code: 'Ab3xY9z', target_url: null }, false],
    ['a character outside base62', { code: 'Ab3xY-', target_url: null }, false],
    ['an empty code', { code: '', target_url: null }, false],
    ['a code that is not text', { code: 123456, target_url: null }, false],
    ['a missing code', { code: null, target_url: null }, false],
    ['an http target', { code: 'Ab3xY9', target_url: 'http://example.org/give' }, false],
    ['a javascript target', { code: 'Ab3xY9', target_url: 'javascript:alert(1)' }, false],
    ['a target that is not a URL', { code: 'Ab3xY9', target_url: 'example.org' }, false],
    ['a target that is not text', { code: 'Ab3xY9', target_url: 7 }, false],
  ])('%s', (_name, row, works) => {
    expect(isWorkingShareLink(row)).toBe(works);
  });
});

describe('a poster works when it is switched on and the scan route accepts its token', () => {
  test.each([
    ['switched on, with a minted token', { qr_token: 'qrt_abc123', is_active: 1 }, true],
    [
      'a token of exactly 128 characters',
      { qr_token: `qrt_${'x'.repeat(124)}`, is_active: 1 },
      true,
    ],
    ['switched off', { qr_token: 'qrt_abc123', is_active: 0 }, false],
    ['no value for the switch', { qr_token: 'qrt_abc123', is_active: null }, false],
    ['text that reads as on', { qr_token: 'qrt_abc123', is_active: '1' }, false],
    ['true is not the stored value', { qr_token: 'qrt_abc123', is_active: true }, false],
    ['a token without the qrt_ prefix', { qr_token: 'token-abc123', is_active: 1 }, false],
    ['a token of 129 characters', { qr_token: `qrt_${'x'.repeat(125)}`, is_active: 1 }, false],
    ['a token that is not text', { qr_token: 42, is_active: 1 }, false],
    ['a missing token', { qr_token: null, is_active: 1 }, false],
    // OSE-2140 (owner, 2026-11-18): the room's vote code is not a poster.
    ["the room's vote code", { qr_token: 'qrt_abc123', is_active: 1, is_vote_code: 1 }, false],
    [
      'a poster read with its vote-code flag',
      { qr_token: 'qrt_abc123', is_active: 1, is_vote_code: 0 },
      true,
    ],
  ])('%s', (_name, row, works) => {
    expect(isWorkingPoster(row)).toBe(works);
  });
});

// ── 2. The read ──────────────────────────────────────────────────────────────

type Reply = { results?: unknown[] } | Error;

/** A database that answers each of the two evidence reads with what it is given. */
function standIn(links: Reply, posters: Reply): { db: D1Database; asked: string[] } {
  const asked: string[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          asked.push(`${sql} <- ${JSON.stringify(args)}`);
          return {
            async all() {
              const reply = /\bFROM shortlinks\b/.test(sql) ? links : posters;
              if (reply instanceof Error) throw reply;
              return reply;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, asked };
}

describe('the read counts the rows that pass the rule', () => {
  test('rows that do not work are not counted', async () => {
    const { db } = standIn(
      {
        results: [
          { code: 'Ab3xY9', target_url: null },
          { code: 'Zz9Zz9', target_url: 'https://example.org/give' },
          { code: 'Ab3xY9z', target_url: null },
          { code: 'Qq1Qq1', target_url: 'http://example.org/give' },
        ],
      },
      {
        results: [
          { qr_token: 'qrt_a', is_active: 1 },
          { qr_token: 'qrt_b', is_active: 0 },
          { qr_token: 'qrt_c', is_active: 1 },
          { qr_token: 'qrt_d', is_active: 1 },
          { qr_token: 'not-a-token', is_active: 1 },
        ],
      }
    );
    expect(await collectGoLiveEvidence(db, 'evt_1')).toEqual({
      shortlinks: 2,
      active_deployments: 3,
    });
  });

  test('no rows is a count of zero, and zero is not evidence', async () => {
    const { db } = standIn({ results: [] }, { results: [] });
    const evidence = await collectGoLiveEvidence(db, 'evt_1');
    expect(evidence).toEqual({ shortlinks: 0, active_deployments: 0 });
    expect(hasGoLiveEvidence(evidence)).toBe(false);
  });

  test('either kind of working code is enough', () => {
    expect(hasGoLiveEvidence({ shortlinks: 1, active_deployments: 0 })).toBe(true);
    expect(hasGoLiveEvidence({ shortlinks: 0, active_deployments: 1 })).toBe(true);
  });

  test('both reads are for this event and no other', async () => {
    const { db, asked } = standIn({ results: [] }, { results: [] });
    await collectGoLiveEvidence(db, 'evt_this_one');
    expect(asked.sort()).toEqual([
      'SELECT code, target_url FROM shortlinks WHERE event_id = ? <- ["evt_this_one"]',
      'SELECT qr_token, is_active, is_vote_code FROM poster_deployments WHERE event_id = ? <- ["evt_this_one"]',
    ]);
  });

  test('the answer has two keys: no scan count is read or returned', async () => {
    const { db, asked } = standIn(
      { results: [{ code: 'Ab3xY9', target_url: null }] },
      { results: [] }
    );
    expect(Object.keys(await collectGoLiveEvidence(db, 'evt_1')).sort()).toEqual([
      'active_deployments',
      'shortlinks',
    ]);
    expect(asked.join('\n')).not.toMatch(/scan/i);
  });
});

describe('a read that fails is thrown, never counted as zero', () => {
  const good = { results: [{ code: 'Ab3xY9', target_url: null }] };
  const on = { results: [{ qr_token: 'qrt_a', is_active: 1 }] };

  test.each([
    ['the link read throws', new Error('D1_ERROR: down'), on],
    ['the poster read throws', good, new Error('D1_ERROR: down')],
    ['the link read has no row list', {}, on],
    ['the poster read has no row list', good, {}],
    ['the link read has a row list that is not a list', { results: 'x' as never }, on],
  ] as Array<[string, Reply, Reply]>)('%s', async (_name, links, posters) => {
    const { db } = standIn(links, posters);
    await expect(collectGoLiveEvidence(db, 'evt_1')).rejects.toThrow();
  });
});

describe('the two answers carry a code, the move and the counts, and nothing about the event', () => {
  test('the refusal', () => {
    const body = goLiveRefusal('ready', { shortlinks: 0, active_deployments: 0 });
    expect(Object.keys(body).sort()).toEqual(['code', 'error', 'evidence', 'from', 'ok', 'to']);
    expect(body).toMatchObject({ ok: false, code: 'NO_QR_EVIDENCE', from: 'ready', to: 'active' });
    expect(body.error).not.toMatch(/scan/i);
  });

  test('the failed read', () => {
    const body = evidenceUnavailable();
    expect(Object.keys(body).sort()).toEqual(['code', 'error', 'ok']);
    expect(body).toMatchObject({ ok: false, code: 'EVIDENCE_UNAVAILABLE' });
    // It must not read as "this event has no code".
    expect(body.error).not.toMatch(/no working/i);
    expect(body.error).toMatch(/Nothing was changed/);
  });
});

// ── 3. The doors ─────────────────────────────────────────────────────────────

describe('one rule: the read holds no condition of its own', () => {
  const read = code('lib', 'go-live-evidence.ts');

  test('it takes both halves of the rule from lib/code-validity.ts', () => {
    expect(read).toMatch(
      /import \{[^}]*\bisWorkingPoster\b[^}]*\bisWorkingShareLink\b[^}]*\} from '\.\/code-validity';/
    );
    expect(read).toMatch(/links\.filter\(isWorkingShareLink\)\.length/);
    expect(read).toMatch(/posters\.filter\(isWorkingPoster\)\.length/);
  });

  test('it does not test a code, a target or a switch itself', () => {
    expect(read).not.toMatch(/isValidCodeShape|isValidHttpsTarget/);
    expect(read).not.toMatch(/is_active\s*(=|!|<|>)/);
    expect(read).not.toMatch(/target_url\s*(=|!|\.|IS\b)/i);
    expect(read).not.toMatch(/https/i);
  });

  test('it never reads the qr_verified column, nor any column of the event row', () => {
    expect(read).not.toMatch(/qr_verified/);
    expect(read).not.toMatch(/\bFROM\s+events\b/i);
    expect(code('lib', 'code-validity.ts')).not.toMatch(/qr_verified/);
  });

  test('its two reads filter on the event and on nothing else', () => {
    const wheres = [...read.matchAll(/\bWHERE\b([^'"`]*)['"`]/g)].map((m) => m[1]!.trim());
    expect(wheres).toEqual(['event_id = ?', 'event_id = ?']);
    expect(read).not.toMatch(/\bCOUNT\s*\(/i);
  });

  test('a failed read is caught in one place, and that place does not answer "refused"', () => {
    expect(read.match(/\bcatch\b/g) ?? []).toHaveLength(1);
    const caught = read.slice(read.indexOf('catch'), read.indexOf('if (hasGoLiveEvidence('));
    expect(caught).toMatch(/console\.error\(/);
    expect(caught).toMatch(/return \{ outcome: 'unavailable' \};/);
    expect(caught).not.toMatch(/refused/);
  });

  test("the token check is the scan route's own: one definition, read by both", () => {
    expect(code('lib', 'qr-token.ts')).toMatch(/export function isValidQrTokenShape\(/);
    expect(code('lib', 'code-validity.ts')).toMatch(
      /import \{ isValidQrTokenShape \} from '\.\/qr-token';/
    );
    const scan = code('handlers', 'qr-scan.ts');
    expect(scan).toMatch(/import \{ isValidQrTokenShape \} from '\.\.\/lib\/qr-token';/);
    expect(scan).toMatch(/if \(!isValidQrTokenShape\(qrToken\)\) \{/);
    const definers = filesUnder(SRC).filter((path) =>
      /function isValidQrTokenShape\(/.test(blank(readFileSync(path, 'utf8')))
    );
    expect(definers.map((path) => relative(SRC, path).replace(/\\/g, '/'))).toEqual([
      'lib/qr-token.ts',
    ]);
    expect(read).not.toMatch(/qrt_|isValidQrTokenShape/);
  });

  test('the rule is written once: no other file under src/ tests a share-link row for go-live', () => {
    expect(code('lib', 'code-validity.ts')).toMatch(/isValidCodeShape\(row\.code\)/);
    for (const door of [code('handlers', 'qr-verify.ts'), code('handlers', 'events.ts')]) {
      expect(door).not.toMatch(/isWorkingShareLink|isWorkingPoster|collectGoLiveEvidence/);
      expect(door).not.toMatch(/hasGoLiveEvidence/);
    }
  });
});

describe('each door asks before it writes active', () => {
  /** The text from the question up to the write, with the checks in between. */
  function betweenAskAndWrite(text: string, write: string): string {
    const ask = text.indexOf('requireGoLiveEvidence(');
    const at = text.indexOf(write);
    expect(ask, 'the door asks').toBeGreaterThan(-1);
    expect(at, 'the door writes').toBeGreaterThan(-1);
    expect(ask, 'the question comes before the write').toBeLessThan(at);
    return text.slice(ask, at);
  }

  test('verify-qr', () => {
    const text = code('handlers', 'qr-verify.ts');
    const verify = text.slice(
      text.indexOf('export async function handleV2AdminVerifyQr('),
      text.indexOf('export async function handleV2AdminUnverifyQr(')
    );
    expect(verify.match(/requireGoLiveEvidence\(/g) ?? []).toHaveLength(1);
    expect(verify).toMatch(/requireGoLiveEvidence\(env\.DB, eventId, 'verify_qr', row\.status\)/);
    const gap = betweenAskAndWrite(verify, "UPDATE events SET status = 'active'");
    // Both outcomes that are not "allowed" leave before the write.
    expect(gap).toMatch(
      /if \(decision\.outcome === 'unavailable'\) return refusal\(evidenceUnavailable\(\), 503, rid\);/
    );
    expect(gap).toMatch(
      /if \(decision\.outcome === 'refused'\) \{\s*return refusal\(goLiveRefusal\(row\.status, decision\.evidence\), 409, rid\);\s*\}/
    );
    // Leaving active asks for nothing.
    const unverify = text.slice(text.indexOf('export async function handleV2AdminUnverifyQr('));
    expect(unverify).not.toMatch(/requireGoLiveEvidence/);
  });

  test('PUT status', () => {
    const text = code('handlers', 'events.ts');
    const put = text.slice(
      text.indexOf('export async function handleUpdateEvent('),
      text.indexOf('export async function handleDeleteEvent(')
    );
    expect(put.match(/requireGoLiveEvidence\(/g) ?? []).toHaveLength(1);
    // Asked on every move INTO active, from any state, and only then.
    expect(put).toMatch(
      /if \(from !== to && to === 'active'\) \{\s*const decision = await requireGoLiveEvidence\(env\.DB, eventId, 'put_status', from\);/
    );
    const gap = betweenAskAndWrite(put, "'UPDATE events SET ' + sets.join(");
    expect(gap).toMatch(
      /if \(decision\.outcome === 'unavailable'\) \{\s*return Response\.json\(\s*\{ \.\.\.evidenceUnavailable\(\), status: 503, requestId: rid \},\s*\{ status: 503,/
    );
    expect(gap).toMatch(
      /if \(decision\.outcome === 'refused'\) \{\s*return Response\.json\(\s*\{ \.\.\.goLiveRefusal\(from, decision\.evidence\), status: 409, requestId: rid \},\s*\{ status: 409,/
    );
    // The receipt is set only on the allowed path, after both returns.
    expect(gap.indexOf('goLiveEvidence = decision.evidence;')).toBeGreaterThan(
      gap.indexOf("decision.outcome === 'refused'")
    );
  });

  test('the two doors are the only callers under src/, so there is no third answer to keep in step', () => {
    const askers = filesUnder(SRC)
      .filter((path) => /\brequireGoLiveEvidence\(/.test(blank(readFileSync(path, 'utf8'))))
      .map((path) => relative(SRC, path).replace(/\\/g, '/'))
      .sort();
    expect(askers).toEqual([
      'handlers/events.ts',
      'handlers/qr-verify.ts',
      'lib/go-live-evidence.ts',
    ]);
  });

  test('verify-qr holds the only statement under src/ that writes the literal status active', () => {
    const writers = filesUnder(SRC)
      .filter((path) =>
        /\bUPDATE\s+events\s+SET\b[^;`]*?\bstatus\s*=\s*'active'\s*,/i.test(
          blank(readFileSync(path, 'utf8'))
        )
      )
      .map((path) => relative(SRC, path).replace(/\\/g, '/'));
    expect(writers).toEqual(['handlers/qr-verify.ts']);
  });
});

describe('the admin page has its own sentence for each answer', () => {
  const admin = readFileSync(join(SRC, 'templates', 'admin.html'), 'utf8');
  const reasons = admin.slice(
    admin.indexOf('var FAILURE_REASONS = {'),
    admin.indexOf('window._adminRequestFailed = function')
  );

  test('NO_QR_EVIDENCE says what to do', () => {
    expect(reasons).toMatch(/NO_QR_EVIDENCE: 'It has no working link or poster code yet\./);
  });

  test('EVIDENCE_UNAVAILABLE does not say the event has no code', () => {
    const line = reasons.split('\n').find((l) => l.includes('EVIDENCE_UNAVAILABLE:')) ?? '';
    expect(line).toMatch(/could not be checked/);
    expect(line).not.toMatch(/no working/i);
  });
});
