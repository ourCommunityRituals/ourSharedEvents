# OurSharedEvents Beachhead ICP

**Date:** 2026-05-14
**Audience:** Internal — strategic spine for sales, sponsor outreach, GTM, eng prioritization
**Status:** Current
**Supersedes:** the implicit multi-vertical ICP framing in `COMPETITIVE-BRIEF-2026-05-14.md`
**Closes:** OSE-266

## Why this matters — the civic-visibility thesis

There is an entire economy of recurring community events — bocce nights, trivia leagues, recreational kickball, taproom darts, neighborhood-bar trivia, rec-center pickleball, library book clubs, parks-dept rec leagues — that happens every week in every neighborhood, and that has been **invisible to measurement, invisible to local sponsors, and economically illegible**.

These events have been compounding _socially_ (the same regulars Thursday after Thursday, the same league season after season) without compounding _economically_ or _informationally_. The bar that's hosted trivia for eight years has eight years of attendance memory in the bartender's head and zero years of measurable data. The insurance broker, credit union, or urgent-care clinic that would happily sponsor that trivia night has no way to find it, no way to measure it, and no way to justify a budget against it.

**OSE gives those events three things they have never had:**

1. **A voice.** Every event closes with a SharedReport. The trivia night that used to disappear from the calendar at 11 pm now leaves a measurable trace. Multiplied across a corridor and across years, the trace becomes a _story about a place_ that did not exist before.

2. **Local sponsor power.** The corner insurance broker, the regional credit union, the neighborhood urgent-care clinic — these are buyers Eventbrite is too expensive for and Meta is too imprecise for. OSE turns "the Beverly trivia corridor on Thursdays" into a $149/mo SKU with a measurable monthly report. Local sponsor budgets that currently leak into low-ROI digital ad spend now have a high-signal home.

3. **Compounding data, compounding voice.** Every event adds to the corridor's signal. A bar with 47 trivia nights of SharedReport data isn't just a busy bar; it's a documented community fixture whose value to local sponsors grows with every Thursday. The data compounding _is_ the voice compounding.

This is the line: **"OSE gives a voice to the events that happen in quiet, and gives local sponsors a way to support them — without surveilling a single person who shows up."**

### Every layer wins, simultaneously

| Layer                               | Before OSE                                                                 | With OSE                                                                                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The event** (Thursday trivia)     | Happens, dies at 11pm, lives only in bartender memory                      | Generates a SharedReport, compounds with prior nights, becomes a documented fixture                                                                   |
| **The venue** (the bar)             | Pays its bills from drink revenue alone                                    | Adds a second revenue surface: a measurable sponsor pitch backed by months of corridor data                                                           |
| **The local sponsor**               | Spends on Meta / Google with poor signal, or doesn't spend locally at all  | Buys corridor presence as a SKU with monthly attribution — ROI legible for the first time                                                             |
| **The attendee**                    | Anonymous in the bartender's eye, but tracked across the rest of the web   | Anonymous in the bartender's eye AND in the platform AND in the sponsor relationship — only their presence-density contributes to the corridor signal |
| **The neighborhood** (the corridor) | A collection of disconnected venues with no measurable civic-vitality data | A corridor-density profile across years, available to researchers, planners, civic leaders                                                            |

Every layer wins — and the architecture is what makes every win simultaneous. Meta makes sponsors win at attendees' expense. Eventbrite makes ticketing companies win at organizers' expense. **OSE is the only platform where all five layers compound together because the architecture refuses to extract value from any one of them at the expense of the others.**

This is the thesis that makes the rest of this document — beachhead ICP, product narrative, phase sequencing, infrastructure stack — coherent. Without it, OSE is good engineering. With it, OSE is the platform that makes a category of overlooked community economic activity visible for the first time.

## The beachhead, in one sentence

**OSE is for medium-and-smaller adult venues — bars, taprooms, neighborhood pubs — running recurring sports leagues and trivia nights, in the United States.**

