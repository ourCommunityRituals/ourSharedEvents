/**
 * CCR worksheet gate (scripts/ci/ccr-worksheet-check.mjs).
 *
 * 1. The real tree passes and the gate really scanned worksheets (not a vacuous green).
 * 2. Hermetic born-red cases: a valid run passes, then each rule is broken on its own and
 *    must turn the script red with its own message. Both sides of every boundary are
 *    pinned (a class minimum, exactly 95%, a ceiling), because a mutation of one side
 *    alone must not survive.
 *
 * The run model (owner, 2026-11-02): loop 1 is the Critical run, loop 2 Conservative,
 * loop 3 Recursive, on the same subject; the results are taken together as a cumulative
 * score; under 95% the team solutions it afterwards.
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp -- writes a temp tree the test just created; patterns are built from fixed fixture names */

const { spawnSync } = require('child_process');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const { join, dirname } = require('path');

const ROOT = join(__dirname, '..', '..');
const CHECK = join(ROOT, 'scripts', 'ci', 'ccr-worksheet-check.mjs');

const run = (root) => spawnSync(process.execPath, [CHECK, '--root', root], { encoding: 'utf-8' });

const TEAM = [
  'dr-of-security',
  'role-backend-architect',
  'role-frontend-integration',
  'role-design-fe',
  'role-qa-automation',
  'role-sdet-sre',
  'role-devops',
  'role-data-scientist',
  'role-product-owner',
];
const ORDER = {
  3: ['Critical', 'Conservative', 'Recursive'],
  5: ['Critical', 'Conservative', 'Adversarial', 'Compliance', 'Recursive'],
};
const layerFor = (n, total) =>
  (ORDER[total] ?? ORDER[5])[(n - 1) % (ORDER[total] ?? ORDER[5]).length];

const made = [];
function put(root, rel, body) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
}

const unresolved = (o = {}) =>
  `{ ${['regulatory', 'security_critical', 'critical', 'high', 'medium', 'low']
    .map((k) => `${k}: ${o[k] ?? 0}`)
    .join(', ')} }`;

function loop(n, o = {}, total = 3) {
  const lines = [`## Loop ${n}`, ''];
  if (o.team !== null) {
    lines.push(`Team: ${o.team ?? TEAM.join(', ')}`);
  }
  if (o.layers !== false) {
    lines.push(...(o.layerLines ?? [`${layerFor(n, total)} layer: this loop's lens.`]));
  }
  if (o.score !== null) {
    lines.push(...(o.scoreLines ?? [`Score: ${o.score ?? 90}%`]));
  }
  if (o.extra) {
    lines.push(o.extra);
  }
  return lines.join('\n') + '\n';
}

const loops = (scores, o = {}) =>
  scores
    .map((s, i) =>
      loop(i + 1, { score: s, ...(o.all ?? {}), ...(o.per?.[i] ?? {}) }, scores.length)
    )
    .join('\n');

const SECTION_NAMES = [
  'Verdict',
  'What was reviewed',
  'Findings register',
  'What must be true before shipping',
  'Verification after shipping',
  'Risks accepted',
  'Solutioning',
  'Human gate',
];
const SEV_LABEL = {
  regulatory: 'Regulatory',
  security_critical: 'Security Critical',
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};
// One open row per unresolved finding, read back from the frontmatter's unresolved string.
function registerFor(un) {
  const rows = [];
  for (const [, k, n] of String(un).matchAll(/(\w+): (\d+)/g)) {
    for (let i = 0; i < Number(n); i++) {
      rows.push(`| F${rows.length + 1} | ${SEV_LABEL[k]} | open |`);
    }
  }
  return ['| # | Severity | Status |', '|---|---|---|', ...rows].join('\n');
}
const sectionBody = (s, o, un) => {
  if (s === 'Human gate') {
    return `\n\n${o.question ?? 'No open questions.'}`;
  }
  if (s === 'Findings register') {
    return `\n\n${o.register ?? registerFor(un)}`;
  }
  return '';
};
const sectionsFor = (o = {}, un = '') =>
  SECTION_NAMES.filter((s) => s !== o.without)
    .map((s) => `## ${s}${sectionBody(s, o, un)}`)
    .join('\n\n');

