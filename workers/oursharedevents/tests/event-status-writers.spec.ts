/**
 * Every statement in the Worker that writes `events.status` keeps
 * `active ⟺ qr_verified = 1` (OSE-1425).
 *
 * The doors into and out of `active` are: create (handleCreateEvent), PUT
 * status (handleUpdateEvent), verify-qr and unverify-qr (qr-verify.ts), and the
 * draft-expiry job (lib/draft-expiry.ts). Their behaviour is tested on the rows
 * in event-create-status.spec.ts, qr-verify.spec.ts and
 * admin-status-write-from.spec.ts. This spec is the second check: it reads the
 * Worker's source and fails when a statement can write a status without
 * writing qr_verified with it, so a new door cannot open quietly.
 *
 * WHAT THIS IS, AND IS NOT. It reads source text under `src/`, with comments
 * blanked, the same way spine-keys-writers.spec.ts does, and it misses the same
 * shapes: a SET list held in a variable or built with a template, a column name
 * that is itself a variable, SQL split across concatenated strings, a
 * schema-qualified table. The one SET list built in code (PUT) is pinned by
 * text below. Seed files and migrations are not read: they are test data and
 * history, not a door a caller can use (the seeds that write live rows without
 * qr_verified are listed on OSE-2036, the follow-up to OSE-1425).
 *
 * @born-red event status writers | method: injected fault | date: 2026-11-13 |
 *   verified: each rule below went red on a planted fault: qr_verified dropped
 *   from verify-qr's UPDATE; a new `UPDATE events SET status = ?` in
 *   draft-expiry.ts; the PUT coupling block removed; qr_verified dropped from
 *   create's column list; create's actor check removed; an extra `?` in
 *   create's VALUES list.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

const WORKER = join(__dirname, '..');
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

const rel = (path: string) => relative(WORKER, path).replace(/\\/g, '/');

/** Source with its comments blanked, so prose about a statement is not a statement. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\n]*/gm, '');
}

interface Writer {
  file: string;
  set: string;
  built: boolean;
}

