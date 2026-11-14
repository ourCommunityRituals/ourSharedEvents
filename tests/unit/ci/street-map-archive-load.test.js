/**
 * The street-map archive load (.github/workflows/street-map-archive-load.yml).
 *
 * Owner, 2026-11-14: nothing is run, built or checked on the owner's computer.
 * So the United States archive is cut, checked and loaded into the staging
 * bucket by a workflow, dispatched by hand. This file holds three things:
 *
 *   1. the decisions the workflow makes (scripts/ci/street-map-archive-load.mjs),
 *      each fed the fault that must stop a run;
 *   2. the workflow's shape: dispatch-only, staging only, the bucket credential
 *      in the three bucket steps and nowhere else, tools refused before they are
 *      unpacked, the check before the upload, nothing overwritten;
 *   3. drift: the build, key and bucket are typed in wrangler.toml, in the
 *      workflow and in the runbook, and the runbook shows only commands the
 *      workflow runs.
 *
 * What it cannot hold: the workflow running. It can be dispatched only from
 * main, so its first real run is the owner's `measure` dispatch.
 */
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '../../../');
// One line ending, so a Windows checkout reads the same text as CI.
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const WORKFLOW = '.github/workflows/street-map-archive-load.yml';
const RUNBOOK = 'docs/runbooks/RUNBOOK-STREET-MAP-ARCHIVE.md';
const TOML = 'workers/oursharedevents/wrangler.toml';
const workflow = () => read(WORKFLOW);
const runbook = () => read(RUNBOOK);
const toml = () => read(TOML);

let load;
beforeAll(async () => {
  load = await import('../../../scripts/ci/street-map-archive-load.mjs');
});

// ─── 1. The decisions ────────────────────────────────────────────────────────

describe('names: the workflow loads the file the Worker reads, into the bucket staging binds', () => {
  const NAMED = { build: '20261109', key: 'us-20261109.pmtiles', bucket: 'ose-map-tiles-staging' };
  const TOML_OK = [
    '[env.staging]',
    '[[env.staging.r2_buckets]]',
    'binding = "MAP_TILES"',
    'bucket_name = "ose-map-tiles-staging"',
    '[env.staging.vars]',
    'MAP_TILES_ARCHIVE = "us-20261109.pmtiles"',
    '[env.production]',
    '[env.production.vars]',
    'MAP_TILES_ARCHIVE = "us-20261109.pmtiles"',
    '',
  ].join('\n');

  test('agreeing names have no problem', () => {
    expect(load.nameProblems(NAMED, TOML_OK)).toEqual([]);
  });

  test.each([
    ['two digits of the date swapped in the key', { key: 'us-20261019.pmtiles' }],
    ['the key of another build', { key: 'us-20261110.pmtiles', build: '20261110' }],
    ['the build moved and the key left behind', { build: '20261110' }],
    ['the whole build named as the key', { key: '20261109.pmtiles' }],
    ['the planet name of 2026-11-09', { key: 'planet-20261109.pmtiles' }],
    ['the production bucket', { bucket: 'ose-map-tiles-production' }],
    ['the uploads bucket', { bucket: 'ose-uploads-staging' }],
    ['the dev bucket', { bucket: 'ose-map-tiles-dev' }],
    ['no key at all', { key: undefined }],
    ['no bucket at all', { bucket: undefined }],
  ])('fat finger in the workflow: %s', (_, slip) => {
    expect(load.nameProblems({ ...NAMED, ...slip }, TOML_OK)).not.toEqual([]);
  });

  test('a production block that reads another archive is a problem, not a pass', () => {
    const split = TOML_OK.replace(
      /MAP_TILES_ARCHIVE = "us-20261109\.pmtiles"\n$/,
      'MAP_TILES_ARCHIVE = "us-20261003.pmtiles"\n'
    );
    expect(split).not.toBe(TOML_OK);
    expect(load.nameProblems(NAMED, split).join(' ')).toMatch(/on staging and .* on production/);
  });

  test('rainy: a wrangler.toml with no staging bucket, no archive name or no blocks is named', () => {
    expect(
      load.nameProblems(NAMED, TOML_OK.replace('binding = "MAP_TILES"', 'binding = "X"'))
    ).toEqual(['wrangler.toml: staging has no MAP_TILES bucket_name']);
    expect(
      load.nameProblems(NAMED, TOML_OK.replace('MAP_TILES_ARCHIVE', 'MAP_TILES_ARCHIV'))
    ).toEqual(['wrangler.toml: staging has no MAP_TILES_ARCHIVE']);
    expect(load.nameProblems(NAMED, '')).toEqual([
      'wrangler.toml: staging has no MAP_TILES bucket_name',
    ]);
  });
});

describe('private: only the two exact answers that mean private pass', () => {
  // wrangler 4.158.0 prints a banner, then these.
  const OFF =
    ' ⛅️ wrangler 4.158.0\n───────────────────\nPublic access via the r2.dev URL is disabled.\n';
  const NONE =
    " ⛅️ wrangler 4.158.0\n───────────────────\nListing custom domains connected to bucket 'ose-map-tiles-staging'...\nThere are no custom domains connected to this bucket.\n";

  test('no r2.dev URL and no custom domain: private', () => {
    expect(load.privacyProblems(OFF, NONE)).toEqual([]);
  });

  test.each([
    ['the r2.dev URL is on', "Public access is enabled at 'https://pub-abc.r2.dev'.", NONE],
    [
      'a custom domain is listed',
      OFF,
      "Listing custom domains connected to bucket 'b'...\ndomain: tiles.example.com\nenabled: Yes\n",
    ],
    [
      'the first read failed',
      '✘ [ERROR] A request to the Cloudflare API failed. Authentication error [code: 10000]',
      NONE,
    ],
    ['the second read failed', OFF, '✘ [ERROR] The specified bucket does not exist. [code: 10006]'],
    ['both answers empty', '', ''],
    ['the two answers swapped', NONE, OFF],
    ['an answer that was never read', undefined, undefined],
    ['the sentence reworded by a later wrangler', 'Public access through r2.dev is off.', NONE],
  ])('%s: not private', (_, devUrl, domains) => {
    expect(load.privacyProblems(devUrl, domains)).not.toEqual([]);
  });
});

