# Copilot PR — CI Approval Runbook

**Audience:** whoever (human or Claude) is shepherding a **Copilot-authored** PR through CI.
**Scope:** PRs opened by the GitHub Copilot coding agent (author `app/copilot-swe-agent`,
commits authored by `Copilot`) in `ourCommunityRituals/ourSharedEvents`.
**Why this exists:** GitHub holds **all** Actions workflows on Copilot-authored PRs pending a
human's **"Approve and run workflows"** click. The runs are created but execute **zero jobs** until
approved. This looks identical to "the pipeline is broken" but it is not — it is a deliberate
security gate. This runbook is how you tell the two apart and clear the gate correctly.

> **Prime directive.** The approval click is a **feature, not a defect.** We keep it on purpose
> (see [ADR-020](../../../../docs/adr/ADR-020-copilot-ci-human-approval-gate.md)). Do **not**
> "fix" a held Copilot PR by disabling the gate, by re-authoring the PR to bypass it, or by
> touching `oursharedevents-ci.yml` — the pipeline is healthy. Approve it, or leave it held.

---

## 1. The tell — how to recognize the gate (vs. a real failure)

On a Copilot PR you will see **most checks missing** and the run(s) held. Symptoms:

- `gh pr checks <PR>` lists only the **ungated** checks (e.g. the GitHub-managed
  `CodeQL - Code Quality` default setup) — **not** `S0 Security`, `T0 Gate (*)`, etc.
- The GitHub UI shows a yellow banner: **"N workflows awaiting approval"** with an
  **"Approve and run workflows"** button.
- The run's conclusion is literally `action_required` with **0 jobs**.

Confirm it is the gate and not a failure — one command, unambiguous:

```bash
# Grab a held run id from the PR, then inspect it:
gh run list --branch <copilot-branch> --limit 20
gh api repos/ourCommunityRituals/ourSharedEvents/actions/runs/<RUN_ID> \
  --jq '{status,conclusion,triggering_actor:.triggering_actor.login,event}'
# Gate signature:  {"status":"completed","conclusion":"action_required","triggering_actor":"Copilot","event":"pull_request"}
```

`conclusion: action_required` + `triggering_actor: Copilot` + **0 jobs run** = the approval gate,
**not** a code failure. Contrast: the same jobs run green with **no** approval on a **human** PR
(reference: PR #647 ran the full `S0 → T0 → …` chain clean). The workflow files are identical for
both — the only difference is the PR author identity.

---

## 2. The fix — approve the run

1. Open the PR on GitHub → **Conversation** tab (banner) or **Checks** tab.
2. Click **"Approve and run workflows."** (You need **write** access to the repo.)
   - This approves **all** held workflows for the **current commit** at once. The full
     `S0 → T0 → (downstream)` chain then runs continuously from that single click.
3. Watch it land (see §4).

**It must be repeated on every new Copilot push.** Each new commit re-arms the gate. That recurring
click **is** the intended human break — it is the moment a human eyeballs agent-authored changes
before they run with repo secrets.

> **The REST `/approve` endpoint does NOT work here.** `POST …/actions/runs/<id>/approve` returns
> `403 "This run is not from a fork pull request or queued by the Actions bot"` — that endpoint is
> only for **fork / first-time-contributor** PRs. A Copilot PR is same-repo, so it is gated by the
> **Copilot-specific** control, which is cleared **only** via the UI button (or the repo setting we
> deliberately leave off — §3). There is no `gh` one-liner for it.

---

## 3. What we deliberately do NOT do

- ❌ **Do not enable** Settings → _Code, planning, and automation_ → **Copilot → Cloud agent →
  "skip approval for Actions workflows."** That would auto-run unreviewed, agent-authored code with
  access to `pull_request`-job secrets (e.g. `OCR_HUB_READ` — used by S0/T0 and several other
  PR-triggered workflows — plus `ANTHROPIC_API_KEY`, `LINEAR_API_KEY`). Rationale + rejected alternatives:
  [ADR-020](../../../../docs/adr/ADR-020-copilot-ci-human-approval-gate.md).
- ❌ **Do not** re-route the work to a human/Claude-Code author _for the purpose of dodging the
  gate._ That removes the approval break on purpose-built agent output.
- ❌ **Do not** edit `oursharedevents-ci.yml` job graph / `needs:` / required-check names to "make
  it run." Nothing there is broken. Required checks (`S0 Security`, `T0 Gate (lint|typecheck|
tests|a11y|invariants)`, `Gate-execution reconciler`, `Invariant #22 …`) all still map to live
  jobs — proven green on human PRs.

---

## 4. After approval — watch it, then read it as normal CI

```bash
gh run list --branch <copilot-branch> --limit 20      # OurSharedEvents CI/CD flips action_required → in_progress → completed
gh pr checks <PR>                                       # S0 Security + T0 Gate (*) now report
```

Once approved, this is ordinary CI:

- On a normal `copilot/*` branch, **deploy jobs skip** (deploy only runs on push to `main`,
  a `v*` tag, `workflow_dispatch`, or a PR branch named `full-pipeline/*`). So an approved Copilot
  PR exercises `S0` + `T0` + the PR-scoped test tiers; the staging deploy/smoke/contract tiers that
  `need` deploy are skipped, and **no Cloudflare deploy credentials are used**.
- A **red required check now is a real signal** — the first real signal of whether the agent's code
  is sound. Triage it like any failure (read the logs, fix the code). Do **not** treat a genuine
  failure as something to re-approve around.

---

## 5. Quick reference

```bash
# Is it the gate, or a failure?  (gate == action_required + Copilot + 0 jobs)
gh api repos/ourCommunityRituals/ourSharedEvents/actions/runs/<RUN_ID> \
  --jq '{status,conclusion,triggering_actor:.triggering_actor.login,event}'

# Approve:  UI only — PR → "Approve and run workflows"  (write access; per push)
#   (no gh/REST equivalent for same-repo Copilot PRs; fork /approve → 403)

# Watch after approving
gh run list --branch <copilot-branch> --limit 20
gh pr checks <PR>
```

> Decision of record: **keep the human approval gate** —
> [ADR-020](../../../../docs/adr/ADR-020-copilot-ci-human-approval-gate.md). If you ever feel the
> per-push click is "friction to remove," re-read the ADR's Alternatives Considered first: the safe
> way to remove it is to de-secret every `pull_request` job, not to flip the setting.
