/**
 * OSE-1615 — the spine keys on an event row: when they are cleared, computed
 * and checked. The rule itself (what a key is a hash of) is `spine-keys.ts`.
 *
 * Three steps keep a stored key true to its row:
 *
 *   1. CLEAR. Every statement in the Worker that changes an input of a key also
 *      sets both keys to NULL, in that same statement (`SPINE_KEYS_CLEAR_SQL`).
 *      A save therefore never leaves a key describing a venue, a type or a night
 *      the row no longer has, even when step 2 does not run.
 *   2. COMPUTE. After the save, `refreshSpineKeys` reads the stored row and
 *      writes both keys. Its write lands only on the row it read: a concurrent
 *      edit makes it read again.
 *   3. CHECK. The nightly `runSpineKeyCheck` reads events, computes both keys
 *      again and writes them wherever they differ from what is stored.
 *
 * WHAT THIS GUARANTEES, AND WHAT IT DOES NOT. Steps 1 and 2 cover the Worker's
 * own writes: after a save through this code a key is absent or right. They do
 * not cover a writer outside it: a seed file, a migration, a change to a type's
 * code in the registry, SQL run by hand, or an older Worker version running
 * after migration 0104. Such a writer can leave a key that no longer matches its
 * row. Step 3 replaces it: on the next run when fewer rows are waiting than one
 * run writes (SPINE_KEY_CHECK_MAX_WRITES) and the table is no larger than one
 * run reads (SPINE_KEY_CHECK_MAX_ROWS); otherwise over the nights it takes.
 * Within each page of rows a wrong key is written before a missing one, but a
 * page read earlier can use up the run's writes first. Until it is replaced the
 * key can be wrong, so a reader of the keys must not assume one is right on the
 * day of an outside write. The run reports how many it replaced (`corrected`),
 * at warning level. A database
 * trigger would make step 1 hold for every writer at once; the deploy gate
 * refuses any trigger today (`scripts/verify-d1-canonical-shape.mjs`), so that
 * is a decision for its own change.
 *
 * A venue that is corrected gets the key of the corrected venue: the keys follow
 * the row, and no earlier key is kept.
 *
 * `tests/spine-keys-writers.spec.ts` reads every `UPDATE events` under `src/`
 * and in the seed files and fails when one changes an input without step 1. It
 * reads source text, so it is a second check, not the guarantee.
 */

import { errorLabel } from './error-label';
import { computeSpineKeys, type SpineKeyInputs, type SpineKeys } from './spine-keys';

/** The event columns a key is computed from. `event_type_id` gives `uec_code`. */
export const SPINE_KEY_INPUT_COLUMNS = [
  'location',
  'h3_res7',
  'event_type_id',
  'start_date',
  'timezone',
  'starts_at',
] as const;

/** Step 1, as SQL: goes in the SET list of any statement that changes an input. */
export const SPINE_KEYS_CLEAR_SQL = 'venue_canonical_id = NULL, event_correlation_id = NULL';

/** The body fields a client may never send: the server computes them. */
export const SPINE_KEY_FIELDS = ['venue_canonical_id', 'event_correlation_id'] as const;

/**
 * Which of the server-computed key fields a request body tries to set, if any.
 * A body that is not a JSON object names no field; the handler's own checks
 * answer for it.
 */
export function suppliedSpineKeyField(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  return SPINE_KEY_FIELDS.find((f) => f in body) ?? null;
}

const ASSIGNS_AN_INPUT = new RegExp(
  `(?:^|,)\\s*(?:${SPINE_KEY_INPUT_COLUMNS.join('|')})\\s*=`,
  'i'
);

/**
 * Whether a list of SET fragments (the list an update handler builds) changes an
 * input of a key. A fragment may hold one assignment or several.
 */
export function touchesSpineKeyInputs(sets: readonly string[]): boolean {
  return sets.some((s) => ASSIGNS_AN_INPUT.test(s));
}

/** One event row as the store reads it: the inputs, the type code, the stored keys. */
interface StoredRow extends SpineKeyInputs, SpineKeys {
  id: string;
  event_type_id: string | null;
}

