/**
 * The lexicon allowance stays one exact name (OSE-2034, ADR-031).
 *
 * The honesty lexicon bans words that claim a count of people ("attendance",
 * "reach", "views"…) from every schema name (OSE-801;
 * workers/oursharedevents/src/lib/schema-lexicon.ts). ADR-031 allows one whole
 * identifier that holds a banned token without the banned meaning:
 * `attendance_mode`, which says how an event is held and can only ever hold one
 * of three words.
 *
 * An allowance is the kind of list that grows quietly. This spec holds it to
 * what the ADR decided. It is structural: it reads the source, the migrations
 * and the ADR, and runs on every PR in the T0 `invariants` step.
 *
 *   (a) The list is exactly the names ADR-031 lists. A name added to the code
 *       without the ADR, or to the ADR without the code, fails.
 *   (b) Each allowed name's reason cites a ticket.
 *   (c) Each allowed name is a column a migration adds, with a CHECK that limits
 *       it to a fixed list of words. So it cannot hold a number, and so it
 *       cannot say how many people came.
 *   (d) The match is the exact identifier: the lint does not test a prefix, a
 *       suffix or a pattern.
 *   (e) The banned word list still holds the word, and the two ticketed
 *       exemption lists (debt, not decisions) are still empty.
 *   (f) No rendered template carries an allowed name's banned word in a test
 *       id, a class or visible text: the public event page says "In person",
 *       never the field's name.
 *
 * @born-red OSE-2034 | method: (a) run before ADR-031 existed, then with a
 * second name added to the code only; (c) the CHECK removed from migration
 * 0108; (d) the lint changed to a prefix match; (e) the word removed from the
 * banned list; (f) the test id renamed to carry the word | date: 2026-11-13
 */
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const WORKER = join(ROOT, 'workers', 'oursharedevents');
const read = (...p: string[]) => readFileSync(join(...p), 'utf8');

const LEXICON = read(WORKER, 'src', 'lib', 'schema-lexicon.ts');
const ADR = read(ROOT, 'docs', 'adr', 'ADR-031-attendance-mode-and-the-lexicon.md');

/** The body of `export const NAME ... = new Map([ ... ]);` or `new Set([ ... ]);`. */
function literalOf(name: string): string {
  const m = new RegExp(
    `export const ${name}\\b[^=]*= new (?:Map|Set)\\(\\[([\\s\\S]*?)\\]\\);`
  ).exec(LEXICON);
  expect(m, `${name} is declared in schema-lexicon.ts`).not.toBeNull();
  // Comments explain entries; they are not entries.
  return m![1]!.replace(/\/\/[^\n]*/g, '');
}

/** [name, reason] pairs of ALLOWED_IDENTIFIERS, read from the source. */
function allowed(): [string, string][] {
  return [
    ...literalOf('ALLOWED_IDENTIFIERS').matchAll(/\[\s*'([^']+)'\s*,\s*'([^']+)'\s*,?\s*\]/g),
  ].map((m) => [m[1]!, m[2]!]);
}

function migrations(): string {
  const dir = join(WORKER, 'migrations');
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
    .map((f) => read(dir, f).replace(/--[^\n]*/g, ''))
    .join('\n');
}

