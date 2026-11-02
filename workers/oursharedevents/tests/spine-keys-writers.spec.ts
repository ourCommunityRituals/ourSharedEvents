/**
 * A statement that changes an input of a spine key also clears both keys
 * (OSE-1615, step 1 in `src/lib/spine-keys-store.ts`).
 *
 * WHAT THIS IS, AND IS NOT. It reads source text: every `UPDATE events` and
 * every upsert into `events` under the Worker's `src/`, in the seed files CI
 * applies, and in migrations from 0104 on. It fails when one assigns an input
 * column without setting both keys to NULL in the same statement. It is a
 * second check. A statement written in a shape this scan does not read passes
 * it. Known shapes it does not read: a SET list held in a variable or built
 * with a template (`SET ${cols.join(', ')}`); a column name that is itself a
 * variable; SQL split across concatenated strings; a row-value assignment
 * (`SET (location, h3_res7) = (...)`); a schema-qualified table
 * (`main.events`, or `INDEXED BY`); an input more than 1,500 characters into
 * the SET list; an input that comes after a SQL literal holding `WHERE`, `;` or
 * `--`, or after a closing quote and bracket such as `datetime('now')` in a
 * source file (the scan takes that for the end of the SET list); a migration
 * that changes a type's `uec_code`; a file outside the folders named above. It
 * also accepts the clear wherever it appears in the SET text, a quoted literal
 * included. What repairs a key that
 * any writer leaves stale is the nightly `runSpineKeyCheck`, which is tested on
 * the rows themselves in `spine-keys-store.spec.ts` ("an outside write of ...
 * is corrected by the next check").
 *
 * @born-red spine key writers | method: each rule below was seen red on a
 *   planted fault; the faults and what they turned red are in
 *   `docs/ccr-archive/CCR-SPINE-KEYS-2026-10-12.md` | date: 2026-10-12
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';
import { SPINE_KEY_INPUT_COLUMNS, SPINE_KEYS_CLEAR_SQL } from '../src/lib/spine-keys-store';

const WORKER = join(__dirname, '..');
const REPO = join(WORKER, '..', '..');
const SRC = join(WORKER, 'src');

function filesUnder(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, ext));
    else if (name.endsWith(ext)) out.push(path);
  }
  return out;
}

const rel = (path: string) => relative(REPO, path).replace(/\\/g, '/');

/** Source with its comments blanked, so prose about a statement is not a statement. */
function code(path: string): string {
  const text = readFileSync(path, 'utf8');
  return path.endsWith('.sql')
    ? text.replace(/--[^\n]*/g, '')
    : text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');
}

/** The files a write to `events` can live in. */
function scanned(): string[] {
  const migrations = filesUnder(join(WORKER, 'migrations'), '.sql').filter((p) => {
    const n = Number((p.match(/[\\/](\d{4})_[^\\/]*$/) ?? [])[1]);
    return n > 104;
  });
  return [
    ...filesUnder(SRC, '.ts'),
    ...filesUnder(join(REPO, 'bruno', 'fixtures'), '.sql'),
    ...filesUnder(join(REPO, 'tests', 'ui', 'smoke', 'fixtures'), '.sql'),
    ...migrations,
  ];
}

interface Writer {
  file: string;
  /** The SET list as written, or 'built' when it is assembled in code. */
  set: string;
  built: boolean;
}

// `UPDATE events SET`, in any case, with OR IGNORE and the like, a quoted table
// name or an alias; and the SET list of an upsert into events.
const UPDATE_EVENTS =
  /\bUPDATE\s+(?:OR\s+\w+\s+)?["`[]?events["`\]]?(?:\s+(?:AS\s+)?\w+)?\s+SET\b/gi;
const UPSERT_EVENTS = /\bINTO\s+["`[]?events\b[^;]*?\bON\s+CONFLICT\b[^;]*?\bDO\s+UPDATE\s+SET\b/gi;
// Where a SET list ends. In a .sql file: the WHERE or the end of the statement.
// In source: also the end of the string that holds it.
const END_OF_SET_SQL = /\bWHERE\b|;/i;
const END_OF_SET_TS = /\bWHERE\b|;|`|'\s*\)|"\s*\)/i;

function writers(): Writer[] {
  const found: Writer[] = [];
  for (const path of scanned()) {
    const text = code(path);
    for (const re of [UPDATE_EVENTS, UPSERT_EVENTS]) {
      for (const m of text.matchAll(re)) {
        const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 1500);
        // 'UPDATE events SET ' + sets.join(', '): the list is built at run time.
        if (/^\s*['"`]\s*\+/.test(rest)) {
          found.push({ file: rel(path), set: 'built', built: true });
          continue;
        }
        const end = rest.search(path.endsWith('.sql') ? END_OF_SET_SQL : END_OF_SET_TS);
        found.push({ file: rel(path), set: end === -1 ? rest : rest.slice(0, end), built: false });
      }
    }
  }
  return found;
}