The buyer is the venue owner / general manager. The sponsor _is_ the buyer (the bar pays because the events drive repeat foot traffic and corridor-anchored brand identity). The attendees are anonymous, by architectural design, and stay that way.

## Why this beachhead, in five forces

1. **Adults-only Phase 1 collapses the regulatory overreach.** Bar venues are 21+ by definition. No COPPA exposure, no HIPAA exposure, no BIPA exposure for the foreseeable rollout. The regulatory pool router stays as architectural readiness, not as current-defensibility marketing. HIPAA (Phase 4) and COPPA (Phase 5) — each with their own physically-separate D1 database — are honestly future work, not leaked current claims.

2. **Weekly recurring cadence is the architecture's archetype.** Anonymous ID + 15-minute time buckets + multi-year corridor density signal was built for _recurring_ hyperlocal events. Thursday trivia at the same bar for 52 weeks a year is the literal use case. One-off ticketed events don't generate corridor signal; weekly trivia at eight bars in one neighborhood does.

3. **The buyer is the sponsor.** Cleanest possible sales motion. The bar owner _is_ the sponsor — no advertiser intermediary, no two-sided marketplace bootstrapping. One conversation, one signature, one payment relationship. Compare: most event platforms assume sponsor + organizer + venue as three separate parties.

4. **Trivia franchises are a natural distribution channel.** Geeks Who Drink, Trivia Time, Pour House Trivia, Trivia Mafia and similar franchises each have 50–300+ bar locations under contract. One franchise partnership = N bars onboarded under one referral attribution. This is corridor-of-mouth (OSE-267 referral instrumentation) made concrete.

5. **Defensible against group-chat default.** Bar owners do _not_ have a customer WhatsApp group for Thursday trivia regulars — they have an Instagram post that gets buried in four hours. OSE replaces the _gap_, not the _group chat_. The "OSE is a layer, not a replacement" claim (OSE-265) becomes literally true for this ICP.

## The product, in one sentence

**OSE is a sponsor-grade corridor-density analytics product, delivered through an events platform.**

The events generate the data; the **SharedReport** delivers it. Every event closes with a data artifact the sponsor can hold in their hand — and every event makes the next one's report richer. This is the SKU. The events platform is the data-collection mechanism that makes the SKU possible.

## The product flow — pre-event, event, post-event

OSE runs as a **continuous three-phase arc** across every event, with the SharedReport as the closing artifact that lands the sponsor relationship.

### Pre-event

- Public event surface (`/events/:id`) — mobile-first, anonymity affordance visible, share/save flows, sponsor matching. The bar shares this via QR codes, Instagram bio, printed coasters, chalkboard signs. (Shipped — OSE-243a.)
- Admin surface where the bar's manager creates the recurring trivia / league series in under five minutes.
- `/poster` surface prints a QR-code carrier for bathroom walls and coaster racks — every scan is a corridor-density signal contribution.

### Event (live)

- Public event surface flips to live-phase rendering with a LIVE NOW indicator, check-in CTA, and "navigate now" wayfinding. (Shipped — OSE-244a, deployed to staging 2026-05-14.)
- `/display` surface drives the TV behind the bar — sponsor rotation, the night's leaderboard, "next league night" countdown.
- Check-in scans contribute to the anonymized event-night density signal.

### Post-event

- **`/sharedReport` — the product deliverable.** Every event closes with a sponsor-grade data artifact:
  - Unique gatherings (anonymized count of distinct anon-IDs in the event window)
  - Return rate (% of anon-IDs seen at prior events at this venue or corridor)
  - Corridor density vs. neighborhood baseline (how busy was this venue compared to the surrounding 2-mile corridor)
  - Sponsor-rotation impressions on the `/display` surface
  - Poster-scan attribution (which venue / placement / time-of-day drove scans)
  - Headcount trend over recurring instances of the same series
  - Sample size and confidence-band callouts so the bar / sponsor can read the numbers honestly