describe('fits: the dry-run size against the free disk', () => {
  // go-pmtiles v1.31.2 logs with a date, a time and file:line in front.
  const line = (size) =>
    `2026/11/14 18:00:01 extract.go:612: Extract transferred 22 GB (overfetch 0.05) for an archive size of ${size}\n`;
  const LOG =
    '2026/11/14 18:00:00 extract.go:441: Region tiles 31000000, result tile entries 29000000\n' +
    '2026/11/14 18:00:01 extract.go:606: Completed in 41s with 4 download threads (700000 tiles/s).\n' +
    line('21 GB');

  test('reads the size, and the largest size that rounds to it', () => {
    expect(load.parseDryRunSize(LOG)).toEqual({ text: '21 GB', bytes: 21e9, upperBytes: 21.55e9 });
    expect(load.parseDryRunSize(line('9.4 GB'))).toEqual({
      text: '9.4 GB',
      bytes: 9.4e9,
      upperBytes: 9.45e9,
    });
    expect(load.parseDryRunSize(line('464 MB')).upperBytes).toBe(464.55e6);
    expect(load.parseDryRunSize(line('1.2 TB')).bytes).toBe(1.2e12);
    expect(load.parseDryRunSize(line('7 B'))).toEqual({ text: '7 B', bytes: 7, upperBytes: 7 });
  });

  test('takes the archive size, not the transfer size, and the last line when there are two', () => {
    expect(load.parseDryRunSize(line('3.0 GB') + line('21 GB')).text).toBe('21 GB');
    expect(load.parseDryRunSize(LOG).text).not.toBe('22 GB');
  });

  test.each([
    ['an empty log', ''],
    ['a failed run', '2026/11/14 18:00:00 main.go:185: Failed to extract, 404 Not Found\n'],
    ['a size with no unit', line('21')],
    ['a size in a unit it does not know', line('21 GiB')],
    ['a count of bytes with a decimal, which the tool never prints', line('7.5 B')],
    ['a line cut off', '... for an archive size of '],
    ['no log at all', undefined],
  ])('%s has no size', (_, log) => {
    expect(load.parseDryRunSize(log)).toBeNull();
  });

  test('fits with room for the directories; stops when it does not', () => {
    const size = load.parseDryRunSize(LOG);
    // 21.55 GB and 5% (1.0775 GB) is 22.6275 GB.
    const need = 21.55e9 + Math.ceil(21.55e9 * 0.05);
    expect(load.diskVerdict(size, need)).toMatchObject({ fits: true, need });
    expect(load.diskVerdict(size, need - 1).fits).toBe(false);
    expect(load.diskVerdict(size, need - 1).reason).toMatch(/does not fit this runner/);
    // A file that rounds to 21 GB does not fit a disk with 21 GB free.
    expect(load.diskVerdict(size, 21e9).fits).toBe(false);
    // The 14 GB GitHub documents for a standard runner.
    expect(load.diskVerdict(size, 14e9).fits).toBe(false);
    // A small file still leaves 1 GB for what the dry run does not count.
    const small = load.parseDryRunSize(line('464 MB'));
    expect(load.diskVerdict(small, 464.55e6 + 1e9).fits).toBe(true);
    expect(load.diskVerdict(small, 464.55e6 + 1e9 - 1).fits).toBe(false);
  });

  test.each([
    ['no size was read', null, 70e9],
    ['the free disk is empty text', { upperBytes: 1 }, ''],
    ['the free disk is not a number', { upperBytes: 1 }, 'Avail'],
    ['the free disk is zero', { upperBytes: 1 }, '0'],
    ['the free disk was never read', { upperBytes: 1 }, undefined],
  ])('rainy: %s, so it does not fit', (_, size, free) => {
    expect(load.diskVerdict(size, free).fits).toBe(false);
  });
});

describe('absent and loaded: what the bucket lists', () => {
  const KEY = 'us-20261109.pmtiles';
  const entry = (over = {}) => ({ Path: KEY, Name: KEY, Size: 21000000123, IsDir: false, ...over });
  const RECORD = {
    check: 'street-map-archive',
    file: KEY,
    bytes: 21000000123,
    sha256: 'a'.repeat(64),
    pass: true,
    problems: [],
  };

  test('an empty bucket, or one holding other objects, leaves the key free', () => {
    expect(load.overwriteProblems('[]', KEY)).toEqual([]);
    expect(
      load.overwriteProblems(JSON.stringify([entry({ Path: 'us-20261003.pmtiles' })]), KEY)
    ).toEqual([]);
  });

  test('a key that is there is never overwritten', () => {
    expect(load.overwriteProblems(JSON.stringify([entry()]), KEY).join(' ')).toMatch(
      /already holds "us-20261109\.pmtiles" \(21000000123 bytes\)\. An object is never overwritten/
    );
    // Even a stub of zero bytes: the name is taken.
    expect(load.overwriteProblems(JSON.stringify([entry({ Size: 0 })]), KEY)).not.toEqual([]);
  });

  test.each([
    ['an empty answer', ''],
    ['an error where the listing should be', 'Failed to lsjson: AccessDenied'],
    ['an object where a list should be', '{"error":"x"}'],
    ['a listing cut off', '[{"Path":"us-2026'],
  ])('rainy: %s is not an empty bucket', (_, listing) => {
    expect(load.overwriteProblems(listing, KEY).join(' ')).toMatch(/not known to be free/);
    expect(load.loadProblems(listing, RECORD, KEY).join(' ')).toMatch(/could not be read/);
  });

  test('loaded: the key listed at the byte size in the record', () => {
    expect(load.loadProblems(JSON.stringify([entry()]), RECORD, KEY)).toEqual([]);
  });

  test.each([
    [
      'the upload stopped one byte short',
      [entry({ Size: 21000000122 })],
      RECORD,
      /upload stopped early/,
    ],
    ['the object is not there', [], RECORD, /does not list/],
    [
      'only another build is there',
      [entry({ Path: 'us-20261003.pmtiles' })],
      RECORD,
      /does not list/,
    ],
    ['a folder has the name', [entry({ IsDir: true })], RECORD, /does not list/],
    [
      'the record is of a file that failed',
      [entry()],
      { ...RECORD, pass: false },
      /does not say the file passed/,
    ],
    [
      'the record is for another file',
      [entry()],
      { ...RECORD, file: 'us-20261003.pmtiles' },
      /is for "us-20261003/,
    ],
    ['the record has no size', [entry()], { ...RECORD, bytes: undefined }, /no byte size/],
    [
      'the record has a size of zero',
      [entry({ Size: 0 })],
      { ...RECORD, bytes: 0 },
      /no byte size/,
    ],
    ['the record has no SHA-256', [entry()], { ...RECORD, sha256: '' }, /no SHA-256/],
    ['there is no record', [entry()], null, /does not say the file passed/],
  ])('not loaded: %s', (_, listing, record, why) => {
    expect(load.loadProblems(JSON.stringify(listing), record, KEY).join(' ')).toMatch(why);
  });

  test('the summary carries the size and the SHA-256', () => {
    const md = load.summaryMarkdown(RECORD, {
      bucket: 'ose-map-tiles-staging',
      build: '20261109',
      state: 'loaded',
    });
    expect(md).toContain('`21000000123` (21.0 GB)');
    expect(md).toContain(`\`${'a'.repeat(64)}\``);
    expect(md).toContain('`us-20261109.pmtiles`');
    expect(md).toContain('`ose-map-tiles-staging`');
  });
});

