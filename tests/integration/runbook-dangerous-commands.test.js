/**
 * Runbooks hold no dangerous database command (OSE-1503).
 *
 * The rollback and recovery runbooks used to tell the operator to delete a
 * production D1 database, to drop tables by hand, and to dump tables into a
 * folder git does not ignore. An operator under stress copies what the page
 * says, so the page must not say it.
 *
 * What fails this test, by where it is written:
 *
 *   Anywhere, break-glass or not:
 *     - a command that deletes a D1 database;
 *     - a D1 export, or D1 query output sent to a file, whose target git does
 *       not ignore (or whose target cannot be worked out).
 *
 *   Outside a break-glass section:
 *     - a command that creates a D1 database (the "recreate" half);
 *     - DROP TABLE;
 *     - a Time Travel restore, which overwrites a database in place.
 *
 *   Inside a break-glass section:
 *     - any of those three before a line that starts with STOP.
 *
 * A break-glass section is a Markdown heading whose text contains "break-glass"
 * (or "break glass"), down to the next heading of the same or a higher level.
 *
 * Subjects are found by walking folders, so a new runbook is covered without
 * editing this file:
 *   - every .md under docs/runbooks/ and beside the migrations: all rules;
 *   - every .md under docs/ and workers/oursharedevents/docs/: the database
 *     delete rule.
 *
 * What this cannot see. It reads command text, line by line:
 *   - prose ("drop the database and start again"), screenshots and links;
 *   - a command split over lines without a trailing backslash;
 *   - a command built from variables (`CMD=delete; wrangler d1 $CMD ...`);
 *   - a script the runbook tells you to run: the script is not read;
 *   - the Cloudflare dashboard, where a database can be deleted with no command;
 *   - query output that is only printed: `SELECT *` on a table of personal data
 *     shows it on screen and in the terminal's history, and nothing here knows;
 *   - exports of anything other than D1.
 * It also cannot tell a warning from an instruction, so a runbook describes the
 * delete command in words instead of spelling it out.
 */

const { readFileSync, readdirSync, statSync, mkdtempSync, cpSync, rmSync } = require('fs');
const { appendFileSync } = require('fs');
const { join, sep } = require('path');
const { tmpdir } = require('os');
const { spawnSync } = require('child_process');

const ROOT = join(__dirname, '..', '..');
const RUNBOOK_DIR = join(ROOT, 'docs', 'runbooks');
const WORKER_DIR = join(ROOT, 'workers', 'oursharedevents');

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.md$/i.test(name)) out.push(p);
  }
  return out;
};
const relTo = (base) => (p) =>
  p
    .slice(base.length + 1)
    .split(sep)
    .join('/');
const rel = relTo(ROOT);

// ── What git ignores ────────────────────────────────────────────────────────
// Asked of git itself, so this never drifts from .gitignore. Fails closed: if
// git cannot answer, the test fails instead of calling the path safe.
const gitIgnores = (repoPath) => {
  const r = spawnSync('git', ['check-ignore', '--no-index', '-q', '--', repoPath], { cwd: ROOT });
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  throw new Error(`git check-ignore could not answer for "${repoPath}" (status ${r.status})`);
};

// ── Reading a command ───────────────────────────────────────────────────────
const VAR = '__VAR__';
const stripBlockquote = (line) => line.replace(/^\s*>[>\s]*/, '');
// $(date +%F), ${table}, $ENV and <placeholder> all become one marker, so a
// file name with a date in it still reads as one word.
const markVariables = (s) =>
  s
    .replace(/\$\([^)]*\)/g, VAR)
    .replace(/\$\{[^}]*\}/g, VAR)
    .replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, VAR)
    .replace(/<[^<>\s]+>/g, VAR);
