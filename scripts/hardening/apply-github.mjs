#!/usr/bin/env node
// OWNER-RUN. Applies the GitHub half of the 2026-10-11 hardening that is safe to apply today.
//
//   node scripts/hardening/apply-github.mjs            # dry run: prints each request, sends nothing
//   node scripts/hardening/apply-github.mjs --apply    # needs a real terminal + typing APPLY
//
// Applies:
//   A. a tag ruleset on refs/tags/v* (create, update, delete blocked, NO bypass actors). A pushed
//      v*.*.* tag starts the production deploy chain, so nobody (you included) can create one until
//      the ruleset is switched off. Production deploys then go through workflow_dispatch with the
//      typed PRODUCTION confirmation.
//   B. the production environment: you as required reviewer, deploys from protected branches only.
//
// Does NOT apply, on purpose:
//   - required reviews on main. With one GitHub account nobody can approve, so it would block
//     every merge (enforce_admins is on). It needs a second, low-privilege identity for agents
//     first; then change tools/ci/main-branch-protection.json and run
//     scripts/apply-branch-protection.mjs --apply (the drift check watches that file).
//   - moving ADMIN_KEY, CF_ACCESS_*, CLOUDFLARE_* and X_OCR_INTERNAL to environment secrets: the
//     values are yours to paste, in your own terminal (see docs/security/AGENT-WORKSTATION-HARDENING.md).
//
// B only protects anything once agents stop running as the admin account (verify G6): the
// same identity could approve its own deployment.

import { fileURLToPath } from 'node:url';
import { REPO, gh, ghJson, requireOwnerTerminal } from './lib.mjs';

export const TAG_RULESET = {
  name: 'release-tags-locked',
  target: 'tag',
  enforcement: 'active',
  bypass_actors: [],
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
  deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
});

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
async function main() {
  const apply = process.argv.includes('--apply');
  const me = ghJson(['api', 'user']);
  if (!me.ok) {
    console.error(`Cannot read the authenticated user: ${me.error}`);
    process.exit(2);
  }
  const rulesets = ghJson(['api', `repos/${REPO}/rulesets`]);
  if (!rulesets.ok) {
    console.error(`Cannot list rulesets: ${rulesets.error}`);
    process.exit(2);
  }
  const haveTag = (rulesets.data ?? []).some((r) => r.name === TAG_RULESET.name);

  const steps = [];
  if (!haveTag)
    steps.push({
      label: 'A. create tag ruleset release-tags-locked',
      args: ['api', '--method', 'POST', `repos/${REPO}/rulesets`, '--input', '-'],
      body: TAG_RULESET,
    });
  else console.log('A. tag ruleset already present (skipped)');
  steps.push({
    label: `B. production environment: reviewer ${me.data.login}, protected branches only`,
    args: ['api', '--method', 'PUT', `repos/${REPO}/environments/production`, '--input', '-'],
    body: productionEnv(me.data.id),
  });

  for (const s of steps) {
    console.log(`\n${s.label}\n  ${s.args.slice(1, 4).join(' ')}\n  ${JSON.stringify(s.body)}`);
  }
  if (!apply) {
    console.log('\nDry run. Re-run with --apply in your own terminal to send these.');
    process.exit(0);
  }
  await requireOwnerTerminal(`change ${REPO} settings (${steps.length} request(s))`);
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
