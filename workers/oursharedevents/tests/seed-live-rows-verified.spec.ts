/**
 * A seed file that leaves an event live leaves it verified (OSE-2036).
 *
 * Every door in the Worker keeps `active ⟺ qr_verified = 1`
 * (event-status-writers.spec.ts reads `src/`). The seed files under
 * `bruno/fixtures` and `tests/ui/smoke/fixtures` are a second way rows reach
 * staging, and they wrote `status = 'active'` with qr_verified left at its
 * default 0. This spec runs each seed against a migrated database and reads
 * the rows.
 *
 * How: before each file every event is set to qr_verified = 0, which is the
 * state of a row seeded before the rule. The file is then applied the way CI
 * applies it (statement by statement, comment lines dropped). Afterwards no
 * event whose id the file names may be active and unverified, or verified and
 * not active. So a file is held to correcting the rows it owns on every pass,
 * not only on a first insert.
 *
 * WHAT THIS IS, AND IS NOT. It reads the rows a seed leaves on a fresh local
 * D1, not staging. A seed owns a row when it inserts into events or assigns a
 * status, and the row's id appears in the file as a quoted literal; an id built
 * in SQL would be missed (none is today). A file that only points at an event
 * (a sponsor, a poster, a place) owns none. Three
 * files do not apply here and are listed with the reason; each is checked to
 * name no live event. It says nothing about rows no seed owns: those are the
 * data migration proposed on OSE-2036.
 *
 * @born-red seeds leave live rows verified | method: ran before the seeds were
 *   changed, then an injected fault | date: 2026-11-18 | verified: before the
 *   change a first pass of this check showed 18 seed files each leaving its own
 *   live rows unverified (launch-story-local.sql, which re-seeds
 *   test-event-001, makes 19); after it, with the coupling statement removed
 *   from ci-brand-seed.sql that file alone went red ("ci-free-evt: status
 *   active, qr_verified 0"), and with the statement's CASE turned to a plain 0
 *   it went red the same way.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';

const FILES: Record<string, string> = {
  ...(import.meta.glob('../../../bruno/fixtures/*.sql', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>),
  ...(import.meta.glob('../../../tests/ui/smoke/fixtures/*.sql', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>),
};
const nameOf = (path: string) => path.replace(/^.*\/(bruno|tests)\//, '$1/');

/** Seeds that cannot be applied to this database, and why that is safe to skip. */
const NOT_APPLIED: Record<string, string> = {
  'tests/ui/smoke/fixtures/forms-phase2-flags.sql': 'a FORMS_DB seed: it has no events table',
  'tests/ui/smoke/fixtures/forms-smoke.sql': 'a FORMS_DB seed: it has no events table',
  'tests/ui/smoke/fixtures/corridor-baseline-smoke.sql':
    'needs rows another job seeds first; it reads events and writes none',
};

const tenv = () => env as unknown as { DB: D1Database; TEST_MIGRATION_STATEMENTS: string };
const db = () => tenv().DB;

/** Same split CI makes: statements end at `;`, `--` lines are comments. */
function statements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True when the file inserts events or assigns `status` on them: it then owns those rows. */
function writesStatus(sql: string): boolean {
  const code = statements(sql).join(';\n');
  return (
    /\b(?:INSERT(?:\s+OR\s+\w+)?|REPLACE)\s+INTO\s+["`[]?events\b/i.test(code) ||
    /\bUPDATE\s+["`[]?events["`\]]?\s+SET\b[^;]*?(?:^|,|\bSET)\s*status\s*=/i.test(code)
  );
}

interface Outcome {
  error: string | null;
  /** Events this file names that it left active and unverified, or verified and not active. */
  wrong: string[];
  /** Events this file names that it left active. */
  live: number;
}
const outcome = new Map<string, Outcome>();

// test-event-001 first: other seeds hang sponsors and posters on it.
const ORDER = Object.keys(FILES).sort(
  (a, b) =>
    Number(b.endsWith('/test-event-001.sql')) - Number(a.endsWith('/test-event-001.sql')) ||
    a.localeCompare(b)
);

beforeAll(async () => {
  const main: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of main) {
    try {
      await db().prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('no such column')) continue;
      throw e;
    }
  }
  for (const path of ORDER) {
    const sql = FILES[path]!;
    // A row seeded before the rule: whatever its status, not verified.
    await db().prepare('UPDATE events SET qr_verified = 0').run();
    let error: string | null = null;
    for (const stmt of statements(sql)) {
      try {
        await db().prepare(stmt).run();
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        break;
      }
    }
    const { results } = await db()
      .prepare('SELECT id, status, qr_verified FROM events')
      .all<{ id: string; status: string; qr_verified: number }>();
    const owned = writesStatus(sql) ? results.filter((r) => sql.includes(`'${r.id}'`)) : [];
    outcome.set(nameOf(path), {
      error,
      wrong: owned
        .filter((r) => (r.status === 'active') !== (r.qr_verified === 1))
        .map((r) => `${r.id}: status ${r.status}, qr_verified ${r.qr_verified}`),
      live: owned.filter((r) => r.status === 'active').length,
    });
  }
});

describe('a seed that leaves an event live leaves it verified', () => {
  test('the seed folders are read, and the check runs over live rows', () => {
    expect(ORDER.length).toBeGreaterThanOrEqual(30);
    const withLive = [...outcome.values()].filter((o) => o.live > 0).length;
    // If this drops, the per-file checks below pass on nothing.
    expect(withLive).toBeGreaterThanOrEqual(19);
  });

  test('only the listed files fail to apply here', () => {
    const failed = [...outcome].filter(([, o]) => o.error !== null).map(([name]) => name);
    expect(failed.sort()).toEqual(Object.keys(NOT_APPLIED).sort());
  });

  for (const [name, why] of Object.entries(NOT_APPLIED)) {
    test(`${name} is skipped (${why}) and writes no event`, () => {
      const sql = Object.entries(FILES).find(([p]) => nameOf(p) === name)?.[1];
      expect(sql, name).toBeDefined();
      const code = statements(sql!).join(';\n');
      expect(code).not.toMatch(/\b(?:INTO|UPDATE|REPLACE\s+INTO)\s+["`[]?events\b/i);
    });
  }

  for (const path of ORDER) {
    const name = nameOf(path);
    if (name in NOT_APPLIED) continue;
    test(`${name}: every event it names is verified exactly when it is active`, () => {
      const o = outcome.get(name);
      expect(o, name).toBeDefined();
      expect(o!.error).toBeNull();
      expect(o!.wrong).toEqual([]);
    });
  }
});
