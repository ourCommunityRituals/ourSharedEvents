/**
 * How .github/workflows/hub-read-token-check.yml is wired (OSE-1695).
 *
 * The job holds OCR_HUB_READ, so the wiring is the security: it must never run on a pull request,
 * must demand a successful read as well as refused writes, and must probe the hub, not this repo.
 * The probe script itself is attacked in tests/integration/read-token-cannot-write.test.js.
 */
const { readFileSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..', '..');
const doc = yaml.load(
  readFileSync(join(ROOT, '.github', 'workflows', 'hub-read-token-check.yml'), 'utf8')
);
const job = doc.jobs.probe;
const probeStep = job.steps.find(
  (s) => typeof s.run === 'string' && s.run.includes('assert-token-read-only.sh')
);

describe('hub-read-token-check.yml', () => {
  test('it never runs on a pull request or any pull-request-like trigger', () => {
    const triggers = Object.keys(doc.on ?? doc[true]);
    for (const bad of [
      'pull_request',
      'pull_request_target',
      'workflow_run',
      'issue_comment',
      'issues',
    ]) {
      expect(triggers).not.toContain(bad);
    }
  });

  test('it runs weekly, by hand, and on a main push that changes the probe', () => {
    const on = doc.on ?? doc[true];
    expect(on.schedule).toHaveLength(1);
    expect(on).toHaveProperty('workflow_dispatch');
    expect(on.push.branches).toEqual(['main']);
    expect(on.push.paths.sort()).toEqual([
      '.github/workflows/hub-read-token-check.yml',
      'scripts/ci/assert-token-read-only.sh',
    ]);
  });

  test('it has read-only permissions and does not keep a git credential', () => {
    expect(doc.permissions).toEqual({ contents: 'read' });
    const checkout = job.steps.find((s) => String(s.uses ?? '').startsWith('actions/checkout'));
    expect(checkout.with['persist-credentials']).toBe(false);
  });

  test('it hands the real token only to the probe step, as GH_TOKEN', () => {
    expect(probeStep).toBeDefined();
    expect(probeStep.env.GH_TOKEN).toBe('${{ secrets.OCR_HUB_READ }}');
    const others = job.steps.filter((s) => s !== probeStep);
    expect(JSON.stringify(others)).not.toContain('secrets.');
  });

  test('it demands a successful read, and probes the hub rather than this repository', () => {
    expect(probeStep.env.PROBE_REQUIRE_READ).toBe('1');
    expect(probeStep.env.PROBE_REPOSITORY).toBe('ourCommunityRituals/ourCommunityRituals');
    expect(probeStep.env.PROBE_ISSUE).toMatch(/^[0-9]+$/);
  });

  test('the script it runs exists and is the one the probe tests cover', () => {
    expect(probeStep.run.trim()).toBe('bash scripts/ci/assert-token-read-only.sh');
    expect(
      readFileSync(join(ROOT, 'scripts', 'ci', 'assert-token-read-only.sh'), 'utf8')
    ).toContain('PROBE_REQUIRE_READ');
  });
});
