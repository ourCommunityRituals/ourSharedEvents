# Runbook: the agent's own GitHub identity (a GitHub App)

> Story: OSE-1746 (agent identity). Related: OSE-1698 (required review), OSE-2121.
> Written: 2026-11-18. Owner steps only: an agent never creates the App, installs it,
> sets secrets or variables, or changes branch protection (AGENTS.md "Human approval").

## Read this first (one minute)

- **Why:** agents open pull requests as your account today. GitHub never counts an
  author's own approval, so "require review" would block every merge while you are the
  only code owner. An App gives agents their own name, `ocr-agent[bot]`, so your review
  counts, and new teammates can be added later by joining a team.
- **Safe to stop at any step.** Nothing here changes `main` until Part F, and Part F has
  its own undo.
- **Never** paste the private key or any token into chat, Linear, a commit, or a Claude
  session. You only ever type it into GitHub's own secret box.
- **Do not turn on "Require review from Code Owners" yet.** Agent PRs are still authored
  by `bereasonable13`, the only code owner, so every agent PR would be stuck. Part F says when.

Tick each box as you go. If you stop, the ticks show where you are.

---

## Part A. Create the App (about 5 minutes)

- [ ] 1. Open **github.com/organizations/ourCommunityRituals/settings/apps**.
      (Or: your org page → **Settings** → bottom of the left menu → **Developer settings** → **GitHub Apps**.)
- [ ] 2. Click **New GitHub App**.
- [ ] 3. **GitHub App name:** `ocr-agent`.
      If GitHub says the name is taken, use `ocr-agent-ourcommunityrituals` and tell the next agent session the name you used.
- [ ] 4. **Homepage URL:** `https://github.com/ourCommunityRituals`
- [ ] 5. **Webhook:** untick **Active**. (The App needs no webhook.)
- [ ] 6. **Permissions → Repository permissions.** Set only these. Leave every other line on **No access**.

  | Permission    | Set to         | Why                                                       |
  | ------------- | -------------- | --------------------------------------------------------- |
  | Contents      | Read and write | push a branch for its PR                                  |
  | Pull requests | Read and write | open and update its PR                                    |
  | Issues        | Read and write | the flag-change notice opens an issue in ourSharedMagnets |
  | Metadata      | Read-only      | GitHub sets this one itself; you cannot turn it off       |

  **Not** these, on purpose: Administration, Secrets, Variables, Environments,
  Workflows, Actions (write), Deployments, Members, any **Organization** or **Account** permission.
  Without **Workflows**, the App cannot change files in `.github/workflows/`, so it cannot edit CI.

- [ ] 7. **Where can this GitHub App be installed?** → **Only on this account**.
- [ ] 8. Click **Create GitHub App**.

## Part B. Note the App ID and make the key (about 3 minutes)

- [ ] 9. On the page that opens, find **App ID** (a number near the top). Write it on paper or keep the tab open. It is not a secret.
- [ ] 10. Scroll to **Private keys** → **Generate a private key**. Your browser downloads a `.pem` file.
- [ ] 11. Keep that file only until Part D, step 19. Do not email it, upload it, or open it in a chat.

## Part C. Install it on the repositories (about 2 minutes)

- [ ] 12. Left menu of the App page → **Install App** → **Install** next to `ourCommunityRituals`.
- [ ] 13. Choose **Only select repositories** and pick two:
      `ourSharedEvents` (it opens the conformance-report PR here) and
      `ourSharedMagnets` (it opens the flag-change issue here).

  Add the other seven repos later, one at a time, only when a PR moves that repo's own
  automation onto the App. (Those seven were not checked in this pass.)

- [ ] 14. Click **Install**.

## Part D. Put the ID and key where the workflows can read them (about 5 minutes)

Do this in **ourSharedEvents** first. The names must match exactly.

- [ ] 15. Open **github.com/ourCommunityRituals/ourSharedEvents/settings/environments** → click **main-automation**.
      (This environment only runs on `main`, so a pull request cannot reach what you store here.)
- [ ] 16. Under **Environment variables** → **Add environment variable**.
      Name: `OCR_AGENT_APP_ID`. Value: the App ID from step 9.
- [ ] 17. Under **Environment secrets** → **Add environment secret**.
      Name: `OCR_AGENT_APP_PRIVATE_KEY`. Value: open the `.pem` file in a plain text editor, copy **all** of it (including the
      `-----BEGIN` and `-----END` lines), paste it into GitHub's box, save.
- [ ] 18. Check the page lists both **names**. GitHub never shows the key again; that is correct.
- [ ] 19. Delete the `.pem` file from your computer (and empty the trash). If you ever need a
      new key, make one in Part B step 10 and delete the old key on the App page.

Do **not** delete `OCR_AUTOMATION_WRITE` or `OCR_NOTIFY_OSM` yet. Part E removes them only after the App is proven.

