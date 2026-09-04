# Positioning artifacts

This directory holds the strategic-positioning documents for OurSharedEvents: competitive briefs, sales-conversation playbooks, audience-pitch frames, and the standing answer to "why does OSE win?"

Positioning artifacts are **descriptive, not aspirational**. They capture how OSE _currently_ differentiates from the competitive landscape — claims that are true today because the architecture, regulatory posture, and time horizon support them. Artifacts that overpromise the platform's current state belong in product strategy decks, not here.

## Status

| Document                                                           | Audience                                                                                                                           | Date       | Status  |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------- |
| [BEACHHEAD-ICP-2026-05-14.md](BEACHHEAD-ICP-2026-05-14.md)         | Internal — strategic spine for GTM + eng prioritization                                                                            | 2026-05-14 | Current |
| [COMPETITIVE-BRIEF-2026-05-14.md](COMPETITIVE-BRIEF-2026-05-14.md) | Internal — sales, organizer conversations, sponsor pitch                                                                           | 2026-05-14 | Current |
| [PRICING-PLAN.md](PRICING-PLAN.md)                                 | Internal — pricing & free-to-paid business plan (folds the two 2026-08-14 root drafts; Local three-way split 2026-09-03, OSE-1198) | 2026-09-03 | Current |

## Relationship to other artifacts

| Artifact                         | Lives at                                                | Role                                  |
| -------------------------------- | ------------------------------------------------------- | ------------------------------------- |
| **Positioning** (this directory) | `docs/positioning/*.md`                                 | How OSE wins vs. the market           |
| **ADRs**                         | `docs/adr/*.md`                                         | Why the architecture is the way it is |
| **Brain invariants**             | `OCR-docs/ocr-docs-brain/architectural-invariants.yaml` | What the architecture must enforce    |
| **Doctrine memory**              | `~/.claude/.../memory/feedback_*.md`                    | Principles that govern decisions      |
| **Brand voice guidelines**       | TBD (OSE-169)                                           | The voice used in user-facing copy    |

Positioning informs sales/conversations; doctrine governs decisions; ADRs record the architectural choices; brain invariants enforce them. Each artifact has one job.

## When to update

A positioning artifact is updated when ONE of:

1. A new competitor emerges that materially changes the landscape (rare)
2. OSE's own architecture changes in a way that strengthens or weakens a "only platform that..." claim (notable)
3. A sales conversation reveals a pitch that didn't work — the artifact gets sharpened with the corrected angle (frequent)
4. A new audience surfaces that needs its own pitch frame (community leaders → school principals → museum directors → etc.)

Positioning is **not** updated to chase competitor feature parity. If Eventbrite ships anonymous-mode tomorrow, the competitive brief gets re-read for accuracy — but the _strategic thesis_ (anonymous-ID as identity primitive + phased regulatory + long-game patience) doesn't shift unless OSE itself shifts.

## Process for adding a new positioning artifact

1. Identify the artifact's audience (internal sales? prospective sponsor? regulator? press?)
2. Identify whether it builds on or supersedes existing artifacts in this directory
3. Date the file (`<TYPE>-YYYY-MM-DD.md`) so revisions don't lose history
4. Land as a focused docs PR (not bundled with feature work)
5. Update the Status table above

Older artifacts are kept for historical record — when a brief is superseded, mark it `Status: Historical` in the table above; don't delete the file.
