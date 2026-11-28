# ADR-034: A booth and a session are children of one event; participation mode is a column

**Status:** Proposed. A draft for the owner to decide. Decision 1 (a booth is its own row) was accepted by the owner on 2026-11-14, and booths are built (read 2026-11-16: `migrations/0109_event_booths.sql`, `src/lib/event-booths.ts`, `src/lib/public-booths.ts`, the public stall list and stall pages, and scans per stall; PRs 1250, 1259 and 1316). Sessions and participation mode are not built: no `event_sessions` table and no `participation_mode` column exist. Items 8 and 9 record the owner's direction of the same day. The other owner decisions listed below are open.
**Date:** 2026-11-14
**Deciders:** Owner (PO). Sr Architect owns the draft. Dr of Security advises on the membrane.
**Ticket:** OSE-1997 (epic OSE-1996)

## Context

A market or a fair is one event with many things inside it: stalls, a programme of talks and workshops, and sometimes a contest. OurSharedEvents has no shape for a thing inside an event.

What exists today (read from source on 2026-11-14, not seen at runtime):

- **A stall can only be a poster placement.** `poster_deployments` has a free-text `placement_label` (required, up to 200 characters), a code, and an H3 cell. It has no name of its own, no number, and no unique key on (event, label) (`migrations/0003`, `0047`, `0082`; `src/handlers/poster-deployments.ts:155-157`).
- **Events have no parent.** There is no `parent_event_id`. The only event-to-event links are a series (`events.series_id`, `migrations/0034`), which groups across time, and a series' anchor event.
- **Counts per placement exist.** `scan_placement_events` (`migrations/0062`) counts scans per placement per hour. SharedReport drops a placement whose floored total is under 5 from its list (`shared-report-builder.ts:752-815`); it does not say "Fewer than 5" for it, and there is no pooled total for the dropped ones.
- **Sign-ups point at an event only.** `form_registrations` has `event_id` and a free-text `source_placement_id` with no foreign key (`migrations-forms/0001`; `src/handlers/forms.ts:254-257`).
- **Event settings are loose.** `settings_json` keys are validated in `src/lib/event-settings.ts`. No key is locked once an event starts. `attendance_mode` was added as a column with a CHECK (`migrations/0108:33`).
- **No container exists.** There is no generic "object in a container" code or ADR in this repo. OSE-1192 and OSE-1083 are Linear tickets only.
- **Multi-stop events (OSE-1248)** have no code and no document.
- **Types.** Flea Market, Craft Fair and Community Swap Meet are in the catalog at phase 1, clearance tier 1 (`migrations/0024`). There is no general "fair" or "farmers market" code.

Three features (booths OSE-1998, the programme OSE-2001, participation mode OSE-2000) would each invent a child-of-event shape if this is not decided first.

## Decision

Proposed. Each numbered item is one decision the owner may accept, change or refuse on its own.

### 1. A booth is its own row under an event

**Accepted by the owner, 2026-11-14** ("Yes.", in answer to "Do I go ahead and build stalls as their own records?").

A new table in `DB`, `event_booths`:

| Column                                          | Notes                                                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `id`                                            | text, primary key                                                                                  |
| `event_id`                                      | not null, foreign key to `events(id)`                                                              |
| `number`                                        | the stall number or code the organizer uses; unique within the event                               |
| `name`                                          | the trading name shown to the public                                                               |
| `category`                                      | optional, from a fixed list decided with the catalog (OSE-2002)                                    |
| `hall_x`, `hall_y`                              | optional position on the hall plan, as fractions of the plan (0 to 1), never a coordinate on earth |
| `is_active`, `sort`, `created_at`, `updated_at` |                                                                                                    |

`poster_deployments` gains a nullable `booth_id`. A booth's codes are ordinary placements that point at it, so `/q`, the scan path and the hourly dedupe are untouched.

A booth takes its brand from its event. Its admin routes sit under `/admin/events/:id/booths`, which `guardAdminObjectScope` already covers.

### 2. A session is a lighter child, not an event