const assigns = (set: string, column: string) => new RegExp(`\\b${column}\\s*=`, 'i').test(set);
const changesAnInput = (w: Writer) => SPINE_KEY_INPUT_COLUMNS.some((c) => assigns(w.set, c));
const clearsBothKeys = (w: Writer) =>
  /\bvenue_canonical_id\s*=\s*NULL\b/i.test(w.set) &&
  /\bevent_correlation_id\s*=\s*NULL\b/i.test(w.set);

describe('every writer of a spine key input clears both keys', () => {
  const all = writers();
  const inputWriters = all.filter((w) => !w.built && changesAnInput(w));

  test('the scan finds the writers it is about', () => {
    // If these drop to zero the checks below pass on nothing.
    const files = new Set(inputWriters.map((w) => w.file));
    for (const expected of [
      'workers/oursharedevents/src/handlers/events.ts',
      'workers/oursharedevents/src/lib/event-place.ts',
      'bruno/fixtures/covenant-event-geo.sql',
      'bruno/fixtures/core-values-draft-seed.sql',
      'tests/ui/smoke/fixtures/sponsored-event.sql',
      'tests/ui/smoke/fixtures/sponsor-logo-check.sql',
    ]) {
      expect(files.has(expected), expected).toBe(true);
    }
    expect(inputWriters.length).toBeGreaterThanOrEqual(8);
    expect(all.filter((w) => w.built).map((w) => w.file)).toEqual([
      'workers/oursharedevents/src/handlers/events.ts',
    ]);
  });

  test('the scan reads the shapes a statement can take', () => {
    const shapes = [
      'UPDATE events SET location = ? WHERE id = ?',
      'update events set location = ? where id = ?',
      'UPDATE OR IGNORE events SET location = ? WHERE id = ?',
      'UPDATE events AS e SET location = ? WHERE e.id = ?',
      'UPDATE events e SET e.location = ? WHERE e.id = ?',
      'UPDATE "events" SET location = ? WHERE id = ?',
      'UPDATE  events\n   SET location = ?\n WHERE id = ?',
    ];
    for (const sql of shapes) {
      UPDATE_EVENTS.lastIndex = 0;
      expect(UPDATE_EVENTS.test(sql), sql).toBe(true);
    }
    UPSERT_EVENTS.lastIndex = 0;
    expect(
      UPSERT_EVENTS.test(
        'INSERT INTO events (id) VALUES (?) ON CONFLICT(id) DO UPDATE SET location = ?'
      )
    ).toBe(true);
    // Another table whose name starts the same way is not this table.
    UPDATE_EVENTS.lastIndex = 0;
    expect(UPDATE_EVENTS.test('UPDATE events_backup SET location = ?')).toBe(false);
  });

  test('the clear sets both keys to NULL', () => {
    expect(SPINE_KEYS_CLEAR_SQL).toMatch(/\bvenue_canonical_id = NULL\b/);
    expect(SPINE_KEYS_CLEAR_SQL).toMatch(/\bevent_correlation_id = NULL\b/);
  });

  test('a statement that assigns an input column clears both keys in the same statement', () => {
    const missing = inputWriters
      .filter((w) => !clearsBothKeys(w))
      .map((w) => `${w.file}: SET${w.set.replace(/\s+/g, ' ').slice(0, 120)}`);
    expect(missing).toEqual([]);
  });

  test('the one statement whose SET list is built in code adds the clear, once for each such statement', () => {
    const text = code(join(SRC, 'handlers', 'events.ts'));
    const built = (text.match(/'UPDATE events SET '\s*\+\s*sets\.join\(/g) ?? []).length;
    const stale = (text.match(/const spineKeysStale = touchesSpineKeyInputs\(sets\);/g) ?? [])
      .length;
    const clears = (text.match(/if \(spineKeysStale\) sets\.push\(SPINE_KEYS_CLEAR_SQL\);/g) ?? [])
      .length;
    expect(built).toBe(1);
    expect(stale).toBe(1);
    expect(clears).toBe(1);
    // The clear is added after the last input can enter the list and before the join.
    const at = (needle: string) => text.indexOf(needle);
    expect(at('if (spineKeysStale) sets.push(SPINE_KEYS_CLEAR_SQL);')).toBeGreaterThan(
      at('const spineKeysStale = touchesSpineKeyInputs(sets);')
    );
    expect(at("'UPDATE events SET ' + sets.join(")).toBeGreaterThan(
      at('if (spineKeysStale) sets.push(SPINE_KEYS_CLEAR_SQL);')
    );
    const afterStale = text.slice(
      at('const spineKeysStale = touchesSpineKeyInputs(sets);'),
      at("'UPDATE events SET ' + sets.join(")
    );
    for (const column of SPINE_KEY_INPUT_COLUMNS) {
      expect(
        new RegExp(`sets\\.push\\([^)]*\\b${column}\\s*=`).test(afterStale),
        `${column} enters the SET list after the stale flag was computed`
      ).toBe(false);
    }
  });

  test('events are inserted in one place, and it computes the keys for the new row', () => {
    // A second place that inserts events must compute its keys too: add it
    // here with the test that proves it. (The nightly check would key it by
    // the next night either way.)
    const inserters = filesUnder(SRC, '.ts')
      .filter((path) => /\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+["`[]?events\b/i.test(code(path)))
      .map(rel);
    expect(inserters).toEqual(['workers/oursharedevents/src/handlers/events.ts']);
    const text = code(join(SRC, 'handlers', 'events.ts'));
    const create = text.slice(
      text.indexOf('export async function handleCreateEvent('),
      text.indexOf('export async function handleUpdateEvent(')
    );
    expect(create).toMatch(/\bINSERT INTO events\b/);
    expect(create).toMatch(/await refreshSpineKeys\(env\.DB, id\);/);
  });

  test('the nightly run includes the check', () => {
    const index = code(join(SRC, 'index.ts'));
    const scheduled = index.slice(index.indexOf('async scheduled('));
    // After every other nightly job has settled, and not among them: computing
    // keys costs CPU the retention jobs must get first. `afterAllSettle` is
    // tested on its own in spine-keys-store.spec.ts; this pins that the
    // scheduled handler uses it, inside waitUntil, on the list of the others.
    expect(scheduled).toMatch(
      /ctx\.waitUntil\(afterAllSettle\(jobs, \(\) => runSpineKeyCheck\(env\)\)\);/
    );
    expect(scheduled).toMatch(/ctx\.waitUntil\(Promise\.all\(jobs\)\);/);
    const listStart = scheduled.indexOf('const jobs = [');
    expect(listStart).toBeGreaterThan(-1);
    const together = scheduled.slice(listStart, scheduled.indexOf('];', listStart));
    expect(together).toContain('runFormDataLifecycle(env)');
    expect(together).toContain('runRegistrationContactClear(env)');
    expect(together).not.toContain('runSpineKeyCheck');
    // The check is started in one place only.
    expect(scheduled.match(/runSpineKeyCheck\(env\)/g) ?? []).toHaveLength(1);
  });

  test('outside the store, the Worker only ever sets a key to NULL', () => {
    const offenders: string[] = [];
    for (const path of filesUnder(SRC, '.ts')) {
      const file = rel(path);
      if (/src\/lib\/spine-keys(-store)?\.ts$/.test(file)) continue;
      const text = code(path);
      for (const m of text.matchAll(/\b(venue_canonical_id|event_correlation_id)\b/g)) {
        const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 12);
        if (!/^\s*=\s*NULL\b/.test(tail)) offenders.push(`${file}: ${m[0]}${tail.trimEnd()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
