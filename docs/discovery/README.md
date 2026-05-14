# Discovery

Primary research — conversations, interviews, validation work — that grounds the strategic spine documents in evidence rather than hypothesis.

This directory is where the platform's claims about its ICP get tested against actual buyer reality.

## Why discovery lives here

The CCR rerun of `docs/positioning/BEACHHEAD-ICP-2026-05-14.md` (2026-05-14) flagged the single highest-leverage gap: **every strategic claim in the strategic spine is currently deductive** (architecture → ICP → product), without primary research at the ICP layer. The spine reasons forward from "OSE has anonymous-ID architecture" to "therefore OSE serves bar trivia" — but no actual bar owner has been asked whether they would buy what OSE sells.

Discovery converts the doc from **plausible** to **defensible**. Even five anonymized conversations create a new evidentiary base that the rest of the artifact stack can cite.

## What this directory contains

| File                                                                                   | Purpose                                                                                                                                                  |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`INTERVIEW-GUIDE-BAR-OWNERS-2026-05-14.md`](INTERVIEW-GUIDE-BAR-OWNERS-2026-05-14.md) | The interview script — 14 ICP-validating questions reorganized for natural conversational flow, with follow-up prompts and listening-for-red-flags notes |
| [`INTERVIEW-TEMPLATE-2026-05-14.md`](INTERVIEW-TEMPLATE-2026-05-14.md)                 | Note-taking template for capturing findings consistently — fill out one per conversation                                                                 |
| [`TARGET-LIST-FRAMEWORK-2026-05-14.md`](TARGET-LIST-FRAMEWORK-2026-05-14.md)           | How to choose which bars to approach first — criteria, sources, sample selection logic                                                                   |
| `BAR-OWNER-INTERVIEWS-YYYY-MM-DD.md`                                                   | Anonymized findings from each batch of conversations (one file per discovery sprint)                                                                     |

## Process

1. Pick 5 target venues using `TARGET-LIST-FRAMEWORK`.
2. Schedule conversations or walk in cold (the framework explains both).
3. Open `INTERVIEW-TEMPLATE` fresh per conversation. Don't type during the conversation — fill it out within 30 minutes after, while memory is sharp.
4. Use `INTERVIEW-GUIDE` as a backbone, not a script to read. The questions are in the right order for _thinking_, not for _speaking_.
5. After 5 conversations: write `BAR-OWNER-INTERVIEWS-YYYY-MM-DD.md` summarizing patterns, contradictions, surprises, and recommended changes to BEACHHEAD-ICP.
6. Update BEACHHEAD-ICP via OSE-269 (consolidation work) with cited findings.

## Anonymization discipline

- **Never** record venue names, owner names, or specific addresses in any committed artifact.
- Acceptable identifiers: venue type (taproom / sports bar / cocktail bar), neighborhood-level location (Beverly / Lincoln Park / Wicker Park), role (owner / GM / bar manager), conversation date.
- Acceptable quotes: paraphrased to remove identifying detail.
- **Personal notes** (with venue names) can live in a private notebook, but the committed discovery artifact must be anonymized at write time.

This rule exists for two reasons: (1) the BEACHHEAD-ICP doc may eventually be shared externally, and any leak of venue/owner identity damages those relationships; (2) the platform's whole architectural ethos is anonymous attendance — the discovery process should embody the same discipline.

## When this directory becomes self-sustaining

Once 20+ conversations have been logged here, the discovery artifacts become the canonical reference for _who OSE actually serves_. The strategic spine in `docs/positioning/` will cite these documents the way ADRs cite Brain invariants — as primary source for downstream claims.

Until then, this directory is the **bridge between architectural intuition and operational reality**.
