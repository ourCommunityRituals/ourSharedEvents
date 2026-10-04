# ADR-022: Make the event the base unit and the brand an optional tracking layer

**Status:** Proposed
**Date:** 2026-10-03
**Deciders:** Matthew Zdano (PO)

> **CCR status (2026-10-03):** Loop 1 failed and was corrected. Loop 2 stopped at
> the human gate (two PO questions, listed under "Open questions"). Loop 3 has not
> run. Worksheet: `.claude/outputs/CCR-ADR-022-EVENT-BASE-BRAND-OPTIONAL-2026-10-03.md`.
> This ADR stays **Proposed** until Loop 3 passes.

## Context

The build scope set on 2026-10-03 is free and Mid: from one person running one
event in a backyard, to an Anchor running campaigns across event types who wants
one SharedReport for all traffic at their space. Enterprise (brands that contain
brands, OSE-1532) is later, but Mid must already fit it.

Three things were undecided or unwritten:

1. **What an event must have.** The PO's rule is five core values: title, time,
   event type, map on or off, and QR codes. Those alone give a poster that shows
   the codes and starts a pre-event. Neither the PO nor a search of `docs/adr/`
   found this written down. The code requires only `title` at creation
   (`handlers/events.ts`).
2. **What a brand is.** There is no `brands` table; `brand_id` is a `NOT NULL`
   text column on events and other tables. The public pages list one hard-coded
   brand, `'root'`, written in at least nine places. A brand other than `root`
   has event pages but no list, map or front door.
3. **How a public address reads, and how traffic is told apart.** The PO wants
   an address a person can read, kept short, that one brand can use for onsite,
   offsite and online traffic.

Trigger: the 2026-10-03 prioritization session, and tickets OSE-1552 to OSE-1556
and OSE-1560 to OSE-1563. Prior art was read from the GAS-era toolkit
(`archive/gas/Config.gs` and `config/brand-config.js` in that repo), which
modelled brands as a parent and child tree and resolved an unknown brand to the
default brand.

## Decision

### 1. The event is the base. Five core values make it publishable.

| Core value | Stored as                                                   | Rule                                             |
| ---------- | ----------------------------------------------------------- | ------------------------------------------------ |
| Title      | `events.title`                                              | Required to create a draft. Nothing else is.     |
| Time       | `events.start_date`, `start_time`, `timezone` → `starts_at` | Required to leave draft.                         |
| Event type | `events.event_type_id`                                      | Required to leave draft.                         |
| Map        | `events.is_published`                                       | Defaults to off. On only by the organizer's act. |
| QR codes   | the event's codes, `qr_verified`                            | Already required: `active ⟺ qr_verified = 1`.    |

A draft stays as easy as today: a title is enough. The core values are checked
when an event moves out of `draft`. Two code paths do that today (`PUT status` in
`handlers/events.ts` and verify-qr in `handlers/qr-verify.ts`); both call one
shared check (OSE-1560).

**The map is never on by omission** (PO, 2026-10-03). Before OSE-1560,
`is_published` became 1 when a request left it out. Under this ADR:

- An event with no sponsors defaults to **map off**. A new event never has a
  sponsor, so every new event starts off the map.
- The default does not block anything. The organizer gets a brief, neutral toast
  saying the event is not on the map and that this is their choice to make, with
  the way to change it. It is a heads-up, not a warning and not a gate.
- **Adding a sponsor flips the default to on, by design** (PO, 2026-10-03). When
  the organizer adds or approves a sponsor on an event, the map setting turns on
  and a neutral toast says so. The toast shows for 10 seconds and then disappears by itself.
- The flip changes the **default** only. If the organizer has already set the
  map themselves, on or off, adding a sponsor does not change it. This needs a
  record of whether the organizer made the choice.
- The toast carries a one-step way to turn the map back off, and the setting
  stays visible on the status panel after the toast goes.
- Apart from this one rule, nothing switches the map on for the organizer.

