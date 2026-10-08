/**
 * INVARIANT 29: Declined Regulatory Regimes
 *
 * HIPAA, COPPA and SOPPA are declined, not gated
 * (`OCR_STANDARD_declinedRegimes.md`, ratified 2026-09-04, SOPPA 2026-09-10).
 * There is no pool, dataset, consent model or roadmap rung for any of them,
 * and no configuration can switch one on. On the anonymous plane (OSE) this
 * holds by item-tracking: what is counted is the event, never the person.
 *
 * Brain Invariant #29 (declined_regulatory_regimes):
 *   - brain canonical: OCR-docs/ocr-docs-brain/architectural-invariants.yaml
 *   - lives_in: ose, wkrp. One `test_file` name serves both repos, which is
 *     why this gate is `.invariant.test.ts` and not `.invariant.spec.ts`.
 *     ourWKRP's twin is `tests/security/declined-regimes.invariant.test.ts`.
 *
 * A meta-gate, in the pattern of `deprecation-lock`: the scanning is done by
 * `scripts/guard-declined-regimes.js` (OSE-1220). This gate locks the things
 * that make the decline real, so none of them can go quietly:
 *   1. the standard is vendored into this repo;
 *   2. the guard and its self-tests exist, are npm scripts, and run in the
 *      T0 lint shard, self-tests first;
 *   3. the guard still fails on a planted ALLOWED_MAX_TIER=4 and a planted
 *      tier-5 event type (it is run here against a temp worker dir);
 *   4. the code-level refusals stand: `phaseToPool` throws for tiers 4 and 5,
 *      `resolveAllowedMaxTier` clamps to 3, the pool list is `general` only,
 *      and no dataset is named for a declined regime;
 *   5. the worker tests that prove (4) exist and are not skipped;
 *   6. no migration, in either database, adds a column a declined regime
 *      would need (age, birth date, parental consent, student, school,
 *      grade, patient, diagnosis, medical). FORMS_DB holds a registrant's
 *      contact details, so an innocent "age" there would hold COPPA data.
 */

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const WORKER = join(REPO_ROOT, 'workers', 'oursharedevents');
const GUARD = join(REPO_ROOT, 'scripts', 'guard-declined-regimes.js');
const GUARD_TESTS = join(REPO_ROOT, 'scripts', 'guard-declined-regimes.test.js');
const STANDARD = join(REPO_ROOT, '.ocr-standards', 'standards', 'OCR_STANDARD_declinedRegimes.md');
const read = (p: string) => readFileSync(p, 'utf-8');

