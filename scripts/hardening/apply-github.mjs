#!/usr/bin/env node
// OWNER-RUN. Applies the GitHub half of the hardening that is safe to apply today.
//
//   node scripts/hardening/apply-github.mjs            # dry run: prints each request, sends nothing
//   node scripts/hardening/apply-github.mjs --apply    # needs a real terminal + typing APPLY
//   node scripts/hardening/apply-github.mjs --only main-automation [--apply]
//   node scripts/hardening/apply-github.mjs --only release-tag-ruleset,production-gate
//
// Each step is named for what it changes, and every printed line starts with its [name].
// --only <name>[,<name>...] runs just the named steps; with no --only, all three run. A name not
// in the list below stops the script before any request. Give --only once: a second --only is an
// error, not a merge. A step that --only leaves out sends nothing and reads nothing. Any other
// argument (a mistyped flag such as --onyl, or a step name without --only) is refused too, so a
// typo can never fall back to running all three.
//
// Steps:
//   release-tag-ruleset: creates a tag ruleset on refs/tags/v* (create, update, delete, force-push
//      blocked). The only bypass is the repository ADMIN ROLE, so the owner can still release by
//      tag. Once agents run as a non-admin identity (verify G6) they cannot create a v*.*.* tag,
//      which starts the production deploy chain. Until then the ruleset stops nothing an admin
//      token cannot undo, and the policy-gate hook's tag rules are what stand in the way.
//   production-gate: adds the approval gate to the existing production environment: you as
//      required reviewer, and deploys allowed only from `main` and from `v*` tags (the two ways
//      the workflow can start a production deploy). It is meant to create nothing; note that the
//      PUT it sends would create the environment if it were missing (it exists today).
//   main-automation: creates the main-automation environment (OSE-1695): jobs may use it from
//      the `main` branch only (one custom branch policy; no tag ref, no wildcard; any other policy
//      is deleted). It is where the three write tokens live as environment secrets:
//      OCR_AUTOMATION_WRITE, OCR_NOTIFY_OSM and BRANCH_PROTECTION_READ_TOKEN. NO required
//      reviewer, by design: the scheduled and push-triggered jobs that use it would stall waiting
//      for one. The control is the branch policy plus the token living only there. The
//      environment must exist with this policy BEFORE any workflow names it: GitHub creates a
//      missing environment on first use, with no protection. This script sets no secret; you add
//      the three values in the environment yourself.
//
// Does NOT apply, on purpose:
//   - required reviews on main. With one GitHub account nobody can approve, so it would block
//     every merge (enforce_admins is on). It needs a second, low-privilege identity for agents
//     first; then change tools/ci/main-branch-protection.json and run
//     scripts/apply-branch-protection.mjs --apply (the drift check compares review rules).
//   - moving ADMIN_KEY, CF_ACCESS_*, CLOUDFLARE_* and X_OCR_INTERNAL to environment secrets:
//     the values are yours to paste, and several jobs read them without declaring an environment
//     (docs/security/AGENT-WORKSTATION-HARDENING.md lists them).
//
// production-gate protects nothing against an agent running as the admin account: that
// identity can approve its own deployment. G6 is the control that makes it mean something.

import { fileURLToPath } from 'node:url';
import { REPO, gh, ghJson, requireOwnerTerminal, requireTty } from './lib.mjs';

export const RELEASE_TAG_RULESET = 'release-tag-ruleset';
export const PRODUCTION_GATE = 'production-gate';
export const MAIN_AUTOMATION_STEP = 'main-automation';

// The --only table, in the order the steps run. Every printed label is built from these names.
export const STEPS = [
  {
    name: RELEASE_TAG_RULESET,
    what: 'creates the tag ruleset release-tags-locked on refs/tags/v* (bypass: admin role)',
  },
  {
    name: PRODUCTION_GATE,
    what: 'approval gate on the existing production environment: owner as reviewer, deploys from branch main and tag v*',
  },
  {
    name: MAIN_AUTOMATION_STEP,
    what: 'creates the main-automation environment: branch main only, no reviewers, extra policies removed',
  },
];
export const STEP_NAMES = STEPS.map((s) => s.name);