## Part E. Check it worked (after the agent's follow-up PR merges)

An agent prepares a PR that switches `conformance-report.yml` and `notify-osm-flag-change.yml`
to an App token. After you merge it:

- [ ] 20. **Actions** tab → **Notify OSM on Flag Change** → **Run workflow** (branch `main`).
      Pass: it goes green, and in `ourSharedMagnets` → **Issues** → **Closed** there is a new
      "[token check]" issue whose author is **ocr-agent[bot]**.
- [ ] 21. **Actions** → **Conformance Report** → **Run workflow** (branch `main`).
      Pass: it goes green. If the report changed, the "chore: regenerate conformance report"
      PR shows author **ocr-agent[bot]** and its checks start by themselves.
      (If the report did not change, the log says "unchanged — no refresh PR needed". That is still a pass for the token.)
- [ ] 22. Only when 20 and 21 pass: **github.com/settings/personal-access-tokens** (your own
      account) → delete the tokens used for `OCR_AUTOMATION_WRITE`, `OCR_NOTIFY_OSM` and
      `OCR_PROPAGATE_TOKEN`. Then remove those three secrets from every repo and environment.
      Deleting at GitHub is what makes them useless; removing the secret alone is not enough (OSE-1467).

## Part F. Review that counts, and room for a team (later; one sitting each)

Do these in order. Each one keeps `main` mergeable for you alone.

- [ ] 23. **Make the team.** Org page → **Teams** → **New team** → name `maintainers`
      (it becomes `@ourCommunityRituals/maintainers`). Add your reviewing account.
      Then team page → **Repositories** → add `ourSharedEvents` with **Write**.
      GitHub ignores a CODEOWNERS line for a team without write access.
- [ ] 24. **Tell an agent** "the team exists". It opens a PR that changes `.github/CODEOWNERS`
      from `@bereasonable13` to `@ourCommunityRituals/maintainers`. The "CODEOWNERS owners all
      resolve" check fails that PR if the team is missing, so it cannot land too early.
      Adding a teammate later = adding them to the team. No file change.
- [ ] 25. **Decide who the agent is when it works in a Claude session.** See "Open decision" below.
      Required review only works when the agent's account is **not** the account that reviews.
- [ ] 26. **Turn on review (OSE-1698), same day as its file PR.** Settings → **Branches** → `main`
      → tick **Require a pull request before merging**, **Require approvals: 1**,
      **Dismiss stale pull request approvals**, **Require review from Code Owners**,
      **Require approval of the most recent reviewable push**. Save.
      Then ask an agent to update `tools/ci/main-branch-protection.json` to match.
      Until that PR merges the nightly drift check reports a difference; that is expected for a day.
      Since 2026-11-18, `apply-branch-protection.mjs --apply` refuses to run if it would
      delete these settings, so nobody removes them by accident.
- [ ] 27. **Prove it once.** Ask an agent for a throwaway PR authored by `ocr-agent[bot]`. Pass:
      the PR page says **Review required** and the merge button stays grey until you approve.
      Close the PR without merging.

**Undo for Part F, step 26:** Settings → **Branches** → `main` → untick **Require a pull request
before merging** → Save. You can always do this as the admin, so `main` is never locked for good.
Then ask an agent to put the file back to match.

---

## Open decision for the owner: the agent's account in Claude sessions

