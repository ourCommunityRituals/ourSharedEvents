# Secrets and Tokens Standard — OCR Org-Level

> **Status:** PROPOSED (ADR-012, 2026-10-01). It becomes binding when ADR-012 is accepted.
> **Applies to:** every repo in the fleet, every CI workflow, every deployed Worker, and every person with a credential.
> **Inventory and plan:** `docs/references/OCR_REFERENCE_secretsInventory_2026-10-01.md`.

**This is a privacy requirement.** The platform promises never to know who you are. That promise only holds if nobody outside the intended path can change the code that keeps it, or read the stores behind it. ADR-012 proposes credential isolation as a brain invariant, `credential_isolation`, in the Privacy & Identity group next to #1 Anonymous ID and #8 Bounded PII Retention. It is not yet in the registry; it lands with Phase 0 item 0.9. It is tested like them: blocking gates and red-team tests, born red (§10).

One idea runs through this standard: **a secret belongs to one trust zone, lives as briefly as its job allows, and is written in one place (Doppler).** Everything below is a consequence of that.

## Prerequisites (the zones rest on these)

- **`main` is protected with no bypass,** for admins and agents alike. Required checks are on, and changes come only through reviewed pull requests. Every environment branch rule below means "code that reached `main`", so a bypass would undo all of them.
- **Agents act under their own identity** (a bot account or GitHub App), separate from the human who approves. Today they do not: agent sessions commit, open PRs and dispatch workflows as the owner's account (`bereasonable13`), so no review or bypass rule can tell the two apart (CCR gate R16). Until R16 closes, "reviewed" and "no bypass for agents" are not true for this fleet.
- **A tag ruleset** limits who can create release tags. Tags are **labels only**: no environment deploys on a tag push, because a tag runs the tagged commit's own workflow file. `production` admits `main` only.
- **Plan check:** required reviewers on environments may need GitHub Enterprise for private repositories. The zones do not depend on reviewers: protected `main` and environment branch rules (enforced in repository settings, outside the deployed commit) are the wall, and reviewers are an extra layer where the plan allows.

---

## 1. Trust zones

A trust zone is a set of places where code of one trust level runs. A secret is assigned to exactly one zone, and only that zone may reach it.

