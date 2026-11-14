# ADR-032: Keep the field name `attendance_mode`, as one exact allowance in the lexicon lint

**Status:** Accepted. The owner chose the field name on 2026-11-12 and, on 2026-11-14, accepted
option A below: keep the name, as the one exact allowance in the lexicon lint (OSE-2033). The field
has been on `main` and on staging since 2026-11-14 (PR #1211).
**Date:** 2026-11-13
**Deciders:** Owner (PO). Dr of Security advises on the lexicon; the Data Scientist confirms the field carries no count.
**Tickets:** OSE-2033 (this decision), OSE-2034 (its tests), OSE-2035 (the shared brain), OSE-2012 (the story that needed it)

## Context

Two owner decisions meet in one column name.

**The honesty lexicon** (`docs/architecture/HONESTY-LEXICON.md`, OSE-801) bans words that claim a
count of people from every schema name: `attendance`, `impressions`, `reach`, `unique`, `people`,
`views` and others. The lint (`workers/oursharedevents/src/lib/schema-lexicon.ts`) splits each
table, column and index name into words and fails on any banned one. Its only escape was an
exemption: debt, with the ticket that removes it. That list is empty. The last two entries were
removed by renaming columns (migrations 0102 and 0103).

**The online-or-in-person story** (OSE-2012; showcase plan S13, owner decisions of 2026-11-12) adds
a required field to every event and names it `attendance_mode`: `in_person`, `online` or `both`. The
name follows schema.org's "attendance mode". ourWKRP's showcase already reads `attendanceMode`.

So migration 0108 adds a column whose name holds a banned word. The lint fails on it, as written.

What the lexicon protects is a claim: no name may say how many people came when the system counts
signals. `attendance_mode` makes no such claim. It says how an event is held. It holds one of three
words, and the database refuses anything else. But the lint tests words, not meanings, and the
lexicon had no category for a name that holds a banned word without the banned meaning.

The shared brain does not settle it. The lexicon is draft article #27 in an OCR-docs proposal, not
yet in `architectural-invariants.yaml`, and its text knows only ticketed exemptions (OSE-2035).

## Decision

Keep the name the owner chose, and give the lint a second, separate list:

- `ALLOWED_IDENTIFIERS` in `schema-lexicon.ts`: whole identifiers that hold a banned word and are
  not the banned idea. Each entry is a decision recorded here, not debt. It has no removal ticket.
- The match is the exact identifier. `attendance_mode` passes. `attendance`, `attendance_count`,
  `attendance_mode_total`, `attendanceMode` and an index named for the column all still fail.
- A name may be on the list only when all of these hold. The structural invariant
  `tests/e2e/0-architecture/lexicon-allowance.invariant.spec.ts` checks them on every PR:
  1. It is a column that a migration adds with a CHECK limiting it to a fixed list of words. It
     cannot hold a number.
  2. It is listed in this ADR, between the markers below, and its reason in the code cites a ticket.
  3. The banned word list still holds its word, and the two exemption lists stay empty.
- The word stays off rendered pages. The public event page says "In person", "Online" or "Online
  and in person". Its test id is `event-mode`. No page handler writes the word into markup.
- The public API publishes the field only as one of its three words, whatever the row holds
  (`PUBLIC_EVENT_WORD_FIELDS` in `public-event-projection.ts`). The count-publication gate accepts a
  count-shaped name only when it goes through a count-floor function or is declared a word field.

The allowed identifiers:

<!-- allowed-identifiers:begin -->

- `attendance_mode` (events; migration 0108; OSE-2012): how an event is held. One of `in_person`,
  `online`, `both`.

<!-- allowed-identifiers:end -->

## Alternatives Considered

### Alternative B: Rename the field (`event_mode`, `held_mode`, `format`)

No allowance is needed and the lint stays as it was.

**Not chosen (owner, 2026-11-14):** it departs from the name the owner decided and from schema.org,
and ourWKRP's showcase reader and its testing doc already use `attendanceMode`. `participation_mode`
is taken by a different, planned field (OSE-2000). The column is applied on staging now, so a rename
would be a migration and a change to the public contract.

### Alternative C: A ticketed exemption in `EXEMPT_IDENTIFIERS`

**Rejected because:** an exemption is a promise to rename. The "no stale exemptions" test exists to
force that. Using it for a name that is meant to stay would make the debt list lie, and the next
real debt would hide beside it.

### Alternative D: Take `attendance` off the banned list, or ban it only next to count words

**Rejected because:** `attendance` is the plainest count-of-people word there is. A pattern rule
("banned unless followed by mode") is a rule about one name written as if it were general, and a
weaker word list is exactly what `schema-lexicon.spec.ts` says never to do.

### Alternative E: Keep the column name clean and map it to `attendance_mode` in the API only

**Rejected because:** two names for one field is a standing source of mistakes, and the API key is
the more public of the two. It would hide the question instead of answering it.

## Consequences

### Positive

- The owner's field name and schema.org's vocabulary are kept, in OSE and in ourWKRP.
- The lexicon gains a named, tested category for a decided name, so the exemption list keeps
  meaning debt only.
- The allowance cannot grow by a one-line edit: a second name needs this ADR, a CHECK and a ticket.

### Negative

- The word now appears in the schema, in the public JSON, and in source. A reader who knows the
  lexicon will ask why. This ADR and the lint's own comment are the answer.
- The lint is no longer a pure word test. One more list to understand.
- The rendered-surface lint and the allowance have to be kept apart by hand: the allowance is for
  the name, never for a page.

### Neutral

- API field names were already outside the lint's reach (the brain's draft article says so). This
  does not change that; OSE-2035 asks the owner whether it should.

## Reconciliation

- `docs/architecture/HONESTY-LEXICON.md` has the allowance under "Enforcement".
- `docs/features/EVENTS.md` describes the field.
- If the owner chooses option B: remove `ALLOWED_IDENTIFIERS`, its invariant spec and this ADR's
  list; rename the column in migration 0108 before it is applied anywhere; supersede this ADR.
