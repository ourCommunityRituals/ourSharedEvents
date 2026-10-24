# Agent identity: GitHub App + WSL2 sandbox (OSE-1697)

Owner decision 2026-10-22: yes to a GitHub App for agents, run from a WSL2 sandbox. This sheet is the order of work. Names, dates and run ids only; never paste a key or token in chat.

## What this fixes

- Today the agent signs in as the owner (SSH key, credential manager, `gh`). The tag ruleset, environment reviewers and required reviews are advisory against that identity.
- One account is author and sole reviewer, so merges go through admin bypass (`protected_branch.policy_override`: 80 events in OCR-docs, 1 in ourSharedEvents, 2026-08-02 to 2026-10-15). A separate author lets the owner be the real reviewer. It is also the segregation-of-duties item for SOC 2 (OSE-1720).

## What it will not do

- The App cannot change `.github/workflows/*` (no Workflows permission), cannot touch secrets, environments, rulesets or branch protection. Every workflow edit stays owner-made. This is the point, and it has a cost: workflow PRs are written by the owner or by an agent whose branch the owner pushes.
- The sandbox only protects if agent sessions actually run inside it. A session started from the Windows desktop app still has the Windows credential manager. See Part B, step 6.

## Part A: create the App (owner, browser, about 10 minutes)

1. GitHub, organization ourCommunityRituals, Settings, Developer settings, GitHub Apps, New GitHub App.
2. Name `ocr-agent-ose`. Homepage URL: the repo URL. Webhook: untick Active.
3. Repository permissions, set exactly these and nothing else:
   - Contents: Read and write
   - Pull requests: Read and write
   - Issues: Read and write
   - Actions: Read-only
   - Metadata: Read-only (automatic)
     Leave Workflows, Administration, Secrets, Environments, Pages and everything else at No access.
4. Where can this App be installed: Only on this account. Create.
5. On the App page note the **App ID** (a number, not a secret).
6. Generate a private key. A `.pem` downloads. **That file is the secret.** Move it straight into the sandbox (Part B, step 4), then delete it from Downloads and the Recycle Bin.
7. Install App, choose the org, **Only select repositories**, pick ourSharedEvents only. Note the installation id from the URL after install (a number).
8. Tell me: App ID and installation id. Never the key.

## Part B: the sandbox (me guiding, owner at the terminal)

1. New distribution, not your daily one: `wsl --install -d Ubuntu --name ocr-agent` (Ubuntu is already present; a second named distro keeps it separate).
2. In the distro, `/etc/wsl.conf`:
   ```
   [interop]
   enabled=false
   appendWindowsPath=false
   [automount]
   enabled=false
   ```
   Then `wsl --terminate ocr-agent` and reopen. This cuts the agent off from Windows executables, the Windows PATH and the C: drive, so it cannot reach the credential manager or your SSH key.
3. Inside: git, gh, node, and Claude Code. No SSH keys, no `gh auth login`.
4. Copy the `.pem` in through the WSL file share (`\\wsl$\ocr-agent\home\<user>\.config\ocr-agent\app.pem`), `chmod 600`, then delete the Windows copy.
5. I write `~/.config/ocr-agent/mint-token.mjs` (signs a 9-minute JWT with the key, exchanges it for a 1-hour installation token, scoped to ourSharedEvents) and a git credential helper that calls it. Nothing is stored on disk but the key. Clone the repo over HTTPS inside the distro.
6. Run agent sessions from inside the distro (terminal). The Claude desktop app on Windows is not inside the sandbox; I have not confirmed whether it can attach to a WSL session, so treat desktop sessions as owner-identity sessions until it is tested.

## Part C: probes (owner's terminal, agent credential outside the harness)

Each must be refused by GitHub; record the response code, not the token:

- `GET /repos/ourCommunityRituals/ourSharedEvents/actions/secrets`
- `GET /repos/.../branches/main/protection`
- `POST /repos/.../rulesets`
- a push that touches `.github/workflows/*`
- a tag push
- a push to another org repo (App is installed on one)

These are the acceptance probes in OSE-1697. I will record the results on the ticket.

## Part D: make it count

1. Rulesets: confirm the App is **not** a bypass actor anywhere. Interim, until the first App PR merges clean: set bypass mode to `pull_request` on the OCR-docs `main` ruleset (id 15221497).
2. Audit: after one week, count `protected_branch.policy_override` events from the audit log; the target is 0 for App-authored PRs.
3. Rollback: delete the App installation, `gh auth login` as the owner, re-add the SSH key.

## Open items I cannot confirm from here

- Whether a GitHub App installation consumes an enterprise seat. Standard behavior is that it does not; the draft in PR #976 marked it unconfirmed.
- Whether Claude Code desktop sessions can run inside the WSL distro (Part B step 6).
- Key rotation: App keys do not expire. Put a 90-day rotation date on the board when it is created.