const ROW_COLUMNS = `e.id, e.location, e.h3_res7, e.event_type_id, e.start_date, e.timezone,
                  e.starts_at, e.venue_canonical_id, e.event_correlation_id, etr.uec_code`;

const sameKeys = (a: SpineKeys, b: SpineKeys): boolean =>
  a.venue_canonical_id === b.venue_canonical_id &&
  a.event_correlation_id === b.event_correlation_id;

/**
 * The statement that writes the keys onto the row they were computed from, and
 * only that row: every input is in the WHERE, so a row edited since the read is
 * left alone.
 */
function storeStatement(db: D1Database, row: StoredRow, keys: SpineKeys): D1PreparedStatement {
  // SQLite `IS` compares NULL as a value, so the guard holds on empty inputs.
  return db
    .prepare(
      `UPDATE events SET venue_canonical_id = ?, event_correlation_id = ?
        WHERE id = ?
          AND location IS ? AND h3_res7 IS ? AND event_type_id IS ?
          AND start_date IS ? AND timezone IS ? AND starts_at IS ?`
    )
    .bind(
      keys.venue_canonical_id,
      keys.event_correlation_id,
      row.id,
      row.location,
      row.h3_res7,
      row.event_type_id,
      row.start_date,
      row.timezone,
      row.starts_at
    );
}

const landed = (res: { meta?: { changes?: number } }): boolean => (res.meta?.changes ?? 0) > 0;

/**
 * What a log line may say about an error: its class, and any database error
 * code in its message. Never the message itself. The database client's own
 * errors can quote what it was sent or what came back ("Failed to parse body as
 * JSON, got: ..."), and what comes back here is rows of every brand. The one
 * helper for the whole Worker is lib/error-label.ts.
 */
export { errorLabel };

export const REFRESH_ATTEMPTS = 3;

/**
 * Step 2: compute both keys from the stored row and store them. Returns the keys
 * the row now has, or null when the event is gone or they could not be stored
 * (the row kept changing, or the database failed). It never throws: the save it
 * follows has already landed, and step 1 has left the keys NULL, so a failure
 * here leaves "no key yet" for the nightly check.
 */
export async function refreshSpineKeys(db: D1Database, eventId: string): Promise<SpineKeys | null> {
  try {
    for (let attempt = 0; attempt < REFRESH_ATTEMPTS; attempt++) {
      const row = await db
        .prepare(
          `SELECT ${ROW_COLUMNS}
             FROM events e LEFT JOIN event_type_registry etr ON etr.id = e.event_type_id
            WHERE e.id = ?`
        )
        .bind(eventId)
        .first<StoredRow>();
      if (!row) return null;
      const keys = await computeSpineKeys(row);
      if (sameKeys(keys, row) || landed(await storeStatement(db, row, keys).run())) return keys;
    }
    console.warn(
      JSON.stringify({
        type: 'SPINE_KEYS_REFRESH_FAILED',
        source: 'save',
        error: `the row changed on each of ${REFRESH_ATTEMPTS} attempts`,
        timestamp: new Date().toISOString(),
      })
    );
  } catch (err) {
    // No argument of this function is logged: a function that logs what it is
    // given turns each of its callers into a log sink (log-redaction gate), and
    // the nightly check repairs the row whichever one it was.
    console.warn(
      JSON.stringify({
        type: 'SPINE_KEYS_REFRESH_FAILED',
        source: 'save',
        error: errorLabel(err),
        timestamp: new Date().toISOString(),
      })
    );
  }
  return null;
}

/**
 * Start `last` once every one of `jobs` has settled, the ones that failed
 * included. (`Promise.all` would let go at the first failure, with the other
 * jobs still running.) If a job never settles, `last` never starts.
 */
export function afterAllSettle<T>(
  jobs: readonly Promise<unknown>[],
  last: () => Promise<T>
): Promise<T> {
  return Promise.allSettled(jobs).then(last);
}

/** Rows the nightly check reads per query. */
export const SPINE_KEY_CHECK_PAGE = 500;
/**
 * Rows one run reads at most. Computing a row's keys costs CPU (measured at
 * about 0.4 ms a row, most of it building date formatters), and the run shares
 * its invocation's CPU allowance with the other nightly jobs.
 */