// A valid three-loop run: raw results under 95, solutioned to 96.
function worksheet(o = {}) {
  const scores = o.scores ?? [60, 70, 80];
  const fm = {
    ccr: 1,
    class: 'bug-fix',
    requested_loops: 3,
    loops_run: scores.length,
    team: 'extended',
    gate: 'pass',
    cumulative_score: Math.min(...scores) - 10,
    system_score: 96,
    unresolved: unresolved(),
    ...o.fm,
  };
  const head = Object.entries(fm)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const body = o.loops ?? loops(scores, o);
  return `${o.prefix ?? ''}---\n${head}\n---\n\n# CCR worksheet: test\n\n${body}\n${sectionsFor(o, fm.unresolved)}\n`;
}

function tree(o = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ccr-ws-'));
  made.push(root);
  for (const id of o.agents ?? TEAM) {
    put(root, `.claude/agents/${id}.md`, '---\nname: x\n---\n');
  }
  if (o.noOutputs) {
    return root;
  }
  put(root, '.claude/outputs/CCR-TEST-2026-11-01.md', o.worksheet ?? worksheet());
  for (const [k, v] of Object.entries(o.files ?? {})) {
    put(root, `.claude/outputs/${k}`, v);
  }
  return root;
}

const redWith = (ws, expected, extra = {}) => {
  const r = run(tree({ worksheet: ws, ...extra }));
  expect(r.stderr).toMatch(expected);
  expect(r.status).toBe(1);
};
const green = (ws, extra = {}) => {
  const r = run(tree({ worksheet: ws, ...extra }));
  expect(r.stderr).toBe('');
  expect(r.status).toBe(0);
};

// Every case spawns a process; give them room on a busy runner.
vi.setConfig({ testTimeout: 30_000 });
afterAll(() => {
  for (const r of made) {
    rmSync(r, { recursive: true, force: true });
  }
});