test.describe('the lexicon allowance is one exact, decided name', () => {
  test('(a) the list is exactly what ADR-031 lists', () => {
    const inAdr =
      /<!-- allowed-identifiers:begin -->([\s\S]*?)<!-- allowed-identifiers:end -->/.exec(ADR);
    expect(inAdr, 'ADR-031 carries the marked list of allowed identifiers').not.toBeNull();
    const adrNames = [...inAdr![1]!.matchAll(/^- `([a-z0-9_]+)`/gm)].map((m) => m[1]!).sort();
    const codeNames = allowed()
      .map(([n]) => n)
      .sort();
    expect(codeNames.length, 'the source list was read').toBeGreaterThan(0);
    expect(codeNames).toEqual(adrNames);
    expect(codeNames).toEqual(['attendance_mode']);
  });

  test('(b) each reason cites a ticket', () => {
    for (const [name, reason] of allowed()) {
      expect(reason, name).toMatch(/\bOSE-\d+\b/);
      expect(reason.length, `${name}: a reason, not a label`).toBeGreaterThan(30);
    }
  });

  test('(c) each allowed name is a column held to a fixed list of words by a CHECK', () => {
    const sql = migrations();
    for (const [name] of allowed()) {
      const add = new RegExp(
        `ADD COLUMN ${name} TEXT NOT NULL DEFAULT '([a-z_]+)'\\s+CHECK \\(${name} IN \\(([^)]*)\\)\\)`
      ).exec(sql);
      expect(
        add,
        `${name}: a migration adds it NOT NULL, with a CHECK on its values`
      ).not.toBeNull();
      const words = add![2]!.split(',').map((w) => w.trim());
      expect(words.length, name).toBeGreaterThanOrEqual(2);
      for (const w of words) {
        expect(w, `${name}: every allowed value is a quoted word, never a number`).toMatch(
          /^'[a-z_]+'$/
        );
      }
      expect(words, `${name}: the default is one of its words`).toContain(`'${add![1]}'`);
      // No later migration loosens it: the column is added once and never rebuilt.
      expect(sql.split(`ADD COLUMN ${name} `).length - 1, name).toBe(1);
    }
  });

  test('(d) the lint matches the exact identifier, nothing looser', () => {
    const fn = /export function findBannedSchemaIdentifiers\([\s\S]*?\n}\n/.exec(LEXICON);
    expect(fn).not.toBeNull();
    const uses = [...fn![0].matchAll(/\ballowed\b[^\n;]*/g)].map((m) => m[0]);
    // Its default, and one exact lookup. No startsWith, includes, some or regex.
    expect(fn![0]).toContain('allowed.has(id.name)');
    for (const u of uses) {
      expect(u, 'allowed is only ever asked for the whole name').not.toMatch(
        /startsWith|endsWith|includes|some\(|match|test\(|keys\(\)/
      );
    }
    // The payload lint (report keys) takes no allowance at all.
    const payload = /export function findBannedPayloadKeys\([\s\S]*?\n}\n/.exec(LEXICON);
    expect(payload![0]).not.toContain('ALLOWED_IDENTIFIERS');
  });

  test('(e) the word is still banned, and the debt lists are still empty', () => {
    const banned = [...literalOf('BANNED_SCHEMA_TERMS').matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    for (const [name] of allowed()) {
      const held = name.split('_').filter((t) => banned.includes(t));
      expect(held.length, `${name} needs an allowance only because it holds a banned word`).toBe(1);
    }
    expect(banned).toEqual(
      expect.arrayContaining(['attendance', 'impressions', 'reach', 'unique', 'people', 'views'])
    );
    expect(literalOf('EXEMPT_IDENTIFIERS').trim(), 'EXEMPT_IDENTIFIERS').toBe('');
    expect(literalOf('EXEMPT_PAYLOAD_KEYS').trim(), 'EXEMPT_PAYLOAD_KEYS').toBe('');
  });

  test('(f) no public page handler writes the banned word into markup', () => {
    const pages = read(WORKER, 'src', 'handlers', 'pages.ts');
    const banned = [...literalOf('BANNED_SCHEMA_TERMS').matchAll(/'([a-z]+)'/g)].map((m) => m[1]!);
    for (const [name] of allowed()) {
      const word = name.split('_').find((t) => banned.includes(t))!;
      // In markup: an attribute value or a tag's text. Reading the column
      // (`row.attendance_mode`, `e.attendance_mode` in SQL) is not markup.
      const inMarkup = new RegExp(
        `(?:data-[a-z-]+|class|id|aria-label)="[^"]*${word}|>[^<\`$]*\\b${word}\\b`,
        'i'
      );
      const hits = pages
        .split('\n')
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => !/^\s*(\/\/|\*)/.test(line) && inMarkup.test(line));
      expect(
        hits.map(([n, l]) => `pages.ts:${n} ${l.trim().slice(0, 100)}`),
        `"${word}" in page markup`
      ).toEqual([]);
    }
  });
});
