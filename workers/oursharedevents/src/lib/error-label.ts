/**
 * What a log line may say about a caught error: its class and any database
 * result codes. Never its message.
 *
 * Workers Logs are on, so every line is kept by a third party, and an error's
 * message is free text that can quote data. The D1 client bundled in workerd
 * does so in two places (read in the source of workerd 1.20260930.2):
 *   - `Failed to parse body as JSON, got: ${body}`: the whole response body;
 *   - `D1_TYPE_ERROR: Type '…' not supported for value '${r}'`: a bound value.
 * A line that writes `err.message` after a database call can therefore carry a
 * row: an event id, venue text, another brand's row and, from FORMS_DB, a
 * person's details.
 *
 * Every part of the label comes from a fixed list or is a plain identifier set
 * by code, so no row can be in it:
 *   - the error's class (`Error`, `TypeError`), or the type of a thrown value
 *     that is not an Error;
 *   - the D1 client's codes and SQLite's result codes found in the message
 *     (`D1_ERROR`, `SQLITE_CONSTRAINT`), kept only when they are in the lists
 *     below. Text that merely looks like a code is not copied.
 *
 * What is lost: the table or column SQLite named (`no such column: x`,
 * `UNIQUE constraint failed: events.slug`). The log line's own `type` and
 * `handler` say where it failed; the label says how.
 *
 * Gate: tests/e2e/0-architecture/log-redaction.invariant.spec.ts refuses a log
 * line that reads a caught error any other way.
 */

/** Every code the D1 client puts at the front of a message it throws. */
const D1_CODES = new Set([
  'D1_ERROR',
  'D1_EXEC_ERROR',
  'D1_TYPE_ERROR',
  'D1_COLUMN_NOTFOUND',
  'D1_DUMP_ERROR',
  'D1_SESSION_ERROR',
]);

/** SQLite's primary result codes (sqlite.org/rescode.html), less OK, ROW and DONE. */
const SQLITE_CODES = new Set(
  [
    'ERROR',
    'INTERNAL',
    'PERM',
    'ABORT',
    'BUSY',
    'LOCKED',
    'NOMEM',
    'READONLY',
    'INTERRUPT',
    'IOERR',
    'CORRUPT',
    'NOTFOUND',
    'FULL',
    'CANTOPEN',
    'PROTOCOL',
    'EMPTY',
    'SCHEMA',
    'TOOBIG',
    'CONSTRAINT',
    'MISMATCH',
    'MISUSE',
    'NOLFS',
    'AUTH',
    'FORMAT',
    'RANGE',
    'NOTADB',
  ].map((c) => `SQLITE_${c}`)
);

const MAX_CODES = 4;

/** `Error`, `TypeError`, …; for a thrown value that is not an Error, its type. */
export function errorClassOf(err: unknown): string {
  if (!(err instanceof Error)) return typeof err;
  // A name is set by code, but keep it to a plain identifier all the same.
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(err.name) ? err.name : 'Error';
}

/**
 * The database codes in an error's message, in the order they appear, each one
 * once. An extended SQLite code is cut back to its primary code
 * (`SQLITE_BUSY_SNAPSHOT` gives `SQLITE_BUSY`). Empty when the error did not
 * come from the database. Never throws.
 */
export function errorCodes(err: unknown): string[] {
  const found: string[] = [];
  try {
    if (!(err instanceof Error)) return found;
    for (const [token] of String(err.message).matchAll(/\b(?:D1|SQLITE)_[A-Z]+(?:_[A-Z]+)*\b/g)) {
      const code = D1_CODES.has(token)
        ? token
        : [...SQLITE_CODES].find((c) => token === c || token.startsWith(`${c}_`));
      if (code && !found.includes(code)) found.push(code);
      if (found.length === MAX_CODES) break;
    }
  } catch {
    // an error whose message cannot be read has no codes
  }
  return found;
}

/** `Error D1_ERROR SQLITE_CONSTRAINT`. Never throws: it runs inside a catch. */
export function errorLabel(err: unknown): string {
  let errorClass = 'Error';
  try {
    errorClass = errorClassOf(err);
  } catch {
    // keep the default
  }
  return [errorClass, ...errorCodes(err)].join(' ');
}