const tag = (name) => `[${name}]`;

/**
 * Reads --only from argv. Returns { ok: true, selected } with the selected names in run order
 * (all of them when --only is absent), or { ok: false, error }. Pure: no request, no exit.
 * Accepts `--only a,b` and `--only=a,b`. A repeated --only, a missing or empty value, an empty
 * entry and an unknown name are each an error.
 */
export function parseOnly(argv) {
  const values = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--only') {
      const next = argv[i + 1];
      values.push(next === undefined || next.startsWith('--') ? '' : next);
      if (next !== undefined && !next.startsWith('--')) i += 1;
    } else if (a.startsWith('--only=')) {
      values.push(a.slice('--only='.length));
    }
  }
  if (values.length === 0) return { ok: true, selected: [...STEP_NAMES] };
  if (values.length > 1) {
    return { ok: false, error: 'give --only once, with a comma-separated list of step names' };
  }
  const names = values[0].split(',').map((s) => s.trim());
  if (names.every((n) => n === '')) return { ok: false, error: '--only needs a step name' };
  if (names.some((n) => n === '')) return { ok: false, error: '--only has an empty step name' };
  const unknown = names.filter((n) => !STEP_NAMES.includes(n));
  if (unknown.length) return { ok: false, error: `unknown step name(s): ${unknown.join(', ')}` };
  return { ok: true, selected: STEP_NAMES.filter((n) => names.includes(n)) };
}

export const FLAGS = ['--apply', '--only <name>[,<name>...]', '--only=<name>[,<name>...]'];
const FLAG_NAMES = ['--apply', '--only'];

// Edit distance (insert, delete, substitute), for the "did you mean" hint.
function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * Every argument must be a recognised flag or the value right after --only. A mistyped flag
 * (--onyl) or a stray word (a step name without --only) is an error, never ignored: ignoring it
 * would run all three steps. Returns { ok: true } or { ok: false, error }. Pure.
 */
export function checkArgs(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply' || a.startsWith('--only=')) continue;
    if (a === '--only') {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) i += 1;
      continue;
    }
    if (a.startsWith('--')) {
      const name = a.split('=')[0];
      const near = FLAG_NAMES.find((f) => distance(name, f) <= 2);
      return { ok: false, error: `unknown flag ${a}${near ? ` (did you mean ${near}?)` : ''}` };
    }
    return {
      ok: false,
      error: `unexpected argument ${JSON.stringify(a)} (step names go after --only)`,
    };
  }
  return { ok: true };
}

/** What --apply asks the owner to confirm: the selected step names and the request count. */
export function applyConfirmation(selected, requestCount) {
  return `send ${requestCount} request(s) to ${REPO} for: ${selected.join(', ')}`;
}

export const TAG_RULESET = {
  name: 'release-tags-locked',
  target: 'tag',
  enforcement: 'active',
  bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
  conditions: { ref_name: { include: ['refs/tags/v*'], exclude: [] } },
  rules: [
    { type: 'creation' },
    { type: 'update' },
    { type: 'deletion' },
    { type: 'non_fast_forward' },
  ],
};

export const productionEnv = (ownerId) => ({
  prevent_self_review: false,
  reviewers: [{ type: 'User', id: ownerId }],
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
});

export const DEPLOY_REFS = [
  { name: 'main', type: 'branch' },
  { name: 'v*', type: 'tag' },
];

export const MAIN_AUTOMATION = 'main-automation';

// No `reviewers` key: a new environment then has none (see main-automation above).
export const mainAutomationEnv = () => ({
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
});

export const MAIN_AUTOMATION_REFS = [{ name: 'main', type: 'branch' }];

const refKey = (p) => `${p.type ?? 'branch'}:${p.name}`;

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