Checked 2026-11-18: this cloud session acts on GitHub as **`bereasonable13`**, and the last
eight PRs (#1415 to #1422) were all authored by that account. Claude cloud sessions use the
GitHub account connected at claude.ai, not a key you hand them. So the App alone changes the
**workflow-opened** PRs (conformance report, OSM notice). It does not, by itself, change who
authors PRs from a Claude session.

Never put the App's private key into a Claude session or its environment settings: it lasts
until you delete it and can mint tokens for every repo the App is installed on.

Choices (pick one before step 26):

1. **Review from a different account.** Agents keep `bereasonable13`; you review as another
   account that is in `maintainers`, and `bereasonable13` is **not** in the team. Simple, but it
   is two accounts of one person, which the original review warned about.
2. **Agents work through GitHub Actions with the App token.** The `@claude` job in
   `claude-review.yml` (or a new one) mints an App token and pushes as `ocr-agent[bot]`. Cleanest
   identity; more setup.
3. **Wait.** Keep review off (today's state) until a second person joins.

---

## For agents: what changes when PRs come from `ocr-agent[bot]` (sweep, 2026-11-18)

Line numbers are from `main` at `8c0a64d` plus this branch.

| Where                                                                                                                                                                   | Today                                                                                                                                                                                 | Under the App                                                                                                                                                                                                                                                                                                                                    | Action                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `conformance-report.yml:133`                                                                                                                                            | opens the refresh PR with `OCR_AUTOMATION_WRITE` (a PAT; PR authored by the owner). Comment at `:124-130` says a `GITHUB_TOKEN` PR triggers no checks.                                | Mint an App token (`actions/create-github-app-token`, pinned SHA) from `vars.OCR_AGENT_APP_ID` + `secrets.OCR_AGENT_APP_PRIVATE_KEY`, narrowed to this repo, contents + pull-requests write. App-token PRs do trigger checks. `--force` on the stable branch `chore/conformance-refresh` (`:157`) stays: it is the bot's own branch, not `main`. | Follow-up PR after Part D                          |
| `notify-osm-flag-change.yml:54`                                                                                                                                         | `OCR_NOTIFY_OSM \|\| OCR_PROPAGATE_TOKEN`                                                                                                                                             | App token narrowed to `ourSharedMagnets`, issues write. Drop the `OCR_PROPAGATE_TOKEN` fallback.                                                                                                                                                                                                                                                 | Same follow-up PR                                  |
| `branch-protection-drift.yml:117`                                                                                                                                       | `BRANCH_PROTECTION_READ_TOKEN` (admin-read PAT)                                                                                                                                       | Unchanged. The App has no Administration permission on purpose.                                                                                                                                                                                                                                                                                  | None                                               |
| `security-human-gate.yml` (verify step)                                                                                                                                 | decided "bot" by the letters bot/claude/github-actions in a `gh pr view --json` login. GraphQL logins of Apps have no `[bot]` (inferred), so `ocr-agent` would have read as a person. | Decided by REST account `type` via `scripts/ci/pr-actor-kind.mjs`; approvals count only from people with write association whose latest decision is APPROVED.                                                                                                                                                                                    | **Fixed in this PR**                               |
| `security-human-gate.yml`                                                                                                                                               | header said it is a required check                                                                                                                                                    | It is not in `tools/ci/main-branch-protection.json`, so it is advisory.                                                                                                                                                                                                                                                                          | Owner choice (make it required)                    |
| `scripts/apply-branch-protection.mjs --apply`                                                                                                                           | PUT the whole file; the file says `required_pull_request_reviews: null`, so it would delete review set by hand                                                                        | Refuses (exit 1, nothing sent) when the PUT would loosen live protection; `--allow-weaken` for a planned rollback                                                                                                                                                                                                                                | **Fixed in this PR**                               |
| `tools/ci/main-branch-protection.json:19`                                                                                                                               | `required_pull_request_reviews: null`                                                                                                                                                 | Changes only with Part F step 26                                                                                                                                                                                                                                                                                                                 | Later PR                                           |
| `scripts/check-pr-linear-close.mjs`                                                                                                                                     | reads branch, title, body, commits                                                                                                                                                    | No author read. Not affected.                                                                                                                                                                                                                                                                                                                    | None                                               |
| `premature-close-detector.yml` / `scripts/detect-premature-close.mjs`                                                                                                   | Linear + PR bodies                                                                                                                                                                    | No author read. Not affected.                                                                                                                                                                                                                                                                                                                    | None                                               |
| `claude-review.yml:235,307` (`anthropics/claude-code-action`)                                                                                                           | runs on PR events by the owner                                                                                                                                                        | The action skips bot-triggered runs unless `allowed_bots` is set (inferred from the action's documented inputs; not read at the pinned SHA). The review is advisory (`continue-on-error`) and not required, so nothing blocks; the review would just not run.                                                                                    | Add `allowed_bots: ocr-agent[bot]` with the switch |
| `claude-review.yml:271`                                                                                                                                                 | `@claude` gated on the **commenter's** `author_association`                                                                                                                           | Not the PR author. Not affected.                                                                                                                                                                                                                                                                                                                 | None                                               |
| `brain-contract-check.yml:208`                                                                                                                                          | passes `pull_request.user.login` to `open_drift_ticket.py`                                                                                                                            | An unknown login falls back to the token owner as assignee (per the 2026-10-26 check). Harmless.                                                                                                                                                                                                                                                 | None                                               |
| `github.actor != 'dependabot[bot]'` (about 20 sites: `flags-package-ci.yml`, `inv22-cross-repo-gate.yml`, `brain-contract-check.yml`, `oursharedevents-ci.yml:982,996`) | special case for Dependabot only                                                                                                                                                      | Does not match `ocr-agent[bot]`, so App PRs get every check. Wanted.                                                                                                                                                                                                                                                                             | None                                               |
| `.github/CODEOWNERS` (12 lines)                                                                                                                                         | every line names `@bereasonable13`                                                                                                                                                    | Moves to `@ourCommunityRituals/maintainers` in Part F step 24                                                                                                                                                                                                                                                                                    | Later PR                                           |
| `branch-protection-drift.yml:80-95`                                                                                                                                     | CODEOWNERS errors check                                                                                                                                                               | Fails the CODEOWNERS PR if the team does not exist or lacks access                                                                                                                                                                                                                                                                               | None (it is the safety)                            |