export const SPINE_KEY_CHECK_MAX_ROWS = 5000;
/** Keys the nightly check writes in one run. Reading a row costs no write. */
export const SPINE_KEY_CHECK_MAX_WRITES = 200;
/** Wall-clock time one run may take before it stops and says so. */
export const SPINE_KEY_CHECK_BUDGET_MS = 10_000;

/** Why a run stopped before it had read and settled every row. */
export type SpineKeyCheckStop = 'write_cap' | 'row_cap' | 'time' | 'db_error';

export interface SpineKeyCheckResult {
  /** Rows read. */
  checked: number;
  /** Of those, rows whose inputs give a venue key, and an event key. */
  with_venue_key: number;
  with_event_key: number;
  /** Rows given a key they did not have, with no stored key replaced. */
  filled: number;
  /**
   * Rows where a stored key did not match the row and was replaced or removed.
   * Above zero means an input changed without the keys being cleared: a writer
   * outside the Worker, or a type's code changed in the registry.
   */
  corrected: number;
  /** Rows whose keys could not be computed or written. */
  errors: number;
  /**
   * True when rows were left unread or unwritten: the run stopped early
   * (`stopped` says why), or a write failed.
   */
  incomplete: boolean;
  stopped: SpineKeyCheckStop | null;
  /** The first error's class and database code (`errorLabel`), never its message. */
  first_error: string | null;
}

export interface SpineKeyCheckLimits {
  page?: number;
  maxRows?: number;
  maxWrites?: number;
  budgetMs?: number;
  /** The id the scan starts after. Defaults to a point that moves each day. */
  start?: string;
  /** The clock, for the time budget. */
  now?: () => number;
  /** The rule, so a test can make one row fail. */
  compute?: typeof computeSpineKeys;
}

/**
 * Where a run starts reading. Ids are read in order from this point to the end
 * and then from the beginning up to it, so every row is read when the table fits
 * in one run. The point moves each day (event ids are `evt_` and a random UUID,
 * so two hex characters split them into 256 even parts), so when a run stops
 * early at a limit, or at a row it cannot get past, the next run does not stop
 * at the same rows.
 */
export function spineKeyCheckStart(day: Date): string {
  const dayNumber = Math.floor(day.getTime() / 86_400_000);
  // 37 and 256 share no factor: 256 days in a row give 256 different starts.
  const part = (((dayNumber * 37) % 256) + 256) % 256;
  return `evt_${part.toString(16).padStart(2, '0')}`;
}

type Pending = { row: StoredRow; keys: SpineKeys; correction: boolean };

/** A stored key that the row no longer gives: the case `corrected` counts. */
const replacesAStoredKey = (row: StoredRow, keys: SpineKeys): boolean =>
  (row.venue_canonical_id !== null && row.venue_canonical_id !== keys.venue_canonical_id) ||
  (row.event_correlation_id !== null && row.event_correlation_id !== keys.event_correlation_id);

/**
 * Step 3, nightly: events' keys are computed again from their stored rows and
 * written where they differ. A row that cannot have a key (no venue name left
 * after normalising, no cell, no type, no start) computes to "no key", matches
 * what is stored and costs no write, so such rows never crowd out the rest.
 *
 * Rows are read in id order, a page at a time, from a start that moves each day
 * (`spineKeyCheckStart`). Each page's writes go in one batch (one transaction),
 * wrong keys before missing ones within the page. The run stops, and says why, after SPINE_KEY_CHECK_MAX_WRITES
 * writes with more waiting, after SPINE_KEY_CHECK_MAX_ROWS rows, or after
 * SPINE_KEY_CHECK_BUDGET_MS. It calls no other service and returns counts.
 */
