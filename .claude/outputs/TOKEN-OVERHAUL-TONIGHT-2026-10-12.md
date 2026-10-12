# Token audit and overhaul: tonight's run sheet (2026-10-12)

For the owner, at the owner's terminal and browser. **No agent sets, rotates or reads a secret**
(AGENTS.md); an agent can only check a result by **name, date or a log line**, never by value.
This sheet puts the queue in `TOKEN-OVERHAUL-QUEUE-2026-10-12.md` into an order, and adds what the
hardening CCR (HARD-5a) learned about the two tokens that matter most. Work **one credential at a
time**; each push cancels the running CI run, so let the verifying run finish before the next
step.

## 0. Before you touch anything (15 minutes)

1. **Revoke the Anthropic key** printed into a transcript on 2026-10-11 (`primaryApiKey` in
   `~/.claude/config.json`; also remove its `customApiKeyResponses` entry). Revoke at the
   provider; a rotation that keeps the old key alive does not help.
2. **Read the audit logs first, so old-token activity is still attributable** (OSE-1467):
   - GitHub: organisation → Settings → Audit log. Filter to the last 30 days. Look for
     `protected_branch.*`, `repository_ruleset.*`, `environment.*`, `workflows.*`,
     `repo.*` (visibility, collaborators, secrets), `org.*`, `personal_access_token.*` and
     **events made through a token** (the log marks programmatic access type and token id). The
     PAT behind `OCR_PROPAGATE_TOKEN` acts as you, so unfamiliar IPs or times are the signal.
   - Cloudflare: Manage Account → Audit log. Look for Worker deploys, secret changes, D1
     changes, token creation, and API-token actions you did not run.
   - Note what you saw (names and times only) in OSE-1467.
3. **Identify the PAT behind `OCR_PROPAGATE_TOKEN`** (HARD-5a, decision 4). GitHub → Settings →
   Developer settings → Personal access tokens. Check both lists (fine-grained and classic).
   Write down, for the one that matches: **type, owner account, repositories or scopes, expiry,
   last used**. If it is **classic with `repo`**, it can change branch protection on every repo you
   administer; treat it as the highest-risk credential in the org and rotate it first.

## 1. Create the replacements (before deleting anything)

Derived from what the workflows actually do with the PAT (read from the YAML, 2026-10-12);
confirm each by running the job and reading its log, and widen one permission at a time.