// SQL lives in quotes and is full of ">" (comparisons). Only ">" outside quotes
// is a shell redirect.
const dropQuoted = (s) => s.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'[^']*'/g, "''");
const unquote = (s) => {
  const q = s[0];
  return (q === '"' || q === "'") && s.length > 1 && s.endsWith(q) ? s.slice(1, -1) : s;
};
// `| tee -a out.json`: the first word after tee that is not a flag.
const teeTarget = (rest) => rest.split(/\s+/).find((word) => word && !word.startsWith('-')) ?? '';

/** Why an export target is unsafe, or null when git ignores it. */
const unsafeTarget = (rawTarget) => {
  const target = unquote(rawTarget);
  if (!target) return 'target not readable';
  if (target === '/dev/null') return null;
  if (
    target.startsWith(VAR) ||
    /^(?:[/\\~%]|[A-Za-z]:)/.test(target) ||
    /(?:^|[/\\])\.\.(?:[/\\]|$)/.test(target)
  ) {
    return 'target is outside the repository, or starts with a variable';
  }
  const path = target.split(VAR).join('x');
  return gitIgnores(path) ? null : 'target is not ignored by git';
};

/** Reasons a D1 export or redirected D1 query on this command is unsafe. */
const exportProblems = (command) => {
  const marked = markVariables(command);
  const problems = [];
  if (/\bd1\s+export\b/.test(marked)) {
    const out = /--output(?:=|\s+)("[^"]*"|'[^']*'|\S+)/.exec(marked);
    const why = out ? unsafeTarget(out[1]) : 'no --output named';
    if (why) problems.push(why);
  }
  if (/\bd1\s+(?:execute|export)\b/.test(marked)) {
    const bare = dropQuoted(marked);
    const targets = [
      ...[...bare.matchAll(/>{1,2}(?!&)\s*([^\s;|&]*)/g)].map((m) => m[1]),
      ...[...bare.matchAll(/\|\s*tee\b([^|;&]*)/g)].map((m) => teeTarget(m[1])),
    ];
    for (const t of targets) {
      const why = unsafeTarget(t);
      if (why) problems.push(why);
    }
  }
  return problems;
};

// The wrangler words are matched in lower case, as a shell needs them. Prose
// such as "a D1 export" is not a command.
const DELETES_DATABASE = [/\bd1\s+delete\b/, /\bDELETE\b.*\/d1\/database\b/i];
const BREAK_GLASS_ONLY = [
  ['database-create', /\bd1\s+create\b/],
  ['drop-table', /\bDROP\s+TABLE\b/i],
  ['restore-in-place', /\btime-travel\s+restore\b/],
];
const BREAK_GLASS_HEADING = /break[\s-]?glass/i;
// "STOP", "**STOP.**" or "- STOP" at the start of a line, in capitals.
const isStopLine = (text) =>
  /^\*{0,2}STOP\b/.test(
    text
      .trim()
      .replace(/^[-*]\s+/, '')
      .trim()
  );
const endsWithBackslash = (text) => text.trimEnd().endsWith('\\');

/**
 * Scan one Markdown document.
 * @returns {{violations: {line:number, rule:string, text:string}[], gated: number}}
 *   `gated` counts break-glass-only commands that were allowed, so a caller can
 *   prove the scanner saw them.
 */
