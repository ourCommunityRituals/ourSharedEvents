# Moving the other repos off OCR_PROPAGATE_TOKEN (OSE-1695, step 3.0)

Read on 2026-10-15 from the org's workflow files by name (`gh search code`, `gh api contents`). No token value was read.

## What uses the old token

Org secret `OCR_PROPAGATE_TOKEN` has visibility **all**: every repo in the org can read it. `OCR_HUB_READ` has visibility **selected: ourSharedEvents only**, so no other repo can use it yet.

| Repo                                                                            | Workflows                                                                                           | What it does with the token                                               | Kind      |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------- |
| OCR-docs                                                                        | `propagate-standards.yml`                                                                           | checkout of 7 spokes, `git push`, `gh pr create/comment` in them          | **WRITE** |
| OCR-docs                                                                        | `brain-location-audit.yml`                                                                          | checkout of hub, ourSharedEvents, Magnets, WKRP, Airwaves, Games, Records | read      |
| OCR-docs                                                                        | `nightly-sync-check.yml`                                                                            | `gh` audit of the 7 spokes ("does not modify any repo")                   | read      |
| OCR-docs                                                                        | `design-system-check.yml`                                                                           | checkout of hub                                                           | read      |
| ourCommunityRituals (hub)                                                       | `ci.yml` (4 jobs)                                                                                   | checkout of OCR-docs                                                      | read      |
| ourWKRP                                                                         | `ci.yml`, `mobile-workability.yml`, `brain-contract-check.yml`, `scripts/ci-stage-ocr-workspace.sh` | checkout of hub and OCR-docs                                              | read      |
| ourAirwaves, ourSharedGames, ourSharedMagnets, ourSharedPulse, ourSharedRecords | `brain-contract-check.yml`, `design-system-check.yml`                                               | checkout of OCR-docs, hub                                                 | read      |
| ourEventRings                                                                   | `design-system-check.yml`                                                                           | checkout of hub                                                           | read      |

**One write site in the whole org** (`propagate-standards`). Everything else only reads.

## Recommendation: three narrow tokens (same pattern as the OSE split)

| New secret                     | Contents                                                  | Where the secret lives                      | Used by                                      |
| ------------------------------ | --------------------------------------------------------- | ------------------------------------------- | -------------------------------------------- |
| `OCR_HUB_READ` (exists; widen) | read: hub + OCR-docs                                      | org secret, selected repos: add the 9 below | all the read checkouts of hub / OCR-docs     |
| `OCR_SPOKES_READ` (new)        | read: the 7 spokes + hub                                  | OCR-docs only                               | `brain-location-audit`, `nightly-sync-check` |
| `OCR_PROPAGATE_WRITE` (new)    | Contents write + Pull requests write on the 7 spokes only | OCR-docs only, environment main-only        | `propagate-standards`                        |

Why not widen `OCR_HUB_READ` to all spokes: seven of the nine repos only need hub + OCR-docs. The two audits are the only ones that read the spokes, so their wider read stays in OCR-docs alone.

Alternative, later (OSE-1107): a GitHub App with per-run installation tokens, no owner identity, one-hour life. Better long term; needs an org-level app and a new action in the workflow. Not tonight.

## Order (nothing breaks at any step)

1. **Owner** creates the two new fine-grained tokens and stores the three secrets (checklist below). Nothing in any workflow changes yet.
2. **Agent** opens one small PR per repo (read repos: `OCR_PROPAGATE_TOKEN` to `OCR_HUB_READ`, no `||` fallback; OCR-docs: three PRs or one). Each is a human merge.
3. **Verify** by run id and log line per repo (no values).
4. **Owner** sets the org secret `OCR_PROPAGATE_TOKEN` visibility to "selected, none". Reversible. Wait one nightly cycle (the `nightly-sync-check` is the canary).
5. **Owner** deletes the org secret and the PAT (step 3.3).

## Owner checklist (browser, own terminal; never paste a value in chat)

- **OCR_SPOKES_READ**: fine-grained PAT, resource owner ourCommunityRituals, only repos: the 7 spokes + ourCommunityRituals; permissions Contents: Read, Pull requests: Read (nightly-sync-check lists open PRs), Metadata: Read; 90 days. Store as a secret **of the OCR-docs repo**.
- **OCR_PROPAGATE_WRITE**: fine-grained PAT, only the 7 spokes; Contents: Read and write, Pull requests: Read and write, Metadata: Read; 90 days. Store as an **environment secret of OCR-docs** (environment, branch policy `main`).
- **OCR_HUB_READ**: add OCR-docs and ourCommunityRituals to the token's repository list if absent; org secret visibility, add ourCommunityRituals, OCR-docs, ourWKRP, ourAirwaves, ourSharedGames, ourSharedMagnets, ourSharedPulse, ourSharedRecords, ourEventRings.

## Not decided here

- `OCR_PROPAGATE_WRITE` needs the OCR-docs `propagate-standards` job to declare an environment (a workflow edit in OCR-docs; the branch policy is the owner's repo setting).
- OCR-docs has no ratchet or enumerator like OSE's; I would add a small one in the same PRs so a bare `OCR_PROPAGATE_TOKEN` cannot return.
- Expiry: fine-grained PATs expire. Put a renewal date on the board per token.

## Progress

- 2026-10-15 12:13:22Z: `OCR_SPOKES_READ` stored as a repo secret of OCR-docs (verified by name and date only).
- Found: OCR-docs also holds a **repo-level** `OCR_PROPAGATE_TOKEN` (dated 2026-04-06T03:41:15Z), separate from the org secret (04-06T04:18:51Z). Deleting the org secret does not remove it, and a repo secret wins over an org secret of the same name. Both must be deleted at step 3.3.
- OCR-docs has one environment, `copilot`. `OCR_PROPAGATE_WRITE` needs a main-only environment created first (owner repo setting).
- 2026-10-15 12:17:28Z: environment `main-automation` created in OCR-docs (selected branches, no reviewers); branch policy `main` added (policy id 63158750).
- 2026-10-15 13:39:16Z: `OCR_PROPAGATE_WRITE` stored as an environment secret of `main-automation`. **Open:** the pasted value was 41 characters (the SPOKES_READ one was 93, a fine-grained length); a classic token is 40. Token type and its 7-repo scope are not verified by me. The owner confirms on the token's page.