test.describe('Invariant 29: Declined regulatory regimes (HIPAA, COPPA, SOPPA)', () => {
  test('OSE-INV29 | governance | the declined-regimes standard is vendored and names all three', () => {
    expect(
      existsSync(STANDARD),
      '.ocr-standards/standards/OCR_STANDARD_declinedRegimes.md must exist'
    ).toBe(true);
    const text = read(STANDARD);
    for (const regime of ['HIPAA', 'COPPA', 'SOPPA']) expect(text).toContain(regime);
  });

  test('OSE-INV29 | security | guard | the guard and its self-tests exist and are npm scripts', () => {
    expect(existsSync(GUARD), 'scripts/guard-declined-regimes.js must exist').toBe(true);
    expect(existsSync(GUARD_TESTS), 'scripts/guard-declined-regimes.test.js must exist').toBe(true);
    const scripts = JSON.parse(read(join(REPO_ROOT, 'package.json'))).scripts ?? {};
    expect(scripts['guard:declined-regimes']).toBe('node scripts/guard-declined-regimes.js');
    expect(scripts['test:guard-declined-regimes']).toBe(
      'node scripts/guard-declined-regimes.test.js'
    );
  });

  test('OSE-INV29 | security | CI | the T0 lint shard runs the self-tests, then the guard', () => {
    const wf = yaml.load(
      read(join(REPO_ROOT, '.github', 'workflows', 'oursharedevents-ci.yml'))
    ) as {
      jobs: Record<
        string,
        {
          strategy?: { matrix?: { shard?: string[] } };
          steps?: Array<{ if?: string; run?: string }>;
        }
      >;
    };
    const gate = wf.jobs.gate;
    expect(gate?.strategy?.matrix?.shard ?? []).toContain('lint');
    const steps = gate?.steps ?? [];
    const at = (cmd: string) =>
      steps.findIndex(
        (s) =>
          typeof s?.run === 'string' &&
          s.run.trim() === cmd &&
          /shard\s*==\s*'lint'/.test(s.if ?? '')
      );
    const selfTests = at('npm run test:guard-declined-regimes');
    const guard = at('npm run guard:declined-regimes');
    expect(selfTests, 'the self-tests must run in the gate job, lint shard').toBeGreaterThanOrEqual(
      0
    );
    expect(guard, 'the guard must run in the gate job, lint shard').toBeGreaterThanOrEqual(0);
    expect(selfTests, 'self-tests run first, so a broken guard cannot pass as clean').toBeLessThan(
      guard
    );
  });

  test('OSE-INV29 | security | guard | still fails on a planted tier above 3, passes on a clean worker', () => {
    const dir = mkdtempSync(join(tmpdir(), 'declined-regimes-'));
    const runGuard = () =>
      spawnSync(process.execPath, [GUARD, '--worker', dir], { encoding: 'utf-8' });
    try {
      mkdirSync(join(dir, 'migrations'));
      writeFileSync(join(dir, 'wrangler.toml'), 'ALLOWED_MAX_TIER = "3"\n');
      expect(runGuard().status, 'a clean worker must pass').toBe(0);

      writeFileSync(join(dir, 'wrangler.toml'), 'ALLOWED_MAX_TIER = "4"\n');
      expect(runGuard().status, 'ALLOWED_MAX_TIER=4 must fail the guard').toBe(1);

      writeFileSync(join(dir, 'wrangler.toml'), 'ALLOWED_MAX_TIER = "3"\n');
      writeFileSync(
        join(dir, 'migrations', '0001_seed.sql'),
        "INSERT INTO event_type_registry (event_type, legal_clearance_tier) VALUES ('youth-camp', 5);\n"
      );
      expect(runGuard().status, 'a seeded tier-5 event type must fail the guard').toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('OSE-INV29 | security | code | phaseToPool refuses tiers 4 and 5; the pool list is general only', () => {
    const src = read(join(WORKER, 'src', 'lib', 'pool-contract.ts'));
    expect(src).toMatch(/export const REGULATORY_POOLS = \['general'\] as const;/);
    expect(src).toMatch(/export const DECLINED_REGIMES = \['hipaa', 'coppa', 'soppa'\] as const;/);
    const body = /export function phaseToPool[\s\S]*?\n\}/.exec(src)?.[0] ?? '';
    expect(body, 'phaseToPool must exist').not.toBe('');
    expect(body).toMatch(/phase > 3\)\s*\{\s*throw new PoolRoutingError\(phase\);/);
    const datasets = /export const BIGQUERY_DATASETS[\s\S]*?\}(?: as const)?;/.exec(src)?.[0] ?? '';
    expect(datasets, 'BIGQUERY_DATASETS must exist').not.toBe('');
    expect(datasets, 'no dataset may be named for a declined regime').not.toMatch(
      /hipaa|coppa|soppa/i
    );
  });

  test('OSE-INV29 | security | code | resolveAllowedMaxTier clamps to 3', () => {
    const src = read(join(WORKER, 'src', 'lib', 'template-clearance.ts'));
    expect(src).toMatch(/export const DECLINED_REGIME_MAX_TIER = 3;/);
    const body = /export function resolveAllowedMaxTier[\s\S]*?\n\}/.exec(src)?.[0] ?? '';
    expect(body).toMatch(/return Math\.min\(resolved, DECLINED_REGIME_MAX_TIER\);/);
  });

  test('OSE-INV29 | quality | tests | the worker tests proving both refusals exist and are not skipped', () => {
    const anchors: Array<[string, RegExp[]]> = [
      [
        'shared-report-bigquery-export.spec.ts',
        [
          /expect\(\(\) => phaseToPool\(4\)\)\.toThrow\(PoolRoutingError\)/,
          /expect\(\(\) => phaseToPool\(5\)\)\.toThrow\(PoolRoutingError\)/,
        ],
      ],
      [
        'template-clearance-gate.spec.ts',
        [/OSE-1220: resolveAllowedMaxTier clamps to the declined-regime ceiling/],
      ],
    ];
    for (const [file, patterns] of anchors) {
      const text = read(join(WORKER, 'tests', file));
      for (const p of patterns) expect(text, `${file} must keep ${p}`).toMatch(p);
      expect(text, `${file} must not skip or narrow its tests`).not.toMatch(
        /\b(?:test|it|describe)\.(?:skip|only|fixme)\b/
      );
    }
  });

  test('OSE-INV29 | privacy | schema | no migration adds a column a declined regime would need', () => {
    const DECLINED_COLUMN =
      /\b(birth\w*|dob|date_of_birth|age|age_\w+|\w+_age|parent(?:al)?_consent\w*|guardian\w*|student\w*|school\w*|grade|grade_level|patient\w*|diagnos\w*|medical\w*)\s+(?:TEXT|INTEGER|INT|REAL|BLOB|NUMERIC|BOOLEAN|DATE)\b/gi;
    // Negative control: the pattern sees the fields it exists to refuse.
    for (const planted of [
      'birth_year INTEGER',
      'school_name TEXT',
      'parental_consent BOOLEAN',
      'diagnosis TEXT',
    ]) {
      expect(planted.match(DECLINED_COLUMN), planted).not.toBeNull();
    }
    expect('stage INTEGER'.match(DECLINED_COLUMN)).toBeNull();

    const hits: string[] = [];
    let scanned = 0;
    for (const dirName of ['migrations', 'migrations-forms']) {
      const dir = join(WORKER, dirName);
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql'))) {
        scanned++;
        for (const m of read(join(dir, f)).matchAll(DECLINED_COLUMN))
          hits.push(`${dirName}/${f}: ${m[0]}`);
      }
    }
    expect(scanned, 'both migration directories must be read').toBeGreaterThan(100);
    expect(hits).toEqual([]);
  });
});