// ─── 2. The workflow's shape ─────────────────────────────────────────────────

const LOAD_ONLY = "inputs.mode == 'load'";
const BUCKET_SECRETS = ['R2_MAP_TILES_ACCESS_KEY_ID', 'R2_MAP_TILES_SECRET_KEY'];
const DEPLOY_TOKEN_NAME = 'CLOUDFLARE_API_TOKEN_OSE';
const SECRETS_ALLOWED = [
  ...BUCKET_SECRETS,
  DEPLOY_TOKEN_NAME,
  'CLOUDFLARE_ACCOUNT_ID',
  'OCR_HUB_READ',
];
const secretsIn = (node) => [
  ...new Set([...JSON.stringify(node ?? null).matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1])),
];
const run = (step) => String(step?.run ?? '');
/** The commands of a script: lines that start with the program, comments and echoes left out. */
const commands = (step, program) =>
  run(step)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => new RegExp(`^(?:\\./|npx )?${program}\\b`).test(l));

/** What is wrong with the workflow's shape, as sentences. Pure: takes its text. */
function shapeProblems(text) {
  const out = [];
  const doc = yaml.load(text) ?? {};
  const code = text
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
  const on = doc.on ?? doc.true ?? {};
  const jobs = doc.jobs ?? {};
  const loadJob = jobs.load ?? {};
  const privateJob = jobs['bucket-private'] ?? {};
  const steps = loadJob.steps ?? [];

  // Dispatched by hand, and nothing else.
  if (typeof on !== 'object' || Object.keys(on).join() !== 'workflow_dispatch') {
    out.push('the workflow has a trigger other than workflow_dispatch');
  }
  const inputs = on?.workflow_dispatch?.inputs ?? {};
  if (Object.keys(inputs).sort().join() !== 'confirm,mode') {
    out.push(`the inputs are "${Object.keys(inputs).join()}", not confirm and mode`);
  }
  if (
    (inputs.mode?.options ?? []).join() !== 'measure,load' ||
    inputs.mode?.default !== 'measure'
  ) {
    out.push('mode is not measure or load, with measure the default');
  }
  // Staging only: the word is in no line a runner reads.
  if (/prod/i.test(code)) out.push('a line that is not a comment names production');
  if (JSON.stringify(doc.permissions) !== '{"contents":"read"}') {
    out.push('permissions are not contents: read alone');
  }
  if (
    doc.concurrency?.group !== 'street-map-archive-load' ||
    doc.concurrency?.['cancel-in-progress'] !== false
  ) {
    out.push('two loads can run at once, or one can be cancelled under an upload');
  }
  if (Object.keys(jobs).sort().join() !== 'bucket-private,load') {
    out.push(`the jobs are "${Object.keys(jobs).join()}", not bucket-private and load`);
  }

  // Each job refuses first: STAGING typed, then main.
  for (const [id, job] of Object.entries(jobs)) {
    const [first, second] = job.steps ?? [];
    if (
      !/!= "STAGING"[\s\S]*exit 1/.test(run(first)) ||
      !/inputs\.confirm/.test(first?.env?.CONFIRM ?? '')
    ) {
      out.push(`${id}: the first step does not refuse unless STAGING was typed`);
    }
    if (!/"\$GITHUB_REF" != "refs\/heads\/main"[\s\S]*exit 1/.test(run(second))) {
      out.push(`${id}: the second step does not refuse a dispatch from a branch`);
    }
    if (first?.if || second?.if) out.push(`${id}: a refusal has a condition and can be skipped`);
    if (secretsIn(job.env).length) out.push(`${id}: a secret is given to every step of the job`);
  }
  if (secretsIn(doc.env).length) out.push('a secret is given to every job');

  // Who holds what.
  const stray = secretsIn(doc).filter((s) => !SECRETS_ALLOWED.includes(s));
  if (stray.length) out.push(`a secret this workflow should not read: ${stray.join(', ')}`);
  if (BUCKET_SECRETS.some((s) => secretsIn(privateJob).includes(s))) {
    out.push('bucket-private reads the bucket credential');
  }
  if (secretsIn(loadJob).includes(DEPLOY_TOKEN_NAME)) {
    out.push('load reads the deploy token, on the runner that downloads tools');
  }
  for (const step of privateJob.steps ?? []) {
    if (/\b(curl|wget|rclone|pmtiles)\b/.test(run(step))) {
      out.push('bucket-private downloads or runs a tool on the runner that holds the deploy token');
    }
  }
  const wrangler = (privateJob.steps ?? []).flatMap((s) => commands(s, 'wrangler'));
  if (
    wrangler.length !== 2 ||
    !/^npx wrangler r2 bucket dev-url get "\$\{BUCKET\}" /.test(wrangler[0] ?? '') ||
    !/^npx wrangler r2 bucket domain list "\$\{BUCKET\}" /.test(wrangler[1] ?? '')
  ) {
    out.push('bucket-private runs something other than the two reads of the bucket');
  }
  if (
    !/\bprivate "\$RUNNER_TEMP\/dev-url\.txt" "\$RUNNER_TEMP\/domains\.txt"/.test(
      run((privateJob.steps ?? []).at(-1))
    )
  ) {
    out.push('bucket-private does not end by judging the two reads');
  }
  if (!(loadJob.needs ?? []).includes('bucket-private')) {
    out.push('load does not wait for the bucket to be read as private');
  }
  const holders = steps.filter((s) => BUCKET_SECRETS.some((n) => secretsIn(s).includes(n)));
  for (const step of holders) {
    if (!String(step.if ?? '').includes(LOAD_ONLY)) {
      out.push(`"${step.name}" reads the bucket credential in measure mode`);
    }
    if (/\b(pmtiles|npm|npx|curl|wget|tar|unzip)\b|check-street-map-archive/.test(run(step))) {
      out.push(
        `"${step.name}" holds the bucket credential and runs more than rclone and the judge`
      );
    }
  }
  if (holders.length !== 4) {
    out.push(
      `${holders.length} steps read the bucket credential, not the guard and the three bucket steps`
    );
  }

  // The tools: refused before they are unpacked.
  for (const [tool, unpack] of [
    ['PMTILES', 'tar -xzf'],
    ['RCLONE', 'unzip'],
  ]) {
    const step = steps.find((s) => run(s).includes(`\${${tool}_SHA256}`));
    const script = run(step);
    const checked = script.indexOf(
      `echo "\${${tool}_SHA256}  \${FILE}" | sha256sum --check --strict`
    );
    if (
      !step ||
      checked === -1 ||
      checked > script.indexOf(unpack) ||
      script.indexOf(unpack) === -1
    ) {
      out.push(`${tool}: the file is not checked against its SHA-256 before it is unpacked`);
    }
    if (!/^set -euo pipefail$/m.test(script)) {
      out.push(`${tool}: a failed check does not stop the step`);
    }
    if (!/^[0-9a-f]{64}$/.test(doc.env?.[`${tool}_SHA256`] ?? '')) {
      out.push(`${tool}: the pinned SHA-256 is not 64 hex characters`);
    }
    if (!/^\d+\.\d+\.\d+$/.test(doc.env?.[`${tool}_VERSION`] ?? '')) {
      out.push(`${tool}: the version is not pinned`);
    }
    if (step?.if) out.push(`${tool}: the download is skipped in one mode`);
  }

  // The order of the load, and nothing after the measure in measure mode.
  const at = (test) => steps.findIndex(test);
  const order = {
    'tool downloads': at((s) => run(s).includes('${RCLONE_SHA256}')),
    'dry run': at((s) => commands(s, 'pmtiles').some((c) => c.includes('--dry-run'))),
    'key is free': at((s) => / absent /.test(run(s))),
    cut: at((s) =>
      commands(s, 'pmtiles').some((c) => /^pmtiles extract /.test(c) && !c.includes('--dry-run'))
    ),
    check: at((s) => run(s).includes('check-street-map-archive.mjs')),
    'record artifact': at((s) => String(s.uses ?? '').startsWith('actions/upload-artifact@')),
    upload: at((s) => commands(s, 'rclone').some((c) => /^rclone copyto /.test(c))),
    confirm: at((s) => / loaded /.test(run(s))),
  };
  const names = Object.keys(order);
  for (const name of names) if (order[name] === -1) out.push(`load has no "${name}" step`);
  for (let i = 1; i < names.length; i++) {
    if (
      order[names[i - 1]] !== -1 &&
      order[names[i]] !== -1 &&
      order[names[i - 1]] >= order[names[i]]
    ) {
      out.push(`"${names[i]}" does not come after "${names[i - 1]}"`);
    }
  }
  steps.forEach((step, i) => {
    if (
      order['dry run'] !== -1 &&
      i > order['dry run'] &&
      !String(step.if ?? '').includes(LOAD_ONLY)
    ) {
      out.push(`"${step.name ?? step.uses}" runs in measure mode, after the measure`);
    }
  });

  const dry = run(steps[order['dry run']]);
  if (
    !/^set -euo pipefail$/m.test(dry) ||
    !/--dry-run 2>&1 \| tee "\$RUNNER_TEMP\/dry-run\.log"[\s\S]* fits "\$RUNNER_TEMP\/dry-run\.log" "\$FREE"/.test(
      dry
    )
  ) {
    out.push('the dry run is not judged against the free disk in the same step');
  }
  if (!/FREE="\$\(df --output=avail -B1 "\$WORK"/.test(dry)) {
    out.push('the free disk is not read from the disk the file is written to');
  }
  const check = run(steps[order.check]);
  if (
    !/STATUS=\$\?[\s\S]*"\$STATUS" -ne 0 \] \|\| \[ "\$\(tail -n 1 "\$RUNNER_TEMP\/check\.log"\)" != "PASS" \][\s\S]*exit 1/.test(
      check
    ) ||
    !/^set -uo pipefail$/m.test(check)
  ) {
    out.push('the check does not stop the run unless it exits 0 and ends in PASS');
  }
  const artifact = steps[order['record artifact']];
  if (
    !/always\(\)/.test(String(artifact?.if ?? '')) ||
    !String(artifact?.with?.path ?? '').endsWith('.check.json')
  ) {
    out.push('the check record is not kept when a later step, or the check itself, fails');
  }
  const upload = run(steps[order.upload]);
  if (
    !/^set -euo pipefail$/m.test(upload) ||
    upload.indexOf(' absent ') === -1 ||
    upload.indexOf(' absent ') > upload.indexOf('rclone copyto ')
  ) {
    out.push('the upload does not ask the bucket for the key first');
  }
  if (
    !/^rclone copyto "\$\{ARCHIVE_KEY\}" "r2:\$\{BUCKET\}\/\$\{ARCHIVE_KEY\}" .*--immutable\b/m.test(
      upload
    )
  ) {
    out.push('the upload is not the dated key into the staging bucket with --immutable');
  }
  // rclone lists and copies; it never deletes, moves or syncs.
  const verbs = Object.values(jobs)
    .flatMap((j) => j.steps ?? [])
    .flatMap((s) => commands(s, 'rclone'))
    .map((c) => c.replace(/^\.\//, '').split(/\s+/)[1]);
  const other = verbs.filter((v) => !['lsjson', 'copyto', 'version'].includes(v));
  if (other.length) {
    out.push(`rclone runs "${other.join(', ')}": it may only list, copy and print its version`);
  }
  if (verbs.filter((v) => v === 'copyto').length !== 1) out.push('there is not exactly one upload');
  return out;
}

// @born-red street-map archive load, shape | method: each rule is fed the fault that turns it red, in the cases below; "the real workflow" seen failing with the faults named in its own comment injected into the real file | date: 2026-11-14
describe('the workflow: dispatched by hand, staging only, the credential where it is needed', () => {
  // Seen red on the real file, 2026-11-14, one fault at a time: `--immutable`
  // deleted from the upload; the sha256sum line moved under `tar -xzf`; the
  // cut step's `if:` deleted; `environment: production` added to the load job.
  test('the real workflow', () => {
    expect(shapeProblems(workflow())).toEqual([]);
  });

  /** A fault made on the parsed workflow, so it does not depend on the file's layout. */
  const doc = (change) => (text) => {
    const d = yaml.load(text);
    change(d, d.jobs.load.steps, d.jobs['bucket-private'].steps);
    return yaml.dump(d, { lineWidth: -1 });
  };
  const stepOf = (steps, has) => steps.find((s) => String(s.run ?? s.uses ?? '').includes(has));

  test('a workflow written back from its parsed form still passes (the faults below are the only change)', () => {
    expect(shapeProblems(doc(() => {})(workflow()))).toEqual([]);
  });

  test.each([
    ['a push trigger added', doc((d) => (d.on.push = { branches: ['main'] }))],
    ['a schedule added', doc((d) => (d.on.schedule = [{ cron: '0 3 * * *' }]))],
    ['a pull_request trigger added', doc((d) => (d.on.pull_request = {}))],
    [
      'an environment input added',
      doc((d) => (d.on.workflow_dispatch.inputs.environment = { type: 'string' })),
    ],
    [
      'load made the default mode',
      doc((d) => (d.on.workflow_dispatch.inputs.mode.default = 'load')),
    ],
    [
      'the bucket input-able: production named in env',
      doc((d) => (d.env.BUCKET = 'ose-map-tiles-production')),
    ],
    [
      'the load job on the production environment',
      doc((d) => (d.jobs.load.environment = 'production')),
    ],
    ['write permission', doc((d) => (d.permissions.contents = 'write'))],
    ['a second run cancels the first', doc((d) => (d.concurrency['cancel-in-progress'] = true))],
    ['no lock at all', doc((d) => delete d.concurrency)],
    ['the STAGING refusal dropped from load', doc((d, steps) => steps.splice(0, 1))],
    ['the main refusal dropped from bucket-private', doc((d, steps, priv) => priv.splice(1, 1))],
    ['the STAGING refusal made conditional', doc((d, steps) => (steps[0].if = LOAD_ONLY))],
    [
      'the main refusal compares nothing',
      doc((d, steps) => (steps[1].run = 'echo "from $GITHUB_REF"')),
    ],
    [
      'the bucket credential on the whole load job',
      doc((d) => (d.jobs.load.env = { K: '${{ secrets.R2_MAP_TILES_SECRET_KEY }}' })),
    ],
    [
      'the bucket credential on the whole workflow',
      doc((d) => (d.env.K = '${{ secrets.R2_MAP_TILES_SECRET_KEY }}')),
    ],
    [
      'the bucket credential given to the cut',
      doc((d, steps) => (stepOf(steps, 'ls -l').env.K = '${{ secrets.R2_MAP_TILES_SECRET_KEY }}')),
    ],
    [
      'the bucket credential given to the check',
      doc(
        (d, steps) =>
          (stepOf(steps, 'check-street-map-archive').env.K =
            '${{ secrets.R2_MAP_TILES_ACCESS_KEY_ID }}')
      ),
    ],
    [
      'the bucket credential read in measure mode',
      doc((d, steps) => delete stepOf(steps, 'before-cut.json').if),
    ],
    [
      'the deploy token in the load job',
      doc(
        (d, steps) =>
          (stepOf(steps, '--dry-run').env.CLOUDFLARE_API_TOKEN =
            '${{ secrets.CLOUDFLARE_API_TOKEN_OSE }}')
      ),
    ],
    [
      'the bucket credential in bucket-private',
      doc((d, steps, priv) => (priv.at(-2).env.K = '${{ secrets.R2_MAP_TILES_SECRET_KEY }}')),
    ],
    [
      'another secret read',
      doc((d, steps) => (stepOf(steps, '--dry-run').env.K = '${{ secrets.ADMIN_KEY }}')),
    ],
    [
      'a tool downloaded beside the deploy token',
      doc((d, steps, priv) => (priv.at(-2).run += '\ncurl -sSL https://example.test/tool | sh')),
    ],
    [
      'the bucket made public by the read job',
      doc(
        (d, steps, priv) =>
          (priv.at(-2).run += '\nnpx wrangler r2 bucket dev-url enable "${BUCKET}"')
      ),
    ],
    [
      'an object deleted with wrangler',
      doc(
        (d, steps, priv) =>
          (priv.at(-2).run += '\nnpx wrangler r2 object delete "${BUCKET}/${ARCHIVE_KEY}"')
      ),
    ],
    [
      'another bucket read for privacy',
      doc(
        (d, steps, priv) =>
          (priv.at(-2).run = priv
            .at(-2)
            .run.replace('dev-url get "${BUCKET}"', 'dev-url get ose-uploads-staging'))
      ),
    ],
    ['the two reads never judged', doc((d, steps, priv) => priv.pop())],
    ['load does not wait for bucket-private', doc((d) => delete d.jobs.load.needs)],
    ['bucket-private removed', doc((d) => delete d.jobs['bucket-private'])],
    [
      'pmtiles unpacked before its SHA-256 is checked',
      doc((d, steps) => {
        const s = stepOf(steps, '${PMTILES_SHA256}');
        s.run = s.run
          .replace(/echo "\$\{PMTILES_SHA256\}.*\n/, '')
          .replace(
            'tar -xzf "$FILE"\n',
            'tar -xzf "$FILE"\necho "${PMTILES_SHA256}  ${FILE}" | sha256sum --check --strict\n'
          );
      }),
    ],
    [
      'the pmtiles SHA-256 check dropped',
      doc((d, steps) => {
        const s = stepOf(steps, '${PMTILES_SHA256}');
        s.run = s.run.replace(/echo "\$\{PMTILES_SHA256\}.*\n/, 'echo "${PMTILES_SHA256}"\n');
      }),
    ],
    [
      'the rclone SHA-256 check made a warning',
      doc((d, steps) => {
        const s = stepOf(steps, '${RCLONE_SHA256}');
        s.run = s.run.replace('sha256sum --check --strict', 'sha256sum --check --strict || true');
        s.run = s.run.replace('set -euo pipefail\n', '');
      }),
    ],
    [
      'the pmtiles digest shortened',
      doc((d) => (d.env.PMTILES_SHA256 = d.env.PMTILES_SHA256.slice(0, 40))),
    ],
    ['rclone at "latest"', doc((d) => (d.env.RCLONE_VERSION = 'latest'))],
    [
      'the dry run dropped',
      doc((d, steps) => steps.splice(steps.indexOf(stepOf(steps, '--dry-run')), 1)),
    ],
    [
      'the dry run not judged',
      doc((d, steps) => {
        const s = stepOf(steps, '--dry-run');
        s.run = s.run.replace(/\nnode .* fits .*\n?/, '\n');
      }),
    ],
    [
      'the dry run judged against another disk',
      doc((d, steps) => {
        const s = stepOf(steps, '--dry-run');
        s.run = s.run.replace('-B1 "$WORK"', '-B1 /');
      }),
    ],
    ['the cut runs in measure mode', doc((d, steps) => delete stepOf(steps, 'ls -l').if)],
    [
      'the upload runs in measure mode',
      doc((d, steps) => (stepOf(steps, 'rclone copyto').if = '${{ always() }}')),
    ],
    [
      'the check moved after the upload',
      doc((d, steps) => {
        const check = steps.splice(steps.indexOf(stepOf(steps, 'check-street-map-archive')), 1)[0];
        steps.splice(steps.indexOf(stepOf(steps, 'rclone copyto')) + 1, 0, check);
      }),
    ],
    [
      'the check dropped',
      doc((d, steps) => steps.splice(steps.indexOf(stepOf(steps, 'check-street-map-archive')), 1)),
    ],
    [
      'the check passes on its exit code alone',
      doc((d, steps) => {
        const s = stepOf(steps, 'check-street-map-archive');
        s.run = s.run.replace(/ \|\| \[ "\$\(tail[^\]]*\]/, '');
      }),
    ],
    [
      'the check passes on the word alone',
      doc((d, steps) => {
        const s = stepOf(steps, 'check-street-map-archive');
        s.run = s.run.replace('[ "$STATUS" -ne 0 ] || ', '');
      }),
    ],
    [
      'a failed check only warns',
      doc((d, steps) => {
        const s = stepOf(steps, 'check-street-map-archive');
        s.run = s.run.replace(/exit 1\s*\nfi\s*$/, 'true\nfi\n');
      }),
    ],
    [
      'the record kept only when everything passed',
      doc(
        (d, steps) => (stepOf(steps, 'actions/upload-artifact').if = "${{ inputs.mode == 'load' }}")
      ),
    ],
    [
      'the upload without --immutable',
      doc((d, steps) => {
        const s = stepOf(steps, 'rclone copyto');
        s.run = s.run.replace(' --immutable', '');
      }),
    ],
    [
      'the upload under a name that is not dated',
      doc((d, steps) => {
        const s = stepOf(steps, 'rclone copyto');
        s.run = s.run.replace('"r2:${BUCKET}/${ARCHIVE_KEY}"', '"r2:${BUCKET}/latest.pmtiles"');
      }),
    ],
    [
      'the upload does not ask for the key first',
      doc((d, steps) => {
        const s = stepOf(steps, 'rclone copyto');
        s.run = s.run.replace(/\nnode .* absent .*\n/, '\n');
      }),
    ],
    [
      'the key asked for only after the cut',
      doc((d, steps) => steps.splice(steps.indexOf(stepOf(steps, 'before-cut.json')), 1)),
    ],
    [
      'the old object deleted to make room',
      doc((d, steps) => {
        const s = stepOf(steps, 'rclone copyto');
        s.run = s.run.replace(
          'rclone copyto',
          'rclone deletefile "r2:${BUCKET}/${ARCHIVE_KEY}"\nrclone copyto'
        );
      }),
    ],
    [
      'the bucket synced instead of one file copied',
      doc((d, steps) => {
        const s = stepOf(steps, 'rclone copyto');
        s.run = s.run.replace(/rclone copyto .*/, 'rclone sync . "r2:${BUCKET}" --immutable');
      }),
    ],
    ['the listed size never compared', doc((d, steps) => steps.pop())],
  ])('fault: %s', (_, fault) => {
    const text = fault(workflow());
    expect(text).not.toBe(doc(() => {})(workflow()));
    expect(shapeProblems(text)).not.toEqual([]);
  });

  test('"production" in a comment is not a fault; in a line the runner reads it is', () => {
    expect(workflow()).toMatch(/^# .*production/m);
    expect(shapeProblems(`${workflow()}\n# production is loaded by a later PR\n`)).toEqual([]);
    expect(
      shapeProblems(
        workflow().replace('BUCKET: ose-map-tiles-staging', 'BUCKET: ose-map-tiles-prod')
      )
    ).toContain('a line that is not a comment names production');
  });
});

// ─── 3. Drift: wrangler.toml, the workflow and the runbook ───────────────────

/**
 * The command lines the workflow runs, as the runner sees them: env names
 * filled in, quotes and the checkout path taken off, and what follows the
 * command (a pipe, a redirect) cut away. Whole lines, so a command is never
 * found inside a longer one: the cut is the dry run without its last flag.
 */
function ranCommands(workflowText) {
  const doc = yaml.load(workflowText) ?? {};
  const env = doc.env ?? {};
  return Object.values(doc.jobs ?? {})
    .flatMap((job) => job.steps ?? [])
    .flatMap((step) => run(step).split('\n'))
    .map((line) => {
      let text = line.trim();
      for (const [name, value] of Object.entries(env)) {
        text = text.split(`\${${name}}`).join(String(value));
      }
      text = text.split('${GITHUB_WORKSPACE}/').join('').split('"').join('');
      return text.split(/ (?:2>&1|\||>) /)[0].trim();
    })
    .filter(Boolean);
}

/** The commands the runbook must show, each one, exactly: every one that cuts, checks, reads or writes the bucket. */
const mustBeShown = (command) =>
  (/^(?:\.\/|npx )?(?:wrangler|pmtiles|rclone)\b/.test(command) ||
    command.includes('check-street-map-archive.mjs')) &&
  !/^\.\/(?:pmtiles|rclone) version$/.test(command);

/** The command lines the runbook shows, from its ```bash blocks. */
const shown = (runbookText) =>
  [...runbookText.matchAll(/^ *```bash\n([\s\S]*?)^ *```$/gm)].flatMap((m) =>
    m[1]
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  );

const KINDS = {
  'the r2.dev read': /^npx wrangler r2 bucket dev-url get \S+$/,
  'the custom-domain read': /^npx wrangler r2 bucket domain list \S+$/,
  'the dry run': /^pmtiles extract \S+ \S+ --region=\S+ --dry-run$/,
  'the bucket listing': /^rclone lsjson r2:\S+ /,
  'the cut': /^pmtiles extract \S+ \S+ --region=\S+$/,
  'the check': /^node workers\/oursharedevents\/scripts\/check-street-map-archive\.mjs \S+$/,
  'the upload': /^rclone copyto \S+ r2:\S+ /,
};

/** What does not agree between the three files, as sentences. Pure: takes their text. */
function driftProblems(workflowText, tomlText, runbookText) {
  const out = [];
  const env = yaml.load(workflowText)?.env ?? {};
  out.push(
    ...load.nameProblems(
      { build: env.PROTOMAPS_BUILD, key: env.ARCHIVE_KEY, bucket: env.BUCKET },
      tomlText
    )
  );
  // Every command the runbook shows is one the workflow runs: it shows none for a person.
  const ran = ranCommands(workflowText);
  const lines = shown(runbookText);
  for (const line of lines) {
    if (!ran.includes(line)) {
      out.push(`the runbook shows a command the workflow does not run: ${line}`);
    }
  }
  // And the other way: the workflow cuts, checks, reads and writes with no command the runbook leaves out.
  for (const command of new Set(ran.filter(mustBeShown))) {
    if (!lines.includes(command)) {
      out.push(`the workflow runs a command the runbook does not show: ${command}`);
    }
  }
  for (const [kind, shape] of Object.entries(KINDS)) {
    if (!lines.some((l) => shape.test(l))) out.push(`the runbook does not show ${kind}`);
  }
  // Read as one line: the runbook's sentences wrap.
  const oneLine = runbookText.replace(/\s+/g, ' ');
  for (const [what, value] of [
    ['the go-pmtiles version', `go-pmtiles **v${env.PMTILES_VERSION}**`],
    ['the go-pmtiles file', `go-pmtiles_${env.PMTILES_VERSION}_Linux_x86_64.tar.gz`],
    ['the go-pmtiles SHA-256', env.PMTILES_SHA256],
    ['the rclone version', `rclone **v${env.RCLONE_VERSION}**`],
    ['the rclone file', `rclone-v${env.RCLONE_VERSION}-linux-amd64.zip`],
    ['the rclone SHA-256', env.RCLONE_SHA256],
    ['the workflow file', WORKFLOW],
    ['the first secret', '`R2_MAP_TILES_ACCESS_KEY_ID`'],
    ['the second secret', '`R2_MAP_TILES_SECRET_KEY`'],
    ['the artifact', '`street-map-archive-check-record`'],
    ['the answer that means no public URL', `"${load.DEV_URL_OFF}"`],
    ['the answer that means no custom domain', `"${load.NO_DOMAINS}"`],
    ['the region file', `--region=${env.REGION_FILE}`],
  ]) {
    if (!value || !oneLine.includes(value)) {
      out.push(`the runbook does not name ${what} the workflow uses`);
    }
  }
  for (const secret of BUCKET_SECRETS) {
    if (!workflowText.includes(`secrets.${secret} }}`)) {
      out.push(`the workflow does not read ${secret}`);
    }
  }
  if (!workflowText.includes('name: street-map-archive-check-record')) {
    out.push('the workflow keeps the record under another artifact name');
  }
  if (!fs.existsSync(path.join(ROOT, String(env.REGION_FILE)))) {
    out.push(`the region file "${env.REGION_FILE}" is not in this repo`);
  }
  return out;
}

// @born-red street-map archive load, drift | method: each rule is fed the slip that turns it red, in the cases below; "the real files agree" seen failing with the faults named in its own comment injected into the real files | date: 2026-11-14
describe('the names typed three times are one set of names', () => {
  // Seen red on the real files, 2026-11-14, one fault at a time: ARCHIVE_KEY in
  // the workflow changed to us-20261019.pmtiles; MAP_TILES_ARCHIVE in the staging
  // block of wrangler.toml changed to us-20261110.pmtiles; a ```bash block with
  // `rclone delete r2:ose-map-tiles-staging/us-20261109.pmtiles` added to the
  // runbook; PMTILES_SHA256 in the workflow changed by one character;
  // `--download-threads=16` added to the cut and not to the dry run (the cut is
  // the dry run without its last flag, so commands are compared as whole lines).
  test('the real files agree', () => {
    expect(driftProblems(workflow(), toml(), runbook())).toEqual([]);
  });

  test('the runbook shows commands, and each is one the workflow runs', () => {
    expect(shown(runbook()).length).toBeGreaterThanOrEqual(Object.keys(KINDS).length);
    expect(shown('```bash\nls\n```\n')).toEqual(['ls']);
    expect(shown('1. Step\n\n   ```bash\n   ls -l\n   ```\n')).toEqual(['ls -l']);
  });

  test.each([
    [
      'the key with two digits swapped',
      'ARCHIVE_KEY: us-20261109.pmtiles',
      'ARCHIVE_KEY: us-20261019.pmtiles',
    ],
    [
      'the key of the build after',
      'ARCHIVE_KEY: us-20261109.pmtiles',
      'ARCHIVE_KEY: us-20261110.pmtiles',
    ],
    ['the build moved, the key left', "PROTOMAPS_BUILD: '20261109'", "PROTOMAPS_BUILD: '20261110'"],
    ['the uploads bucket', 'BUCKET: ose-map-tiles-staging', 'BUCKET: ose-uploads-staging'],
    ['the dev bucket', 'BUCKET: ose-map-tiles-staging', 'BUCKET: ose-map-tiles-dev'],
    [
      'another region file',
      'REGION_FILE: docs/runbooks/street-map-us-region.geojson',
      'REGION_FILE: docs/runbooks/street-map-region.geojson',
    ],
    ['another go-pmtiles release', "PMTILES_VERSION: '1.31.2'", "PMTILES_VERSION: '1.31.3'"],
    ['one character of the go-pmtiles digest', 'PMTILES_SHA256: 3ed7', 'PMTILES_SHA256: 3ed8'],
    ['another rclone release', "RCLONE_VERSION: '1.76.0'", "RCLONE_VERSION: '1.77.0'"],
    ['one character of the rclone digest', 'RCLONE_SHA256: b00f', 'RCLONE_SHA256: b00e'],
    [
      'the cut from a build typed in the command',
      '"https://build.protomaps.com/${PROTOMAPS_BUILD}.pmtiles" "${ARCHIVE_KEY}" --region="${GITHUB_WORKSPACE}/${REGION_FILE}"\n',
      '"https://build.protomaps.com/20261110.pmtiles" "${ARCHIVE_KEY}" --region="${GITHUB_WORKSPACE}/${REGION_FILE}"\n',
    ],
    [
      'the cut with a box in place of the region file',
      '--region="${GITHUB_WORKSPACE}/${REGION_FILE}"\n',
      '--bbox=-125.1,24.3,-66.8,49.5\n',
    ],
    [
      'the cut with more download threads than the runbook shows',
      '--region="${GITHUB_WORKSPACE}/${REGION_FILE}"\n',
      '--region="${GITHUB_WORKSPACE}/${REGION_FILE}" --download-threads=16\n',
    ],
    [
      'the check run on the whole build',
      'check-street-map-archive.mjs" "${ARCHIVE_KEY}"',
      'check-street-map-archive.mjs" "${PROTOMAPS_BUILD}.pmtiles"',
    ],
    ['the upload with another part size', '--s3-chunk-size=256M', '--s3-chunk-size=5M'],
    ['the upload without --immutable', ' --immutable', ''],
    [
      'the listing of another bucket',
      'rclone lsjson "r2:${BUCKET}" --files-only --max-depth 1 > "$RUNNER_TEMP/before-cut.json"',
      'rclone lsjson "r2:ose-uploads-staging" --files-only --max-depth 1 > "$RUNNER_TEMP/before-cut.json"',
    ],
    ['a secret under another name', 'secrets.R2_MAP_TILES_SECRET_KEY }}', 'secrets.R2_SECRET }}'],
    [
      'the record kept under another name',
      'name: street-map-archive-check-record',
      'name: check-record',
    ],
  ])('fat finger in the workflow: %s', (_, from, to) => {
    const text = workflow().split(from).join(to);
    expect(text).not.toBe(workflow());
    expect(driftProblems(text, toml(), runbook())).not.toEqual([]);
  });

  test.each([
    [
      'the archive name on staging',
      /^(\[env\.staging\][\s\S]*?MAP_TILES_ARCHIVE = ")us-20261109(\.pmtiles")/m,
      '$1us-20261110$2',
    ],
    [
      'the staging bucket',
      'binding = "MAP_TILES"\nbucket_name = "ose-map-tiles-staging"',
      'binding = "MAP_TILES"\nbucket_name = "ose-map-tiles-stg"',
    ],
    [
      'the archive name on production only',
      /(MAP_TILES_ARCHIVE = ")us-20261109(\.pmtiles"(?![\s\S]*MAP_TILES_ARCHIVE = ))/,
      '$1us-20261110$2',
    ],
  ])('fat finger in wrangler.toml: %s', (_, from, to) => {
    const text = toml().replace(from, to);
    expect(text).not.toBe(toml());
    expect(driftProblems(workflow(), text, runbook())).not.toEqual([]);
  });

  test.each([
    [
      'a command for a person: delete the object',
      '## Staging, in order',
      '```bash\nrclone delete r2:ose-map-tiles-staging/us-20261109.pmtiles\n```\n\n## Staging, in order',
    ],
    [
      'a command for a person: cut it on your machine',
      '## Staging, in order',
      '```bash\npmtiles extract https://build.protomaps.com/20261109.pmtiles us.pmtiles --bbox=-125,24,-66,49\n```\n\n## Staging, in order',
    ],
    [
      'a command for a person: make the bucket public',
      '## Staging, in order',
      '```bash\nnpx wrangler r2 bucket dev-url enable ose-map-tiles-staging\n```\n\n## Staging, in order',
    ],
    [
      'a command for a person: dispatch from a terminal',
      '## Staging, in order',
      '```bash\ngh workflow run "Street-map archive load (stg)" -f confirm=STAGING -f mode=load\n```\n\n## Staging, in order',
    ],
    [
      'the upload shown with the old flags',
      '--immutable --s3-chunk-size=256M --stats=1m --stats-one-line -v',
      '--progress --s3-chunk-size=256M',
    ],
    [
      'the upload shown to another key',
      'r2:ose-map-tiles-staging/us-20261109.pmtiles --immutable',
      'r2:ose-map-tiles-staging/us-20261019.pmtiles --immutable',
    ],
    [
      'the check shown on another file',
      'check-street-map-archive.mjs us-20261109.pmtiles',
      'check-street-map-archive.mjs us-20261019.pmtiles',
    ],
    ['the dry run not shown', /^ *```bash\n *pmtiles extract .* --dry-run\n *```\n/m, ''],
    ['the bucket listing not shown', /^ *```bash\n *rclone lsjson .*\n *```\n/m, ''],
    [
      'the privacy read shown on another bucket',
      'dev-url get ose-map-tiles-staging',
      'dev-url get ose-uploads-staging',
    ],
    [
      'an older go-pmtiles digest',
      // By its place in the table, so the digest is typed in the workflow and the runbook only.
      /(Linux_x86_64\.tar\.gz` +\| `)[0-9a-f]{64}/,
      `$1${'0'.repeat(64)}`,
    ],
    ['an older rclone named', 'rclone **v1.76.0**', 'rclone **v1.59.0**'],
    ['a secret under another name', '`R2_MAP_TILES_SECRET_KEY`', '`R2_SECRET_ACCESS_KEY`'],
    [
      'the answer wrangler gives, misquoted',
      '"Public access via the r2.dev URL is disabled."',
      '"Public access is disabled."',
    ],
    [
      'the workflow file under another name',
      '.github/workflows/street-map-archive-load.yml',
      '.github/workflows/street-map-load.yml',
    ],
  ])('fat finger in the runbook: %s', (_, from, to) => {
    const text =
      typeof from === 'string' ? runbook().split(from).join(to) : runbook().replace(from, to);
    expect(text).not.toBe(runbook());
    expect(driftProblems(workflow(), toml(), text)).not.toEqual([]);
  });

  test('the script reads the wrangler.toml the parity check reads', async () => {
    const parity = await import('../../../scripts/ci/env-parity.mjs');
    expect(load.WRANGLER_PATH).toBe(parity.WRANGLER_PATH);
    expect(load.boundNames(toml())).toEqual({
      bucket: 'ose-map-tiles-staging',
      key: 'us-20261109.pmtiles',
      productionKey: 'us-20261109.pmtiles',
    });
  });
});