const scanMarkdown = (source) => {
  const lines = (source.charCodeAt(0) === 0xfeff ? source.slice(1) : source).split(/\r?\n/);
  const violations = [];
  const headings = []; // open headings, outermost first: { level, breakGlass }
  let inFence = false;
  let stopSeen = false;
  let gated = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    let text = stripBlockquote(lines[i]);

    if (/^\s*(?:```|~~~)/.test(text)) {
      inFence = !inFence;
      continue;
    }

    if (!inFence) {
      const h = /^(#{1,6})\s+(.*)$/.exec(text);
      if (h) {
        const level = h[1].length;
        while (headings.length && headings[headings.length - 1].level >= level) headings.pop();
        const wasBreakGlass = headings.some((x) => x.breakGlass);
        const breakGlass = BREAK_GLASS_HEADING.test(h[2]);
        headings.push({ level, breakGlass });
        // A STOP line covers its own break-glass section and the headings under
        // it. It does not carry into the next break-glass section.
        if (breakGlass || !wasBreakGlass) stopSeen = false;
        continue;
      }
      if (isStopLine(text)) stopSeen = true;
    } else {
      // A shell command continued with a trailing backslash is one command.
      while (endsWithBackslash(text) && i + 1 < lines.length) {
        if (/^\s*(?:```|~~~)/.test(lines[i + 1])) break;
        i += 1;
        text = `${text.trimEnd().slice(0, -1)} ${stripBlockquote(lines[i]).trim()}`;
      }
    }

    const inBreakGlass = headings.some((x) => x.breakGlass);
    const add = (rule) => violations.push({ line: lineNo, rule, text: text.trim().slice(0, 160) });

    if (DELETES_DATABASE.some((re) => re.test(text))) add('database-delete');
    for (const why of exportProblems(text)) add(`export: ${why}`);
    for (const [rule, re] of BREAK_GLASS_ONLY) {
      if (!re.test(text)) continue;
      if (!inBreakGlass) add(`${rule}: outside a break-glass section`);
      else if (!stopSeen) add(`${rule}: no STOP line before it in its break-glass section`);
      else gated += 1;
    }
  }
  return { violations, gated };
};

const report = (files, name, keep = () => true) =>
  files.flatMap((file) =>
    scanMarkdown(readFileSync(file, 'utf-8'))
      .violations.filter(keep)
      .map((v) => `${name(file)}:${v.line} [${v.rule}] ${v.text}`)
  );

const RUNBOOKS = walk(RUNBOOK_DIR);
const MIGRATION_DOCS = [
  ...walk(join(WORKER_DIR, 'migrations')),
  ...walk(join(WORKER_DIR, 'migrations-forms')),
];
const ALL_DOCS = [...walk(join(ROOT, 'docs')), ...walk(join(WORKER_DIR, 'docs'))];

describe('Runbooks hold no dangerous database command', () => {
  it('finds its subjects (not vacuous)', () => {
    const names = RUNBOOKS.map(rel);
    expect(names).toContain('docs/runbooks/ROLLBACK.md');
    expect(names).toContain('docs/runbooks/DISASTER-RECOVERY.md');
    expect(RUNBOOKS.length).toBeGreaterThanOrEqual(10);
    expect(MIGRATION_DOCS.map(rel)).toContain(
      'workers/oursharedevents/migrations/ROLLBACK_PLAN.md'
    );
    expect(ALL_DOCS.length).toBeGreaterThan(100);
  });

  it('no runbook has one outside a break-glass section', () => {
    expect(report(RUNBOOKS, rel)).toEqual([]);
  });

  it('no document beside the migrations has one outside a break-glass section', () => {
    expect(report(MIGRATION_DOCS, rel)).toEqual([]);
  });

  it('no document under docs/ deletes a database', () => {
    expect(report(ALL_DOCS, rel, (v) => v.rule === 'database-delete')).toEqual([]);
  });

  // If the scanner stopped seeing commands, the tests above would pass on
  // anything. The recovery runbook's restore steps are real break-glass
  // commands, so they must be counted.
  it('sees the break-glass commands the recovery runbook does contain', () => {
    const dr = scanMarkdown(readFileSync(join(RUNBOOK_DIR, 'DISASTER-RECOVERY.md'), 'utf-8'));
    expect(dr.gated).toBeGreaterThanOrEqual(2);
  });
});

