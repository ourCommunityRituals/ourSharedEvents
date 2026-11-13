# The Honesty Lexicon — why we don't say "impressions"

> Doctrine reference. This will come up again — read it before renaming, before
> adding a metric, and before agreeing to a sponsor-facing number.
> Enforced in the schema by `workers/oursharedevents/tests/schema-lexicon.spec.ts`
> (OSE-801). Related: Invariant #25 (sponsor share covenant), `DATA_POLICY.md`,
> `../features/SPONSOR-PRICING.md`.

## The principle

OurSharedEvents refuses the surveillance-advertising promise. A sponsor's
presence is **derived** from real local contribution — never **purchased**
exposure. That refusal is the moat, and it is only real if our _vocabulary_
never quietly re-imports the model we reject. Words are load-bearing: the moment
a banned word enters a column, an export header, a log line, or a label, the
ad-tech mental model comes back with it and leaks to the surface by accident.

So the lexicon is enforced everywhere, **including the storage layer** — a lint
that guards the surface while the schema speaks the banned words is aspirational,
and it gets routed around by accident.

## Why "impressions" specifically is banned

An _impression_ is the unit of the ad-tech promise: a claim that a brand was
_shown to_ someone (the CPM / "pay us to put your logo in front of N eyeballs"
model). Every reason it's out:

1. **It sells position/attention — Invariant #25 forbids that.** Denominating
   value in impressions means more money = more impressions = buying position.
   Our covenant can't be gamed that way; "impressions" is the vocabulary of the
   thing that can.
2. **It's fabricated and unverifiable.** You cannot honestly know someone _saw_ a
   logo. We count things that actually happened and leave a real anonymous trace
   — a **scan**, a **return**, a **check-in**. An impression is the institutional
   version of the `Math.random()` fabricated metrics the doctrine already bans.
3. **It pulls toward re-identification.** Impressions want to become _unique_
   impressions / _unique_ visitors — per-person counting. Our anonymity doctrine
   (Invariant #1, k-anon floors) is the opposite: aggregate, floored, never
   per-head. That's why **"unique"** is banned right next to "impressions".

## The honest word: "display"

Where we genuinely record that an ad was rendered, the honest word is
**display**. It states a **render fact** — _the ad was on the screen_ — instead
of claiming attention.

**Definition (PO, 2026-08-20): display = the ad was on screen. Full stop.**
Not duration, not dwell, not attention, not per-head — just the straight fact
that the ad was placed and rendered on the display surface. Distinct from a
**click**, which is the separate real action.

`display` is honest because it is verifiable from the surface's own render state
and claims nothing about who saw it or for how long.

**On the record (PO, 2026-08-20): what we labelled "impressions" was always meant
to be "display".** The name was borrowed from ad-tech by mistake — a misapplied
name and definition over a concept that was legitimate all along (the ad was on
screen). So `sponsor_displays → sponsor_displays` is a **pure lexical fix**,
not a change to what is counted. The substance was never the ad-tech impression;
only the word was wrong.

## The banned catalogue (as identifier tokens)

`attendance`, `impression(s)`, `visit(s)`, `reach`, `unique`, `turnout`,
`eyeball(s)`, `people`, `view(s)`.

These are audience-inflation words (claiming a crowd) plus the re-identification
hint (`unique`). Matched as **tokens** of an identifier (snake_case / camelCase
segments), never as raw SQL — so the `UNIQUE` constraint keyword is never a false
positive; only a column literally named `unique_*` is.

## Honest replacements

| Banned                               | Honest                         | Why                                                            |
| ------------------------------------ | ------------------------------ | -------------------------------------------------------------- |
| `impression` / `sponsor_displays`    | `display` / `sponsor_displays` | render fact, not claimed view                                  |
| `impression_token`                   | `display_token`                | the token names a display slot, not an audience claim          |
| `unique_agents`                      | `distinct_agent_hashes`        | describes the data (distinct hashes), drops the re-id word     |
| `visit_count` (on `anon_id_returns`) | `return_count`                 | a **return**, aligned to the table; not a "visit"              |
| "reach" / "eyeballs" / "turnout"     | (do not use)                   | pure audience-inflation; there is no honest count to rename to |

## Guardrails — the word is honest only while the thing stays honest

Renaming to `display` does **not** license re-importing the model under a cleaner
name. A `display` count must stay:

- **A render fact** — the ad was on screen. Never dwell-time-as-value ("more
  dwell time" is itself a removed #25 violation).
- **Never per-person / `unique`.** No unique-display counts, no per-head joins.
- **Never sold as guaranteed reach/position** (#25). Sponsor presence is derived,
  not bought.

## Display _share_ is the covenant made verifiable

The lexicon is not a free-floating style rule — it is a downstream expression of
the **sponsor covenant (Invariant #25)**. Each banned word is banned because
using it would let money buy audience/position, which the covenant forbids.
"Display" earns its place because it points the other way: it is the honest,
_derived_ metric the covenant is built on.

Concretely, on the SharedReport (the proof layer):

- The one purchasable dimension under #25 is rotation frequency / **share**. So
  each tier — **premium / mid / local** — has a _derived, expected_ display
  share. The SharedReport lets a sponsor **correlate their actual display % to
  that expectation** — proof the rotation share was delivered fairly. This is
  honest precisely because it proves the derived allocation, the opposite of
  selling impressions/reach/position.
- **One truth, two views:** the sponsor surface and the event/organizer surface
  must show the **same** display info for the same interaction — they cannot
  diverge (assert equality across surfaces; a disagreement is a real bug, never
  masked). Tracked as **OSE-933**.

So: `impression → display` (lexical honesty) exists _for_ the covenant, and
`display share vs expectation, same on both sides` is the covenant made checkable.

## Naming vs substance — the deeper test

A banned _name_ is a lexical fix (rename it). But if a table/metric actually
_counts the banned thing_ — e.g. counts _displays_ and sells them as audience —
the fix is doctrinal, not lexical: **don't count it, or don't surface it as
value.** Before renaming, confirm what a metric records. If it's a real action
(scan/click/return) it was just misnamed; if it's a claimed audience, renaming it
only hides the problem.

## Enforcement

- **Schema:** `tests/schema-lexicon.spec.ts` reads the built schema
  (`sqlite_master` + `PRAGMA table_info`) and fails on any banned-token
  identifier. Tracked, ticketed exemptions live in `EXEMPT_IDENTIFIERS`
  (`src/lib/schema-lexicon.ts`) and a "no stale exemptions" test forces their
  removal once the rename lands. **Do not weaken the banned set to go green** —
  rename, or add a ticketed exemption.
- **A decided name that holds a banned word without the banned meaning**
  (ADR-028): `ALLOWED_IDENTIFIERS` in the same file. One entry,
  `events.attendance_mode`: how an event is held (in person, online or both).
  It is one of three words, held by a CHECK, and can never be a number. The
  match is the exact name; `attendance_count` still fails. This is not an
  exemption: it has no removal ticket, and it needs an ADR entry.
  `tests/e2e/0-architecture/lexicon-allowance.invariant.spec.ts` holds the list
  to what the ADR lists. The word still never appears on a rendered page.
- **Surface:** honest labels on every rendered surface, both languages.
- **Do not** silently drop a banned word from the list to pass — that is the
  "honesty lexicon lying by omission" the doctrine exists to prevent.
