/**
 * Who is a bot, and whose approval counts, in the Security Human Gate
 * (.github/workflows/security-human-gate.yml, scripts/ci/pr-actor-kind.mjs).
 *
 * Why (agent identity, a GitHub App): agent PRs will be authored by the App
 * (`ocr-agent[bot]`), and the team will grow. The gate used to decide "bot" by
 * matching the letters bot / claude / github-actions anywhere in a login, on
 * `gh pr view --json` output:
 *   - a person whose login holds "bot" or "claude" (say `abbott`) was treated as a
 *     bot: their approval was thrown away and their PRs needed a second person;
 *   - `gh pr view --json` reads GraphQL, where an App's login has no `[bot]`
 *     suffix (inferred: GraphQL `Bot.login` is the bare slug), so an App named
 *     `ocr-agent` would have been read as a PERSON, and its PR could pass the
 *     override with a label and no human approval.
 * Now the gate reads the REST API, where every account carries `type`
 * ("Bot" or "User") and a bot login ends in `[bot]`, and decides on that. An
 * approval counts only from a person with a write-level association
 * (OWNER, MEMBER, COLLABORATOR) whose latest decision is still APPROVED.
 *
 * BORN RED (2026-11-18). Each fault was put in, this file run, the named tests
 * seen failing, and the fault taken out:
 *   P1  script missing, workflow as main has it
 *         -> every test below
 *   P2  isBotUser() back to the old letters rule (/bot|claude|github-actions/i on the login)
 *         -> "a person whose login contains bot or claude is a person",
 *            "an App author is a bot by account type" (the old rule reads `ocr-agent` as a
 *            person), "a bot approval does not count", both "author-is-bot" and
 *            "human-approvals" CLI cases
 *   P3  `type` ignored (login suffix only)
 *         -> "an App author is a bot by account type", "a bot approval does not count",
 *            "human-approvals reads one review per line"
 *   P4  association not checked
 *         -> "an approval from an account without write association does not count"
 *   P5  every APPROVED review counted (no latest-decision rule)
 *         -> "an approval later replaced by changes requested does not count",
 *            "one person approving twice counts once"
 *   P6  unreadable input reads as "no bot, zero approvals" (catch returns defaults)
 *         -> "the CLI fails closed on input it cannot read"
 *
 * BORN RED (2026-11-18, Dr of Security review of this change). Found: the old label
 * check `grep -c … || echo "0"` gives "0\n0" when no label matches, `[ … -eq 0 ]` then
 * errors, the `if` reads false, and the gate PASSED WITHOUT A LABEL (reproduced under
 * bash -eo pipefail). Same method as above:
 *   P7  the workflow as main has it (seen on that workflow)
 *         -> "the label check is decided by the classifier, with no grep-count fallback",
 *            and the three other "the gate uses the classifier" tests
 *   P8  hasLabel() matches a substring ("security:human-override-requested" counts)
 *         -> "a label must match exactly"
 *   P9  labelAppliedByHuman() ignores the actor (any `labeled` event counts)
 *         -> "a label put on by a bot does not count",
 *            "a label taken off and put back by a bot does not count"
 *   P10 labelAppliedByHuman() ignores a later `unlabeled`
 *         -> "a label taken off and put back by a bot does not count"
 *   P11 humanApprovals() ignores the head commit (commit_id not compared)
 *         -> "an approval of an older commit does not count"
 */

const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'ci', 'pr-actor-kind.mjs');

let kind;
beforeAll(async () => {
  kind = await import('../../../scripts/ci/pr-actor-kind.mjs');
});

const user = (login, type = 'User') => ({ login, type });
const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const review = (
  login,
  state,
  assoc = 'MEMBER',
  type = 'User',
  at = '2026-11-18T00:00:00Z',
  commit = HEAD
) => ({
  user: user(login, type),
  state,
  author_association: assoc,
  submitted_at: at,
  commit_id: commit,
});
const labeled = (name, login, type = 'User', event = 'labeled', at = '2026-11-18T00:00:00Z') => ({
  event,
  label: { name },
  actor: user(login, type),
  created_at: at,
});
const LABEL = 'security:human-override';

describe('isBotUser(): decided by account type, not by letters in a name', () => {
  test('an App author is a bot by account type', () => {
    expect(kind.isBotUser(user('ocr-agent', 'Bot'))).toBe(true);
  });
  test('a login ending in [bot] is a bot', () => {
    expect(kind.isBotUser({ login: 'ocr-agent[bot]' })).toBe(true);
    expect(kind.isBotUser(user('dependabot[bot]', 'Bot'))).toBe(true);
    expect(kind.isBotUser(user('github-actions[bot]', 'Bot'))).toBe(true);
  });
  test('a person whose login contains bot or claude is a person', () => {
    expect(kind.isBotUser(user('abbott'))).toBe(false);
    expect(kind.isBotUser(user('robotics-jane'))).toBe(false);
    expect(kind.isBotUser(user('claude-smith'))).toBe(false);
  });
  test('the owner accounts are people', () => {
    expect(kind.isBotUser(user('bereasonable13'))).toBe(false);
  });
  test('a missing user is treated as a bot (fail closed)', () => {
    expect(kind.isBotUser(null)).toBe(true);
    expect(kind.isBotUser({})).toBe(true);
  });
});