- The SharedReport ships as both a sponsor-facing PDF / web page and a structured BigQuery-backed artifact that compounds across phases and years.

### Why the three-phase arc matters

The three rendered surfaces are not three independent features — they are the **product itself running as a continuous data-collection-and-delivery loop**. Each event:

1. Generates pre-event share signal (QR scans, poster scans, save-event clicks).
2. Generates live-event attendance signal (check-ins, time-on-page, sponsor-rotation impressions).
3. Closes with a SharedReport that compounds with every prior event in the same venue / corridor / sponsor account.

The flywheel is concrete: **every event creates data → SharedReport delivers data to sponsor → SharedReport is the proof point for the next sponsor conversation → next event creates more data**. Per the flywheel doctrine, this is not a feature roadmap; it is a single loop running at every fractal scale (event-level, sponsor-account-level, corridor-level, phase-level).

## What the architecture lets us _legally_ deliver

The SharedReport contains:

- Gathering density signal (count of distinct anonymous IDs in time/place buckets)
- Return rate signal (anonymous ID seen at multiple events, no identity ever resolved)
- Corridor density (geographic aggregation across the 2-mile bucket)
- Sponsor-rotation reach (impressions on `/display` surface, aggregate)
- Poster-scan attribution (which scan source, no individual identity)
- Time-of-day / day-of-week density patterns
- Phase-spanning cross-tier corridor data (once Phases 1-5 are in production, with regulatory-tier-safe aggregation guaranteed by the multi-D1 architecture)

The SharedReport explicitly **does not** contain:

- Attendee names, emails, phone numbers, IP addresses, or device IDs
- A roster of who attended
- Any per-attendee identity linkage across events
- Any pre-aggregation raw signal that could re-identify an attendee

The architectural moat translates directly into a sales line: **"You cannot accidentally collect attendee identity, because the platform cannot accidentally show it to you — but you do get a sponsor-grade analytics report at every event close, and the data compounds over time as your venue's corridor signal grows."**

## Why this product framing is structurally stronger than the competition

| Competitor pattern              | Their framing                                  | Why OSE's framing wins                                                                                           |
| ------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Eventbrite                      | Ticket processing; data is a side-pocket asset | OSE's data IS the asset; the events make the data                                                                |
| Partiful                        | Friend-group RSVP; monetization unclear        | OSE has a tangible sponsor-paid deliverable per event                                                            |
| Luma                            | Event UX; analytics are an add-on subscription | OSE's analytics are the product; the events are the input                                                        |
| Meta Events                     | Identity-graph ad targeting                    | OSE delivers corridor density without identity capture — a categorically different SKU                           |
| Posh                            | Influencer attendance graphs                   | OSE delivers venue-level density; no influencer mediation, no identity layer                                     |
| Group chats (WhatsApp / Signal) | Free, friction-free, no data layer             | Group chats can't generate SharedReports; OSE doesn't replace the chat — it replaces the missing analytics layer |

The competitive matrix collapses to one observation: every other platform either (a) treats data as a byproduct of identity-aware events, or (b) doesn't generate data at all. OSE is the only platform shipping a data product _because of_ anonymity, not in spite of it.

## Phase sequencing — the five-phase model

OSE ships in **five phases**. The first three share the existing data architecture and ship as a coordinated **initial launch wave**. The last two introduce **net-new physically-separate D1 databases** to satisfy HIPAA and COPPA at the storage layer, not just at the routing layer.