describe('ccr worksheet gate: the real tree', () => {
  // The committed worksheets, as CI sees them; untracked drafts on a workstation are not the tree.
  test('passes and scanned the worksheets', () => {
    const r = spawnSync(process.execPath, [CHECK, '--root', ROOT, '--tracked'], {
      encoding: 'utf-8',
    });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const m = r.stdout.match(/ccr worksheets ok \((\d+) checked\)/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(1);
  });
});

describe('ccr worksheet gate: a pass and a stop', () => {
  test('a valid three-loop run passes', () => green(worksheet()));

  test('a CRLF checkout of it passes', () => {
    const r = run(tree({ worksheet: worksheet().replace(/\n/g, '\r\n') }));
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  test('a stop after every loop ran, with a question for the owner, passes', () =>
    green(
      worksheet({
        fm: {
          gate: 'stop',
          system_score: 50,
          unresolved: unresolved({ critical: 2, high: 3 }),
        },
        question: 'Who owns the required-review setting?',
      })
    ));

  test('a lite run is one loop with all three layers', () =>
    green(
      worksheet({
        scores: [96],
        fm: {
          class: 'lite',
          requested_loops: 1,
          team: 'base',
          cumulative_score: 96,
          system_score: 96,
        },
        per: [
          {
            team: 'role-qa-automation',
            layerLines: ['Critical layer: a', 'Conservative layer: b', 'Recursive layer: c'],
          },
        ],
      })
    ));

  test('a lite run with one layer is red', () =>
    redWith(
      worksheet({
        scores: [96],
        fm: {
          class: 'lite',
          requested_loops: 1,
          team: 'base',
          cumulative_score: 96,
          system_score: 96,
        },
        per: [{ team: 'role-qa-automation' }],
      }),
      /loop 1 must carry "Critical layer: \.\.\.", "Conservative layer: \.\.\.", "Recursive layer: \.\.\."/
    ));
});

describe('ccr worksheet gate: every loop runs', () => {
  const MIN = {
    'bug-fix': 3,
    'security-fix': 3,
    upgrade: 4,
    architecture: 5,
    governance: 5,
    compliance: 5,
  };
  const raw = (n) => Array(n).fill(80);
  const ratified = (cls) =>
    ['governance', 'compliance'].includes(cls) ? { owner_ratified: '2026-11-02' } : {};

  test.each(Object.entries(MIN))('%s: exactly %i loops passes', (cls, n) =>
    green(worksheet({ scores: raw(n), fm: { class: cls, requested_loops: 1, ...ratified(cls) } }))
  );

  test.each(Object.entries(MIN))('%s: one loop fewer than %i is red', (cls, n) =>
    redWith(
      worksheet({ scores: raw(n - 1), fm: { class: cls, requested_loops: 1, ...ratified(cls) } }),
      new RegExp(`this run needs ${n} \\(requested 1, class ${cls} needs ${n}\\)`)
    )
  );

  test('the owner asking for more than the class minimum is held to it', () =>
    redWith(
      worksheet({ scores: raw(3), fm: { requested_loops: 8 } }),
      /this run needs 8 \(requested 8, class bug-fix needs 3\)/
    ));

  test('a stop does not excuse a skipped loop', () =>
    redWith(
      worksheet({
        scores: [60],
        fm: { gate: 'stop', system_score: 50 },
        question: 'Stop here?',
      }),
      /loops_run is 1 but this run needs 3/
    ));

  test('more loops than specified are fine', () => green(worksheet({ scores: [80, 80, 80, 80] })));

  test('a loop section is missing', () =>
    redWith(
      worksheet({ fm: { loops_run: 3 }, loops: loops([80, 80]) }),
      /loops_run is 3 but the worksheet has loop sections \[1, 2\]/
    ));

  test('loop sections out of order', () =>
    redWith(
      worksheet({
        loops: [loop(2, { score: 80 }), loop(1, { score: 80 })].join('\n'),
        fm: { loops_run: 2, requested_loops: 1 },
      }),
      /loop sections \[2, 1\]/
    ));

  test('a loop section repeated', () =>
    redWith(
      worksheet({
        loops: [loop(1, { score: 80 }), loop(1, { score: 80 })].join('\n'),
        fm: { loops_run: 2, requested_loops: 1 },
      }),
      /loop sections \[1, 1\]/
    ));

  test('class is not a prototype key', () => {
    for (const cls of ['toString', 'constructor', '__proto__', 'vibes']) {
      redWith(worksheet({ fm: { class: cls } }), /class must be one of/);
    }
  });
});

describe('ccr worksheet gate: each loop is its layer', () => {
  test.each([
    [1, 'Critical'],
    [2, 'Conservative'],
    [3, 'Recursive'],
  ])('loop %i without its %s line is red', (n, name) => {
    const per = [{}, {}, {}];
    per[n - 1] = { layers: false };
    redWith(worksheet({ per }), new RegExp(`loop ${n} must carry "${name} layer: \\.\\.\\."`));
  });

  test.each([
    [1, 'Critical'],
    [2, 'Conservative'],
    [3, 'Adversarial'],
    [4, 'Compliance'],
    [5, 'Recursive'],
  ])('a five-loop run: loop %i without its %s line is red', (n, name) => {
    const per = [{}, {}, {}, {}, {}];
    per[n - 1] = { layers: false };
    redWith(
      worksheet({ scores: [80, 80, 80, 80, 80], per }),
      new RegExp(`loop ${n} must carry "${name} layer: \\.\\.\\."`)
    );
  });

  test('a five-loop run labelled in the three-loop order is red at loop 3', () =>
    redWith(
      worksheet({
        scores: [80, 80, 80, 80, 80],
        per: [{}, {}, { layerLines: ['Recursive layer: x'] }],
      }),
      /loop 3 must carry "Adversarial layer: ..."/
    ));

  test('a four-loop run (not ruled) follows the five-loop order', () => {
    green(worksheet({ scores: [80, 80, 80, 80] }));
    redWith(
      worksheet({
        scores: [80, 80, 80, 80],
        per: [{}, {}, {}, { layerLines: ['Critical layer: x'] }],
      }),
      /loop 4 must carry "Compliance layer: ..."/
    );
  });

  test('the wrong layer for the loop is red', () =>
    redWith(
      worksheet({ per: [{ layerLines: ['Conservative layer: x'] }] }),
      /loop 1 must carry "Critical layer: \.\.\."/
    ));

  test('a layer with no text is red', () =>
    redWith(worksheet({ per: [{ layerLines: ['Critical layer:'] }] }), /loop 1 must carry/));

  test('a findings bullet named Critical is not the layer', () =>
    redWith(worksheet({ per: [{ layerLines: ['- Critical: F1'] }] }), /loop 1 must carry/));

  test('a layer inside a code fence does not count', () =>
    redWith(
      worksheet({ per: [{ layerLines: ['```', 'Critical layer: a', '```'] }] }),
      /loop 1 must carry/
    ));

  test.each([
    ['no score', { score: null }, /loop 1 needs exactly one line "Score: NN%" \(found 0\)/],
    ['two scores', { scoreLines: ['Score: 90%', 'Score: 40%'] }, /\(found 2\)/],
    ['over 100', { scoreLines: ['Score: 150%'] }, /needs exactly one line "Score: NN%"/],
    ['no percent sign', { scoreLines: ['Score: 90'] }, /needs exactly one line "Score: NN%"/],
  ])('%s is red', (_n, o, expected) => redWith(worksheet({ per: [o] }), expected));
});

describe('ccr worksheet gate: the extended team', () => {
  test.each(TEAM)('a loop without %s is red', (id) =>
    redWith(
      worksheet({ per: [{}, { team: TEAM.filter((x) => x !== id).join(', ') }] }),
      new RegExp(`loop 2 extended team is missing ${id}`)
    )
  );

  test('a team member with no agent file is red', () =>
    redWith(worksheet(), /no file in \.claude\/agents\/: role-devops/, {
      agents: TEAM.filter((x) => x !== 'role-devops'),
    }));

  test('a made-up agent id is red', () =>
    redWith(
      worksheet({ per: [{ team: TEAM.join(', ') + ', dr-of-astrologer' }] }),
      /no file in \.claude\/agents\/: dr-of-astrologer/
    ));

  test.each([
    ['prose', 'NOT RUN, skipped to save tokens: ' + TEAM.join(', ')],
    ['a trailing note', TEAM.join(', ') + ' (none of these ran)'],
    ['a bullet list start', '- ' + TEAM.join(', ')],
  ])('a Team line with %s is red', (_n, team) =>
    redWith(worksheet({ per: [{ team }] }), /needs exactly one line "Team: id, id, \.\.\."/)
  );

  test('no Team line is red, for a base team too', () => {
    redWith(worksheet({ per: [{ team: null }] }), /needs exactly one line "Team:/);
    redWith(
      worksheet({ fm: { team: 'base' }, per: [{ team: null }] }),
      /needs exactly one line "Team:/
    );
  });

  test('two Team lines are red', () =>
    redWith(worksheet({ per: [{ extra: 'Team: role-devops' }] }), /needs exactly one line "Team:/));

  test('a Team line that exists only inside a code fence does not count', () =>
    redWith(
      worksheet({ per: [{ team: null, extra: '```\nTeam: ' + TEAM.join(', ') + '\n```' }] }),
      /needs exactly one line "Team:/
    ));
});

describe('ccr worksheet gate: the cumulative and the pass', () => {
  test('the cumulative cannot be better than the worst loop', () => {
    green(worksheet({ scores: [60, 70, 80], fm: { cumulative_score: 60 } }));
    redWith(
      worksheet({ scores: [60, 70, 80], fm: { cumulative_score: 60.1 } }),
      /cumulative_score 60\.1 is better than the worst loop \(60%\)/
    );
  });

  test('solutioning cannot lower the score below the cumulative', () =>
    redWith(
      worksheet({ fm: { gate: 'stop', system_score: 40, cumulative_score: 50 }, question: 'Why?' }),
      /system_score 40 is below cumulative_score 50/
    ));

  test('system_score at exactly 95% passes, 94.9% does not', () => {
    green(worksheet({ fm: { system_score: 95 } }));
    redWith(worksheet({ fm: { system_score: 94.9 } }), /gate is pass but system_score is 94\.9%/);
  });

  test('loop 1 at exactly 95% is red, 94.9% is not', () => {
    redWith(worksheet({ scores: [95, 96, 96] }), /loop 1 scored 95%/);
    green(worksheet({ scores: [94.9, 96, 96] }));
  });

  test('a lite pass under 95% is red', () =>
    redWith(
      worksheet({
        scores: [94],
        fm: {
          class: 'lite',
          requested_loops: 1,
          team: 'base',
          cumulative_score: 94,
          system_score: 94,
        },
        per: [
          {
            team: 'role-qa-automation',
            layerLines: ['Critical layer: a', 'Conservative layer: b', 'Recursive layer: c'],
          },
        ],
      }),
      /gate is pass but system_score is 94%/
    ));

  test('a score under 95% needs a Solutioning section', () => {
    redWith(worksheet({ without: 'Solutioning' }), /needs a "## Solutioning" section/);
    redWith(
      worksheet({
        without: 'Solutioning',
        fm: { gate: 'stop', cumulative_score: 50, system_score: 50 },
        question: 'Which?',
      }),
      /needs a "## Solutioning" section/
    );
  });

  test('no Solutioning section is needed when no score is under 95%', () =>
    green(
      worksheet({
        without: 'Solutioning',
        scores: [96],
        fm: {
          class: 'lite',
          requested_loops: 1,
          team: 'base',
          cumulative_score: 96,
          system_score: 96,
        },
        per: [
          {
            team: 'role-qa-automation',
            layerLines: ['Critical layer: a', 'Conservative layer: b', 'Recursive layer: c'],
          },
        ],
      })
    ));

  test.each(['governance', 'compliance'])('%s needs owner_ratified to pass', (cls) => {
    const scores = [80, 80, 80, 80, 80];
    redWith(
      worksheet({ scores, fm: { class: cls, requested_loops: 5 } }),
      /needs "owner_ratified: YYYY-MM-DD"/
    );
    redWith(
      worksheet({ scores, fm: { class: cls, requested_loops: 5, owner_ratified: 'soon' } }),
      /needs "owner_ratified: YYYY-MM-DD"/
    );
    green(
      worksheet({ scores, fm: { class: cls, requested_loops: 5, owner_ratified: '2026-11-02' } })
    );
  });

  test('a stop with a clean score is red', () =>
    redWith(
      worksheet({ fm: { gate: 'stop' }, question: 'Why?' }),
      /gate is stop but system_score is a clean 96%/
    ));

  test('a stop must put a question to the owner on a line ending in "?"', () => {
    const stop = (question) =>
      worksheet({
        fm: { gate: 'stop', system_score: 50, cumulative_score: 50 },
        question,
      });
    redWith(stop('No questions.'), /human gate section must put at least one question/);
    redWith(
      stop('See https://x.example/a?b=1 for context.'),
      /human gate section must put at least one question/
    );
  });
});

describe('ccr worksheet gate: the arithmetic', () => {
  // The loosest legal ceiling is 100 - 0.375 x the base weight of the unresolved findings.
  const CEILING = { critical: 94.375, high: 96.25, medium: 98.125, low: 99.25 };
  const stopWith = (u, score) =>
    worksheet({
      fm: { gate: 'stop', cumulative_score: 0, system_score: score, unresolved: unresolved(u) },
      question: 'Which way?',
    });

  test.each(Object.entries(CEILING))(
    '%s: the ceiling is %d, one hair above is red',
    (sev, ceil) => {
      const u = unresolved({ [sev]: 1 });
      green(
        ceil >= 95
          ? worksheet({ fm: { cumulative_score: 0, system_score: ceil, unresolved: u } })
          : stopWith({ [sev]: 1 }, ceil)
      );
      redWith(stopWith({ [sev]: 1 }, ceil + 0.01), /is above the most the unresolved counts allow/);
    }
  );

  test('the ceiling is never below 0', () => green(stopWith({ critical: 99 }, 0)));

  test('Regulatory caps at 60, Security Critical floors at 0', () => {
    green(stopWith({ regulatory: 1 }, 60));
    redWith(stopWith({ regulatory: 1 }, 61), /an unresolved Regulatory item caps it at 60/);
    green(stopWith({ security_critical: 1 }, 0));
    redWith(
      stopWith({ security_critical: 1 }, 1),
      /an unresolved Security Critical floors it at 0/
    );
  });

  test('neither can pass', () => {
    redWith(
      worksheet({
        fm: {
          system_score: 0,
          cumulative_score: 0,
          unresolved: unresolved({ security_critical: 1 }),
        },
      }),
      /gate cannot pass with an unresolved Security Critical or Regulatory/
    );
    redWith(
      worksheet({
        fm: { system_score: 60, cumulative_score: 0, unresolved: unresolved({ regulatory: 1 }) },
      }),
      /gate cannot pass with an unresolved Security Critical or Regulatory/
    );
  });
});

describe('ccr worksheet gate: frontmatter and sections', () => {
  test.each([
    ['team', { team: 'everyone' }, /team must be extended or base/],
    ['gate', { gate: 'maybe' }, /gate must be stop or pass/],
    ['requested_loops 0', { requested_loops: 0 }, /requested_loops must be a whole number/],
    ['requested_loops text', { requested_loops: 'five' }, /requested_loops must be a whole number/],
    ['loops_run 0', { loops_run: 0 }, /loops_run must be a whole number/],
    ['system_score 101', { system_score: 101 }, /system_score must be a number from 0 to 100/],
    ['system_score -1', { system_score: -1 }, /system_score must be a number from 0 to 100/],
    [
      'cumulative_score missing',
      { cumulative_score: undefined },
      /cumulative_score must be a number from 0 to 100/,
    ],
    ['cumulative_score 101', { cumulative_score: 101 }, /cumulative_score must be a number/],
    ['unresolved missing', { unresolved: undefined }, /unresolved must be a map/],
    [
      'unresolved key missing',
      { unresolved: '{ critical: 0 }' },
      /unresolved\.regulatory must be a whole number/,
    ],
    [
      'unresolved negative',
      { unresolved: unresolved({ high: -1 }) },
      /unresolved\.high must be a whole number, 0 or more \(got -1\)/,
    ],
  ])('%s is red', (_n, fm, expected) => redWith(worksheet({ fm }), expected));

  test.each([
    ['Verdict', 'verdict'],
    ['What was reviewed', 'what was reviewed'],
    ['Findings register', 'findings register'],
    ['What must be true before shipping', 'what must be true before shipping'],
    ['Verification after shipping', 'verification'],
    ['Risks accepted', 'risks accepted'],
    ['Human gate', 'human gate'],
  ])('a worksheet without "%s" is red', (name, label) =>
    redWith(worksheet({ without: name }), new RegExp(`missing section: ${label} \\(`))
  );

  test('a bold line or prose mention is not a section heading', () => {
    const ws = worksheet({ without: 'Risks accepted' }).replace(
      '## Human gate',
      '**Risks accepted**\n\n## Human gate'
    );
    redWith(ws, /missing section: risks accepted/);
  });

  test('frontmatter that is not YAML is red', () =>
    redWith('---\nclass: [unclosed\n---\n\nbody\n', /frontmatter is not valid YAML/));

  test('a blank line or BOM before the frontmatter says where it must start', () => {
    redWith(worksheet({ prefix: '\n' }), /must start on line 1 with "---"/);
    redWith(worksheet({ prefix: String.fromCharCode(0xfeff) }), /must start on line 1 with "---"/);
  });
});

describe('ccr worksheet gate: which files it sees', () => {
  test('a worksheet with no frontmatter is red', () =>
    redWith(
      '# CCR\n\nI reviewed it. 97%.\n',
      /no frontmatter; a CCR worksheet must carry the ccr frontmatter/
    ));

  test.each([
    ['lowercase', 'ccr-sneaky.md'],
    ['underscore', 'CCR_sneaky.md'],
    ['a subfolder', 'sub/deeper/CCR-sneaky.md'],
    ['.markdown', 'CCR-sneaky.markdown'],
  ])('a worksheet with no frontmatter named %s is still seen', (_n, name) => {
    const r = run(tree({ files: { [name]: '# nothing\n97%\n' } }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`.claude/outputs/${name}: no frontmatter`);
  });

  test('a file that is not a worksheet is ignored', () => {
    const r = run(
      tree({ files: { 'PROPOSAL-ccr-x.md': '# p\n', 'CCR-x.txt': 'x\n', 'notes.md': 'n\n' } })
    );
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  test('an old worksheet in docs/ccr-archive is not read', () => {
    const root = tree();
    put(root, 'docs/ccr-archive/CCR-OLD-2026-10-01.md', '# CCR\n\nold, no frontmatter\n');
    const r = run(root);
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('ccr worksheets ok (1 checked)');
  });

  test('a tree with no .claude/outputs is red, not a vacuous green', () => {
    const r = run(tree({ noOutputs: true }));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/\.claude\/outputs is missing/);
  });
});

describe('ccr worksheet gate: classes the owner added', () => {
  test('a rollback CCR needs 3 loops: 3 is green', () =>
    green(worksheet({ fm: { class: 'rollback', requested_loops: 3 } })));

  test('a rollback CCR needs 3 loops: 2 is red', () =>
    redWith(
      worksheet({ scores: [60, 70], fm: { class: 'rollback', requested_loops: 2 } }),
      /loops_run is 2 but this run needs 3 \(requested 2, class rollback needs 3\)/
    ));

  test('a loop count above 20 is red, so a typo cannot stall the check', () =>
    redWith(
      worksheet({ fm: { loops_run: 21 } }),
      /loops_run must be a whole number from 1 to 20 \(got 21\)/
    ));
});

describe("ccr worksheet gate: the owner's sentence", () => {
  const inv = (sentence, fm = {}) => worksheet({ fm: { invocation: `'${sentence}'`, ...fm } });

  test.each([
    ['a class word with no number', 'run ccr loop for bug fix', {}],
    ['a number and a subject', 'run ccr 3 loops for release', {}],
    ['a quoted subject', 'run ccr 3 loop for "definition of task"', {}],
    ['a team', 'run ccr loop with extended team for release', {}],
    ['rollback', 'run ccr loop for rollback', { class: 'rollback' }],
    ['a quoted class word', 'run ccr loop for "rollback"', { class: 'rollback' }],
    [
      'fewer than the class minimum, run to the minimum',
      'run ccr 3 loop for "definition of task"',
      { class: 'governance', requested_loops: 3, owner_ratified: '2026-11-02' },
    ],
  ])('%s is green', (_n, sentence, fm) => {
    const scores = fm.class === 'governance' ? [60, 70, 80, 85, 90] : undefined;
    green(worksheet({ scores, fm: { invocation: `'${sentence}'`, ...fm } }));
  });

  test.each([
    [
      'a number that is not requested_loops',
      'run ccr 5 loops for release',
      {},
      /requested_loops is 3 but the invocation asks for 5 \(the number it names\)/,
    ],
    [
      'no number, and requested_loops is not the class minimum',
      'run ccr loop for release',
      { requested_loops: 4, loops_run: 3 },
      /requested_loops is 4 but the invocation asks for 3 \(no number, so the bug-fix minimum\)/,
    ],
    [
      'a class word that is not the class',
      'run ccr loop for compliance',
      {},
      /class is bug-fix but the invocation's subject is the class word for compliance/,
    ],
    [
      'a class word sets the loop count, not the declared class',
      'run ccr loop for compliance',
      {},
      /requested_loops is 3 but the invocation asks for 5 \(no number, so the compliance minimum\)/,
    ],
    [
      'a quoted class word that is not the class',
      'run ccr loop for "compliance"',
      {},
      /class is bug-fix but the invocation's subject is the class word for compliance/,
    ],
    [
      'a team that is not the team',
      'run ccr loop with base team for release',
      {},
      /team is extended but the invocation asks for the base team/,
    ],
    [
      'a class word with no number, and requested_loops below its minimum',
      'run ccr loop for compliance',
      { class: 'compliance', requested_loops: 3 },
      /requested_loops is 3 but the invocation asks for 5 \(no number, so the compliance minimum\)/,
    ],
    [
      'a sentence that is not the format',
      'Start CCR',
      {},
      /invocation must be the owner's sentence/,
    ],
  ])('%s is red', (_n, sentence, fm, expected) => redWith(inv(sentence, fm), expected));
});

describe('ccr worksheet gate: the findings register', () => {
  const table = (...rows) => ['| # | Severity | Status |', '|---|---|---|', ...rows].join('\n');

  test('open rows that match unresolved are green', () =>
    green(worksheet({ fm: { unresolved: unresolved({ low: 1 }) } })));

  test('unresolved that does not match the open rows is red', () =>
    redWith(
      worksheet({ fm: { unresolved: unresolved({ low: 1 }) }, register: table() }),
      /unresolved does not match the open rows of the findings register: low 1 vs 0/
    ));

  test('an open row that unresolved leaves out is red', () =>
    redWith(
      worksheet({ register: table('| F1 | High | open |') }),
      /unresolved does not match the open rows of the findings register: high 0 vs 1/
    ));

  test.each(['fixed', 'Closed', 'resolved in PR 12', 'withdrawn'])(
    'a row with status "%s" is not counted',
    (status) => green(worksheet({ register: table(`| F1 | High | ${status} |`) }))
  );

  test('with no Status column every row is open, and "Sev" names the column', () =>
    green(
      worksheet({
        fm: { unresolved: unresolved({ low: 1 }) },
        register: '| # | Sev | Finding |\n|---|---|---|\n| L1 | **Low** | x |',
      })
    ));

  test('a table with no Severity column before the register table is skipped', () =>
    green(
      worksheet({
        fm: { unresolved: unresolved({ low: 1 }) },
        register: `| a | b |\n|---|---|\n| 1 | 2 |\n\nRegister:\n\n${table('| F1 | Low | open |')}`,
      })
    ));

  test('a register with no Severity column is red', () =>
    redWith(
      worksheet({ register: 'F1 is high, but this is prose.' }),
      /the findings register needs a table with a Severity column/
    ));

  test('an unknown severity is red', () =>
    redWith(
      worksheet({ register: table('| F1 | Severe | open |') }),
      /the findings register has a row of severity "Severe"/
    ));
});

describe('ccr worksheet gate: the pull request fields', () => {
  test('a pr number and a quoted 40-character subject_sha are green', () =>
    green(worksheet({ fm: { pr: 1234, subject_sha: `"${'a1'.repeat(20)}"` } })));

  test.each([
    ['pr 0', { pr: 0 }, /pr must be a pull request number \(got 0\)/],
    ['pr text', { pr: 'mine' }, /pr must be a pull request number/],
    [
      'a short subject_sha',
      { subject_sha: 'abc1234' },
      /subject_sha must be a full 40-character commit SHA/,
    ],
  ])('%s is red', (_n, fm, expected) => redWith(worksheet({ fm }), expected));
});