const UPDATE_EVENTS =
  /\bUPDATE\s+(?:OR\s+\w+\s+)?["`[]?events["`\]]?(?:\s+(?:AS\s+)?\w+)?\s+SET\b/gi;
const END_OF_SET = /\bWHERE\b|;|`|'\s*\)|"\s*\)/i;

function updateWriters(): Writer[] {
  const found: Writer[] = [];
  for (const path of filesUnder(SRC, '.ts')) {
    const text = code(path);
    for (const m of text.matchAll(UPDATE_EVENTS)) {
      const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 1500);
      if (/^\s*['"`]\s*\+/.test(rest)) {
        found.push({ file: rel(path), set: 'built', built: true });
        continue;
      }
      const end = rest.search(END_OF_SET);
      found.push({ file: rel(path), set: end === -1 ? rest : rest.slice(0, end), built: false });
    }
  }
  return found;
}

/** An assignment at the top of the SET list, not a comparison inside a CASE. */
const assigns = (set: string, column: string) =>
  new RegExp(`(?:^|,)\\s*(?:\\w+\\.)?${column}\\s*=`, 'i').test(set);
const assignedValue = (set: string, column: string) =>
  (set.match(new RegExp(`(?:^|,)\\s*(?:\\w+\\.)?${column}\\s*=\\s*([^,]+)`, 'i')) ?? [])[1]?.trim();

/**
 * Statements that write a status without qr_verified, each with why it keeps
 * the invariant. Each must write a literal status that is not 'active', from a
 * state that is not 'active'.
 */
const EXEMPT: Array<{ file: string; status: string; from: RegExp; why: string }> = [
  {
    file: 'src/lib/draft-expiry.ts',
    status: "'archived'",
    from: /\bAND\s+status\s*=\s*'draft'/i,
    why: 'archives drafts only; a draft is never verified, so qr_verified is already 0',
  },
];

describe('every writer of events.status keeps active ⟺ qr_verified = 1', () => {
  const all = updateWriters();
  const statusWriters = all.filter((w) => !w.built && assigns(w.set, 'status'));

  test('the scan finds the writers it is about', () => {
    // If these drop to zero, the checks below pass on nothing.
    const files = statusWriters.map((w) => w.file).sort();
    expect(files).toEqual([
      'src/handlers/qr-verify.ts',
      'src/handlers/qr-verify.ts',
      'src/lib/draft-expiry.ts',
    ]);
    expect(all.filter((w) => w.built).map((w) => w.file)).toEqual(['src/handlers/events.ts']);
  });

  test('the scan reads an assignment, not a comparison', () => {
    expect(assigns("status = 'active', qr_verified = 1", 'status')).toBe(true);
    expect(assigns(' is_published = 1, status = ?', 'status')).toBe(true);
    expect(assigns("listed_from = CASE WHEN status = 'active' THEN ? END", 'status')).toBe(false);
    expect(assigns('event_status = ?', 'status')).toBe(false);
  });

  test('a statement that writes a status writes qr_verified in the same statement', () => {
    const missing = statusWriters
      .filter((w) => !assigns(w.set, 'qr_verified'))
      .filter((w) => !EXEMPT.some((e) => e.file === w.file))
      .map((w) => `${w.file}: SET${w.set.replace(/\s+/g, ' ').slice(0, 120)}`);
    expect(missing).toEqual([]);
  });

  test('in each such statement, qr_verified is 1 exactly when the status is active', () => {
    const wrong: string[] = [];
    for (const w of statusWriters.filter((x) => assigns(x.set, 'qr_verified'))) {
      const status = assignedValue(w.set, 'status');
      const qr = assignedValue(w.set, 'qr_verified');
      const ok = (status === "'active'" && qr === '1') || (status !== "'active'" && qr === '0');
      if (!ok) wrong.push(`${w.file}: status = ${status}, qr_verified = ${qr}`);
    }
    expect(wrong).toEqual([]);
  });

  test('an exempt statement writes a literal status that is not active, from a state that is not active', () => {
    for (const e of EXEMPT) {
      const writers = statusWriters.filter((w) => w.file === e.file);
      expect(writers, e.file).toHaveLength(1);
      expect(assignedValue(writers[0]!.set, 'status')).toBe(e.status);
      expect(e.status).not.toBe("'active'");
      expect(code(join(WORKER, e.file)), e.why).toMatch(e.from);
    }
  });

  test('outside a status write, nothing sets qr_verified', () => {
    const lone = all
      .filter((w) => !w.built && assigns(w.set, 'qr_verified') && !assigns(w.set, 'status'))
      .map((w) => w.file);
    expect(lone).toEqual([]);
  });

  test('PUT, whose SET list is built in code, couples qr_verified to every status it writes', () => {
    const text = code(join(SRC, 'handlers', 'events.ts'));
    const put = text.slice(
      text.indexOf('export async function handleUpdateEvent('),
      text.indexOf("'UPDATE events SET ' + sets.join(")
    );
    // status can enter the list through the plain-field loop ...
    expect(put).toMatch(/\bstatus:\s*\{\s*max:\s*\d+\s*\}/);
    // ... and whenever the body names a status as text, qr_verified follows it.
    expect(put).toMatch(
      /if \(typeof body\.status === 'string'\) \{\s*sets\.push\('qr_verified = \?'\);\s*values\.push\(body\.status === 'active' \? 1 : 0\);\s*\}/
    );
    // A non-text status is refused before the list is used (400 INVALID_STATUS
    // or the NOT NULL column), so it can never write 'active'.
    expect(put).toMatch(/if \('status' in body && body\.status !== null\) \{/);
    // qr_verified enters the list in that one place only.
    expect(put.match(/qr_verified/g) ?? []).toHaveLength(1);
  });

  test('create is the one place that inserts an event, and a live row is written verified', () => {
    const inserters = filesUnder(SRC, '.ts')
      .filter((path) => /\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+["`[]?events\b/i.test(code(path)))
      .map(rel);
    expect(inserters).toEqual(['src/handlers/events.ts']);

    const text = code(join(SRC, 'handlers', 'events.ts'));
    const create = text.slice(
      text.indexOf('export async function handleCreateEvent('),
      text.indexOf('export async function handleUpdateEvent(')
    );
    // A person's create is a draft; only automation chooses the state.
    expect(create).toMatch(
      /const status = isAutomationActor\(actor\) \? requestedStatus : 'draft';/
    );
    expect(create.match(/\bconst status\b/g) ?? []).toHaveLength(1);

    const insert = create.match(/INSERT INTO events \(([\s\S]*?)\)\s*VALUES \(([^)]*)\)/);
    expect(insert).not.toBeNull();
    const columns = insert![1]!.split(',').map((c) => c.trim());
    const marks = insert![2]!.split(',').map((c) => c.trim());
    expect(columns).toContain('status');
    expect(columns).toContain('qr_verified');
    // Every column has its one bound value.
    expect(marks.every((m) => m === '?')).toBe(true);
    expect(marks).toHaveLength(columns.length);
    // The bound value for qr_verified follows the status, and nothing else.
    expect(create).toMatch(/status === 'active' \? 1 : 0,/);
  });
});