**Implemented (OSE-1560, 2026-10-04; the code is the record).** Create stores the
event off the map unless the request says `is_published: true`; an absent or
malformed value is "no choice". "Did the organizer choose?" is a server-managed
marker `mapDefault: true` in `events.settings_json` (`lib/event-settings.ts`;
no migration): set at create when no choice was sent, removed by any explicit
map write (`POST`/`PUT` `is_published`) and by the flip, and rejected if a client
sends it. It is a positive marker on purpose: every existing event has none, so
an old explicit "off" is never flipped. The flip (`lib/map-default.ts`) is one
conditional UPDATE, brand-bound through the sponsor row, run only when the
organizer creates a sponsor with an event, attaches one, or approves a sponsor's
request (never on a sponsor's own request, never on a decline). On a live event
it starts a fresh publish grace window, so the event is still not listed until
that ends. It is audited as `MAP_ON_BY_SPONSOR` and the response carries a `map`
block with the heads-up words. The admin status panel states the setting and
holds its control; the toast component itself is OSE-1564.

**A place is required only when the map is on.** Map on needs a location that
resolves to an area cell. Map off needs none.

An event that is already past draft is not blocked; it is asked for the missing
values the next time it is edited.

Nothing else is ever required to create an event, print its poster or count its
scans. In particular, not a brand and not a sponsor.

### 2. A brand is optional. It is the layer Mid and Enterprise use to keep track.

- Storage keeps `brand_id NOT NULL`. "No brand" is stored as the platform's
  public brand. Every isolation query keeps one shape, `WHERE brand_id = ?`.
- The platform's public brand keeps the id `root`. It is written once, in
  `lib/brand.ts` (OSE-1555), and is never shown to a person.
- A brand becomes a row in a `brands` table with a `parent_brand_id` from the
  start (OSE-1553). Nothing reads the parent until Enterprise.
- An unknown brand is refused. It is never swapped for the default brand, and a
  write with no resolvable brand is an error.
- A brand carries a "show first" list of event types. It orders and curates; it
  never blocks a brand from creating any type (ADR-010, consequence 5).

### 2a. Inside the platform brand, the owner is the isolation boundary.

Because "no brand" is one shared brand, brand scoping alone would let every
organizer without a brand see and change every other such organizer's events and
named form data. So:

- In the platform brand, an organizer reaches only rows whose `created_by` is
  their own server-verified identity: on lists and by id, for reads and writes,
  with the same 404 rule as the brand guard (OSE-1561).
- In a brand of its own, the brand stays the boundary, as it is today
  (`lib/admin-object-scope.ts`, OSE-1080).
- **No organizer other than the founder is admitted to the platform brand until
  OSE-1561 is Done.** This extends the OSE-1456 gate.

### 2b. The plan belongs to the brand.

Free and Mid must work side by side on one deployment. Today the plan is one
global setting (`Scope = 'global' | 'event'` in `packages/flags/src/types.ts`).
Under this ADR a brand has one plan; the platform brand is free; flags resolve
event override, then the brand's plan, then global (OSE-1562). Security, audit,
isolation and retention never depend on the plan.

### 3. One readable address, with optional parts.

```
/events?type=<event_type>&sponsor=<sponsor>          no brand
/b/<brand>?type=<event_type>&sponsor=<sponsor>       a brand
```

- Every part is a plain word. Event types, categories and sponsors get readable
  slugs; the brand id is its slug.
- `type` and `sponsor` are optional filters, in that order in the canonical form.
- The `sponsor` filter lists only events where that sponsor is on show
  (`SPONSOR_ON_SHOW_SQL`). A pending or declined placement is indistinguishable
  from an unknown sponsor.
- No brand means the platform's public list. It never means every brand's events
  merged; a brand's events appear only under its own address.

### 4. The kind of traffic is carried by the code, never by the readable address.

| Traffic | Arrives by                                          | Counted as                                              |
| ------- | --------------------------------------------------- | ------------------------------------------------------- |
| Onsite  | `/q/` code on a poster or TV with placement `venue` | Anonymous scan, tagged with the poster's cell           |
| Offsite | `/q/` code on a poster with placement `community`   | Anonymous scan, tagged with the poster's cell           |
| Online  | `/s/` short link                                    | Click count, tagged with the area it was published into |

A filter in the address selects what the page shows. It is never recorded
against a visitor.

Today every code, scan and short link belongs to one event (`event_id NOT NULL`
on `shortlinks`, `scans` and `poster_deployments`). This ADR decides only this
much about brand-level traffic:

- Short links may be owned by a brand, with a server-built target (OSE-1563,
  part 1).
- Whether poster codes may be owned by a brand is **not decided**. It touches
  scans, reports, retention and exports, and is a spike (OSE-1563, part 2).

Clicks and scans are different units. They are reported side by side and never
added into one "traffic" number.

### 5. Tracking rolls up in one way.

Event → campaign → brand → (later) parent brand. Every roll-up floors each
contributing count and then adds, reusing the rule in
`handlers/portfolio-rollup.ts`. Where the onsite, offsite and online split is
shown, each cell is floored before anything is added.

## Alternatives Considered

### Alternative A: Make `brand_id` nullable for events with no brand

A free event would store `NULL`.

**Rejected because:** every tenant-isolation query would gain a third case, and
`brand_id = ?` silently excludes `NULL` rows. Invariant #9 is enforced by that
filter being total. A named platform brand gives the same product behaviour with
no new state. The cost of this choice is decision 2a.

### Alternative B: Give every free organizer a brand of their own

Each organizer would be a one-person brand, so brand scoping alone would isolate
them.

**Rejected because:** the PO's rule is that the brand is the optional layer Mid
uses; a free event must need none. It would also give every free organizer a
`/b/<brand>` address and a plan row, and make "free" and "Mid" differ only by a
flag. Kept as the fallback if OSE-1561 proves harder than expected.

### Alternative C: Rename the platform brand from `root`

**Rejected because:** it is a data migration across every brand-scoped table and
both databases for no visible gain. Once OSE-1555 lands the id is written in one
place and shown nowhere.

### Alternative D: Put the brand at the top of the path, `/<brand>/…`

This is what the GAS toolkit did.

**Rejected because:** it needs a reserved-word list that must be checked on every
brand creation and every new route, for good. `/b/` costs two characters and
cannot collide.

### Alternative E: Carry the traffic kind in the address (`?src=poster`, `?sponsor=` as attribution)

**Rejected because:** anyone can edit a query string, so the counts would be
unreliable, and a per-visit attribution parameter is a tracker. The existing
split, `/q/` for tracking and `/s/` for routing, already separates the three
kinds without identifying anyone.

### Alternative F: Require all five core values to create a draft

**Rejected because:** the lowest use layer must stay near zero effort. Drafts
are forgiving on purpose and expire by themselves (`lib/draft-expiry.ts`).

## Consequences

### Positive

- An event needs no brand and no sponsor: five values, a poster, a pre-event.
- A brand is added on top without changing any event. Mid tracking and the
  Enterprise tree are extensions of one roll-up rule.
- One address works on a poster, in a text message and on a web page, and a
  person can read what it is.
- An unknown brand can no longer resolve to someone else's data.
- A home event can no longer appear on the map because a field was left out.

### Negative

- Leaving draft gets stricter. Events created before this ADR may lack a time or
  an event type and will prompt for them on the next edit.
- The platform brand needs a second isolation rule (owner) beside the brand
  rule. Two rules are more to test and to get wrong than one.
- The plan moves from one global setting to one per brand: a change in
  `@ocr/flags` and a backfill.
- Slugs for event types, categories and sponsors are new data that must stay
  unique and stable; renaming one breaks printed addresses unless the old slug
  keeps redirecting.
- `root` stays as an internal name that newcomers have to learn.

### Neutral

- Brands exist only from Mid upward in practice; free events all live in the
  platform brand.
- Organizers are admitted by a runbook grant today; no code creates a
  membership. This ADR does not change how an organizer gets in.

## Open questions (PO)

1. **How does a free organizer get in at launch:** by invitation (a grant per
   person, as today) or self-serve? Self-serve is new product surface and a new
   abuse surface.
2. **What may the platform brand's owner see** of other organizers' events and
   of their named form data? Recommended: event rows for support, never named
   form data.
3. **All-day events:** is a date alone enough for "time", with an explicit
   all-day choice?
4. **Map and sponsors, remaining details:** does removing the last sponsor turn
   the default back to off? What does the flip do for an event with no place to
   put on the map? _Working proposals shipped with OSE-1560, for the PO to
   confirm:_ removing the last sponsor leaves the map as it is (nothing turns it
   off but the organizer); with no place, the setting turns on and the event stays
   unmapped until its location resolves to an area cell (never a coordinate).

## References

- Tickets: OSE-1552 (campaigns and the campaign report), OSE-1553 (`brands`
  table), OSE-1554 (brand test matrix), OSE-1555 (brand resolver), OSE-1556
  (brand pages and readable address), OSE-1560 (core values at publish),
  OSE-1561 (owner isolation in the platform brand), OSE-1562 (plan per brand),
  OSE-1563 (brand short links, and the poster-code spike), OSE-1564 (toast
  service), OSE-1532 (Enterprise
  brand tree), OSE-1080 (object-level brand scoping, Done), OSE-1456 (client
  admin gate), OSE-1446 (role matrix).
- Code: `handlers/events.ts` (create, `is_published` default, `?mine=1`,
  `VALID_TRANSITIONS`), `handlers/qr-verify.ts`, `handlers/pages.ts` (public
  lists), `handlers/portfolio-rollup.ts` (floor, then sum),
  `lib/admin-brand-scope.ts`, `lib/admin-object-scope.ts`, `lib/sponsor-card.ts`
  (`SPONSOR_ON_SHOW_SQL`), `lib/event-datetime.ts`,
  `packages/flags/src/types.ts`, migrations 0070 (`is_published`), 0075
  (`created_by`), 0076 (event type categories), 0082 (`placement_type`).
- ADRs: ADR-009 (geographic hierarchy), ADR-010 (templates never gate; brand
  curation), ADR-017 (report depth), ADR-019 (sponsor consent).
- Invariants: #1 (no coordinates), #5 (tier equity), #7 (aggregate-only
  reporting), #9 (tenant isolation).
