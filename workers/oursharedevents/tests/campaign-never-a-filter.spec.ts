/**
 * Showcase S14: a campaign title is never a filter, search or sort key, held by
 * reading `src/`.
 *
 * tests/campaigns.spec.ts sends the parameters a caller might try today. This
 * file is for the route someone adds tomorrow. A sponsor is never a filter
 * (AGENTS.md, invariant 6 and the showcase plan, section 5), and a campaign is
 * a sponsor's banner across events, so it follows the same rule:
 *
 *   1. no code under `src/` reads a query parameter named for a campaign;
 *   2. the campaign handlers read no query parameter at all;
 *   3. no SQL statement that touches `campaigns` uses a title to select rows
 *      (WHERE / ON / HAVING) or to order them (ORDER BY). Grouping a report by
 *      campaign (GROUP BY) selects nothing and is allowed.
 *
 * What this cannot see: SQL built from pieces at run time, and a filter applied
 * in JavaScript after the read. It reads text.
 *
 * @born-red S14 | method: each fault was put in src and this file failed naming
 * it, then the fault was removed. (1) `url.searchParams.get('campaign')` added
 * to handlers/events.ts; (2) `new URL(request.url).searchParams.get('q')` added
 * to handlers/campaigns.ts; (3) `AND title LIKE ?` added to the list statement
 * (this one passed at first, because the list's WHERE arrives through `${where}`;
 * the scan now starts at FROM), `ORDER BY title` put in its place, and
 * `AND c.title = ?` added to the public read in lib/campaigns.ts | date: 2026-11-13
 *
 * Pure Node (fs) -> node project.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

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

/** Source with JS comments blanked, so prose about a rule is not read as code. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/[^\n]*/gm, '');
}

const FILES = filesUnder(SRC);

/** Template literals (where this codebase writes SQL) that name the campaigns table. */
function campaignStatements(source: string): string[] {
  return (source.match(/`[^`]*`/g) ?? []).filter(
    (s) => /\bcampaigns\b/i.test(s) && /\b(SELECT|UPDATE|DELETE|INSERT)\b/.test(s)
  );
}

/**
 * The parts of a statement that choose or order rows: everything after the
 * column list, which is from the first FROM (a SELECT) or WHERE (an UPDATE) on,
 * with each GROUP BY list taken out. Starting at FROM, not at WHERE, matters: a
 * WHERE clause can arrive through `${...}`, where this file cannot read it.
 */
function selectingParts(sql: string): string {
  const flat = sql.replace(/\s+/g, ' ');
  const from = flat.search(/\b(FROM|WHERE)\b/);
  if (from === -1) return '';
  return (
    flat
      .slice(from)
      .replace(/\bGROUP BY\b.*?(?=\b(HAVING|ORDER BY|LIMIT)\b|$)/g, ' ')
      // `ON CONFLICT(id) DO UPDATE SET title = excluded.title` assigns; it does not select.
      .replace(/\bON CONFLICT\b.*$/g, ' ')
  );
}

describe('S14: a campaign title is never a filter, search or sort key (src/)', () => {
  test('the scan sees the statements it is meant to hold', () => {
    const seen = FILES.filter((f) => campaignStatements(code(f)).length > 0).map(rel);
    expect(seen).toEqual(expect.arrayContaining(['handlers/campaigns.ts', 'lib/campaigns.ts']));
  });

  test('no query parameter is named for a campaign', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const hits = code(f).match(
        /searchParams\s*\.\s*(get|getAll|has)\(\s*['"`][^'"`]*campaign[^'"`]*['"`]/gi
      );
      if (hits) offenders.push(`${rel(f)}: ${hits.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  test('the campaign handlers read no query parameter', () => {
    const source = code(join(SRC, 'handlers', 'campaigns.ts'));
    expect(source).not.toMatch(/searchParams/);
    expect(source).not.toMatch(/new URL\(/);
  });

  test('no statement on campaigns selects or orders rows by a title', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      for (const sql of campaignStatements(code(f))) {
        if (/\btitle\b/i.test(selectingParts(sql))) {
          offenders.push(`${rel(f)}: ${sql.replace(/\s+/g, ' ').slice(0, 160)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('selectingParts keeps WHERE and ORDER BY, and drops GROUP BY (self-check)', () => {
    expect(selectingParts('SELECT title FROM campaigns')).not.toMatch(/title/);
    expect(selectingParts('INSERT INTO campaigns (id, title) VALUES (?, ?)')).toBe('');
    expect(selectingParts('UPDATE campaigns SET title = ? WHERE id = ?')).not.toMatch(/title/);
    expect(selectingParts('SELECT id FROM campaigns ${where} AND title LIKE ?')).toMatch(/title/);
    expect(selectingParts('SELECT c.title FROM campaigns c WHERE c.id = ?')).not.toMatch(/title/);
    expect(selectingParts('SELECT 1 FROM campaigns WHERE title LIKE ?')).toMatch(/title/);
    expect(selectingParts('SELECT 1 FROM campaigns ORDER BY title')).toMatch(/title/);
    expect(selectingParts('SELECT 1 FROM x JOIN campaigns c ON c.title = x.t')).toMatch(/title/);
    expect(
      selectingParts(
        'SELECT 1 FROM campaigns c WHERE c.id = ? GROUP BY c.id, c.title ORDER BY c.id'
      )
    ).not.toMatch(/title/);
    expect(
      selectingParts('SELECT 1 FROM campaigns c WHERE c.id = ? GROUP BY c.id HAVING c.title = ?')
    ).toMatch(/title/);
  });
});

describe('S14: scoping and consent for a campaign are the same at every tier (src/)', () => {
  test.each(['handlers/campaigns.ts', 'lib/campaigns.ts'])(
    '%s reads no tier and no plan',
    (file) => {
      const source = code(join(SRC, file));
      expect(source).not.toMatch(/\btier\b/i);
      expect(source).not.toMatch(/\bplan\b|report-plan|report-depth|entitlement/i);
    }
  );
});