| New credential                         | Replaces                               | Type and scope                                                                                                                                                                                                                                                                                                           | Used by                                                                                                                                                         |
| -------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OCR_HUB_READ`                         | the read half of `OCR_PROPAGATE_TOKEN` | **Fine-grained PAT, resource owner = the organisation, read only**: repositories `ourCommunityRituals/ourCommunityRituals` (the hub, cloned by `scripts/ci-stage-ocr-workspace.sh` in about 20 jobs) and `ourCommunityRituals/OCR-docs` if the brain checks need it; Contents **read**, Metadata read; **90-day expiry** | every job that stages the hub workspace; acceptable to be PR-reachable because it cannot write                                                                  |
| `OCR_AUTOMATION_WRITE`                 | the write half                         | **Fine-grained PAT, this repository only**: Contents read and write, Pull requests read and write (opens the conformance-refresh PR); add **Checks** or **Actions** only if a job log shows it is needed; **90-day expiry**                                                                                              | `conformance-report.yml`, `notify-osm-flag-change.yml` only; **held as an environment secret on a `main`-only environment** (HARD-2, HARD-5a), never repo-level |
| `CLOUDFLARE_API_TOKEN_OSE` (new value) | the current token                      | **Account-scoped API token**, this one account: Workers Scripts **Edit**, D1 **Edit**, Workers KV Storage **Edit**, Workers R2 Storage **Edit** (those are the bindings in `wrangler.toml`: 2 D1, 1 KV, 1 R2); start there and let the deploy log tell you what is missing; **90-day expiry**                            | `deploy-staging`, `deploy-production`, the T2 to T4 sub-jobs                                                                                                    |

Decision 1 means there is **one** Cloudflare account and **one** deploy token's worth of power for
staging and production; creating one token per environment still helps (separate expiry and
separate revocation), but it does not isolate production. Say so in the inventory.

## 2. Swap, one at a time (create → set secret → run a job that uses it → read the log → delete the old)

Order, highest risk first:

1. `OCR_PROPAGATE_TOKEN`. Set `OCR_HUB_READ` as an org secret first, then **change the workflows**
   (owner-made PR; the agent token has no Workflows scope after HARD-1) so staging jobs read
   `OCR_HUB_READ`; keep `OCR_PROPAGATE_TOKEN` in place until the verifying run is green **in the
   log**; then set `OCR_AUTOMATION_WRITE`, move `conformance-report` and `notify-osm` to it; then
   **delete the old PAT in GitHub** (updating the secret alone does not revoke the old token).
2. `CLOUDFLARE_API_TOKEN_OSE`: create the new token, update the secret, let one staging deploy
   run, read the deploy log for the success line and for any "missing permission" line, then
   **delete the old token in the Cloudflare dashboard**.
3. `ADMIN_KEY`: GitHub secret **and** both Worker secrets (`wrangler secret put` per environment,
   separate values), then `curl` the health route through your normal path to confirm.
4. `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`: rotate the service token in Cloudflare
   Access, update both secrets, run `smoke-staging`.
5. `X_OCR_INTERNAL`: staging only (production has none, verified 2026-10-12).

**Do not rotate** the data-protection keys tonight (`FORMS_ENCRYPTION_KEY`, the peppers, the
signing secrets): a new value breaks stored data, and OSE-1467 does not list them as exposed.

## 3. Create the missing ones that make monitors real

`BRANCH_PROTECTION_READ_TOKEN` (fine-grained, this repository, **Administration: read**, 90-day
expiry; an **environment secret on a `main`-only environment**, HARD-2), `CLAUDE_CODE_OAUTH_TOKEN`
(`claude setup-token`; the Claude PR reviewer skips every PR while its check shows green until
this exists), `STAGING_ADMIN_KEY`, `SECURITY_WEBHOOK_URL`, `LINEAR_TEAM_ID`. Before adding
`CLAUDE_CODE_OAUTH_TOKEN`, restrict the `@claude` trigger to `OWNER` (HARD-9).

## 4. Delete

`SMOKE_RPT_*` (four repo secrets, no workflow reads them; grep scripts and tests first), the
three offline `BLOODRAVEN*` runner registrations, and the `.runner` / `.credentials*` files in
the three `actions-runner*` folders.

## 5. This workstation (HARD-4 "today")

- **Revoke or read-scope the token behind the `mcp__cloudflare__*` connector.** That connector
  lists write tools (worker_deploy, secret_put, d1_delete_database, kv_put, route_delete) in
  agent sessions; the merged hook blocks them by name, but the credential is the control.
- **Install the merged v1 hook** (HARD-4): `node scripts/hardening/apply-workstation.mjs`, read
  the plan, `--apply`, type `APPLY`, then a new session, then ask it to run `npx wrangler
secret:bulk does-not-exist.json` and see `[wrangler-secret]`.
- Log wrangler out of the production-capable session on this machine if deploys go through CI
  (`wrangler logout`); keep the break-glass login in an account agents do not use.

## 6. Record (names, scopes, expiry; never values)

In `OCR_REFERENCE_secretsInventory_2026-10-01.md` §1, one row per credential: name, type, owner,
repositories or scopes, created, **`expires:`**, where it is stored, and who may read it. Set a
calendar reminder 14 days before each expiry. Update OSE-1467 (the six boxes) and OSE-1490.

## 7. What I will check afterwards (names and log lines only)

- `gh secret list` (repo, environments, org): names and dates; no old token's name left behind.
- The verifying run's log for each swap: the success line, no auth failure.
- `node scripts/check-pr-secret-exposure.mjs --report`: which secrets remain PR-reachable.
- That no agent session transcript from tonight contains a value (if one does, rotate it again).

## Stop conditions

Stop and tell me if: a verifying run is red for an auth reason you cannot read from the log; a
credential you did not create appears in an audit log; the PAT turns out to be classic with admin
rights on repositories other than these (rotate it first and review those repositories'
protection tonight).
