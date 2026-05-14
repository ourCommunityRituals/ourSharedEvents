# ADR-NNN: [Decision title in imperative voice]

**Status:** Accepted
**Date:** YYYY-MM-DD
**Deciders:** [Names or roles — e.g., "mzdan + Co-Architect"]

## Context

[One to three paragraphs. What is the situation? What forces are at play? What problem does this decision solve? What constraints are non-negotiable?]

[Cite the trigger — the Linear story, PR, brain invariant, or doctrine that exposed the need for this decision.]

## Decision

[A crisp statement of the choice that was made. Imperative voice when possible: "We separate event metadata from per-attendee form data into two distinct D1 databases…"]

[Optionally, a small diagram or list summarizing the chosen architecture's moving parts.]

## Alternatives Considered

### Alternative A: [Name]

[1-2 sentence description.]

**Rejected because:** [Specific reason — not "it's worse" but "it fails X requirement / introduces Y risk / has Z cost we can't absorb."]

### Alternative B: [Name]

[Same format.]

### Alternative C: [Name (optional, but include any seriously-considered option)]

[Same format.]

## Consequences

### Positive

- [What becomes easier, safer, or cheaper as a direct result of this choice.]
- [Be specific. "Improves performance" is not specific; "removes the N+1 query in the sponsors-resolve handler" is.]

### Negative

- [What becomes harder, more expensive, or requires ongoing discipline.]
- [Be honest. The point of an ADR is to surface trade-offs, not to advocate.]

### Neutral

- [Things that are neither wins nor losses but are worth recording — e.g., "we now need to maintain two migration paths instead of one; this is a cost but matches the level of compartmentalization the decision requires."]

## Implementation Notes

[Optional. Link to the specific commits, PRs, files, or brain entries that realize the decision. Keep this short — the code IS the implementation; this section just routes a future reader to where to look.]

- [Code:] [File path + line range OR a glob if the decision touches many files]
- [Brain invariant:] [`OCR-docs/ocr-docs-brain/architectural-invariants.yaml` invariant ID, if applicable]
- [CI gate:] [`tests/[file].invariant.spec.ts`, if applicable]
- [PR:] [Number(s)]

## References

- [Linear story / epic that triggered or shaped the decision]
- [Prior ADRs that this builds on or modifies]
- [External docs — RFC, blog post, paper — that informed the choice]
- [Doctrine memory file(s) that govern this class of decision]

## Revisit Criteria

[When should we re-open this decision? Examples:]

- [If load grows past X req/s, the SQLite single-writer constraint becomes a bottleneck.]
- [If we onboard a second consumer that needs to JOIN across the two databases, the separation cost may exceed its compliance benefit.]
- [If a regulatory tier we don't currently support becomes required (e.g., GDPR-specific data residency), the routing model needs revisiting.]

[If there's no clear revisit trigger, write "No expected revisit; decision is foundational."]