| Phase                        | ICP                                                                                                                         | Cloudflare D1 storage                                                                                                  | BigQuery export dataset        | Regulatory tier                    | Launch wave        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------- | ------------------ |
| **Phase 1** (now)            | Medium-and-smaller adult bar/taproom/pub venues hosting recurring sports leagues + trivia                                   | Existing 2-DB stack (`DB` + `FORMS_DB`)                                                                                | `general`                      | None — adult-only                  | **Initial launch** |
| **Phase 2** (Q3-Q4 2026)     | Adult community recreation — rec centers, YMCAs, neighborhood gyms, parks-dept rec leagues, recreation-affiliated community | Existing 2-DB stack                                                                                                    | `general`                      | None — adult-led / family-adjacent | **Initial launch** |
| **Phase 3** (Q4 2026 - 2027) | Broader community civic surface — libraries, senior centers, parks-dept open events, neighborhood/civic associations        | Existing 2-DB stack                                                                                                    | `general`                      | None — general                     | **Initial launch** |
| **Phase 4** (2027+)          | **HIPAA** — hospital wellness, medical-adjacent, museum-medical events                                                      | **NEW: `DB_HIPAA`** — third D1 database, physically separate, bound to its own handler class via extended static gate  | `hipaa` (BAA-covered)          | HIPAA                              | **Down the line**  |
| **Phase 5** (2028+)          | **COPPA** — school events, PTAs, youth athletics, school-affiliated recitals                                                | **NEW: `DB_COPPA`** — fourth D1 database, physically separate, bound to its own handler class via extended static gate | `coppa` (audit-trail isolated) | COPPA                              | **Down the line**  |

Each phase reuses the **architectural pattern** (anonymous ID, 15-min time bucket, static invariant gate per database, regulatory pool router) but the _concrete database count_ grows from 2 → 2 → 2 → 3 → 4 across the five phases. By Phase 5, the platform runs **four physically separate D1 databases**, each bound to a disjoint handler class, with no cross-references except the anonymous ID + corridor signal — and BigQuery mirrors that segregation at the export layer.

**Critical discipline:** Phases 4 and 5 are _roadmap_, not _current defensibility_. Marketing language must distinguish them clearly. See OSE-264. The architectural readiness exists today (`src/lib/pool-contract.ts` REGULATORY*POOLS contract); the \_operational* readiness (separate D1 instances + BAA + attestation) lands with Phases 4 and 5.

## Infrastructure stack — designed for this flow

The cloud-stack choice (Google Maps + GCP + BigQuery) was made deliberately to support the five-phase regulatory expansion without re-platforming at Phase 4. Each component has a phase-spanning role:

| Layer                                | Phase 1-3                               | Phase 4 (HIPAA)                                                              | Phase 5 (COPPA)                                                           |
| ------------------------------------ | --------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Edge runtime** (Cloudflare Worker) | Same Worker, same routing               | Same Worker, with HIPAA handler class statically gated to `DB_HIPAA` only    | Same Worker, with COPPA handler class statically gated to `DB_COPPA` only |
| **Storage** (Cloudflare D1)          | `DB` + `FORMS_DB`                       | + `DB_HIPAA` (net-new instance)                                              | + `DB_COPPA` (net-new instance)                                           |
| **Export** (BigQuery on GCP)         | `general` dataset                       | + `hipaa` dataset, BAA-covered under Google Cloud Healthcare API attestation | + `coppa` dataset, audit-trail isolated per FTC COPPA rule §312           |
| **Geo signal** (Google Maps API)     | Corridor density at venue level, no PII | Same — geo primitive carries zero identity                                   | Same                                                                      |
| **Compliance posture** (GCP)         | Standard                                | Google Cloud BAA + HIPAA Implementation Guide alignment                      | COPPA verifiable parental consent flow + GCP audit-trail infrastructure   |

**The infrastructure unity is that the regulatory tier propagates end-to-end as a routing dimension** — from the D1 write at the edge, through `pool-contract.ts`, into a tier-specific BigQuery dataset — never crossing tiers at any layer. Google Maps provides the geographic primitive that powers corridor density across all tiers without ever carrying identity. GCP provides the BAA and attestation surfaces that Phase 4 + 5 require without re-platforming.

This is why the stack choice is not interchangeable. AWS + Athena + Mapbox could run Phases 1-3, but switching at Phase 4 to satisfy HIPAA's specific attestation surface would be a full data-layer migration. The current stack is the **only commodity stack** that supports the 5-phase model without a Phase-4 rewrite.

## The marketing arc by phase

