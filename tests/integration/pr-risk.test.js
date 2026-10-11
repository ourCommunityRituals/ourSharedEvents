/**
 * PR risk classifier (scripts/ci/pr-risk.mjs): fixed path rules decide which
 * reviewer a PR gets. Each sensitive area is named here with a real path, so a
 * rule that stops matching (renamed file, edited pattern) turns this red.
 */

const { spawnSync } = require('child_process');
const { mkdtempSync, writeFileSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'ci', 'pr-risk.mjs');

function classify(files) {
  const list = join(mkdtempSync(join(tmpdir(), 'pr-risk-')), 'files.txt');
  writeFileSync(list, files.join('\n'));
  const r = spawnSync(process.execPath, [SCRIPT, '--files', list], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}

const SRC = 'workers/oursharedevents/src';

describe('pr-risk: every sensitive area is high', () => {
  test.each([
    ['database migration', 'workers/oursharedevents/migrations/0095_x.sql'],
    ['forms migration', 'workers/oursharedevents/migrations-forms/0017_x.sql'],
    ['admin auth', `${SRC}/auth/admin.ts`],
    ['PII', `${SRC}/lib/pii.ts`],
    ['forms DB', `${SRC}/lib/forms-db.ts`],
    ['per-event keyed id', `${SRC}/lib/event-anon-key.ts`],
    ['anonymous id', `${SRC}/lib/anonymous-id.ts`],
    ['IP masking', `${SRC}/lib/ip-mask.ts`],
    ['under-5 floor', `${SRC}/lib/count-floor.ts`],
    ['BigQuery pool contract', `${SRC}/lib/pool-contract.ts`],
    ['admin write guard', `${SRC}/lib/admin-write-guard.ts`],
    ['CORS', `${SRC}/lib/cors.ts`],
    ['rate limits', `${SRC}/lib/rate-limit.ts`],
    ['public read limit', `${SRC}/lib/public-read-limit.ts`],
    ['public projection', `${SRC}/lib/public-event-projection.ts`],
    ['audit log', `${SRC}/lib/audit-log.ts`],
    ['sponsor consent', `${SRC}/lib/sponsor-card.ts`],
    ['sponsor signed link', `${SRC}/lib/sponsor-home-auth.ts`],
    ['route table', `${SRC}/router.ts`],
    ['wrangler.toml', 'workers/oursharedevents/wrangler.toml'],
    ['a workflow', '.github/workflows/oursharedevents-ci.yml'],
    ['CODEOWNERS', '.github/CODEOWNERS'],
    ['a CI gate script', 'scripts/ci/ci-integrity-ratchets.mjs'],
    ['an architecture invariant', 'tests/e2e/0-architecture/runtime-llm-free.invariant.spec.ts'],
    ['AGENTS.md', 'AGENTS.md'],
    ['CLAUDE.md', 'CLAUDE.md'],
    ['a skill', '.claude/skills/ccr/SKILL.md'],
    ['an agent', '.claude/agents/dr-of-security.md'],
    ['the policy hook', '.claude/hooks/policy-gate.mjs'],
    ['root dependencies', 'package-lock.json'],
    ['worker dependencies', 'workers/oursharedevents/package.json'],
    ['the hub pin', '.ocr-hub-ref'],
  ])('%s', (_name, file) => {
    const r = classify([file]);
    expect(r.risk).toBe('high');
    expect(r.reviewer.model).toBe('claude-opus-5-5');
  });

  test('every sensitive path named above exists in the repo (a renamed file would stop matching)', () => {
    const { existsSync } = require('fs');
    const ROOT = join(__dirname, '..', '..');
    for (const p of [
      `${SRC}/auth/admin.ts`,
      `${SRC}/lib/pii.ts`,
      `${SRC}/lib/forms-db.ts`,
      `${SRC}/lib/event-anon-key.ts`,
      `${SRC}/lib/anonymous-id.ts`,
      `${SRC}/lib/ip-mask.ts`,
      `${SRC}/lib/count-floor.ts`,
      `${SRC}/lib/pool-contract.ts`,
      `${SRC}/lib/admin-write-guard.ts`,
      `${SRC}/lib/cors.ts`,
      `${SRC}/lib/rate-limit.ts`,
      `${SRC}/lib/public-read-limit.ts`,
      `${SRC}/lib/public-event-projection.ts`,
      `${SRC}/lib/audit-log.ts`,
      `${SRC}/lib/sponsor-card.ts`,
      `${SRC}/lib/sponsor-home-auth.ts`,
      `${SRC}/router.ts`,
      'workers/oursharedevents/wrangler.toml',
      '.github/CODEOWNERS',
      '.ocr-hub-ref',
    ]) {
      expect(existsSync(join(ROOT, p)), p).toBe(true);
    }
  });
});

describe('pr-risk: low and normal', () => {
  test('docs and working notes only is low (Haiku summary)', () => {
    const r = classify([
      'docs/runbooks/RUNBOOK-DEPLOYMENT.md',
      '.claude/outputs/CCR-X.md',
      'README.md',
    ]);
    expect(r.risk).toBe('low');
    expect(r.reviewer.model).toBe('claude-haiku-5-5');
  });

  test('an ADR is normal, not low', () => {
    expect(classify(['docs/adr/ADR-030-x.md']).risk).toBe('normal');
  });

  test('ordinary application code and tests are normal (Sonnet)', () => {
    const r = classify([
      `${SRC}/handlers/events.ts`,
      'workers/oursharedevents/tests/events.spec.ts',
    ]);
    expect(r.risk).toBe('normal');
    expect(r.reviewer.model).toBe('claude-sonnet-5-5');
  });

  test('one sensitive file makes the whole PR high', () => {
    expect(
      classify(['docs/x.md', `${SRC}/handlers/events.ts`, `${SRC}/lib/count-floor.ts`]).risk
    ).toBe('high');
  });

  test('a governance file is not mistaken for root documentation', () => {
    expect(classify(['AGENTS.md']).risk).toBe('high');
    expect(classify(['STORIES.md']).risk).toBe('high');
  });

  test('an empty change list is normal, never low', () => {
    expect(classify([]).risk).toBe('normal');
  });

  test('every file carries a reason', () => {
    const r = classify(['docs/x.md', `${SRC}/lib/pii.ts`, `${SRC}/handlers/events.ts`]);
    expect(r.reasons).toHaveLength(3);
    for (const x of r.reasons) expect(x.why.length).toBeGreaterThan(5);
  });
});