// ── The check can fail ──────────────────────────────────────────────────────
// Each case copies docs/runbooks/ to a temp folder, adds lines to the copy of
// one real runbook, and scans the copy with the same code as above.
describe('a planted line in a copy of the runbooks is caught', () => {
  const fence = (cmd) => ['```bash', cmd, '```'].join('\n');
  const outside = (cmd) => `\n\n## Planted section\n\n${fence(cmd)}\n`;
  const breakGlass = (cmd, stop = '> **STOP.** Planted confirm line.') =>
    `\n\n## Break-glass: planted\n\n${stop}\n\n${fence(cmd)}\n`;

  const scanCopyWith = (planted) => {
    const dir = mkdtempSync(join(tmpdir(), 'runbooks-planted-'));
    try {
      cpSync(RUNBOOK_DIR, dir, { recursive: true });
      appendFileSync(join(dir, 'ROLLBACK.md'), planted);
      return report(walk(dir), relTo(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('the unchanged copy is clean', () => {
    expect(scanCopyWith('\n')).toEqual([]);
  });

  const CAUGHT = [
    ['database delete', outside('wrangler d1 delete ocr-db-production'), 'database-delete'],
    [
      'database delete, even in a break-glass section',
      breakGlass('npx wrangler d1 delete ocr-forms-db-production --env production'),
      'database-delete',
    ],
    [
      'database delete, staging',
      outside('wrangler d1 delete ocr-db-staging --skip-confirmation'),
      'database-delete',
    ],
    [
      'database delete through the API',
      outside('curl -X DELETE "https://api.cloudflare.com/client/v4/accounts/$A/d1/database/$ID"'),
      'database-delete',
    ],
    [
      'database create',
      outside('wrangler d1 create ocr-db-production'),
      'database-create: outside',
    ],
    [
      'DROP TABLE',
      outside(
        'wrangler d1 execute DB --env staging --remote --command "DROP TABLE IF EXISTS events"'
      ),
      'drop-table: outside',
    ],
    ['DROP TABLE as bare SQL', outside('drop table form_registrations;'), 'drop-table: outside'],
    [
      'restore in place',
      outside(
        'npx wrangler d1 time-travel restore ocr-db-production --env production --timestamp=1'
      ),
      'restore-in-place: outside',
    ],
    [
      'a break-glass command with no STOP line before it',
      breakGlass('wrangler d1 create ocr-db-staging', 'Take care.'),
      'database-create: no STOP line',
    ],
    [
      'a break-glass command after a sentence that only begins with "Stop"',
      breakGlass('wrangler d1 create ocr-db-staging', 'Stop if you are unsure.'),
      'database-create: no STOP line',
    ],
    [
      'a break-glass command whose STOP line comes after it',
      `\n\n## Break-glass: planted\n\n${fence('DROP TABLE events;')}\n\n> **STOP.** Too late.\n`,
      'drop-table: no STOP line',
    ],
    [
      'a command after the break-glass section has ended',
      `${breakGlass('echo nothing gated here')}\n## Next section\n\n${fence('DROP TABLE events;')}\n`,
      'drop-table: outside',
    ],
    [
      'query output sent to a folder git does not ignore',
      outside(
        'wrangler d1 execute DB --env production --command "SELECT * FROM events" --json > dumps/events-$(date +%Y%m%d).json'
      ),
      'export: target is not ignored by git',
    ],
    [
      'the same, split over lines with a backslash',
      outside(
        [
          'for table in events subscribers; do',
          '  wrangler d1 execute DB --env production \\',
          '    --command "SELECT * FROM $table" --json > dumps/${table}-$(date +%Y%m%d).json',
          'done',
        ].join('\n')
      ),
      'export: target is not ignored by git',
    ],
    [
      'the same, in a break-glass section',
      breakGlass(
        'wrangler d1 execute FORMS_DB --env production --remote --command "SELECT 1" > dumps/x.json'
      ),
      'export: target is not ignored by git',
    ],
    [
      'an export to a file in the repository',
      outside('npx wrangler d1 export ocr-forms-db-production --remote --output=forms-dump.sql'),
      'export: target is not ignored by git',
    ],
    [
      'an export to the desktop',
      outside(
        'npx wrangler d1 export ocr-forms-db-production --remote --output ~/Desktop/forms.sql'
      ),
      'export: target is outside the repository',
    ],
    [
      'an export to a shared drive',
      outside('npx wrangler d1 export ocr-db-production --remote --output "G:\\Shared\\dump.sql"'),
      'export: target is outside the repository',
    ],
    [
      'an export to a folder held in a variable',
      outside('npx wrangler d1 export ocr-db-production --remote --output $OUT/.wrangler/dump.sql'),
      'export: target is outside the repository',
    ],
    [
      'query output piped to tee',
      outside('wrangler d1 execute DB --env staging --remote --command "SELECT 1" | tee out.json'),
      'export: target is not ignored by git',
    ],
    [
      'an export with no target',
      outside('npx wrangler d1 export ocr-db-production --remote'),
      'export: no --output named',
    ],
  ];

  it.each(CAUGHT)('catches %s', (_name, planted, rule) => {
    const found = scanCopyWith(planted);
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found.every((v) => v.startsWith('ROLLBACK.md:'))).toBe(true);
    expect(found.some((v) => v.includes(`[${rule}`))).toBe(true);
  });

  const ALLOWED = [
    ['database create in a break-glass section', breakGlass('wrangler d1 create ocr-db-staging')],
    ['DROP TABLE in a break-glass section', breakGlass('DROP TABLE IF EXISTS sponsor_asset;')],
    [
      'restore in a break-glass section',
      breakGlass('npx wrangler d1 time-travel restore ocr-db-staging --env staging --timestamp=1'),
    ],
    [
      'a break-glass command under a sub-heading of its section',
      `${breakGlass('echo first')}\n### Step two\n\n${fence('DROP TABLE IF EXISTS sponsor_asset;')}\n`,
    ],
    [
      'an export to a folder git ignores',
      outside(
        'npx wrangler d1 export ocr-db-staging --remote --output .wrangler/tmp/dump-$(date +%F).sql'
      ),
    ],
    [
      'a query whose SQL has a ">" in it',
      outside(
        'npx wrangler d1 execute ocr-forms-db-production --env production --remote --command "SELECT id FROM pii_audit_log WHERE executed_at > \'2026-10-01\'"'
      ),
    ],
    [
      'a query with a placeholder for the environment',
      outside('wrangler d1 execute DB --env <env> --remote --command "SELECT 1"'),
    ],
    [
      'a query with stderr folded into stdout',
      outside('wrangler d1 execute DB --env staging --remote --command "SELECT 1" 2>&1'),
    ],
    ['dropping an index', outside('DROP INDEX IF EXISTS idx_events_slug;')],
    [
      'prose that names D1 without a command',
      '\n\nA manual D1 export, a D1 delete, a D1 create.\n',
    ],
    ['a shell comment that looks like a heading', outside('# break-glass\necho not a heading')],
  ];

  it.each(ALLOWED)('allows %s', (_name, planted) => {
    expect(scanCopyWith(planted)).toEqual([]);
  });

  it('a "# break-glass" comment inside a code block does not open a break-glass section', () => {
    const planted = `\n\n## Planted section\n\n${fence('# break-glass\nDROP TABLE events;')}\n`;
    expect(scanCopyWith(planted).some((v) => v.includes('[drop-table: outside'))).toBe(true);
  });
});

// The recovery runbook used to export `SELECT *` to `backup/*.json`. No page says
// that any more (the scan above), but a habit outlives a page. If a file is saved
// there anyway, git must not offer to commit it.
describe('the folder the old recovery runbook exported to', () => {
  it.each([
    ['at the repository root', 'backup/events-20261008.json'],
    ['inside the Worker folder', 'workers/oursharedevents/backup/subscribers-20261008.json'],
  ])('is ignored by git %s', (_where, path) => {
    expect(gitIgnores(path)).toBe(true);
  });

  it('(guard) a folder nobody has listed is still not ignored', () => {
    expect(gitIgnores('dumps/events-20261008.json')).toBe(false);
  });
});