The 5-phase model implies three distinct positioning artifacts, each truthful at a different time:

| Artifact                             | Becomes truthful when                                       | Hero claim                                                                                                                                                                                                |
| ------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Launch positioning** (today)       | Phase 1 in production                                       | "Anonymous attendance, corridor density signal, no roster leakage. Built for recurring adult community events. Regulatory tier expansion is on the architectural roadmap."                                |
| **Bridge positioning**               | First HIPAA-tier event served from `DB_HIPAA` in production | "Healthcare-tier data and general-tier data live in different databases — physically separate, not promised-separate. The architectural claim is now a deployment artifact."                              |
| **Saturation positioning** (endgame) | First COPPA event served from `DB_COPPA` in production      | "Four physically separate D1 databases. Two physically separate BigQuery datasets. Anonymous ID is the only cross-correlation key. The architecture is the moat — and it's now in production end-to-end." |

The **saturation play** unlocks at the third artifact. That's when:

- Every community in OSE's footprint has at least one surface across the five phases (bar / rec / civic / hospital / school).
- Corridor density signal aggregates across all five phases for the same geographic area — a compounding moat at scale.
- The "physically impossible" claim that the CCR-2026-05-14 analysis flagged as overreach becomes literally, physically, demonstrably true at the storage layer.
- Competitive copy-the-feature attacks become structurally impossible because no incumbent has both the storage segregation and the cross-phase corridor signal.

Saturation positioning is the brief written _once_ and locked away today, sharpened by what Phases 1-3 reveal, deployed when Phase 4 + 5 land. See planned artifact `docs/positioning/SATURATION-PLAY-YYYY-MM-DD.md` (to draft separately).

## The Phase 1 sales motion

**Lead channel:** in-person bar visits. Bar owners are accessible, decision is fast, sales cycle is 1–3 visits. Walk in at 2pm before the dinner rush. Talk to the GM. Show a working `/events/:id` page on your phone. Leave a printed `/poster` mock with their venue name on it.

**Adjacent channel:** trivia franchise partnerships. One franchise partnership = N bars under one attribution. Higher ACV per conversation, longer sales cycle (4–8 weeks), but a structural unlock once it lands. Target: Geeks Who Drink, Trivia Time, Pour House Trivia, Trivia Mafia, regional independents.

**Inbound channel:** referral codes from existing bars (OSE-267). Bar A signs up → bar A's GM mentions OSE at the regional bar-owner meetup → bar B signs up with bar A's referral code attached → corridor density signal links them.

**Not a channel:** SEO, paid social, content marketing. Discovery is not OSE's job for this ICP. Bars are found in person and on referral.

## Pricing anchor (working hypothesis, not committed)

Three tiers, anchored to what neighborhood bars already pay for adjacent SaaS (Yelp Premium $30–80/mo, OpenTable $50–150/mo, Toast Marketing $50+/mo):

| Tier        | Monthly | Includes                                                                                                         |
| ----------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| **Free**    | $0      | 1 recurring event series, anonymous RSVP, public event page, basic poster QR                                     |
| **House**   | $49     | Unlimited recurring series, multi-night cadence, corridor density report (monthly), `/display` TV surface        |
| **Sponsor** | $149    | Everything in House + sponsor matching + `/sharedReport` corridor analytics + venue referral attribution credits |

Validation needed before commit. The brief currently has one $200/mo number that is an orphan; this tier structure replaces that. **No tier above $149/mo for Phase 1.** Anything more is Phase 2-3 (rec center, civic, multi-venue accounts) or Phase 4+ (regulated tiers with their own physically separate D1 + BigQuery pricing).

## Risks to watch (specific to this ICP)