export async function runSpineKeyCheck(
  env: { DB?: D1Database },
  limits: SpineKeyCheckLimits = {}
): Promise<SpineKeyCheckResult> {
  const page = limits.page ?? SPINE_KEY_CHECK_PAGE;
  const maxRows = limits.maxRows ?? SPINE_KEY_CHECK_MAX_ROWS;
  const maxWrites = limits.maxWrites ?? SPINE_KEY_CHECK_MAX_WRITES;
  const budgetMs = limits.budgetMs ?? SPINE_KEY_CHECK_BUDGET_MS;
  const now = limits.now ?? Date.now;
  const compute = limits.compute ?? computeSpineKeys;
  const start = limits.start ?? spineKeyCheckStart(new Date(now()));
  const result: SpineKeyCheckResult = {
    checked: 0,
    with_venue_key: 0,
    with_event_key: 0,
    filled: 0,
    corrected: 0,
    errors: 0,
    incomplete: false,
    stopped: null,
    first_error: null,
  };
  if (!env.DB) return result;
  const db = env.DB;
  const startedAt = now();
  const stop = (why: SpineKeyCheckStop): void => {
    result.incomplete = true;
    result.stopped = why;
  };
  const failed = (err: unknown, rows: number): void => {
    result.errors += rows;
    if (result.first_error === null) result.first_error = errorLabel(err);
  };

  let writes = 0;
  // Two stretches: after `start` to the end, then from the beginning up to
  // `start`. With no start there is one stretch.
  const stretches: Array<{ after: string; upTo: string | null }> =
    start === ''
      ? [{ after: '', upTo: null }]
      : [
          { after: start, upTo: null },
          { after: '', upTo: start },
        ];
  try {
    scan: for (const stretch of stretches) {
      let after = stretch.after;
      for (;;) {
        if (now() - startedAt > budgetMs) {
          stop('time');
          break scan;
        }
        // One row more than will be used, to know whether the stretch goes on.
        const take = Math.max(0, Math.min(page, maxRows - result.checked));
        const res = await db
          .prepare(
            `SELECT ${ROW_COLUMNS}
               FROM events e LEFT JOIN event_type_registry etr ON etr.id = e.event_type_id
              WHERE e.id > ?1 AND (?2 IS NULL OR e.id <= ?2)
              ORDER BY e.id LIMIT ?3`
          )
          .bind(after, stretch.upTo, take + 1)
          .all<StoredRow>();
        const got = res.results ?? [];
        const more = got.length > take;
        const rows = got.slice(0, take);
        const pending: Pending[] = [];
        for (const row of rows) {
          after = row.id;
          result.checked++;
          let keys: SpineKeys;
          try {
            keys = await compute(row);
          } catch (err) {
            failed(err, 1);
            continue;
          }
          if (keys.venue_canonical_id !== null) result.with_venue_key++;
          if (keys.event_correlation_id !== null) result.with_event_key++;
          if (!sameKeys(keys, row)) {
            pending.push({ row, keys, correction: replacesAStoredKey(row, keys) });
          }
        }
        if (pending.length > 0) {
          // A wrong key is worse than a missing one: those go first.
          pending.sort((a, b) => Number(b.correction) - Number(a.correction));
          const room = maxWrites - writes;
          const batch = pending.slice(0, room);
          if (batch.length > 0) {
            writes += batch.length;
            try {
              const out = await db.batch(batch.map((p) => storeStatement(db, p.row, p.keys)));
              // A miss means the row was edited after this read: its own save
              // computes its keys, so it is neither a write nor an error here.
              batch.forEach((p, i) => {
                if (!landed(out[i])) return;
                if (p.correction) result.corrected++;
                else result.filled++;
              });
            } catch (err) {
              // A batch is one transaction: none of its writes landed.
              failed(err, batch.length);
              result.incomplete = true;
            }
          }
          if (pending.length > batch.length) {
            stop('write_cap');
            break scan;
          }
        }
        if (!more) break;
        if (result.checked >= maxRows) {
          stop('row_cap');
          break scan;
        }
      }
    }
  } catch (err) {
    failed(err, 1);
    stop('db_error');
  }

  const line = JSON.stringify({
    type: 'SPINE_KEY_CHECK',
    ...result,
    timestamp: new Date().toISOString(),
  });
  // A correction, an error or an unfinished run is something to look at.
  if (result.corrected > 0 || result.errors > 0 || result.incomplete) console.warn(line);
  else console.log(line);
  return result;
}
