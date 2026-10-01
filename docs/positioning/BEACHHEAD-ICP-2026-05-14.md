# OurSharedEvents Beachhead ICP

**Date:** 2026-05-14
**Audience:** Internal — strategic spine for sales, sponsor outreach, GTM, eng prioritization
**Status:** Current
**Supersedes:** the implicit multi-vertical ICP framing in `COMPETITIVE-BRIEF-2026-05-14.md`
**Closes:** OSE-266

## The beachhead, in one sentence

**OSE is for medium-and-smaller adult venues — bars, taprooms, neighborhood pubs — running recurring sports leagues and trivia nights, in the United States.**

The buyer is the venue owner / general manager. The sponsor _is_ the buyer (the bar pays because the events drive repeat foot traffic and corridor-anchored brand identity). The attendees are anonymous, by architectural design, and stay that way.

OSE measures every recurring trivia or league night so the bar can sell corridor presence to local sponsors — without ever holding attendee identity.

## Why this matters — the civic-visibility thesis

There is an entire economy of recurring community events — bocce nights, trivia leagues, recreational sports, taproom darts — that happens every week and has been **invisible to measurement, invisible to local sponsors, and economically illegible**.

OSE gives those events three things they have never had: a measurable voice (every event will close with a SharedReport once OSE-245 and the data-pipeline story ship), local sponsor power (a SKU the corner insurance broker can actually buy), and compounding data (every event enriches the corridor signal). The architecture is what makes this possible — anonymous identity means all five layers (event, venue, sponsor, attendee, neighborhood) win simultaneously, because the platform refuses to extract value from any one at the expense of the others.

**The line:** "OSE gives a voice to the events that happen in quiet, and gives local sponsors a way to support them — without surveilling a single person who shows up."

## Why this beachhead, in five forces

1. **Adults-only Phase 1 collapses regulatory overreach.** Bar venues are 21+ by definition. No COPPA, no HIPAA exposure for the foreseeable rollout. Regulatory tier expansion (physically-isolated databases for each regulated tier) is architectural readiness, not current-defensibility marketing. Each expansion is a future physically-separate database; ADR-003 names them when they land.

2. **Weekly recurring cadence is the architecture's archetype.** Anonymous ID + hourly time buckets (15 minutes in the original design; hourly confirmed 2026-10-01) + multi-year corridor density signal was built for _recurring_ hyperlocal events. Thursday trivia at the same bar for 52 weeks is the literal use case.

3. **The buyer is the sponsor.** Bar owner _is_ the sponsor — no advertiser intermediary, no two-sided marketplace bootstrapping. One conversation, one payment relationship.

4. **Regional and national trivia and league franchises are a natural distribution channel.** Each franchise has 50–300+ bar locations under contract. One partnership = N bars onboarded under one referral attribution. This is corridor-of-mouth (OSE-267) made concrete.

5. **Defensible against group-chat default.** Bar owners don't have a customer WhatsApp group for Thursday trivia regulars — they have an Instagram post buried in four hours. OSE replaces the _gap_, not the chat.

## The product, in one sentence

**OSE is a sponsor-grade corridor-density analytics product, delivered through an events platform.**

The events generate the data; the SharedReport delivers it. Every event will close with a data artifact the sponsor can hold — and every event makes the next one richer. This is the SKU. The events platform is the data-collection mechanism that makes the SKU possible.

## Product maturity by surface

| Surface                                 | Status        | Notes                                                                       |
| --------------------------------------- | ------------- | --------------------------------------------------------------------------- |
| Pre-event render (`/events/:id`)        | **Shipped**   | OSE-243a                                                                    |
| Event-live render (LIVE NOW + check-in) | **Staging**   | OSE-244a, deployed 2026-05-14                                               |
| Post-event SharedReport                 | **Unshipped** | OSE-245                                                                     |
| SharedReport data pipeline              | **Unshipped** | Story to spawn                                                              |
| HIPAA-tier database (Phase 4)           | **Unbuilt**   | ADR-003 forthcoming; physically-isolated database, separate from Phases 1–3 |
| COPPA-tier database (Phase 5)           | **Unbuilt**   | ADR-003 forthcoming; physically-isolated database, separate from Phases 1–3 |

"Every event closes with a SharedReport" is the target state, not current truth.

## What the architecture lets us legally deliver

The SharedReport contains gathering density signal, return rate signal, corridor density, sponsor-rotation reach, poster-scan attribution, and time-of-day patterns — all aggregated from anonymous IDs, with no per-attendee identity at any layer.

