> **Status: proposal, 2026-10-04. Not a decision.** Companion to `BRAND-MARKETING-SALES-STRUCTURE-2026-10-04.md`. The PO has said public names can change; this doc is about how the brand and infrastructure line up across the hub, the spokes and the products. Built from `OCR-docs/docs/OCR_VISION.md` (§6.4 to 6.6, §7) and hub ADR-008 and ADR-009 (both still **Proposed**). If accepted, this becomes a hub ADR, not an OSE one.

# Brand and infrastructure: one look, separate regimes

## Governing rule (PO, 2026-10-04): to the public it is one system

A visitor sees one name, one place and one promise ("Counted, never known"). They never see hub, spoke, regime, OSE, OW or any product code, and they are not asked to pick a "door". What they see adapts to what they are doing: finding an event, putting one on, or backing one. Everything below is the engineering reference for how that one system is built behind the scenes. Where this doc says "door" or "public name per spoke", read it as an internal routing term only; the public surface is a single product. Naming and hostname choices must pass this test: could a stranger describe the site in one sentence after five seconds?

## The idea in one paragraph

The brand is a **presentation-plane** thing. The architecture is an **identity-regime** thing. Keep them on different axes so neither bends the other. The hub owns _how everything looks and is governed_ (tokens, `@ocr/ui`, flags, standards, the public front door). Each spoke owns _a regime of data and identity_ (anonymous, named, hybrid). A public "door" is a name and a route that points at one spoke. A door never merges two spokes' data, and a spoke never needs to know the brand's public name.

## Templates: two kinds, one rule

There are **event templates** (OSE: `event_templates`, 32 of them, ADR-010) and **profile templates** (OW and the ourAirwaves editor: artist, team, business, academic, athlete, leader and so on). They are two catalogs of the same thing: a preset of defaults chosen at creation, always overridable. The ADR-010 rule applies to both: templates give breadth and never gate; tiers give depth and layer features on top. Today only the event side is written down (ADR-010 is OSE-local) and OW has no preset system in code, only page files. One hub-level statement of the rule would cover both and any future format (games, records, tournament nights).

## Why OSE and OW stay separate (PO, 2026-10-04)

The separation is the point, and it stays: each runtime respects its own invariants, has its own code and has its own tests. Everything in this doc reduces repos, pipelines and public naming; none of it merges runtimes or databases.

- **Profile templates** (who someone is) belong to OW. A person matches one however they choose. OSE never sees them.
- **Event templates and the event's mode** (physical, digital or hybrid) belong to OSE. The mode is a field on the event. OSE holds no field that refers to a person or a profile, and an event never inherits settings from one.
- OW may run its own events under its own invariants and tests.
- The only connection is a link a person chooses to share, one way, from an OW page out to an OSE event page or an anonymous report. OSE learns nothing from it. A digital check-in reads no IP and no location (OSE already forbids `CF-IP*` headers).
- OSE has no physical, digital or hybrid mode today (checked 2026-10-04: no such column or handler). Adding one is an OSE story with its own tests, not a cross-product change.

## Two axes

|              | Hub                                                                            | Spoke                                                      |
| ------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Owns         | Look, tokens, shared packages, standards, CI bracket, the marketing front door | A product's runtime, database pair, identity model, domain |
| Changes when | The brand or design system changes                                             | The product's behaviour changes                            |
| Must never   | Hold product data or an identity                                               | Carry its own copy of the look                             |

This is what ADR-008 already argues for the code (one copy of `@ocr/ui` and `@ocr/tokens`, with spokes keeping separate workers, databases and domains). The brand question has the same answer: a rename or a re-skin should be a hub change, not a spoke change.

## Where each door lands

| Public door (proposed)        | Spoke or layer                 | Identity regime                      | Notes                                                                                 |
| ----------------------------- | ------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------- |
| Hosts (create, print, manage) | **OSE** admin                  | Anonymous (Invariant 1)              | Hosts are named organizations; attendees are never named.                             |
| Check-in (green QR)           | **OSE** forms / scans          | Anonymous                            | The promise lives here: counted, never known.                                         |
| Sponsors                      | **OSE** sponsor corner         | Anonymous aggregates                 | Sponsors see turnout, not people.                                                     |
| Map                           | **OSE** `/events`, landing map | Anonymous                            | Discovery surface.                                                                    |
| Report                        | **OSE** SharedReport           | Anonymous aggregates, k-floored      | The paid object.                                                                      |
| Stage (named layer)           | **OW**                         | Named, voluntary                     | Artists, DJs, athletes who choose to be known.                                        |
| Games, Records (formats)      | **OSG**, **OSR**               | Inherit OSE; hybrid-capable          | Community series. They ride on the anonymous spine and may carry named personalities. |
| Pulse (consulting)            | **OSP**                        | None (human-delivered)               | Endorsed sub-brand; no runtime of its own.                                            |
| EventRings (data)             | **OER**                        | BigQuery, qualifying-field gate only | Endorsed sub-brand; reads emitted aggregates, never spoke databases.                  |
| Client sites, white label     | **OA** front, **OSM** back     | Per client class                     | OA provisions named; OSM provisions anonymous.                                        |