// Each planner reads only its own step's state and returns that step's requests.
function planReleaseTagRuleset() {
  const step = RELEASE_TAG_RULESET;
  const rulesets = ghJson(['api', `repos/${REPO}/rulesets`]);
  if (!rulesets.ok) {
    console.error(`${tag(step)} Cannot list rulesets: ${rulesets.error}`);
    process.exit(2);
  }
  if ((rulesets.data ?? []).some((r) => r.name === TAG_RULESET.name)) {
    console.log(`${tag(step)} tag ruleset ${TAG_RULESET.name} already present (skipped)`);
    return [];
  }
  return [
    {
      step,
      label: `${tag(step)} POST rulesets (create ${TAG_RULESET.name} on refs/tags/v*, bypass: admin role)`,
      args: ['api', '--method', 'POST', `repos/${REPO}/rulesets`, '--input', '-'],
      body: TAG_RULESET,
    },
  ];
}

function planProductionEnvironment() {
  const step = PRODUCTION_GATE;
  const me = ghJson(['api', 'user']);
  if (!me.ok) {
    console.error(`${tag(step)} Cannot read the authenticated user: ${me.error}`);
    process.exit(2);
  }
  const env = ghJson(['api', `repos/${REPO}/environments/production`]);
  const haveReviewer =
    env.ok &&
    (env.data?.protection_rules ?? []).some(
      (x) => x.type === 'required_reviewers' && (x.reviewers ?? []).length > 0
    );
  const havePolicies = env.ok
    ? new Set(
        (
          ghJson(['api', `repos/${REPO}/environments/production/deployment-branch-policies`]).data
            ?.branch_policies ?? []
        ).map(refKey)
      )
    : new Set();

  const out = [];
  if (!haveReviewer || !env.data?.deployment_branch_policy?.custom_branch_policies) {
    out.push({
      step,
      label: `${tag(step)} PUT environments/production (reviewer ${me.data.login}, custom deploy refs)`,
      args: ['api', '--method', 'PUT', `repos/${REPO}/environments/production`, '--input', '-'],
      body: productionEnv(me.data.id),
    });
  } else console.log(`${tag(step)} production already has a reviewer and custom refs (skipped)`);
  for (const ref of DEPLOY_REFS) {
    if (havePolicies.has(refKey(ref))) continue;
    out.push({
      step,
      label: `${tag(step)} POST environments/production/deployment-branch-policies (deploy from ${ref.type} ${ref.name})`,
      args: [
        'api',
        '--method',
        'POST',
        `repos/${REPO}/environments/production/deployment-branch-policies`,
        '--input',
        '-',
      ],
      body: ref,
    });
  }
  return out;
}

function planMainAutomationEnvironment() {
  const step = MAIN_AUTOMATION_STEP;
  const autoPath = `repos/${REPO}/environments/${MAIN_AUTOMATION}`;
  const short = `environments/${MAIN_AUTOMATION}`;
  // The environment, then (only if it exists with custom policies) its branch policies.
  const auto = ghJson(['api', autoPath]);
  const autoPolicy = auto.ok ? auto.data?.deployment_branch_policy : null;
  const autoMatches =
    autoPolicy?.custom_branch_policies === true && autoPolicy?.protected_branches === false;
  const autoPolicies =
    auto.ok && autoMatches
      ? (ghJson(['api', `${autoPath}/deployment-branch-policies`]).data?.branch_policies ?? [])
      : [];

  const out = [];
  if (!autoMatches) {
    out.push({
      step,
      label: `${tag(step)} PUT ${short} (custom branch policies, no reviewers)`,
      args: ['api', '--method', 'PUT', autoPath, '--input', '-'],
      body: mainAutomationEnv(),
    });
  } else
    console.log(`${tag(step)} ${MAIN_AUTOMATION} already uses custom branch policies (skipped)`);
  const autoHave = new Set(autoPolicies.map(refKey));
  for (const ref of MAIN_AUTOMATION_REFS) {
    if (autoHave.has(refKey(ref))) continue;
    out.push({
      step,
      label: `${tag(step)} POST ${short}/deployment-branch-policies (use from ${ref.type} ${ref.name})`,
      args: ['api', '--method', 'POST', `${autoPath}/deployment-branch-policies`, '--input', '-'],
      body: ref,
    });
  }
  const autoWant = new Set(MAIN_AUTOMATION_REFS.map(refKey));
  for (const p of autoPolicies) {
    if (autoWant.has(refKey(p))) continue;
    if (!Number.isInteger(p.id)) {
      console.log(`${tag(step)} extra policy ${refKey(p)} has no id; remove it by hand`);
      continue;
    }
    out.push({
      step,
      label: `${tag(step)} DELETE ${short}/deployment-branch-policies/${p.id} (remove the extra policy ${refKey(p)})`,
      args: ['api', '--method', 'DELETE', `${autoPath}/deployment-branch-policies/${p.id}`],
    });
  }
  if (autoMatches && out.length === 0) {
    console.log(`${tag(step)} ${MAIN_AUTOMATION} already allows exactly branch main (skipped)`);
  }
  return out;
}

