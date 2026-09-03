# OCR_STANDARD_ciConventions

**Status:** PROPOSED (2026-09-03) · **Owner:** infra / SDET · **Last updated:** 2026-09-03

> **PROPOSED — not yet ratified.** This standard codifies CI-workflow conventions that
> today propagate by copy-and-drift between OSE (base) and the spokes. It emerged from the
> OSE↔OW CI-sync reconciliation (extended-SCRUM 3-loop CCR, 2026-09-03) after WKRP's
> Claude review workflow drifted from OSE's hardened version and broke a PR. Ratification
> path: brain CCR (governance-artifact review) → merge → propagate to every repo's
> `docs/standards/`. §8 proposes the machine-enforcement follow-on.

The rule set below answers one recurring question: **when is a CI check allowed to block a
PR, and how must third-party actions and models be pinned?** It is the missing "Layer B"
(CI conventions) alongside the governance invariants in `architectural-invariants.yaml`.

---

## 1. Advisory vs. blocking — the core classification

Every CI check is exactly one of two kinds. Misclassifying either way is a defect.

| Kind | Mechanism | Use for | Rationale |
|---|---|---|---|
| **Blocking** (default) | no `continue-on-error` | Deterministic gates: unit / integration / contract / security / E2E / invariant conformance | A red here is a **code defect**. It must stop the merge. |
| **Advisory** | `continue-on-error: true` at **job and step** | Nondeterministic external-service bots (LLM code review, third-party APIs) | A red here is usually **infrastructure** (API outage, rate-limit, marketplace-clone failure, model rollout), not a code defect. It must **not** gate delivery. |

**The test:** *If this check went red, would a correct diff be to blame?* Yes → blocking. "Not
necessarily" → advisory. A Claude review bot fails this test (an API 529 reds a perfect PR);
a determinism gate passes it (only a real tie-unstable query reds it).

## 2. The branch-protection corollary (the trap)

`continue-on-error: true` in the workflow file is **undone** if the check's name is listed in
branch protection's *required status checks*. The job reports "advisory" but branch protection
still blocks the merge on it. Advisory-in-file ≠ advisory-in-practice.

**Rule:** an advisory check MUST NOT appear in `required_status_checks.contexts`. When a
workflow is (re)classified advisory, the same change set must remove it from required checks
(owner action — branch protection is not editable from a workflow file).

> This is not hypothetical: it is the exact mechanism by which a Claude-review infrastructure
> crash showed as a hard red on a healthy PR (OSE↔OW sync, 2026-09-03).

## 3. Third-party action pinning

Pin every non-first-party action to a **full commit SHA**, not a mutable tag:

```yaml
uses: anthropics/claude-code-action@fa2b2666b747000bf42767d1f332065b375e3c8f # v1
```

A `@v1` tag can be force-pushed by the action owner to run arbitrary code with the job's
secrets (`ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, propagate tokens) and permissions. Keep the
`# v<major>` trailing comment for legibility; bump via Dependabot. First-party
`actions/checkout` / `actions/setup-node` may use major-version tags.

## 4. Model pinning

Any workflow that invokes a Claude model MUST pin an **explicit, current, non-dated alias**
(e.g. `claude-sonnet-4-6`, `claude-opus-4-8`).

- **Never** rely on an action's rolling default. It moves under you; a rollout to an id your
  key can't serve returns `is_error` with zero token usage → a hard red (or, under
  `continue-on-error`, a **silently dead** review). This broke a WKRP PR on 2026-09-03.
- **Never** pin a **dated snapshot** (e.g. `claude-sonnet-4-20250514`). Dated ids retire; on
  an advisory workflow the retirement fails *silently*, leaving a dead gate. Use the alias.

## 5. Concurrency groups include the event name

A workflow that triggers on more than one event (e.g. `pull_request` + `issue_comment`) MUST
scope its concurrency group by event, or a fast second-event run cancels the real one:

```yaml
concurrency:
  group: <name>-${{ github.event.pull_request.number || github.event.issue.number }}-${{ github.event_name }}
  cancel-in-progress: true
```

Without `${{ github.event_name }}` in the group, `cancel-in-progress` cancels an in-flight
review when a bot comment fires seconds later — the review shows red having never run
(the OSE-888 finding).

## 6. LLM-triggering workflows are trusted-actor-gated

Any workflow that feeds untrusted text (PR/issue comment bodies) to an LLM agent running with
secrets and write scopes MUST gate on `author_association`:

```yaml
if: contains(fromJSON('["OWNER", "MEMBER", "COLLABORATOR"]'), github.event.comment.author_association)
```

Ungated, any commenter can trigger prompt-injection or API-spend DoS. (Dr. Security, top
finding of the 2026-09-03 sync — OSE's `@claude` path was open.)

## 7. Byte-identical propagated files carry an integrity guard

When a file is propagated **byte-identical** across repos (e.g. `scripts/pw-guarded.sh`,
propagated from OSE), a prose header ("fix upstream and re-propagate, don't edit in place") is
not a gate. Add a checksum test that fails on local divergence, so the propagation contract is
enforced rather than hoped. Fix upstream → re-propagate → the guard's expected hash moves with
the propagation commit.

## 8. Enforcement (proposed follow-on)

This document is human-readable Layer B. The concrete, cheaply-machine-checkable rules —
**§3 SHA-pinning** and **§4 no rolling/dated model** — SHOULD be promoted to a Level-1 lint in
`ocr-docs-brain` (a workflow-file scan asserting no unpinned `uses:` and no rolling/dated
model), mirroring how other standards graduate from prose to `architectural-invariants.yaml`.
§1/§2 (advisory-vs-blocking, branch-protection parity) are policy judgments that stay
human-enforced. Whether to open a numbered invariant now or run as a doc first is an owner
decision recorded here rather than pre-empted.

---

## 9. Provenance

Distilled from the OSE↔OW CI-sync reconciliation, 2026-09-03 — an extended-SCRUM 3-loop CCR
(leads weighted: Dr. Security / Sr. Architect / SDET-SRE; full team voiced), overall
confidence ~96%. Best-of-both, not one-directional copy: §1/§2/§5 (advisory, concurrency,
no-key skip) flowed OSE→WKRP; §6 (trusted-actor gate) and the born-red determinism-gate
discipline flowed WKRP→OSE. Shipped exemplars: `ourWKRP#53`, `ourSharedEvents#452`.