describe('humanApprovals(): whose approval counts', () => {
  test('a member approval counts once', () => {
    expect(kind.humanApprovals(HEAD, [review('alice', 'APPROVED')])).toBe(1);
  });
  test('an owner approval counts', () => {
    expect(kind.humanApprovals(HEAD, [review('bereasonable13', 'APPROVED', 'OWNER')])).toBe(1);
  });
  test('a bot approval does not count', () => {
    expect(kind.humanApprovals(HEAD, [review('ocr-agent[bot]', 'APPROVED', 'NONE', 'Bot')])).toBe(
      0
    );
    expect(kind.humanApprovals(HEAD, [review('ocr-agent', 'APPROVED', 'MEMBER', 'Bot')])).toBe(0);
  });
  test('an approval from an account without write association does not count', () => {
    expect(kind.humanApprovals(HEAD, [review('drive-by', 'APPROVED', 'NONE')])).toBe(0);
    expect(kind.humanApprovals(HEAD, [review('drive-by', 'APPROVED', 'CONTRIBUTOR')])).toBe(0);
  });
  test('an approval later replaced by changes requested does not count', () => {
    expect(
      kind.humanApprovals(HEAD, [
        review('alice', 'APPROVED', 'MEMBER', 'User', '2026-11-18T01:00:00Z'),
        review('alice', 'CHANGES_REQUESTED', 'MEMBER', 'User', '2026-11-18T02:00:00Z'),
      ])
    ).toBe(0);
  });
  test('a comment after an approval leaves the approval standing', () => {
    expect(
      kind.humanApprovals(HEAD, [
        review('alice', 'APPROVED', 'MEMBER', 'User', '2026-11-18T01:00:00Z'),
        review('alice', 'COMMENTED', 'MEMBER', 'User', '2026-11-18T02:00:00Z'),
      ])
    ).toBe(1);
  });
  test('a dismissed approval does not count', () => {
    expect(kind.humanApprovals(HEAD, [review('alice', 'DISMISSED')])).toBe(0);
  });
  test('one person approving twice counts once', () => {
    expect(
      kind.humanApprovals(HEAD, [
        review('alice', 'APPROVED', 'MEMBER', 'User', '2026-11-18T01:00:00Z'),
        review('alice', 'APPROVED', 'MEMBER', 'User', '2026-11-18T02:00:00Z'),
      ])
    ).toBe(1);
  });
  test('an approval of an older commit does not count', () => {
    expect(
      kind.humanApprovals(HEAD, [review('alice', 'APPROVED', 'MEMBER', 'User', undefined, OLD)])
    ).toBe(0);
  });
  test('without a head commit nothing counts (fail closed)', () => {
    expect(kind.humanApprovals('', [review('alice', 'APPROVED')])).toBe(0);
  });
});

describe('the override label', () => {
  test('hasLabel() finds the label on a REST pull request', () => {
    expect(kind.hasLabel({ labels: [{ name: 'risk:low' }, { name: LABEL }] }, LABEL)).toBe(true);
    expect(kind.hasLabel({ labels: [{ name: 'risk:low' }] }, LABEL)).toBe(false);
    expect(kind.hasLabel({ labels: [] }, LABEL)).toBe(false);
  });
  test('a label must match exactly', () => {
    expect(kind.hasLabel({ labels: [{ name: `${LABEL}-requested` }] }, LABEL)).toBe(false);
  });
  test('a label put on by a person counts', () => {
    expect(kind.labelAppliedByHuman([labeled(LABEL, 'bereasonable13')], LABEL)).toBe(true);
  });
  test('a label put on by a bot does not count', () => {
    expect(kind.labelAppliedByHuman([labeled(LABEL, 'ocr-agent[bot]', 'Bot')], LABEL)).toBe(false);
    expect(kind.labelAppliedByHuman([labeled(LABEL, 'ocr-agent', 'Bot')], LABEL)).toBe(false);
  });
  test('a label taken off and put back by a bot does not count', () => {
    expect(
      kind.labelAppliedByHuman(
        [
          labeled(LABEL, 'alice', 'User', 'labeled', '2026-11-18T01:00:00Z'),
          labeled(LABEL, 'alice', 'User', 'unlabeled', '2026-11-18T02:00:00Z'),
          labeled(LABEL, 'ocr-agent[bot]', 'Bot', 'labeled', '2026-11-18T03:00:00Z'),
        ],
        LABEL
      )
    ).toBe(false);
  });
  test('other labels and events are ignored', () => {
    expect(
      kind.labelAppliedByHuman(
        [labeled('risk:low', 'alice'), { event: 'closed', actor: user('alice') }],
        LABEL
      )
    ).toBe(false);
  });
});