| Risk                                                         | Severity | Mitigation hypothesis                                                                                                                                                                                        |
| ------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Trivia franchises see OSE as a competitor, not a layer       | High     | Lead with sponsor surface (bar buys, franchise doesn't pay) and anonymity (franchise can't see attendee identity even if they wanted to). The franchise gets _better leaderboards_, not a competing product. |
| Bar owners are not tech-buyers — UX bar is brutally high     | High     | One-tap admin onboarding. QR-based "create your first event in 60 seconds" inside the printed sales sheet. Engineering quality is invisible to this buyer; UX is everything.                                 |
| Alcohol-adjacent regulation (DRAM, state liquor commissions) | Medium   | OSE doesn't sell or promote alcohol — it sells _recurring events at the venue_. Default templates avoid "happy hour" language. No age-verification storage.                                                  |
| Small bars are price-sensitive and high-churn                | Medium   | Free tier is generous. House at $49/mo is below the Yelp Premium floor. Pricing validates _before_ the Sponsor tier is the upsell ask.                                                                       |
| Trivia is seasonal and competitive in dense neighborhoods    | Low      | Saturated corridors = _higher_ signal density. The platform's value goes up when there are five bars on the same block; it doesn't matter which one any single attendee picks.                               |

## What this ICP changes in the broader artifact set

| Artifact                               | Change                                                                                                                                                                                                                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COMPETITIVE-BRIEF-2026-05-14.md`      | Add a "Phase 1 ICP" callout near the top pointing to this doc. Soften pluralized vertical lists in audience pitches. (OSE-266 closure work.)                                                                                                                                                          |
| `EXTERNAL-LANDING-*.md` (when written) | Hero leads with bar/trivia ICP. (OSE-268.)                                                                                                                                                                                                                                                            |
| `pool-contract.ts`                     | No change for Phases 1-3 (general-tier only). Phase 4 extends to route HIPAA writes to `DB_HIPAA`. Phase 5 extends to route COPPA writes to `DB_COPPA`. The contract is forward-compatible — the routing function expands; the contract shape doesn't change.                                         |
| `/poster` surface roadmap              | Re-prioritize against bar bathroom-wall / coaster-rack use case.                                                                                                                                                                                                                                      |
| `/display` surface roadmap             | Re-prioritize against TV-behind-the-bar leaderboard + sponsor rotation.                                                                                                                                                                                                                               |
| `/sharedReport` surface roadmap        | Re-prioritize against monthly bar-owner PDF email with corridor density + retention.                                                                                                                                                                                                                  |
| OSE-267 (referral codes)               | Venue code = bar code. Commissioner code = trivia franchise / rec-league commissioner. The PLG hypothesis is now specific and testable.                                                                                                                                                               |
| OSE-264 (strip overreach)              | Becomes nearly trivial — HIPAA is Phase 4, COPPA is Phase 5, each gets its own physically-separate D1 database when it ships. No awkward "architecturally ready but not attested" framing needed. The endgame architectural claim is what gives the launch positioning permission to be modest today. |

## When to revisit

This document is updated when:

- The first ten bar customers reveal a pricing tier or surface need that this ICP doesn't anticipate.
- A franchise partnership lands and reshapes the unit-of-sale economics.
- A Phase 4 or Phase 5 vertical surfaces faster than expected and pulls forward the multi-D1-database architecture (e.g., a regional hospital system signs an LOI for Phase 4 before Phase 3 has saturated).
- A competitor (Eventbrite, Partiful, Posh, etc.) launches a bar-trivia-targeted product.

It is **not** updated to chase competitor positioning or to soften ICP discipline. The whole point of this artifact is to resist the gravitational pull toward "everyone is our customer."

## References

- `docs/positioning/COMPETITIVE-BRIEF-2026-05-14.md` — strategic spine; this doc sharpens its ICP section
- `docs/adr/ADR-001-anonymous-identity-architecture.md` — the architecture that makes the "no attendee identity" promise truthful
- `docs/adr/ADR-002-static-invariant-gates.md` — the CI pattern that makes the architecture enforceable
- Linear: OSE-266 (this doc closes it), OSE-264 (strip overreach, now simpler), OSE-265 (group-chat default, now sharper), OSE-267 (referral codes), OSE-268 (external landing artifact)