| Zone | Where | Trigger shape | May hold |
|---|---|---|---|
| **Z0 Untrusted code** | Any job whose workflow file or executed code comes from a pull request, including dependencies a pull request selects (its lockfile, its `.ocr-hub-ref`) | `pull_request`, `merge_group` | **No long-lived secret.** Only `GITHUB_TOKEN` (`contents: read`, plus `packages: read` for org packages) and, by exception, an OIDC token bound to a provider-side rule (§4.4). Cross-repo inputs arrive as packages or as trusted checks, not as credentials (§4.1) |
| **Z1 Trusted CI** | Jobs that run only `main` code and test against **staging** | `push` to `main`, `schedule`, `workflow_dispatch` on `main` (**enforced by the environment's branch rule**: a dispatch can name any ref, and a 2026-09-17 dispatch deployed a feature branch to staging), and `workflow_run` only when the source run was a `push` or `schedule` on this repository's `main` (`workflow_run.event` is `push`/`schedule`, `head_branch == 'main'`, `head_repository.full_name == github.repository`). A push to any other branch is not trusted: its code and artifacts are author-controlled, and the environment rule checks the triggered workflow's ref, not the source run's | Staging **test** credentials (CF Access service token for CI, staging admin key), from environment `staging`; the reader App key from environment `ci-read` |
| **Z2 Staging deploy** | The job that deploys to staging and migrates its databases | `push` to `main` | Staging deploy and data credentials, from environment `staging-deploy` (separate from Z1, so a test job never holds deploy or D1 credentials) |
| **Z3 Production** | Production deploy, migration and smoke jobs | `workflow_dispatch` on `main`, through environment `production` (a release tag may label the commit; it does not trigger the deploy) | Production credentials, from environment `production`, which has a **deployment branch rule** (`main` only; production is released by a `workflow_dispatch` on `main`, because a tag push runs the tagged commit's own workflow file and can delete any in-file ancestry check) and a **required reviewer** once agents have their own identity. A **tag ruleset** limits who can create release tags; otherwise anyone with write access could push a matching tag carrying an edited workflow |
| **Z4 Org automation** | Jobs that write to *other* repos (standards propagation, conformance refresh PR) | `push` to `main`, `schedule`, `workflow_dispatch`. **Never** in a workflow file that has a `pull_request` trigger | A GitHub App installation token with write on the named repos only, minted per run (§4.1) |
| **Z5 Runtime** | Deployed Workers | — | Worker secrets, **a distinct value per environment**, written from Doppler by the Z2/Z3 deploy job. Never stored in GitHub |
| **Z6 People** | Operators' machines and dashboards | — | Personal Doppler / Cloudflare / GitHub sessions with SSO and two-factor. Personal tokens never enter CI |

### 1.1 The hard rule about repository secrets

**A repository-level or organization-level secret is in Z0**, whatever the workflow says.

- On a same-repo pull request, GitHub runs the workflow file *from the pull request*. Its author can edit any job to print any repo or org secret.
- The only GitHub-side wall is an **environment** with a required reviewer or a deployment branch rule. The job can name the environment, but it cannot get past the gate.
- So:
  - Anything above Z0 is stored **only** as an environment secret.
  - Repository and organization secrets may hold only what Z0 may hold: **nothing long-lived**. A read-only key is not exempt: a stolen key that can mint read tokens keeps reading until it is revoked.
  - A long-lived secret that still has to be reachable from pull requests is a **recorded exception**: it is in the manifest with `exception_until:` (a date) and the story that removes it, and it has a provider-side cap (§4.4).
  - "Only used in a job that has `if: github.event_name == 'push'`" is **not** a gate.

### 1.2 Zone transitions are one-way

A job never moves a credential down a zone:

- no writing a Z2+ secret to an artifact, cache, output, log or file a later Z0 job can read;
- no passing it to a reusable workflow that runs PR code.

---

## 2. Lifetimes and timing

| Class | Examples | Lifetime | How |
|---|---|---|---|
| **Ephemeral** | `GITHUB_TOKEN`, GitHub App installation tokens, OIDC tokens | ≤1 hour, per job | Minted at job start. Nothing to rotate |
| **Expiring API token** | Cloudflare API tokens, Cloudflare Access service tokens, Doppler service tokens | **≤90 days.** Set as an expiry when created; where the provider's shortest setting is longer, rotate at 90 days anyway | Created with an end date. The manifest records `expires` or `rotate_every: 90d` (§5). Renewed by the owner before it lapses |
| **Non-expiring API key** | Anthropic API key, Linear API key, Google Maps key | Rotated **every 90 days** on a calendar | The provider cannot set an expiry. Each key also gets a **spend or rate cap** at the provider where one exists |
| **Shared auth secret** | `ADMIN_KEY`, `X_OCR_INTERNAL`, `OSE_INTERNAL_BATCH_TOKEN`, `WKRP_SERVICE_TOKEN` | Rotated **every 90 days**, and **never accepted in production** once a federated path exists (§6) | Two-value overlap: the Worker accepts `current` and `previous` during the swap |
| **Data-protection key** | `FORMS_ENCRYPTION_KEY`, `FORMS_HASH_PEPPER`, `ANON_ID_HASH_PEPPER`, `IP_HASH_PEPPER`, `SHARED_REPORT_SIGNING_SECRET`, `SPONSOR_INVITE_SIGNING_SECRET`, `WKRP_ENCRYPTION_KEY`, `WIF_PRIVATE_KEY_PEM` | **Must be versioned before its first rotation** (§2.1; today only `FORMS_ENCRYPTION_KEY` and `ANON_ID_HASH_PEPPER` are), never blind-swapped. Encryption keys and signing secrets rotate **yearly** once they have a keyring or `kid` (until then, on compromise only, per §2.1), and on any compromise. Hash peppers are the exception: they rotate **only** on compromise, because a rotation resets every count built on them; an epoch-versioned pepper (`ANON_ID_HASH_PEPPER`) starts a new epoch and the export counts the current epoch only | §2.1 |
| **Root** | GitHub App private keys, the Doppler workplace owner, the Cloudflare account owner | Owner-held; App keys rotated **yearly**, and on any suspicion | Two-factor on a hardware key or passkey. Never in CI except the App private key in its zone's environment |

### 2.1 Data-protection keys need a keyring before they can rotate

Rotating one of these by swapping the value breaks existing data or links:

- an encryption key makes stored ciphertext unreadable;
- a pepper changes every hash, so lookups miss;
- a signing secret invalidates every link already shared.

So each is versioned before its first rotation:

- **Encrypt / sign** with the newest version. Store the key id with the output (a `v2:` prefix on ciphertext, a `kid` in a token).
- **Decrypt / verify** with any version still in the keyring.
- **Re-encrypt in the background**; data re-keyed by a job is audited. Then retire the old version.
- **Hashes** carry the version they were made with. `anon_id_returns.pepper_epoch` (migration 0091) is the working example: a new pepper starts a new epoch and the old epoch ages out.

Until a key has a keyring, its rotation procedure is "only on compromise, accepting the data loss", and the manifest says so.

### 2.2 Event-driven rotation (do it now, not on the calendar)

Rotate every credential the event could have reached, immediately, when:

- a person with access leaves;
- a credential appears in a log, artifact, issue, chat or commit;
- a workflow file that could reach it was changed by an untrusted or agent author and ran;
- a third-party action or dependency that ran with it in scope is reported compromised;
- a provider reports a breach.

The manifest names, per secret, everything that holds it, so the blast radius is a lookup, not an investigation.

---

## 3. Doppler is the only writer

### 3.1 Layout

| Doppler project | Configs | Holds |
|---|---|---|
| `oursharedevents`, `ourwkrp` (one per deployed product) | Runtime: `dev`, `stg`, `prd`. CI and deploy: **separate root environments** (`stg_ci`, `stg_deploy`, `prd_deploy`), not branch configs. A branch config may inherit its root's secrets and would carry runtime data keys into CI; verify with a throwaway secret before use | Runtime configs hold **only** Worker runtime secrets. `stg_ci` holds staging test credentials (→ environment `staging`); `stg_deploy` / `prd_deploy` hold deploy credentials and production smoke credentials (→ `staging-deploy` / `production`). Kept apart so `wrangler secret bulk` from a runtime config can never ship a CI or deploy credential into a Worker |
| `ocr-platform` | `ci`, `automation` | Org-level: GitHub App IDs and private keys (`ci` = reader App, `automation` = writer App), fleet Linear key |
| `dev_personal` (per person) | `dev` | Local-only conveniences. **Never a value that also exists in `stg` or `prd`** |

`dev` never holds a production value. `stg` and `prd` never share a value. The manifest check (§5) compares their fingerprints, never the values.

### 3.2 How values leave Doppler

- **To GitHub:** Doppler's GitHub Actions sync.
  - `stg_ci` goes to **environment `staging`**, `stg_deploy` to `staging-deploy`, `prd_deploy` to `production`, and the `ocr-platform` App keys to `ci-read` / `automation`.
  - **Never** sync a product config to repository secrets. That is what makes today's production jobs read staging values.
- **To Workers:** the environment-gated deploy job writes Worker secrets from its own config, e.g.
  `doppler secrets download --no-file --format json | npx wrangler secret bulk --env <env>`.
  - This uses a per-config, read-only Doppler service token for the **runtime** config, held as the deploy environment's secret.
  - The deploy job drops Doppler's own `DOPPLER_*` metadata keys before upload, and uploads only names the manifest lists as runtime secrets.
  - **Data-protection keys are never bulk-written.** They are on a denylist for `wrangler secret bulk`, because a wrong value silently breaks stored data. They are written only by a dedicated key-change job, in the target environment's deploy environment, one key per run (`wrangler secret put`), which reads the current keyring, adds or retires one version, and checks the result against the manifest's fingerprint. The same job handles the first mint and every rotation, compromise included.
  - The deploy job then checks that every secret the manifest requires exists for that environment.
- **To people:** `doppler run` locally against `dev` only. Reading `stg` or `prd` needs Doppler access granted to that person for that config.
- **By hand:** `gh secret set` and `wrangler secret put` for a Doppler-managed name are drift. The only exception is break-glass (§7), which is followed by reconciling Doppler.

### 3.3 Doppler access

- **Workplace owners:** the minimum (today: the PO), with SSO and two-factor.
- **Roles:** `dev` is open to collaborators; `stg` to maintainers; `prd` to owners only.
- **Service tokens:** one per config, read-only, named for their single consumer (e.g. `gh-sync-oursharedevents-prd`), with an expiry.
- **Audit:** the activity log is reviewed monthly (§8).

---

## 4. CI and automation identity

### 4.1 Cross-repo access: packages and trusted checks for PRs, GitHub Apps for trusted jobs

Pull-request jobs (Z0) hold no long-lived credential, so they cannot read another private repo directly. They get what they need in one of three ways:

| Need | How a Z0 job gets it | Credential in the PR job |
|---|---|---|
| Hub packages (`@ocr/ui`, `@ocr/flags`) to build PR code | The hub publishes them to GitHub Packages (it already publishes `@ocr/flags`). Each spoke is granted read access on the package, and the PR job installs the version its `.ocr-hub-ref` names | `GITHUB_TOKEN` with `packages: read` (≤ the job) |
| Brain conformance, cross-repo drift checks | A **trusted check**: a `workflow_run` (or `pull_request` check that only reads) workflow runs **main's** code, mints a reader token, and treats the pull request's files as **data**: it reads them, never executes them, and posts a check result | none |
| Anything else from another repo | Published as an artifact or package by that repo's own trusted job | `GITHUB_TOKEN` only |

**Owner option (simplest):** if `OCR-docs` and the hub contain nothing that must stay private, making them public removes every cross-repo read credential from CI.

Two org-owned GitHub Apps replace `OCR_PROPAGATE_TOKEN` for the jobs that do need a credential:

| App | Installed on | Permissions | Key stored in | Zone |
|---|---|---|---|---|
| `ocr-ci-reader` | `OCR-docs`, the hub, and the repos `brain-location-audit` reads | `contents: read`, `metadata: read` | environment `ci-read`, deployment branch rule `main` | Z1 |
| `ocr-automation` | the 7 spokes that receive standards, plus `ourSharedEvents` for the conformance PR | `contents: write`, `pull-requests: write`, `issues: write` (OSM flag-change issue) | environment `automation`, deployment branch rule `main` | Z4 |

- A pull-request job cannot use either key. The environment's branch rule refuses a run whose ref is not `main` (a PR's ref is `refs/pull/<n>/merge`), and the job fails before any step runs.
- Trusted jobs (push to `main`, schedule, `workflow_run`, dispatch on `main`) mint a token with `actions/create-github-app-token` (pinned by SHA). The token is narrowed to the repos and permissions the job needs (`repositories:` and `permission-*` inputs) and expires within an hour.
- A `workflow_run` job that holds a reader token never runs pull-request code. It may read PR files as data (checked out to a separate path, no install, no scripts).
- App private keys are rotated yearly (§2), and immediately if any job that held one ran untrusted code.
- A personal access token is allowed only where no App can do the job. Then it must be fine-grained, repo-scoped and expiring, and the manifest records why.

### 4.2 Checkout and workflow hygiene (mechanical, all repos)

- **Permissions:**
  - Every workflow declares top-level `permissions:` (default `contents: read`, or `{}`).
  - Jobs widen only what they use.
- **Checkouts:**
  - Every `actions/checkout` that receives a `token:` sets `persist-credentials: false`, unless that same job must `git push`. Then it is a Z4 job.
  - A job that holds a secret above Z0 never runs pull-request code: no checkout of a PR ref, no `npm ci` from a PR lockfile.
- **Triggers:**
  - No `pull_request_target` (already invariant #28 for OSE; now fleet-wide). The hub's `label.yml` is the one exception, and only while it checks out nothing.
  - **A `workflow_run` job holds no secret when its source run was a `pull_request`,** same-repo or not: `workflow_run` runs with the default branch as its ref, so environment branch rules do not stop it, and a same-repo check stops only forks. Such jobs read PR files as data or do not run. For other source events, a `head_sha` checkout also requires `github.event.workflow_run.head_repository.full_name == github.repository`.
- **Shell inputs:** no `${{ inputs.* }}`, `${{ github.event.* }}` or `${{ secrets.* }}` inside a `run:` script. Pass them through `env:` and quote them.
- **Actions:**
  - Third-party actions are pinned to a full commit SHA with the tag in a comment, already proposed in ciConventions §3. First-party `actions/*` may stay on a major tag.
  - Dependabot (`package-ecosystem: github-actions`) keeps the pins current.
- **Egress:** `step-security/harden-runner` (pinned) runs first in every job that holds a Z2+ secret, in `audit` mode now, moving to `block` with an allowlist once the allowlist is known.

### 4.3 Cloudflare

Separation comes from **separate tokens per job class and environment**. Where Cloudflare offers resource-level scoping (per-Worker scoping for account-owned tokens was announced 2026-09-15, per the 2026-10-01 review; confirm in the dashboard), each deploy token is limited to its own environment's Worker and databases. Otherwise it is account-wide, and the separate token still gives separate exposure, expiry and revocation:

| Token | Permissions | Environment | Expiry |
|---|---|---|---|
| `CF_DEPLOY_STG` | Workers Scripts edit, D1 edit, KV/R2 as bound | `staging-deploy` | 90d |
| `CF_DEPLOY_PRD` | the same, used only by production jobs | `production` | 90d |
| `CF_READ` | Workers Scripts read, D1 read (`secret list`, canary checks) | `staging` / `production` as used | 90d |
| `CF_DNS` | Zone DNS edit | none in CI (people only) | 90d |

- A second Cloudflare account for production is the stronger wall. It is ADR-012 Alternative C, deferred to the owner.
- Cloudflare Access service tokens are per environment (`CF_ACCESS_CLIENT_ID/SECRET` in each environment), with the shortest duration Cloudflare offers, and rotated every 90 days (§2).

### 4.4 Billable and external APIs reachable from pull requests

Some checks call a paid API on pull requests by design, e.g. the Claude review bots. A long-lived key there is exfiltrable by any same-repo PR author, and a spend cap limits the cost but not the theft. So:

- **Target:** OIDC federation. The provider exchanges GitHub's OIDC token for a short-lived credential under a rule bound to this repo and event. Anthropic's workload identity federation is the planned path (`ourWKRP/.github/workflows/claude.yml:43-47`, OSE-1109).
- **Until then:** the key is a recorded exception (§1.1), with a provider spend cap, a 90-day rotation, and `exception_until:` in the manifest.
- **Alternative:** run the review from trusted code (`workflow_run` on main) that reads the PR diff as data.
- **Ticketing and notifications** (Linear, webhooks) are not needed on pull requests. They move to push or schedule jobs.

---

## 5. Secrets manifest (inventory as code)

Every repo keeps `.github/secrets.manifest.yaml`. It holds names and metadata only, never values:

```yaml
secrets:
  - name: CF_DEPLOY_PRD
    zone: Z3
    store: github-environment:production      # or worker:production, doppler-only, org-secret
    source: doppler:oursharedevents/prd
    grants: "Cloudflare Workers + D1 edit, account-wide"
    owner: mzdan
    expires: 2026-12-30                        # or rotate_every: 90d
    used_by: [".github/workflows/oursharedevents-ci.yml#deploy-production"]
```

The checker **extends OSE's existing #28 enforcement** (`scripts/check-pr-secret-exposure.mjs`, its allowlist JSON, and `tests/e2e/0-architecture/ci-approval-gate-safety.invariant.spec.ts`) into a shared action in OCR-docs. The allowlist becomes the manifest. It runs on every PR in every repo and fails when:

- a workflow references `secrets.X` with no manifest entry, or a manifest entry is unused;
- a secret's `store` is a repository or org secret while its `zone` is above Z0 (§1.1);
- a job in a `pull_request`-triggered workflow references a long-lived secret that is not a recorded exception (§1.1);
- a `workflow_run` workflow can hold a secret while its source event can be `pull_request` (§4.2);
- an environment above Z0 lacks a deployment branch rule that excludes `refs/pull/*` (checked from repo settings where the token allows; otherwise declared in the manifest and asserted by the 1.3 red-team test);
- a checkout with `token:` lacks `persist-credentials: false` outside a Z4 job;
- `${{ secrets.* }}`, `${{ inputs.* }}` or `${{ github.event.* }}` appears inside a `run:` script;
- a third-party `uses:` is not SHA-pinned;
- a workflow lacks top-level `permissions:`;
- production config allows a static admin path (`ALLOW_OCR_INTERNAL` or `ALLOW_ADMIN_KEY_FALLBACK` in `[env.production.vars]`);
- an `exception_until` date has passed (failure).

Token **expiry** is not a merge blocker. A blocker would also block the PR that fixes a lapsed token. Instead, a scheduled job opens an issue 21 days and 3 days before each `expires` date, and a lapsed token fails its own job loudly.

This is the static enforcement of the proposed `credential_isolation` invariant and of #28 (its CI-surface half), with #28's `applies_to` extended to every repo.

---

## 6. Runtime authentication (Workers)

- **Production admin is federated only.** Admin requests are authenticated by Cloudflare Access (a person's identity, or a per-environment Access service token for CI).
  - Static shared-secret paths (`ALLOW_ADMIN_KEY_FALLBACK`, `ALLOW_OCR_INTERNAL`) are **off in production**.
  - A config test pins both flags off in `[env.production.vars]`. OSE's `tests/prod-admin-scope-config.spec.ts`
    already pins `ADMIN_SCOPE_ALL` absent there and is the place to extend. Today `ALLOW_OCR_INTERNAL = "true"`
    *is* set for production (`workers/oursharedevents/wrangler.toml:324`), so this test lands together with the change that turns it off.

- **Service-to-service calls** (OSE↔OW, the SharedReport batch API) use a per-environment token per caller, with current and previous values accepted during rotation, and the caller's name logged.
- **Fail closed:** a missing secret refuses the request, as `admin.ts` already does. A missing data-protection key stops the write; it never writes plaintext.
- **Worker secrets are declared** in `wrangler.toml` comments *and* in the manifest. The deploy job's required-secrets check reads the manifest, not a hand-kept list.
- **No secret is a `[vars]` entry**, not even an empty one: a `[vars]` name collides with `wrangler secret put` and is shipped in plaintext.

---

## 7. Break-glass and incident response

1. **Revoke** at the provider first. Deleting the GitHub secret alone does not revoke anything.
2. **Rotate** in Doppler. The sync and the deploy job carry the new value.
3. **Scope the blast radius** from the manifest (`used_by`, `store`). Check provider audit logs (GitHub org audit log, Cloudflare audit log, Doppler activity log) for use between exposure and revocation.
4. **Record it** as a Linear issue labelled `security`, with the timeline. Close it only when every holder in the manifest has the new value.

Break-glass access (owner sets a value directly in GitHub or Cloudflare) is allowed only to restore service. It is followed within one day by putting the value into Doppler and recording the event.

---

## 8. Detection and review cadence

| When | What |
|---|---|
| Every PR | Manifest checker (§5); committed-secret scan (detect-secrets / gitleaks); GitHub push protection on |
| Weekly | Expiry report from the manifests (what lapses in the next 30 days) |
| Monthly | Review the Doppler activity log, the GitHub org audit log (App token use, secret changes) and Cloudflare token use |
| Quarterly | Calendar rotations (§2); re-run the inventory; prune unused secrets and archived references |
| Yearly | GitHub App private keys; encryption keys and signing secrets that have a keyring or `kid` (never hash peppers, which rotate on compromise only) |

**Optional canaries:** a decoy, never-used credential in each zone (e.g. a Cloudflare token with no permissions). Any use of it is an alert, because nothing legitimate calls it.

---

## 9. Agents and automation volume

Agent-authored work (Copilot, Claude sessions, scheduled routines) is the fastest-growing source of PRs and API calls. So:

- **Agent PRs are Z0** like any other PR, and the human approval gate (OSE ADR-020) stays.
- **Target:** an agent session never receives a credential above Z0. Deploys and production changes run through the environment-gated jobs, where a person approves. **Not true today** (CCR gate R17): interactive and scheduled sessions carry connectors that can query and delete production D1, run BigQuery SQL, merge PRs and dispatch workflows, and they act as the owner's GitHub account (R16). Each session type gets a recorded connector list, read-only where possible, and no production-capable connector on an unattended routine.
- **Every automated caller gets its own identity:** an App, an Access service token, or a per-caller service token. A burst of calls is then attributable and can be cut off without cutting off everyone.
- Provider-side limits cap the damage of a runaway or hijacked automation:
  - Anthropic spend limits;
  - Cloudflare rate-limiting rules on admin and auth paths;
  - the Worker's own rate limits on public reads and forms.

---

## 10. Testing: static gates and red-team tests

Static gates prove the configuration looks right. Red-team tests prove an attacker **cannot** reach a secret. Both are required, and both follow the rules the other 0-architecture invariants follow.

- **Every fix is paired with its red-team test.** The pairs and their order are in the inventory reference, §3.
- **Born red:** each test is first shown succeeding as an attack against today's `main`.
- **Mutation-checked:** each test is shown to fail when its fix is reverted or weakened.
- **Wired and blocking:** each runs in the T0 invariants shard or a named workflow. It blocks merges, and it blocks the launch GO/NO-GO.
- **Safe:** attacks run in a sandbox repo with test-only credentials, never against real secrets.

The attack classes the suite must cover:

- a malicious same-repo PR that edits a workflow to print or send out secrets;
- credentials read from `.git/config`, `http.extraheader` or `$RUNNER_TEMP`;
- a poisoned dependency (`postinstall`) reading the environment and files;
- `workflow_run` spoofing via `full-pipeline/*` or fork branches;
- injection through dispatch inputs;
- production admin bypass (static header, Bearer key, staging Access token, none);
- cross-environment credential reuse;
- the blast radius of a stolen App token, including use after expiry;
- revocation and expiry failing closed;
- canary-credential detection.

**Done and launch:**

- A story is not Done while a credential-isolation gate or red-team test is red.
- A product does not launch until every gate is green and every open exposure record is closed.

## 11. Provenance

- Derived from ADR-012 (2026-10-01), and from invariant #28's 2026-09-26 decision (environment secrets with required reviewers).
- Builds on:
  - the ADR-008 rollout gate findings F2, F6, F12 and D1;
  - OSE-349's "Doppler is the only writer" (`ourSharedEvents/docs/doppler/CF-ACCESS-SECRETS-SOURCE-OF-TRUTH.md`);
  - ourWKRP's per-environment Doppler service tokens (`ourWKRP/.github/workflows/ci.yml:395-396`).
- **Supersedes, once accepted:** the ad-hoc rotation notes in `ourSharedEvents/docs/runbooks/RUNBOOK-SECRETS.md` and `.github-secrets-required.json`. Their content moves into the manifests.