A new table in `DB`, `event_sessions`: `id`, `event_id` (not null), `title`, `starts_at`, `ends_at`, optional `booth_id` or `room`, optional `capacity`, `is_active`, timestamps. A session has no slug, no status of its own, no map entry and no SharedReport of its own. It appears on its fair's page and nowhere else.

A sign-up for a session is a normal registration for the fair that also names the session: `form_registrations` in `FORMS_DB` gains a nullable `session_id`. It holds the session's id as plain text with no foreign key, the same way `event_id` is held there today. No row in `DB` points into `FORMS_DB`.

### 3. A fair and a multi-stop event do not share one mechanism

A fair is one venue, one organizer and one consent; the things inside it are not events. A walk or a crawl (OSE-1248) is many hosts with a consent each; every stop has to be a full event so that its own host can accept or refuse. So a multi-stop event is a grouping of events, like a series but across places, and it is decided in its own ADR. Nothing here blocks it.

### 4. Participation mode is a column

`events.participation_mode`, text, not null, default `off`, CHECK in (`off`, `gathering`, `competition`). It follows `attendance_mode` (ADR-032), not `settings_json`, for two reasons: the database refuses any other value, and the lock below is one rule in one place.

- A brand admin sets it.
- It cannot change once the event's start time has passed. The server refuses and writes the refusal to the audit log.
- `competition` is in the CHECK from the start, because changing a CHECK later means rebuilding the table. The handler refuses `competition` until the voting work (OSE-513, OSE-1193) has shipped.
- It joins the public event answer's allowlist, since a page reads differently in each mode.

### 5. A booth's name is a trading name, and no booth field holds a person

- `event_booths` has no contact name, email, phone or note field. A vendor's contact details, if the organizer needs them, are not stored on this side at all in this decision.
- The public name is what the vendor trades under. A person's own name appears on the identified side only, by their own act, in OurWKRP.
- Nothing in `event_booths` or `event_sessions` joins to OurWKRP.

### 6. Counts at booth grain follow the floor, in words

- A booth's count is the sum of its placements' counts, floored per placement-hour as today.
- A fair's total over booths uses `floorTotalOfParts` (`lib/count-floor.ts:53-60`): a booth under 5 never joins the total, so the total cannot be worked back to it.
- A booth under 5 reads "Fewer than 5". It is not dropped from the list. This is a change from how a placement is treated today, and the placement list should move to the same rule in the same work.
- Counts are post-event. The hall display shows none.

### 7. Booths and sessions ship before any generic container

No container exists to wait for. The two tables are plain, and a later container can adopt them: each row has its own id and one parent event.

### 8. Scan before the transaction (owner direction, 2026-11-14)

The owner's words:

> "The workshop will be more diffcult to keep track of real numbers with more people walking in and out. The stalls where trackable actions and transactions are taking place where the scan is in OSE then the monetary is conducted through the booths own vendor. The key is a process is adopted to where scan before transaction needs to be adopted and enforced"

What this decides:

- **The stall is where the count is real.** A visitor scans the stall's code, and that scan is what OurSharedEvents counts.
- **Money never passes through OurSharedEvents.** The sale is made through the vendor's own till, card reader or app. No price, basket, receipt or payment detail is stored or read here. This is separate from a fee for the table itself (open decision 5).
- **The order is: scan, then pay.** The fair adopts this as its process and the vendors hold to it.
- **Required or optional is the fair's choice.** The owner added, the same day: "or optional". So a fair states one of two things: scanning first is required at its stalls, or it is invited and not required. The report says which, because the two numbers do not mean the same thing: under "required" a stall's scans are close to its buyers; under "optional" they are only the visitors who chose to scan.

The owner, the same day, on what makes it happen: "the key is the positioning and script/playbook so they action takes place". So the first means is not software. It is where the code sits on the stall and what the vendor says, written down as a playbook the organizer hands to every vendor. The software below supports that; it does not replace it.

How it is held to, proposed for the owner to accept or change:

- **Positioning.** The code sits where the hand goes before the money does: at the front edge of the table beside the till or card reader, at phone height, one code per stall, with the stall number printed large beside it.
- **Script.** The vendor says one short line before taking payment, the same line at every stall. The owner agreed this line on 2026-11-14: "Before I ring that up, would you scan our stall? It only counts a visit, it doesn't take your name." The playbook gives the line, what to say when someone declines, and that a sale is never refused over it when scanning is optional.

- **A scan answers with a stamp the vendor can see.** After a stall scan the visitor's phone shows the stall's number and name and the time, for a short while. The vendor glances at it before taking payment. The stamp carries no count, no visitor id and nothing about the sale.
- **The organizer makes it a condition of the stall.** The process is in the fair's terms for vendors, on the table card, and in what vendors are told on the day. OurSharedEvents can show the stamp; it cannot see whether a vendor looked at it.
- **What the number means is stated on the report.** One scan is one visitor at one stall in one hour (the existing dedupe, `src/handlers/qr-scan.ts:20-25`). Two purchases by one visitor in that hour are one scan. A scan is not proof of a sale. The report says "scans before a purchase", never "sales".
- **A vendor cannot be the source of their own count.** Scans from the vendor's own phone at their own stall would inflate it. How to limit that without identifying anyone is for the security read (OSE-2003).

### 9. A session's number is its sign-ups, not its room (owner direction, 2026-11-14)

People walk in and out of a workshop, so a headcount there is not a real number. A session publishes how many signed up, under the floor like any other count. It does not publish attendance, and no session count is added to the stalls' total.

## Owner decisions still open

1. **Booth shape:** decided. The owner accepted decision 1 on 2026-11-14.
2. **Session shape:** accept decision 2 (a child table), or make a session a full event with a parent?
3. **A sole trader's own name.** Some vendors trade under their own name. Is that acceptable as a booth's public name when the organizer enters it, or must the vendor confirm it first?
4. **May a vendor see their own booth's count?** The floor has no exceptions either way; the question is whether a vendor gets a view at all, and how they are let in without becoming an identified user on this side.
5. **Paid tables.** A fee for a stall is commerce. The catalog puts commerce in regulatory phase 2 (`migrations/0023:10`). Is a paid table recorded here at all in phase 1, or kept outside the product? (OSE-2002)
6. **Who may set the mode, and the lock.** Accept "brand admin, fixed at start time", or something stricter?
7. **The stamp, and where the choice is made.** Accept a short-lived on-screen stamp after a stall scan as the way a vendor checks "scanned first"? How long should it show? Is "required or optional" chosen once for the whole fair, or stall by stall?
8. **A general fair type.** Add a code for a fair that is not a craft fair, and one for a farmers market? This also bears on the "50+ event types" goal (OCR-214).

## Alternatives Considered

### Alternative A: a booth is a placement with more fields

Add `booth_name`, `booth_number` and the rest to `poster_deployments`.

- For: no new table; a booth with one code is one row.
- Against: a booth with two codes (table card and banner) becomes two rows that must agree. The table has no brand column and its label is free text, so "unique stall number per event" has nowhere to live. Counts per booth need a group-by on a text field.

### Alternative B: a session is a full event with `parent_event_id`

- For: sign-ups, check-in, forms and a SharedReport per session work with no new code.
- Against: every list, map, sitemap, calendar feed, series query and public read that does not filter on the parent would show a workshop as an event. That is a change to every reader, each of which is a chance to leak or miscount. A session would also take a slug and a consent of its own that it does not need.

### Alternative C: wait for the generic container (OSE-1192)

- For: one mechanism for booths, sessions, votable objects and whatever follows.
- Against: it does not exist, it is marked after first launch, and markets and fairs are the stated priority. Waiting blocks the work for a design nobody has written.

### Alternative D: mode in `settings_json`

- For: no migration.
- Against: no database check on the value, and no setting is locked after start today, so the lock would be a new rule in a file that has none.

## Consequences

### Positive

