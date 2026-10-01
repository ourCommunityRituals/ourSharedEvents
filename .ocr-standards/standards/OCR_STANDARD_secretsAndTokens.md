# Secrets and Tokens Standard — OCR Org-Level

> **Status:** PROPOSED (ADR-012, 2026-10-01). It becomes binding when ADR-012 is accepted.
> **Applies to:** every repo in the fleet, every CI workflow, every deployed Worker, and every person with a credential.
> **Inventory and plan:** `docs/references/OCR_REFERENCE_secretsInventory_2026-10-01.md`.

One idea runs through this standard: **a secret belongs to one trust zone, lives as briefly as its job allows, and is written in one place (Doppler).** Everything below is a consequence of that.

---

## 1. Trust zones

A trust zone is a set of places where code of one trust level runs. A secret is assigned to exactly one zone, and only that zone may reach it.

| Zone | Where | Trigger shape | May hold |
|---|---|---|---|
| **Z0 Untrusted code** | Any job that runs pull-request code, or runs `npm ci` / `pip install` on a pull-request lockfile | `pull_request`, `merge_group`, and any job that checks out a non-`main` ref | **Read-only**, repo-scoped, ≤1-hour GitHub App tokens (§4.1). `GITHUB_TOKEN` at `contents: read`. Nothing else |
| **Z1 Trusted CI** | Jobs that run only `main` code and test against **staging** | `push` to `main`, `schedule`, `workflow_dispatch` on `main` | Staging **test** credentials (CF Access service token for CI, staging admin key), from GitHub environment `staging` |
| **Z2 Staging deploy** | The job that deploys to staging and migrates its databases | as Z1 | Staging deploy and data credentials, from environment `staging` |
| **Z3 Production** | Production deploy, migration and smoke jobs | Tag or `main`, through environment `production` | Production credentials, from environment `production`, which has a **required reviewer** and a **deployment branch rule** (`main` and release tags only) |
| **Z4 Org automation** | Jobs that write to *other* repos (standards propagation, conformance refresh PR) | `push` to `main`, `schedule`, `workflow_dispatch`. **Never** in a workflow file that has a `pull_request` trigger | A GitHub App installation token with write on the named repos only, minted per run (§4.1) |
| **Z5 Runtime** | Deployed Workers | — | Worker secrets, **a distinct value per environment**, written from Doppler by the Z2/Z3 deploy job. Never stored in GitHub |
| **Z6 People** | Operators' machines and dashboards | — | Personal Doppler / Cloudflare / GitHub sessions with SSO and two-factor. Personal tokens never enter CI |

### 1.1 The hard rule about repository secrets

**A repository-level or organization-level secret is in Z0**, whatever the workflow says.

- On a same-repo pull request, GitHub runs the workflow file *from the pull request*. Its author can edit any job to print any repo or org secret.
- The only GitHub-side wall is an **environment** with a required reviewer or a deployment branch rule. The job can name the environment, but it cannot get past the gate.
- So:
  - Anything above Z0 is stored **only** as an environment secret.
  - Repository and organization secrets may hold only what Z0 may hold: ideally nothing; at most GitHub App IDs and private keys used to mint read-only tokens (§4.1).
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
| **Expiring API token** | Cloudflare API tokens, Cloudflare Access service tokens, Doppler service tokens | **≤90 days, set as an expiry when created** | Created with an end date. The manifest records it (§5). Renewed by the owner before it lapses |
| **Non-expiring API key** | Anthropic API key, Linear API key, Google Maps key | Rotated **every 90 days** on a calendar | The provider cannot set an expiry. Each key also gets a **spend or rate cap** at the provider where one exists |
| **Shared auth secret** | `ADMIN_KEY`, `X_OCR_INTERNAL`, `OSE_INTERNAL_BATCH_TOKEN`, `WKRP_SERVICE_TOKEN` | Rotated **every 90 days**, and **never accepted in production** once a federated path exists (§6) | Two-value overlap: the Worker accepts `current` and `previous` during the swap |
| **Data-protection key** | `FORMS_ENCRYPTION_KEY`, `FORMS_HASH_PEPPER`, `ANON_ID_HASH_PEPPER`, `IP_HASH_PEPPER`, `SHARED_REPORT_SIGNING_SECRET`, `SPONSOR_INVITE_SIGNING_SECRET`, `WKRP_ENCRYPTION_KEY`, `WIF_PRIVATE_KEY_PEM` | **Versioned**, never blind-swapped. Rotated on compromise, or yearly | §2.1 |
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
| `oursharedevents`, `ourwkrp` (one per deployed product) | `dev`, `stg`, `prd` | That product's CI test credentials, deploy credentials and Worker runtime secrets |
| `ocr-platform` | `ci`, `automation` | Org-level: GitHub App IDs and private keys (`ci` = reader App, `automation` = writer App), fleet Linear key |
| `dev_personal` (per person) | `dev` | Local-only conveniences. **Never a value that also exists in `stg` or `prd`** |

`dev` never holds a production value. `stg` and `prd` never share a value. The manifest check (§5) compares their fingerprints, never the values.

### 3.2 How values leave Doppler

- **To GitHub:** Doppler's GitHub Actions sync.
  - `stg` goes to **environment `staging`**, `prd` to **environment `production`**, and `ocr-platform/ci` to the narrow repo or org secret §1.1 allows.
  - **Never** sync a product config to repository secrets. That is what makes today's production jobs read staging values.
