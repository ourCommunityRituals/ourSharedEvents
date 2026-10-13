/**
 * `errorLabel`: what a log line may say about a caught error.
 *
 * The D1 client inside workerd puts data in its error messages. Two forms, read
 * in the source of workerd 1.20260930.2 (the version in package-lock.json):
 *   - `Failed to parse body as JSON, got: ${body}`: the whole response body,
 *     not truncated, rethrown as `D1_ERROR: Failed to parse body as JSON, got: …`;
 *   - `D1_TYPE_ERROR: Type '${rType}' not supported for value '${r}'`: a bound
 *     value, written out.
 * Workers Logs are on, so a log line that writes `err.message` after a database
 * call can carry a row. The label is the error's class and any database result
 * codes, each from a fixed list, so nothing a row holds can be in it.
 *
 * Level: N (node project, pure function). The runtime side, with the real D1
 * client and the real log lines, is `d1-error-log.spec.ts`.
 *
 * @born-red every test | method: written before `src/lib/error-label.ts`
 *   existed; the file failed to load. Then run against a planted `errorLabel`
 *   that returned `err.message` (and `String(err)` for a non-Error): 9 of 9
 *   failed | date: 2026-10-12
 */

import { describe, test, expect } from 'vitest';
import { errorCodes, errorLabel } from '../src/lib/error-label';

// Text that stands for a row: a name, an email, an event id.
const ROW = 'Jane Roe jane.roe@example.test evt_4f1c';

// The two message forms, as the D1 client builds them.
const jsonBodyError = (body: string): Error =>
  new Error(`D1_ERROR: Failed to parse body as JSON, got: ${body}`, {
    cause: new Error(`Failed to parse body as JSON, got: ${body}`),
  });
const typeError = (value: unknown): Error =>
  new Error(`D1_TYPE_ERROR: Type '${typeof value}' not supported for value '${String(value)}'`, {
    cause: new Error(`Type '${typeof value}' not supported for value '${String(value)}'`),
  });

/** Every label is a class name, then at most a few database codes. */
const LABEL_SHAPE = /^[A-Za-z][A-Za-z0-9_]{0,63}(?: (?:D1|SQLITE)_[A-Z_]{2,40}){0,4}$/;

describe('errorLabel — the class and the database codes, never the message', () => {
  test('a response body the client could not parse is not written out', () => {
    const label = errorLabel(jsonBodyError(`{"results":[{"attendee_name":"${ROW}"}]}`));
    expect(label).toBe('Error D1_ERROR');
  });

  test('a bound value the client refused is not written out', () => {
    const label = errorLabel(typeError([ROW]));
    expect(label).toBe('Error D1_TYPE_ERROR');
  });

  test('a constraint failure keeps its SQLite code and drops the table and column', () => {
    const err = new Error('D1_ERROR: UNIQUE constraint failed: events.slug: SQLITE_CONSTRAINT');
    expect(errorLabel(err)).toBe('Error D1_ERROR SQLITE_CONSTRAINT');
    expect(errorCodes(err)).toEqual(['D1_ERROR', 'SQLITE_CONSTRAINT']);
  });

  test('an extended SQLite code is cut back to the code in the list', () => {
    const err = new Error('D1_ERROR: database is locked: SQLITE_BUSY_SNAPSHOT');
    expect(errorLabel(err)).toBe('Error D1_ERROR SQLITE_BUSY');
  });

  test('code-shaped text inside quoted data is not a code', () => {
    // A row can hold any text, text shaped like a code included.
    const label = errorLabel(jsonBodyError('{"note":"SQLITE_JANE_ROE D1_JANE_ROE SQLITE_ jane"}'));
    expect(label).toBe('Error D1_ERROR');
  });

  test('an error with no database code is its class alone', () => {
    expect(errorLabel(new TypeError(`Cannot read properties of ${ROW}`))).toBe('TypeError');
    expect(errorCodes(new TypeError(`Cannot read properties of ${ROW}`))).toEqual([]);
  });

  test('a thrown value that is not an Error is its type, never its text', () => {
    expect(errorLabel(ROW)).toBe('string');
    expect(errorLabel({ message: ROW })).toBe('object');
    expect(errorLabel(undefined)).toBe('undefined');
    expect(errorLabel(null)).toBe('object');
  });

  test('a class name that is not a plain identifier is replaced', () => {
    const err = new Error('D1_ERROR: no such table: events: SQLITE_ERROR');
    err.name = ROW;
    expect(errorLabel(err)).toBe('Error D1_ERROR SQLITE_ERROR');
  });

  test('it never throws, and whatever the message holds the label keeps its shape', () => {
    const hostile = new Proxy(new Error('x'), {
      get(target, key) {
        if (key === 'message' || key === 'name') throw new Error(ROW);
        return Reflect.get(target, key);
      },
    });
    expect(() => errorLabel(hostile)).not.toThrow();
    expect(errorLabel(hostile)).not.toContain('Jane');

    const messages = [
      ROW,
      `D1_ERROR: ${ROW}: SQLITE_CONSTRAINT`,
      `D1_EXEC_ERROR: Error in line 1: INSERT INTO t VALUES ('${ROW}'): SQLITE_ERROR`,
      `D1_COLUMN_NOTFOUND: Column not found (${ROW})`,
      `${'D1_ERROR SQLITE_FULL SQLITE_BUSY SQLITE_IOERR SQLITE_NOMEM SQLITE_AUTH '.repeat(40)}${ROW}`,
      `\n\t"${ROW}"\u0000 D1_ERROR`,
    ];
    for (const message of messages) {
      const label = errorLabel(new Error(message));
      expect(label, message).toMatch(LABEL_SHAPE);
      for (const word of ROW.split(' ')) expect(label, message).not.toContain(word);
    }
  });
});
