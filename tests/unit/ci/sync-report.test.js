/**
 * Full-sync report v1 (scripts/ci/sync-report.mjs).
 *
 * Every case builds a small, agreeing world (OCR-docs, ourSharedEvents,
 * ourWKRP and a hub with real git history) and then injects the one fault that
 * must turn its check red or amber. The baseline case proves the world is
 * clean first, so a check that cannot fail would show up as a case that does
 * not move.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- paths are temp fixtures built by the test */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

let sync;
let tmp;
const SCRIPT = path.resolve(__dirname, '../../../scripts/ci/sync-report.mjs');
const TODAY = new Date('2026-10-22T12:00:00Z');

beforeAll(async () => {
  sync = await import('../../../scripts/ci/sync-report.mjs');
});

afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

const put = (root, rel, body) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};
const g = (cwd, ...args) =>
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }
  ).trim();

const GOV = ['CLAUDE.md', 'README.md', 'SKILL.md', 'docs/OCR_VISION.md'];
const ADR_INDEX = `# ADRs
| # | Title | Status | Date |
| --- | --- | --- | --- |
| [ADR-001](ADR-001-one.md) | One | Accepted | 2026-01-01 |
| [ADR-002](ADR-002-two.md) | Two | Proposed | 2026-01-02 |
`;
const ROUTER = `/**
 * Route table:
 *   GET /health                  → health
 *   GET /api/v2/events/:id       → single event
 *   POST /api/v2/events/:id/forms/register → register
 */
export default {};
`;
const YAML = `schema_version: 1.2.0
invariants:
  - id: 1
    name: anonymous_id
    status: live
    test_file: anon.invariant.spec.ts
  - id: 2
    name: geo
    status: partial
    test_file: geo.invariant.spec.ts
  - id: 3
    name: old
    status: retired
    test_file: gone.invariant.spec.ts
  - id: 4
    name: py_guard
    status: live
    test_file: guard.py (OCR-docs brain note)
`;
const conf = (over = {}) =>
  JSON.stringify({
    generated_at: '2026-10-20',
    summary: { total: 4 },
    invariants: [
      { id: 1, invariant_status: 'live', enforcement_status: 'enforced' },
      { id: 2, invariant_status: 'partial', enforcement_status: 'partial' },
      { id: 3, invariant_status: 'retired', enforcement_status: 'retired' },
      { id: 4, invariant_status: 'live', enforcement_status: 'enforced' },
    ],
    ...over,
  });

/** An agreeing world. Returns the paths object the report takes. */
function world() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-report-'));
  const ose = path.join(tmp, 'ose');
  const ocr = path.join(tmp, 'ocr');
  const wkrp = path.join(tmp, 'wkrp');
  const spine = path.join(tmp, 'spine');
  for (const r of [ose, ocr, wkrp]) for (const f of GOV) put(r, f, '# x\n');

  put(ose, 'docs/adr/README.md', ADR_INDEX);
  put(ose, 'docs/adr/ADR-001-one.md', '# One\n\n**Status:** Accepted\n');
  put(ose, 'docs/adr/ADR-002-two.md', '# Two\n\n- **Status:** Proposed (needs sign-off)\n');
  put(ose, 'workers/oursharedevents/src/router.ts', ROUTER);
  put(ose, 'docs/features/INDEX.md', '# Index\n[A](A.md)\n');
  put(ose, 'docs/features/A.md', 'Call `GET /api/v2/events/:eventId` and `GET /health`.\n');
  put(ose, 'docs/brain/ROLE-STATE.md', '# role\n');
  put(ose, 'workers/oursharedevents/docs/security/conformance.json', conf());
  put(ose, 'tests/anon.invariant.spec.ts', '//\n');
  put(ose, 'workers/oursharedevents/tests/geo.invariant.spec.ts', '//\n');
  put(
    ose,
    'AGENTS.md',
    '# A\n\n## Invariants (owner decisions)\n\n1. **One.** [#1] Text.\n2. **Two** [#2 OSE]: text.\n\n## Commands\n'
  );
  put(ocr, 'ocr-docs-brain/architectural-invariants.yaml', YAML);
  put(ocr, 'ocr-docs-brain/scripts/guard.py', '#\n');

  for (const f of GOV) put(spine, f, '# x\n');
  fs.mkdirSync(path.join(spine, 'packages', 'tokens'), { recursive: true });
  put(spine, 'packages/tokens/t.txt', '1');
  g(spine, 'init', '-q');
  g(spine, 'add', '.');
  g(spine, 'commit', '-q', '-m', 'one');
  const first = g(spine, 'rev-parse', 'HEAD');
  put(spine, 'packages/tokens/t.txt', '2');
  put(spine, 'packages/ui.txt', 'u');
  put(spine, 'outside.txt', 'o');
  g(spine, 'add', '.');
  g(spine, 'commit', '-q', '-m', 'two');
  g(spine, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const tip = g(spine, 'rev-parse', 'HEAD');
  put(ose, '.ocr-hub-ref', tip + '\n');
  put(wkrp, '.ocr-hub-ref', tip + '\n');
  return { ose, ocrDocs: ocr, wkrp, spine, agentsItems: 2, first, tip };
}