describe('CLI', () => {
  const run = (args, input) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { input, encoding: 'utf8' });

  test('author-is-bot reads a REST pull request', () => {
    expect(
      run(['author-is-bot'], JSON.stringify({ user: user('ocr-agent[bot]', 'Bot') })).stdout.trim()
    ).toBe('true');
    expect(run(['author-is-bot'], JSON.stringify({ user: user('abbott') })).stdout.trim()).toBe(
      'false'
    );
  });
  test('human-approvals reads one review per line (gh api --paginate --jq ".[]")', () => {
    const lines = [review('alice', 'APPROVED'), review('ocr-agent', 'APPROVED', 'MEMBER', 'Bot')]
      .map((r) => JSON.stringify(r))
      .join('\n');
    expect(run(['human-approvals', HEAD], lines).stdout.trim()).toBe('1');
  });
  test('human-approvals reads an empty list as zero', () => {
    expect(run(['human-approvals', HEAD], '').stdout.trim()).toBe('0');
  });
  test('has-label and label-applied-by-human read REST JSON', () => {
    expect(
      run(['has-label', LABEL], JSON.stringify({ labels: [{ name: LABEL }] })).stdout.trim()
    ).toBe('true');
    expect(
      run(['label-applied-by-human', LABEL], JSON.stringify(labeled(LABEL, 'alice'))).stdout.trim()
    ).toBe('true');
    expect(run(['label-applied-by-human', LABEL], '').stdout.trim()).toBe('false');
  });
  test('the CLI fails closed on input it cannot read', () => {
    expect(run(['author-is-bot'], 'not json').status).not.toBe(0);
    expect(run(['human-approvals', HEAD], '{"user": ').status).not.toBe(0);
    expect(run(['human-approvals'], '').status).not.toBe(0);
    expect(run(['has-label'], '{"labels": []}').status).not.toBe(0);
    expect(run(['label-applied-by-human', LABEL], 'nope').status).not.toBe(0);
    expect(run(['no-such-mode'], '{}').status).not.toBe(0);
  });
});

describe('the gate uses the classifier', () => {
  const wf = yaml.load(
    readFileSync(join(ROOT, '.github', 'workflows', 'security-human-gate.yml'), 'utf8')
  );
  const steps = wf.jobs['human-gate'].steps;
  const verify = steps.find((s) => /Verify human override/.test(s.name || ''));

  test('the verify step decides author and approvals with pr-actor-kind.mjs on the REST API', () => {
    expect(verify.run).toContain('scripts/ci/pr-actor-kind.mjs author-is-bot');
    expect(verify.run).toContain('scripts/ci/pr-actor-kind.mjs human-approvals');
    expect(verify.run).toMatch(/gh api [^\n]*pulls\/\$\{?PR_NUMBER\}?\/reviews/);
  });
  test('the label check is decided by the classifier, with no grep-count fallback', () => {
    expect(verify.run).toContain('scripts/ci/pr-actor-kind.mjs has-label');
    expect(verify.run).toContain('scripts/ci/pr-actor-kind.mjs label-applied-by-human');
    expect(verify.run).not.toMatch(/grep -c[^\n]*\|\|\s*echo/);
    expect(verify.run).toMatch(/human-approvals "\$HEAD_SHA"/);
  });
  test('no letters-in-a-login rule is left in the gate', () => {
    const all = steps.map((s) => s.run || '').join('\n');
    expect(all).not.toMatch(/test\("bot\|/);
    expect(all).not.toMatch(/grep -qiE "bot\|/);
  });
  test('the classifier is checked out before the verify step, without a stored token', () => {
    const iCheckout = steps.findIndex((s) => String(s.uses || '').startsWith('actions/checkout@'));
    expect(iCheckout).toBeGreaterThan(-1);
    expect(iCheckout).toBeLessThan(steps.indexOf(verify));
    expect(steps[iCheckout].with['persist-credentials']).toBe(false);
  });
  test('CODEOWNERS locks the classifier like the workflow', () => {
    const co = readFileSync(join(ROOT, '.github', 'CODEOWNERS'), 'utf8');
    expect(co).toMatch(/^\/scripts\/ci\/pr-actor-kind\.mjs\s+@/m);
  });
});
