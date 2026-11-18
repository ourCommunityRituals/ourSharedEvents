/**
 * `scripts/apply-branch-protection.mjs --apply` must never quietly weaken `main`.
 *
 * `--apply` PUTs the whole body of tools/ci/main-branch-protection.json. GitHub
 * treats that body as the complete new state, so any rule the owner turned on by
 * hand that the file does not hold (a review requirement, a required check) is
 * deleted by the PUT. The agent-identity story names the case: the file says
 * `required_pull_request_reviews: null`, so applying it would delete a review
 * requirement set in the GitHub settings page.
 *
 * `weakenings(expected, live)` lists every way the PUT would loosen what is live.
 * `--apply` reads live first and stops (exit 1, nothing sent) when the list is not
 * empty, unless the owner passes `--allow-weaken` on purpose (the rollback in
 * OSE-1698: "field to null, re-apply from the JSON").
 *
 * BORN RED (2026-11-18). Each fault was put into apply-branch-protection.mjs, this
 * file run, the named tests seen failing, and the fault taken out:
 *   W1  weakenings() missing (the file as main has it)
 *         -> every test below (import has no `weakenings`)
 *   W2  reviews ignored (the review block of weakenings() deleted)
 *         -> "removing a live review rule is a weakening", "a lower approval count ...",
 *            "dropping code-owner review ...", "dropping last-push approval ..."
 *   W3  live required checks ignored (the checks loop deleted)
 *         -> "a live required check the file lacks is a weakening"
 *   W4  --apply PUTs before it compares (the guard moved after the PUT)
 *         -> "--apply refuses before any PUT when it would weaken"
 */

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'apply-branch-protection.mjs');

let bp;
beforeAll(async () => {
  bp = await import('../../../scripts/apply-branch-protection.mjs');
});

const reviews = (over = {}) => ({
  required_approving_review_count: 1,
  require_code_owner_reviews: true,
  dismiss_stale_reviews: true,
  require_last_push_approval: true,
  ...over,
});

const body = ({
  checks = ['A', 'B'],
  prr = null,
  admins = true,
  force = false,
  del = false,
} = {}) => ({
  required_status_checks: { strict: false, checks: checks.map((context) => ({ context })) },
  enforce_admins: admins,
  required_pull_request_reviews: prr,
  allow_force_pushes: force,
  allow_deletions: del,
});

const w = (expected, live) => bp.weakenings(bp.normalize(expected), bp.normalize(live));

describe('weakenings(): what a PUT of the file would loosen on main', () => {
  test('identical state is not a weakening', () => {
    expect(w(body({ prr: reviews() }), body({ prr: reviews() }))).toEqual([]);
  });

  test('a stricter file is not a weakening (turning reviews on)', () => {
    expect(w(body({ prr: reviews() }), body({ prr: null }))).toEqual([]);
  });

  test('removing a live review rule is a weakening (the file says null)', () => {
    const out = w(body({ prr: null }), body({ prr: reviews() }));
    expect(out.length).toBe(1);
    expect(out[0]).toMatch(/review/i);
  });

  test('a lower approval count is a weakening', () => {
    expect(
      w(
        body({ prr: reviews({ required_approving_review_count: 1 }) }),
        body({ prr: reviews({ required_approving_review_count: 2 }) })
      ).length
    ).toBe(1);
  });

  test('dropping code-owner review is a weakening', () => {
    expect(
      w(
        body({ prr: reviews({ require_code_owner_reviews: false }) }),
        body({ prr: reviews() })
      ).join('\n')
    ).toMatch(/code-owner/i);
  });

  test('dropping dismiss-stale or last-push approval is a weakening', () => {
    expect(
      w(body({ prr: reviews({ dismiss_stale_reviews: false }) }), body({ prr: reviews() })).length
    ).toBe(1);
    expect(
      w(
        body({ prr: reviews({ require_last_push_approval: false }) }),
        body({ prr: reviews() })
      ).join('\n')
    ).toMatch(/last-push/i);
  });

  test('a live required check the file lacks is a weakening', () => {
    const out = w(
      body({ checks: ['A'] }),
      body({ checks: ['A', '🔍 Dependency Vulnerability Audit'] })
    );
    expect(out.length).toBe(1);
    expect(out[0]).toContain('🔍 Dependency Vulnerability Audit');
  });

  test('admin enforcement off, or force-push / deletion allowed, is a weakening', () => {
    expect(w(body({ admins: false }), body({ admins: true })).length).toBe(1);
    expect(w(body({ force: true }), body({ force: false })).length).toBe(1);
    expect(w(body({ del: true }), body({ del: false })).length).toBe(1);
  });

  test('the drift diff still reports a stricter live state (drift and weakening are separate)', () => {
    expect(
      bp.diff(bp.normalize(body({ prr: null })), bp.normalize(body({ prr: reviews() }))).length
    ).toBe(1);
  });
});

describe('--apply wiring (source read, no network)', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  const applyBlock = src.slice(src.indexOf("if (mode === '--apply')"));

  test('--apply refuses before any PUT when it would weaken', () => {
    const guard = applyBlock.indexOf('weakenings(');
    const put = applyBlock.indexOf("'PUT'");
    expect(guard).toBeGreaterThan(-1);
    expect(put).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(put);
  });

  test('the override is an explicit flag, named in the usage line', () => {
    expect(src).toContain("'--allow-weaken'");
    expect(src).toMatch(/usage:.*--allow-weaken/);
  });
});