const keys = (l, level) => l.findings.filter((f) => !level || f.level === level).map((f) => f.key);

describe('baseline', () => {
  test('an agreeing world reads in sync on every link', () => {
    const w = world();
    const r = sync.buildReport(w, TODAY);
    expect(r.links.map((l) => [l.id, l.status, l.findings.map((f) => f.key)])).toEqual([
      ['adr', 'ok', []],
      ['docs', 'ok', []],
      ['brain', 'ok', []],
      ['invariants', 'ok', []],
      ['spine-pin', 'ok', []],
    ]);
    expect(r.summary).toEqual({ ok: 5, warn: 0, bad: 0 });
    expect(r.not_read_yet).toContain('CI/CD');
  });
});

describe('link 1: ADR index vs files', () => {
  test('an index row whose file is gone is red', () => {
    const w = world();
    fs.rmSync(path.join(w.ose, 'docs/adr/ADR-002-two.md'));
    const l = sync.checkAdr(w.ose);
    expect(l.status).toBe('bad');
    expect(keys(l, 'bad')).toEqual(['missing-file ADR-002']);
  });
  test('an ADR file with no index row is amber', () => {
    const w = world();
    put(w.ose, 'docs/adr/ADR-003-three.md', '**Status:** Accepted\n');
    const l = sync.checkAdr(w.ose);
    expect(l.status).toBe('warn');
    expect(keys(l)).toEqual(['orphan ADR-003']);
  });
  test('a status the file changed and the index did not is amber', () => {
    const w = world();
    put(w.ose, 'docs/adr/ADR-001-one.md', '**Status:** Superseded by something\n');
    const l = sync.checkAdr(w.ose);
    expect(keys(l)).toEqual(['status ADR-001']);
    expect(l.findings[0].detail).toBe('the index says accepted, the file says superseded');
  });
  test('a file with no readable Status line is amber', () => {
    const w = world();
    put(w.ose, 'docs/adr/ADR-001-one.md', '# One\n');
    expect(keys(sync.checkAdr(w.ose))).toEqual(['no-status ADR-001']);
  });
  test('a missing index is red', () => {
    const w = world();
    fs.rmSync(path.join(w.ose, 'docs/adr/README.md'));
    expect(sync.checkAdr(w.ose).status).toBe('bad');
  });
});

describe('link 2: documentation', () => {
  test('a different parameter name for the same route is not drift', () => {
    const w = world();
    expect(sync.checkDocs(w.ose).findings).toEqual([]);
  });
  test('a route the router header does not list is amber', () => {
    const w = world();
    put(w.ose, 'docs/features/A.md', 'Call `DELETE /api/v2/events/:id` please.\n');
    const l = sync.checkDocs(w.ose);
    expect(l.status).toBe('warn');
    expect(keys(l)).toEqual(['route DELETE /api/v2/events/:']);
  });
  test('the same path under a different method is drift', () => {
    const w = world();
    put(w.ose, 'docs/features/A.md', 'Call `POST /health`.\n');
    expect(keys(sync.checkDocs(w.ose))).toEqual(['route POST /health']);
  });
  test('an INDEX link to a file that does not exist is red', () => {
    const w = world();
    put(w.ose, 'docs/features/INDEX.md', '[A](A.md) [B](B.md)\n');
    const l = sync.checkDocs(w.ose);
    expect(l.status).toBe('bad');
    expect(keys(l, 'bad')).toEqual(['dead-link B.md']);
  });
  test('a feature doc nobody links is amber', () => {
    const w = world();
    put(w.ose, 'docs/features/Z.md', 'no routes\n');
    expect(keys(sync.checkDocs(w.ose))).toEqual(['unindexed Z.md']);
  });
  test('headerRoutes reads the real router.ts header', () => {
    const real = path.resolve(__dirname, '../../..');
    const src = fs.readFileSync(path.join(real, 'workers/oursharedevents/src/router.ts'), 'utf8');
    const routes = sync.headerRoutes(src);
    expect(routes.length).toBeGreaterThan(20);
    expect(routes).toContainEqual({ method: 'GET', path: '/health' });
  });
});