- One shape for "a thing inside an event", used by three features.
- The scan path, `/q`, `/s` and the dedupe do not change.
- A booth's count has a real key, and the pooled total uses a helper that already exists and is tested.
- Sessions cannot appear in any event list by accident, because they are not events.

### Negative

- Two new tables and two new columns (`poster_deployments.booth_id`, `events.participation_mode`) in `DB`, and one new column in `FORMS_DB`.
- A session cannot have its own SharedReport or its own sponsor. If that is wanted later, it is a new decision.
- "Fewer than 5" for a booth changes how the placement list reads today. That is a visible change to an existing report.

### Neutral

- Hall positions are fractions of a plan image. They say nothing about where the hall is; the fair's own area cell does that.
- `competition` exists as a value before it can be chosen.

## Implementation Notes

What each feature may build once this is accepted, and what still waits:

| Feature                             | May build                                                                                                                                                                                           | Still waits on                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| OSE-1998 Booths                     | `event_booths`, `booth_id`, admin entry and bulk entry, per-booth codes, a public `booths` sibling on the event read (allowlist, own-brand SQL, empty on failure, following `lib/public-series.ts`) | Open decisions 1, 3                             |
| OSE-1999 Map template on fair pages | hall plan with `hall_x`, `hall_y`; the area map from `GET /api/v2/map/areas`                                                                                                                        | OSE-1998                                        |
| OSE-2001 Programme                  | `event_sessions`, the `session_id` column, a public `sessions` sibling                                                                                                                              | Open decision 2                                 |
| OSE-2000 Participation mode         | the column, the lock, `gathering`                                                                                                                                                                   | Open decision 6; `competition` waits on OSE-513 |
| OSE-2004 Fair reporting             | per-booth counts, the pooled total, "Fewer than 5"                                                                                                                                                  | Open decision 4                                 |
| OSE-2002 Types and paid tables      | new catalog codes                                                                                                                                                                                   | Open decisions 5, 7                             |

Rules for the build:

- Migrations are additive: new tables, nullable columns, one column with a default. No table is rebuilt.
- Every new by-id admin route scopes by brand.
- Every public field is on an allowlist; nothing is a spread of a row.
- Every test is seen failing first, at the workers-pool layer and on staging.

Not done in this draft: the CCR worksheet the ticket asks for (95% gate, Dr of Security in the review). It should run on the decided text, after the owner answers the open decisions.

## Addendum, 2026-11-28: the stamp passport changes where a stop's code lands

Owner direction, 2026-11-28: a walk, market or fair whose stops each stamp a card kept on the visitor's own phone (`src/lib/passport.ts`).

- An event opts in with the `passport` setting in `settings_json`. Only a JSON `true` turns it on.
- When it is on, a stop's code (a placement with a `booth_id`, not a vote code) lands on `/events/:id/booths/:number#stamp` instead of the event page. That is a read of the booth's number for the `Location` header, in one SQL expression in `lib/passport.ts` (`passportStopSql`).
- Decision 1's "`/q`, the scan path and the hourly dedupe are untouched" now reads: the scan row, the dedupe and every count are untouched, and the scan path reads a booth only for that landing. No scan row carries a booth. `tests/event-booths.spec.ts` holds the narrower rule.
- The stamp is kept in the phone's local storage only. The page script makes no request and sets no cookie, so the Worker never learns which stops one phone has stamped. `tests/passport.spec.ts` reads the script to hold this.

## References

- OSE-1996 (epic), OSE-1997 (this decision), OSE-1998, OSE-1999, OSE-2000, OSE-2001, OSE-2002, OSE-2004, OSE-2011
- OSE-1248 (multi-stop events), OSE-1192 and OSE-1083 (container), OSE-513 and OSE-1193 (voting)
- ADR-032 (`attendance_mode` as a column), ADR-033 (the public area map)
- `AGENTS.md` invariants 1, 2, 3, 5 and 9

## Revisit Criteria

- A generic container ADR is accepted: decide whether these two tables move under it.
- A session needs its own sponsor, report or consent.
- The multi-stop ADR is written and wants the same grouping after all.
- Paid tables are cleared for phase 1.