- **To Workers:** the environment-gated deploy job writes Worker secrets from its own config, e.g.
  `doppler secrets download --no-file --format json | npx wrangler secret bulk --env <env>`.
  - This uses a per-config, read-only Doppler service token held as that environment's secret.
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

### 4.1 Cross-repo access uses GitHub Apps, not personal access tokens

Two org-owned GitHub Apps replace `OCR_PROPAGATE_TOKEN`:

| App | Installed on | Permissions | Zone |
|---|---|---|---|
| `ocr-ci-reader` | `OCR-docs`, the hub (`ourCommunityRituals`) and the repos `brain-location-audit` reads | `contents: read`, `metadata: read` | Z0 |
| `ocr-automation` | the 7 spokes that receive standards, plus `ourSharedEvents` for the conformance PR | `contents: write`, `pull-requests: write`, `issues: write` (OSM flag-change issue) | Z4 |

- Each job mints a token with `actions/create-github-app-token` (pinned by SHA), narrowed to the repos and permissions that job needs (`repositories:` and `permission-*` inputs). The token expires within an hour.
- The App private key is the long-lived secret:
  - `ocr-ci-reader`'s key may be a repo or org secret, because the worst it can do is read.
  - `ocr-automation`'s key is an **environment secret** (environment `automation`, deployment branch rule `main`), never a repo or org secret.
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
  - `workflow_run` jobs that check out `head_sha` must also require `github.event.workflow_run.head_repository.full_name == github.repository`.
- **Shell inputs:** no `${{ inputs.* }}`, `${{ github.event.* }}` or `${{ secrets.* }}` inside a `run:` script. Pass them through `env:` and quote them.
- **Actions:**
  - Third-party actions are pinned to a full commit SHA with the tag in a comment, already proposed in ciConventions §3. First-party `actions/*` may stay on a major tag.
  - Dependabot (`package-ecosystem: github-actions`) keeps the pins current.
- **Egress:** `step-security/harden-runner` (pinned) runs first in every job that holds a Z2+ secret, in `audit` mode now, moving to `block` with an allowlist once the allowlist is known.

### 4.3 Cloudflare

Cloudflare API tokens can be limited to an account or zone, but not to one Worker or one database. So separation comes from **separate tokens per job class**:

| Token | Permissions | Environment | Expiry |
|---|---|---|---|
| `CF_DEPLOY_STG` | Workers Scripts edit, D1 edit, KV/R2 as bound | `staging` | 90d |
| `CF_DEPLOY_PRD` | the same, used only by production jobs | `production` | 90d |
| `CF_READ` | Workers Scripts read, D1 read (`secret list`, canary checks) | `staging` / `production` as used | 90d |
| `CF_DNS` | Zone DNS edit | none in CI (people only) | 90d |

- A second Cloudflare account for production is the stronger wall. It is ADR-012 Alternative C, deferred to the owner.
- Cloudflare Access service tokens are per environment (`CF_ACCESS_CLIENT_ID/SECRET` in each environment), with a duration ≤1 year.

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

A fleet checker, shipped from OCR-docs like `identity-contract` and run on every PR, fails when:

- a workflow references `secrets.X` with no manifest entry, or a manifest entry is unused;
- a secret's `store` is a repository or org secret while its `zone` is above Z0 (§1.1);
- a job reachable from a `pull_request` workflow references a secret, or names an environment, above Z0;
- a checkout with `token:` lacks `persist-credentials: false` outside a Z4 job;
- a third-party `uses:` is not SHA-pinned;
- a workflow lacks top-level `permissions:`;
- an `expires` date is within 14 days (warning) or past (failure).

This is the fleet-wide enforcement of invariant #28. The brain record extends #28's `applies_to` to every repo, with this checker as its enforcement.

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
| Yearly | GitHub App private keys; data-protection keys that have a keyring |

**Optional canaries:** a decoy, never-used credential in each zone (e.g. a Cloudflare token with no permissions). Any use of it is an alert, because nothing legitimate calls it.

---

## 9. Agents and automation volume

Agent-authored work (Copilot, Claude sessions, scheduled routines) is the fastest-growing source of PRs and API calls. So:

- **Agent PRs are Z0** like any other PR, and the human approval gate (OSE ADR-020) stays.
- An agent session never receives a credential above Z0. Deploys and production changes run through the environment-gated jobs, where a person approves.
- **Every automated caller gets its own identity:** an App, an Access service token, or a per-caller service token. A burst of calls is then attributable and can be cut off without cutting off everyone.
- Provider-side limits cap the damage of a runaway or hijacked automation:
  - Anthropic spend limits;
  - Cloudflare rate-limiting rules on admin and auth paths;
  - the Worker's own rate limits on public reads and forms.

---

## 10. Provenance

- Derived from ADR-012 (2026-10-01), and from invariant #28's 2026-09-26 decision (environment secrets with required reviewers).
- Builds on:
  - the ADR-008 rollout gate findings F2, F6, F12 and D1;
  - OSE-349's "Doppler is the only writer" (`ourSharedEvents/docs/doppler/CF-ACCESS-SECRETS-SOURCE-OF-TRUTH.md`);
  - ourWKRP's per-environment Doppler service tokens (`ourWKRP/.github/workflows/ci.yml:395-396`).
- **Supersedes, once accepted:** the ad-hoc rotation notes in `ourSharedEvents/docs/runbooks/RUNBOOK-SECRETS.md` and `.github-secrets-required.json`. Their content moves into the manifests.