OW, OSG and OSR are hybrid-capable, so "Stage" is not strictly OW only. That is fine: the door is the named layer, whichever spoke serves a given vertical.

## What the hub owns for the brand

1. **Tokens and `@ocr/ui`.** One palette, one component set. This repo is already pinned to hub `265a549` (uniform palette, OSE-1523), so the mechanism exists. A brand re-skin is a pin bump in each spoke.
2. **A static front door.** One marketing site, hub-owned, no database and no cookies. It carries the master name, the door explanations, the kit downloads and the "how we keep this promise" page. It links out to spoke domains; it never proxies identity.
3. **A naming map.** One table from internal code to public door, kept in the hub. Internal names (OSE, OSM, OA…) stay in repos, ADRs, Linear and runbooks. Public names live only in rendered copy and the front door. Spokes read the public name from a hub-owned string set, not hard-coded literals, so a rename is one change.
4. **Brand-wide invariants.** The never-who promise, no cookies on public surfaces, and tier-never-gates-security already live in OCR-docs. The brand copy is generated from, or checked against, those rules so marketing cannot promise something the gates do not enforce.

## What each spoke owns

- Its runtime, `wrangler.toml`, database pair and domain (ADR-008: "does not merge databases, workers or runtimes").
- Its identity regime and the gates that enforce it.
- Its own surfaces, built from hub tokens.

## Crossing between regimes

The risk of one friendly brand is that a visitor assumes "one brand = one profile." Three rules keep the wall visible:

1. **A visible regime marker on every surface.** Anonymous surfaces say so in the same words and colour everywhere (green = counted, never known). Named surfaces say "named" just as plainly. The existing green/blue QR convention is the seed of this.
2. **Crossing is an explicit link, never a silent handoff.** Check-in to Stage is a plain link the visitor chooses to follow. No shared session, no token carried across. The choice token (ADR-002) is the boundary.
3. **Admin SSO may be shared; attendee identity may not.** Cloudflare Access for operators can span spokes. Attendees have no account on OSE, so there is nothing to share.

## Domains

- **Recommended:** one apex for the brand front door (hub), with spokes on their own hostnames behind it (for example `host.`, `stage.`, `report.` mapped by Cloudflare routes to the existing workers). This keeps two workers and two database pairs, matches ADR-008, and gives visitors one name to remember.
- **Not recommended:** serving OSE and OW from one worker behind path routing. It is the fusion ADR-009 rejects, and every gate would have to ask "which regime am I in?".
- Existing short links and printed QR codes must keep resolving. Any domain move needs a redirect plan before it needs a design.

## Composition and white label

ADR-009 puts composition in **OA** (pins OSE and OW as versioned dependencies) and contracts in **OSM** (API, elements, specs). Brand fits the same shape: a client deployment is a hub theme (`[data-brand]` tokens, already the Tier-3 rule) plus a composition manifest. The public brand is the default theme, not a special case. "Powered by" attribution is a manifest field, so white-label tiers can turn it off without touching the spoke.

## What I would not change

- The two-database split and the choice-token boundary.
- Spokes that stay separate repos until ADR-008 Phase 1 (after launch).
- Internal vocabulary. Engineers keep OSE, OSM, OA; the confusion the research found is on the public side only.

## Decisions needed from the PO

1. **Master public name.** Shared Choice is the research's pick, pending attorney clearance. Until that clears, nothing public is printed with it.
2. **Where the front door lives.** A hub-owned static site (recommended) or an OSE page. The first keeps OSE a product, not the org's brand host.
3. **Hostname plan.** Apex plus per-door subdomains, or one subdomain per spoke only.
4. **Where the naming map lives.** Hub string set consumed by spokes (recommended), or per-repo constants.
5. **Whether this becomes a hub ADR** (suggested: ADR-012, "Brand is a presentation plane over separate identity regimes"). It would extend ADR-008 and ADR-009 and should wait to be accepted with them or reference them as Proposed.

## Open questions I could not settle from the repos

- Whether the hub already has a place for shared copy or string sets. `@ocr/ui` has components and tokens; I did not find a copy layer.
- Whether `oursharedevents.com` stays the host for the OSE spoke or becomes a hub-fronted subdomain. Production is deployed but not launched, so the cost of moving is lowest now.
- ADR-008 and ADR-009 are Proposed, so everything above that leans on them inherits that status.