const PLANNERS = {
  [RELEASE_TAG_RULESET]: planReleaseTagRuleset,
  [PRODUCTION_GATE]: planProductionEnvironment,
  [MAIN_AUTOMATION_STEP]: planMainAutomationEnvironment,
};

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  // Arguments are checked first: an unknown flag, a stray word or a bad step name exits before
  // the terminal check and before any request.
  const args = checkArgs(argv);
  const only = args.ok ? parseOnly(argv) : args;
  if (!only.ok) {
    console.error(
      `Refusing: ${only.error}.\nRecognised flags: ${FLAGS.join(', ')}.` +
        `\nValid step names: ${STEP_NAMES.join(', ')}`
    );
    process.exit(2);
  }
  const { selected } = only;
  // The terminal check comes before any network call: --apply from a shell with no terminal
  // exits here, so a regression in this guard cannot send a request. The typed confirmation
  // comes after the plan, so it can name the steps and the request count.
  if (apply) requireTty(`change ${REPO} settings`);

  console.log('Steps:');
  for (const s of STEPS) {
    const mark = selected.includes(s.name) ? 'SELECTED' : 'SKIPPED (not in --only)';
    console.log(`  ${mark.padEnd(23)} ${tag(s.name)} ${s.what}`);
  }
  console.log('');

  const steps = [];
  for (const name of selected) steps.push(...PLANNERS[name]());

  for (const s of steps) {
    const body = s.body === undefined ? '' : `\n  ${JSON.stringify(s.body)}`;
    console.log(`\n${s.label}\n  ${s.args.slice(1, 4).join(' ')}${body}`);
  }
  if (steps.length === 0) console.log('\nNothing to do.');
  const summary = () => {
    const part = (name) =>
      selected.includes(name)
        ? `${name} ${steps.filter((s) => s.step === name).length}`
        : `${name} skipped`;
    console.log(`\nSummary (requests per step): ${STEP_NAMES.map(part).join(', ')}.`);
    if (selected.includes(MAIN_AUTOMATION_STEP)) {
      console.log(
        `  ${MAIN_AUTOMATION_STEP} has no reviewer by design. After it exists, add` +
          `\n  OCR_AUTOMATION_WRITE, OCR_NOTIFY_OSM and BRANCH_PROTECTION_READ_TOKEN as` +
          `\n  ${MAIN_AUTOMATION} environment secrets yourself.`
      );
    }
  };
  const confirmation = applyConfirmation(selected, steps.length);
  if (!apply) {
    summary();
    if (steps.length === 0) console.log('\nDry run. Nothing to send for the selected step(s).');
    else
      console.log(
        '\nDry run. Re-run with --apply in your own terminal to send these. It will ask:' +
          `\n  Type APPLY to ${confirmation}`
      );
    return;
  }
  if (steps.length === 0) {
    summary();
    return;
  }
  await requireOwnerTerminal(confirmation);
  let failed = 0;
  for (const s of steps) {
    const r = gh(s.args, s.body === undefined ? undefined : JSON.stringify(s.body));
    console.log(
      `${r.ok ? 'ok  ' : 'FAIL'} ${s.label}${r.ok ? '' : ' :: ' + r.stderr.trim().split('\n')[0]}`
    );
    if (!r.ok) failed += 1;
  }
  summary();
  console.log(`  ${steps.length - failed} of ${steps.length} request(s) succeeded.`);
  console.log('\nRe-run: node scripts/hardening/verify-hardening.mjs');
  process.exit(failed ? 1 : 0);
}

if (isMain) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