**Sales line:** "You cannot accidentally collect attendee identity, because the platform cannot accidentally show it to you — but you do get a sponsor-grade analytics report at every event close, and the data compounds over time as your venue's corridor signal grows."

## Phase sequencing

| Phase                | ICP                                                          | Regulatory tier                                                                                                                                                                        | Wave           |
| -------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **1** (now)          | Adult bars/taprooms, recurring sports leagues + trivia       | None — adult-only                                                                                                                                                                      | Initial launch |
| **2** (Q3–Q4 2026)   | Adult recreation — rec centers, YMCAs, parks-dept leagues    | None                                                                                                                                                                                   | Initial launch |
| **3** (Q4 2026–2027) | Civic — libraries, senior centers, neighborhood associations | None                                                                                                                                                                                   | Initial launch |
| **4** (2027+)        | Healthcare-adjacent wellness events                          | HIPAA — new physically-isolated database; requires Google Cloud Healthcare API enablement + BAA + third-party attestation; budget 9–15 months and low six-figure compliance investment | Down the line  |
| **5** (2028+)        | School events, PTAs, youth athletics                         | COPPA — new physically-isolated database; verifiable parental consent + audit-trail isolation per FTC §312                                                                             | Down the line  |

Phases 4–5 are roadmap, not current defensibility. The existing routing pattern (`pool-contract.ts`) is forward-compatible; each expansion adds a new isolated database without changing the contract shape.

## Phase 1 sales motion

**Lead channel:** In-person bar visits. Bar owners are accessible; sales cycle is 1–3 visits. Walk in at 2pm before the dinner rush. Show a working `/events/:id` page on your phone. Leave a printed `/poster` mock with their venue name on it.

**Adjacent channel:** Regional and national trivia and league franchise partnerships. Higher ACV per conversation, longer cycle (4–8 weeks), structural unlock when it lands.

**Inbound:** Referral codes from existing bars (OSE-267). Bar A signs → mentions OSE at the regional bar-owner meetup → bar B signs with bar A's code attached.

**Not a channel:** SEO, paid social, content marketing.

## Risks to watch

| Risk                                                   | Severity | Mitigation                                                                                                                               |
| ------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Franchises see OSE as competitor, not a layer          | High     | Lead with sponsor surface (bar buys, franchise doesn't pay) and anonymity (franchise can't see attendee identity even if they wanted to) |
| Bar owners are not tech-buyers — UX bar is high        | High     | One-tap admin onboarding; QR "create your first event in 60 seconds" inside the printed sales sheet                                      |
| Alcohol-adjacent regulation (state liquor commissions) | Medium   | OSE sells recurring events, not alcohol. No age-verification storage.                                                                    |
| Small bars are price-sensitive and high-churn          | Medium   | Free tier is generous; validate pricing before the Sponsor tier becomes the upsell                                                       |
| Trivia is seasonal in dense neighborhoods              | Low      | Saturated corridors = higher signal density; platform value increases when five bars share a block                                       |

## When to revisit

Update when: first 10 bar customers reveal unmet pricing or surface needs (cite OSE-271 discovery interviews when complete); a franchise partnership reshapes unit economics; a Phase 4/5 vertical surfaces faster than expected; a competitor launches a bar-trivia-targeted product.

Do **not** update to chase competitor positioning or soften ICP discipline.

## Appendix — Pricing hypothesis (working, not committed)

Anchored to what neighborhood bars already pay for adjacent SaaS (Yelp Premium $30–80/mo, OpenTable $50–150/mo, Toast Marketing $50+/mo):

| Tier        | Monthly | Includes                                                                                                  |
| ----------- | ------- | --------------------------------------------------------------------------------------------------------- |
| **Free**    | $0      | 1 recurring event series, anonymous RSVP, public event page, basic poster QR                              |
| **House**   | $49     | Unlimited recurring series, multi-night cadence, corridor density report (monthly), `/display` TV surface |
| **Sponsor** | $149    | House + sponsor matching + `/sharedReport` corridor analytics + venue referral attribution credits        |

Validation needed before commit. No tier above $149/mo for Phase 1. Anchor to _displacement_ economics — what budget does OSE replace — not additive stacking.

## References

- `docs/positioning/COMPETITIVE-BRIEF-2026-05-14.md`
- `docs/adr/ADR-001-anonymous-identity-architecture.md`
- `docs/adr/ADR-002-static-invariant-gates.md`
- Linear: OSE-266 (closes), OSE-264 (strip overreach), OSE-265 (group-chat default), OSE-267 (referral codes), OSE-268 (external landing artifact), OSE-271 (discovery interviews — cite when complete)