describe('link 3: shared brain', () => {
  test('a missing governance file is amber and named', () => {
    const w = world();
    fs.rmSync(path.join(w.wkrp, 'docs/OCR_VISION.md'));
    const l = sync.checkBrain(w);
    expect(keys(l)).toEqual(['ourWKRP governance']);
    expect(l.findings[0].detail).toContain('docs/OCR_VISION.md');
  });
  test('a checkout behind origin/main is amber', () => {
    const w = world();
    const r = path.join(w.wkrp);
    for (const f of GOV) put(r, f, '# x\n');
    g(r, 'init', '-q');
    g(r, 'add', '.');
    g(r, 'commit', '-q', '-m', 'one');
    put(r, 'x.txt', '2');
    g(r, 'add', '.');
    g(r, 'commit', '-q', '-m', 'two');
    g(r, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    g(r, 'reset', '-q', '--hard', 'HEAD~1');
    const l = sync.checkBrain(w);
    expect(keys(l)).toEqual(['ourWKRP behind']);
    expect(l.findings[0].detail).toContain('1 commit(s) behind');
  });
  test('a tracked file changed and uncommitted is amber; an untracked one is not', () => {
    const w = world();
    const r = w.wkrp;
    g(r, 'init', '-q');
    g(r, 'add', '.');
    g(r, 'commit', '-q', '-m', 'one');
    put(r, 'untracked.txt', 'x');
    expect(keys(sync.checkBrain(w))).toEqual([]);
    put(r, 'README.md', '# changed\n');
    expect(keys(sync.checkBrain(w))).toEqual(['ourWKRP dirty']);
  });
  test('a missing brain yaml is red', () => {
    const w = world();
    fs.rmSync(path.join(w.ocrDocs, 'ocr-docs-brain/architectural-invariants.yaml'));
    expect(keys(sync.checkBrain(w), 'bad')).toEqual(['brain-yaml']);
  });
  test('a repo that is not there is red', () => {
    const w = world();
    expect(keys(sync.checkBrain({ ...w, wkrp: path.join(tmp, 'nope') }), 'bad')).toEqual([
      'ourWKRP missing',
    ]);
  });
});

describe('link 4: invariants', () => {
  test('an id the brain has and the report does not is red', () => {
    const w = world();
    const c = JSON.parse(conf());
    c.invariants = c.invariants.filter((i) => i.id !== 2);
    put(w.ose, 'workers/oursharedevents/docs/security/conformance.json', JSON.stringify(c));
    const l = sync.checkInvariants(w, TODAY);
    expect(keys(l, 'bad')).toContain('#2 not in report');
  });
  test('an id the report has and the brain does not is red', () => {
    const w = world();
    const c = JSON.parse(conf());
    c.invariants.push({ id: 9, invariant_status: 'live', enforcement_status: 'enforced' });
    put(w.ose, 'workers/oursharedevents/docs/security/conformance.json', JSON.stringify(c));
    expect(keys(sync.checkInvariants(w, TODAY), 'bad')).toContain('#9 not in brain');
  });
  test('a status that differs is amber', () => {
    const w = world();
    const c = JSON.parse(conf());
    c.invariants[1].invariant_status = 'live';
    put(w.ose, 'workers/oursharedevents/docs/security/conformance.json', JSON.stringify(c));
    const l = sync.checkInvariants(w, TODAY);
    expect(keys(l, 'warn')).toContain('#2 status');
    expect(l.findings.find((f) => f.key === '#2 status').detail).toBe(
      'brain says partial, conformance.json says live'
    );
  });
  test('a live invariant whose test file is gone is red', () => {
    const w = world();
    fs.rmSync(path.join(w.ose, 'tests/anon.invariant.spec.ts'));
    const l = sync.checkInvariants(w, TODAY);
    expect(keys(l, 'bad')).toEqual(['#1 test file']);
  });
  test('a partial invariant whose test file is gone is only amber', () => {
    const w = world();
    fs.rmSync(path.join(w.ose, 'workers/oursharedevents/tests/geo.invariant.spec.ts'));
    const l = sync.checkInvariants(w, TODAY);
    expect(keys(l, 'bad')).toEqual([]);
    expect(keys(l, 'warn')).toEqual(['#2 test file']);
  });
  test('a retired invariant needs no test file, and an annotated name resolves', () => {
    const w = world();
    expect(sync.testFileName('guard.py (OCR-docs brain note)')).toBe('guard.py');
    expect(keys(sync.checkInvariants(w, TODAY))).toEqual([]);
  });
  test('a conformance report older than a week is amber', () => {
    const w = world();
    put(
      w.ose,
      'workers/oursharedevents/docs/security/conformance.json',
      conf({ generated_at: '2026-10-01' })
    );
    expect(keys(sync.checkInvariants(w, TODAY))).toEqual(['conformance age']);
  });
  test('a summary total that disagrees with the rows is amber', () => {
    const w = world();
    put(
      w.ose,
      'workers/oursharedevents/docs/security/conformance.json',
      conf({ summary: { total: 7 } })
    );
    expect(keys(sync.checkInvariants(w, TODAY))).toEqual(['conformance summary']);
  });
  test('a gap in enforcement is named', () => {
    const w = world();
    const c = JSON.parse(conf());
    c.invariants[0].enforcement_status = 'gap';
    put(w.ose, 'workers/oursharedevents/docs/security/conformance.json', JSON.stringify(c));
    expect(keys(sync.checkInvariants(w, TODAY))).toEqual(['#1 gap']);
  });
  test('an AGENTS.md tag naming an id the brain lacks is red', () => {
    const w = world();
    put(
      w.ose,
      'AGENTS.md',
      '## Invariants\n\n1. **One.** [#1] Text.\n2. **Two** [#99]: text.\n\n## Commands\n'
    );
    const l = sync.checkInvariants(w, TODAY);
    expect(keys(l, 'bad')).toEqual(['AGENTS.md sync']);
    expect(l.findings[0].detail).toBe('[#99] is not in the brain yaml');
  });
  test('an AGENTS.md tag naming a retired id is red', () => {
    const w = world();
    put(
      w.ose,
      'AGENTS.md',
      '## Invariants\n\n1. **One.** [#1] Text.\n2. **Two** [#3]: text.\n\n## Commands\n'
    );
    expect(sync.checkInvariants(w, TODAY).findings[0].detail).toContain('"retired"');
  });
  test('an AGENTS.md invariant with no tag is red', () => {
    const w = world();
    put(
      w.ose,
      'AGENTS.md',
      '## Invariants\n\n1. **One.** [#1] Text.\n2. **Two** with no tag.\n\n## Commands\n'
    );
    expect(sync.checkInvariants(w, TODAY).findings[0].detail).toBe(
      'invariant 2 has no tag ([#n ...] or [OSE])'
    );
  });
  test('the AGENTS.md check is the existing script and reports its summary', () => {
    const w = world();
    const l = sync.checkInvariants(w, TODAY);
    expect(l.counts.agents_sync).toMatch(/^agents-sync: 2 ids \[#1,#2\], 2 items/);
  });
  test('an unreadable yaml is red', () => {
    const w = world();
    fs.rmSync(path.join(w.ocrDocs, 'ocr-docs-brain/architectural-invariants.yaml'));
    expect(sync.checkInvariants(w, TODAY).status).toBe('bad');
  });
});

describe('spine pin', () => {
  test('a pin behind the spine tip is amber and counts the commits and packages files', () => {
    const w = world();
    put(w.wkrp, '.ocr-hub-ref', w.first + '\n');
    const l = sync.checkPins(w);
    expect(keys(l)).toEqual(['ourWKRP pin behind']);
    expect(l.findings[0].detail).toContain('1 commit(s) behind');
    expect(l.findings[0].detail).toContain('2 file(s) under packages/');
  });
  test('a pin that is not a spine commit is red', () => {
    const w = world();
    put(w.ose, '.ocr-hub-ref', '0'.repeat(40) + '\n');
    expect(keys(sync.checkPins(w), 'bad')).toEqual(['ourSharedEvents pin unknown']);
  });
  test('a repo with no pin file is red', () => {
    const w = world();
    fs.rmSync(path.join(w.wkrp, '.ocr-hub-ref'));
    expect(keys(sync.checkPins(w), 'bad')).toEqual(['ourWKRP no pin']);
  });
  test('no spine checkout is red', () => {
    const w = world();
    expect(sync.checkPins({ ...w, spine: null }).status).toBe('bad');
  });
});

describe('read-only and the command line', () => {
  const snapshot = (root) => {
    const out = [];
    const walk = (d) => {
      for (const n of fs.readdirSync(d)) {
        if (n === '.git') continue;
        const p = path.join(d, n);
        fs.statSync(p).isDirectory()
          ? walk(p)
          : out.push(`${path.relative(root, p)}:${fs.statSync(p).mtimeMs}:${fs.statSync(p).size}`);
      }
    };
    walk(root);
    return out.sort();
  };
  const cli = (w, ...extra) =>
    execFileSync(
      process.execPath,
      [
        SCRIPT,
        '--ose',
        w.ose,
        '--ocr-docs',
        w.ocrDocs,
        '--wkrp',
        w.wkrp,
        '--spine',
        w.spine,
        '--agents-items',
        '2',
        ...extra,
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    );

  test('a run changes nothing in any repo', () => {
    const w = world();
    const before = snapshot(tmp);
    cli(w, '--json');
    expect(snapshot(tmp)).toEqual(before);
  });
  test('--write puts files under the repo .claude/outputs only', () => {
    const w = world();
    const before = snapshot(tmp);
    cli(w, '--write');
    const added = snapshot(tmp).filter((x) => !before.includes(x));
    expect(added.length).toBe(2);
    expect(
      added.every((x) => x.startsWith(path.join('ose', '.claude', 'outputs', 'SYNC-REPORT-')))
    ).toBe(true);
  });
  test('--json prints parseable JSON with the chain and what is not read yet', () => {
    const w = world();
    const j = JSON.parse(cli(w, '--json'));
    expect(j.read_only).toBe(true);
    expect(j.links).toHaveLength(5);
    expect(j.chain).toMatch(/^ADR > documentation/);
  });
  test('exit code is 0 on a red link, and 1 only with --strict', () => {
    const w = world();
    fs.rmSync(path.join(w.ose, 'docs/adr/ADR-002-two.md'));
    expect(() => cli(w)).not.toThrow();
    expect(() => cli(w, '--strict')).toThrow();
  });
  test('--hub still works as an alias for --spine', () => {
    const w = world();
    const paths = sync.resolvePaths(['--ose', w.ose, '--hub', w.spine], {}, w.ose);
    expect(paths.spine).toBe(path.resolve(w.spine));
  });
  test('the repo table lists spine, OCR-docs, ourSharedEvents, ourWKRP in that order', () => {
    const w = world();
    const md = cli(w);
    const rows = md
      .split('\n')
      .filter((l) => /^\| (spine|OCR-docs|ourSharedEvents|ourWKRP) \|/.test(l));
    expect(rows.map((l) => l.split(' | ')[0].replace('| ', ''))).toEqual([
      'spine',
      'OCR-docs',
      'ourSharedEvents',
      'ourWKRP',
    ]);
  });
  test('the table names each link and its status', () => {
    const w = world();
    fs.rmSync(path.join(w.ose, 'docs/adr/ADR-002-two.md'));
    const md = cli(w);
    expect(md).toContain('| ADR index vs ADR files | out of sync | 1 |');
    expect(md).toContain('| Spine pin vs spine origin/main | in sync | 0 |');
  });
});
