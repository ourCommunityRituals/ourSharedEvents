#!/usr/bin/env node
// OWNER-RUN. Applies the GitHub half of the hardening that is safe to apply today.
//
//   node scripts/hardening/apply-github.mjs            # dry run: prints each request, sends nothing
//   node scripts/hardening/apply-github.mjs --apply    # needs a real terminal + typing APPLY
//
// Applies:
//   A. a tag ruleset on refs/tags/v* (create, update, delete and force-push blocked). The only
//      bypass is the repository ADMIN ROLE, so the owner can still release by tag. Once agents run
//      as a non-admin identity (verify G6) they cannot create a v*.*.* tag, which starts the
//      production deploy chain. Until then the ruleset stops nothing an admin token cannot undo,
//      and the policy-gate hook's tag rules are what stand in the way.
//   B. the production environment: you as required reviewer, and deploys allowed only from `main`
//      and from `v*` tags (the two ways the workflow can start a production deploy).
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
// B protects nothing against an agent running as the admin account: that identity can approve
// its own deployment. G6 is the control that makes B mean something.

import { fileURLToPath } from 'node:url';
import { REPO, gh, ghJson, requireOwnerTerminal } from './lib.mjs';

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

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

async function main() {
  const apply = process.argv.includes('--apply');
  // The terminal check comes first: --apply from a shell with no terminal exits before any
  // network call, so a regression in this guard cannot send a request.
  if (apply) await requireOwnerTerminal(`change ${REPO} settings`);

  const me = ghJson(['api', 'user']);
  if (!me.ok) {
    console.error(`Cannot read the authenticated user: ${me.error}`);
    process.exit(2);
  }
  const rulesets = ghJson(['api', `repos/${REPO}/rulesets`]);
  const env = ghJson(['api', `repos/${REPO}/environments/production`]);
  if (!rulesets.ok) {
    console.error(`Cannot list rulesets: ${rulesets.error}`);
    process.exit(2);
  }
  const haveTag = (rulesets.data ?? []).some((r) => r.name === TAG_RULESET.name);
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
        ).map((p) => `${p.type ?? 'branch'}:${p.name}`)
      )
    : new Set();

  const steps = [];
  if (!haveTag) {
    steps.push({
      label: 'A. create tag ruleset release-tags-locked (bypass: admin role)',
      args: ['api', '--method', 'POST', `repos/${REPO}/rulesets`, '--input', '-'],
      body: TAG_RULESET,
    });
  } else console.log('A. tag ruleset already present (skipped)');
  if (!haveReviewer || !env.data?.deployment_branch_policy?.custom_branch_policies) {
    steps.push({
      label: `B1. production environment: reviewer ${me.data.login}, custom deploy refs`,
      args: ['api', '--method', 'PUT', `repos/${REPO}/environments/production`, '--input', '-'],
      body: productionEnv(me.data.id),
    });
  } else console.log('B1. production environment already has a reviewer and custom refs (skipped)');
  for (const ref of DEPLOY_REFS) {
    if (havePolicies.has(`${ref.type}:${ref.name}`)) continue;
    steps.push({
      label: `B2. production may deploy from ${ref.type} ${ref.name}`,
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

  for (const s of steps) {
    console.log(`\n${s.label}\n  ${s.args.slice(1, 4).join(' ')}\n  ${JSON.stringify(s.body)}`);
  }
  if (steps.length === 0) console.log('\nNothing to do.');
  if (!apply) {
    console.log('\nDry run. Re-run with --apply in your own terminal to send these.');
    return;
  }
  let failed = 0;
  for (const s of steps) {
    const r = gh(s.args, JSON.stringify(s.body));
    console.log(
      `${r.ok ? 'ok  ' : 'FAIL'} ${s.label}${r.ok ? '' : ' :: ' + r.stderr.trim().split('\n')[0]}`
    );
    if (!r.ok) failed += 1;
  }
  console.log('\nRe-run: node scripts/hardening/verify-hardening.mjs');
  process.exit(failed ? 1 : 0);
}

if (isMain) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
