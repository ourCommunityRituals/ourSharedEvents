/**
 * No workflow step prints a secret (OSE-1488).
 *
 * The workflow-token-hardening test (0.5) already refuses `${{ secrets.X }}` written straight into a
 * `run:` script. This covers the indirect route: a secret passed through `env:` and then printed.
 * GitHub masks an exact echo, but not a value derived from it, and `set -x` or an environment dump
 * prints every value it can see.
 *
 * The rule is scripts/ci/secret-echo-exposure.mjs (mutation-tested with StrykerJS, see
 * stryker.ci-scripts.conf.mjs). This file pins each form it must catch, each form it must leave
 * alone (output piped or redirected onward is how `docker login --password-stdin` works), and then
 * applies it to the real workflows.
 */
const { readFileSync, readdirSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');

const WORKFLOWS = join(__dirname, '..', '..', '..', '.github', 'workflows');

let secretEnvVars;
let printsSecret;
let secretEchoes;
beforeAll(async () => {
  ({ secretEnvVars, printsSecret, secretEchoes } =
    await import('../../../scripts/ci/secret-echo-exposure.mjs'));
});

const T = ['TOKEN'];

describe('secretEnvVars: which env entries carry a secret', () => {
  test('finds entries whose value references a secret, in any expression form', () => {
    expect(
      secretEnvVars({
        A: '${{ secrets.ALPHA }}',
        B: '${{ secrets.BETA || secrets.GAMMA }}',
        C: 'prefix-${{ secrets.DELTA }}',
        PLAIN: 'hello',
        VARS: '${{ vars.NOT_A_SECRET }}',
      }).sort()
    ).toEqual(['A', 'B', 'C']);
  });
  test('merges several env blocks and lists a name once', () => {
    expect(
      secretEnvVars(
        { A: '${{ secrets.X }}' },
        { B: '${{ secrets.Y }}', A: '${{ secrets.X }}' }
      ).sort()
    ).toEqual(['A', 'B']);
  });
  test('ignores missing, null and non-object blocks and non-string values', () => {
    expect(
      secretEnvVars(undefined, null, 'text', 42, [], {
        N: 7,
        F: false,
        O: { a: 'secrets.X' },
        S: '${{ secrets.OK }}',
      })
    ).toEqual(['S']);
    // an array stringifies to its contents, so it would match if the string check were missing
    expect(secretEnvVars({ L: ['${{ secrets.X }}'], S: '${{ secrets.OK }}' })).toEqual(['S']);
  });
  test('nothing in, nothing out', () => {
    expect(secretEnvVars()).toEqual([]);
  });
});

describe('printsSecret: what it must catch', () => {
  test.each([
    ['echo of the variable', 'echo "$TOKEN"'],
    ['echo with braces', 'echo "${TOKEN}"'],
    ['echo inside text', 'echo "token is $TOKEN now"'],
    ['printf', 'printf \'%s\\n\' "$TOKEN"'],
    ['cat', 'cat "$TOKEN"'],
    ['tee', 'tee "$TOKEN"'],
    ['print', 'print $TOKEN'],
    ['Write-Host', 'Write-Host $TOKEN'],
    ['Write-Output', 'Write-Output "$TOKEN"'],
    ['stderr still reaches the log', 'echo "$TOKEN" >&2'],
    ['stdout and stderr merged still reach the log', 'echo "$TOKEN" 2>&1'],
    ['on a later line of the script', 'set -e\nmake build\necho "$TOKEN"\nmake test'],
    ['an indented line', '  if true; then\n    echo "$TOKEN"\n  fi'],
  ])('%s', (_name, run) => {
    expect(printsSecret(run, T)).toEqual(['prints $TOKEN']);
  });

  test('a script naming a different secret variable is attributed to that one', () => {
    expect(printsSecret('echo "$OTHER"', ['TOKEN', 'OTHER'])).toEqual(['prints $OTHER']);
  });
  test('two secrets printed give two reasons, in order', () => {
    expect(printsSecret('echo "$TOKEN"\necho "$OTHER"', ['TOKEN', 'OTHER'])).toEqual([
      'prints $TOKEN',
      'prints $OTHER',
    ]);
  });
  test.each([
    ['printenv', 'printenv'],
    ['env', 'env'],
    ['set', 'set'],
    ['export -p', 'export -p'],
    ['declare -p', 'declare -p'],
    ['export -p with extra spaces', 'export    -p'],
    ['declare -p with extra spaces', 'declare    -p'],
    ['indented, with trailing spaces', '  env   \nmake'],
    ['between other lines', 'make\nprintenv\nmake'],
  ])('a dump of the environment: %s', (_name, run) => {
    expect(printsSecret(run, T)).toEqual(['dumps the environment']);
  });
  test.each([
    ['set -x', 'set -x\nmake'],
    ['set -ex', 'set -ex'],
    ['set -euxo pipefail', 'set -euxo pipefail'],
    ['set -o xtrace', 'set -o xtrace'],
    ['set -x with extra spaces', 'set    -x'],
    ['set -o xtrace with extra spaces', 'set    -o    xtrace'],
  ])('command tracing: %s', (_name, run) => {
    expect(printsSecret(run, T)).toEqual(['turns on set -x']);
  });
  test('print, dump and trace in one script are all reported', () => {
    expect(printsSecret('set -x\nenv\necho "$TOKEN"', T)).toEqual([
      'prints $TOKEN',
      'dumps the environment',
      'turns on set -x',
    ]);
  });
});

describe('printsSecret: what it must leave alone', () => {
  test.each([
    ['output piped onward (docker login)', 'echo "$TOKEN" | docker login --password-stdin'],
    ['output piped to base64', 'echo "$TOKEN" | base64'],
    ['output redirected to a file', 'echo "$TOKEN" > key.txt'],
    ['output appended to a file', 'printf "%s" "$TOKEN" >> "$FILE"'],
    ['both streams to a file with &>', 'echo "$TOKEN" &> out.log'],
    ['both streams to a file with >&', 'echo "$TOKEN" >& out.log'],
    ['a pipe after a stderr redirect', 'echo "$TOKEN" 2>&1 | tee log'],
    ['an existence test', '[ -z "$TOKEN" ] && exit 1'],
    ['a presence marker that never prints the value', 'echo "token is ${TOKEN:+set}"'],
    ['passing it as an argument', 'curl -H "Authorization: Bearer $TOKEN" https://example.test'],
    ['a longer variable name', 'echo "$TOKEN_SUFFIX"'],
    ['a longer variable name with braces', 'echo "${TOKEN2}"'],
    ['a different variable', 'echo "$HOME"'],
    ['an echo with no variable', 'echo "done"'],
    ['a variable with no print command', 'make TOKEN="$TOKEN"'],
    ['the length of the value', 'echo "${#TOKEN}"'],
    ['set without trace flags', 'set -euo pipefail'],
    ['env running a command', 'env FOO=bar make'],
    ['printenv of one named, non-secret variable', 'printenv HOME'],
    ['exporting one variable', 'export FOO=bar'],
  ])('%s', (_name, run) => {
    expect(printsSecret(run, T)).toEqual([]);
  });
  test('no secret in scope means nothing is flagged, even set -x and env', () => {
    expect(printsSecret('set -x\nenv\necho "$TOKEN"', [])).toEqual([]);
  });
  test('a script that is not a string is ignored', () => {
    expect(printsSecret(undefined, T)).toEqual([]);
    expect(printsSecret(null, T)).toEqual([]);
    expect(printsSecret(42, T)).toEqual([]);
  });
});

describe('secretEchoes: scoping and the exact report', () => {
  const job = (steps, env) => ({ 'runs-on': 'ubuntu-latest', ...(env ? { env } : {}), steps });
  const TOKEN_ENV = { TOKEN: '${{ secrets.TOKEN }}' };

  test('a secret on the step is found, with file, job, step name, reason and variable', () => {
    const doc = {
      jobs: { build: job([{ name: 'Deploy', run: 'echo "$TOKEN"', env: TOKEN_ENV }]) },
    };
    expect(secretEchoes('ci.yml', doc)).toEqual({
      findings: ['ci.yml: job "build", step "Deploy" prints $TOKEN (secret in scope: TOKEN)'],
      examined: 1,
    });
  });
  test('a secret set on the job reaches its steps', () => {
    const doc = { jobs: { build: job([{ name: 'S', run: 'echo "$TOKEN"' }], TOKEN_ENV) } };
    expect(secretEchoes('ci.yml', doc).findings).toHaveLength(1);
  });
  test('a secret set on the whole workflow reaches every job', () => {
    const doc = {
      env: TOKEN_ENV,
      jobs: { a: job([{ run: 'echo ok' }]), b: job([{ name: 'B', run: 'echo "$TOKEN"' }]) },
    };
    const r = secretEchoes('ci.yml', doc);
    expect(r.findings).toEqual([
      'ci.yml: job "b", step "B" prints $TOKEN (secret in scope: TOKEN)',
    ]);
    expect(r.examined).toBe(2);
  });
  test('a secret on one job does not reach another job, and one step does not reach the next', () => {
    const doc = {
      jobs: {
        a: job([{ run: 'echo ok', env: TOKEN_ENV }, { run: 'echo "$TOKEN"' }]),
        b: job([{ run: 'echo "$TOKEN"' }], undefined),
      },
    };
    expect(secretEchoes('ci.yml', doc)).toEqual({ findings: [], examined: 1 });
  });
  test('a step with no name is reported by its position', () => {
    const doc = {
      jobs: { build: job([{ run: 'echo ok' }, { run: 'echo "$TOKEN"', env: TOKEN_ENV }]) },
    };
    expect(secretEchoes('ci.yml', doc).findings).toEqual([
      'ci.yml: job "build", step "step 2" prints $TOKEN (secret in scope: TOKEN)',
    ]);
  });
  test('the report lists every reason and every secret in scope', () => {
    const doc = {
      jobs: {
        j: job([
          {
            name: 'N',
            run: 'set -x\necho "$A"',
            env: { A: '${{ secrets.A }}', B: '${{ secrets.B }}' },
          },
        ]),
      },
    };
    expect(secretEchoes('w.yml', doc).findings).toEqual([
      'w.yml: job "j", step "N" prints $A and turns on set -x (secret in scope: A, B)',
    ]);
  });
  test('examined counts only steps that have a script AND a secret in scope', () => {
    const doc = {
      jobs: {
        j: job([
          { uses: 'actions/checkout@v4', env: TOKEN_ENV },
          { run: 'echo ok' },
          { run: 'echo ok', env: TOKEN_ENV },
          { run: 'make', env: TOKEN_ENV },
        ]),
      },
    };
    expect(secretEchoes('ci.yml', doc)).toEqual({ findings: [], examined: 2 });
  });
  test('a workflow with no jobs, no steps, or nothing at all does not throw', () => {
    expect(secretEchoes('a.yml', {})).toEqual({ findings: [], examined: 0 });
    expect(secretEchoes('a.yml', undefined)).toEqual({ findings: [], examined: 0 });
    expect(secretEchoes('a.yml', { jobs: { j: {} } })).toEqual({ findings: [], examined: 0 });
    expect(secretEchoes('a.yml', { jobs: { j: null } })).toEqual({ findings: [], examined: 0 });
    expect(secretEchoes('a.yml', { jobs: { j: { steps: [null, {}] } } })).toEqual({
      findings: [],
      examined: 0,
    });
  });
});

describe('the real workflows', () => {
  const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));
  const results = () =>
    files.map((f) => secretEchoes(f, yaml.load(readFileSync(join(WORKFLOWS, f), 'utf8')) ?? {}));

  test('there are steps to check (a green run is not an empty run)', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(results().reduce((n, r) => n + r.examined, 0)).toBeGreaterThan(20);
  });

  test('no step prints a secret that was passed through env:', () => {
    const found = results().flatMap((r) => r.findings);
    expect(
      found,
      'GitHub masks an exact echo of a secret, not a value derived from it, and set -x or an environment dump prints\n' +
        'everything it can see. Pass the secret to the program that needs it (a pipe or an argument) and do not print it.\n' +
        found.map((l) => '  - ' + l).join('\n')
    ).toEqual([]);
  });
});
