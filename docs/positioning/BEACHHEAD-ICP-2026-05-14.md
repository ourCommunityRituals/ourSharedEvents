# OurSharedEvents Beachhead ICP

**Date:** 2026-05-14
**Audience:** Internal — strategic spine for sales, sponsor outreach, GTM, eng prioritization
**Status:** Current
**Supersedes:** the implicit multi-vertical ICP framing in `COMPETITIVE-BRIEF-2026-05-14.md`
**Closes:** OSE-266

## The beachhead, in one sentence

**OSE is for medium-and-smaller adult venues — bars, taprooms, neighborhood pubs — running recurring sports leagues and trivia nights, in the United States.**

The buyer is the venue owner / general manager. The sponsor _is_ the buyer (the bar pays because the events drive repeat foot traffic and corridor-anchored brand identity). The attendees are anonymous, by architectural design, and stay that way.

## Why this beachhead, in five forces

1. **Adults-only Phase 1 collapses the regulatory overreach.** Bar venues are 21+ by definition. No COPPA exposure, no HIPAA exposure, no BIPA exposure for the foreseeable rollout. The regulatory pool router stays as architectural readiness, not as current-defensibility marketing. Phase 2 (school / hospital wellness / community-rec) is honestly future work, not a leaked current claim.

2. **Weekly recurring cadence is the architecture's archetype.** Anonymous ID + 15-minute time buckets + multi-year corridor density signal was built for _recurring_ hyperlocal events. Thursday trivia at the same bar for 52 weeks a year is the literal use case. One-off ticketed events don't generate corridor signal; weekly trivia at eight bars in one neighborhood does.

3. **The buyer is the sponsor.** Cleanest possible sales motion. The bar owner _is_ the sponsor — no advertiser intermediary, no two-sided marketplace bootstrapping. One conversation, one signature, one payment relationship. Compare: most event platforms assume sponsor + organizer + venue as three separate parties.

4. **Trivia franchises are a natural distribution channel.** Geeks Who Drink, Trivia Time, Pour House Trivia, Trivia Mafia and similar franchises each have 50–300+ bar locations under contract. One franchise partnership = N bars onboarded under one referral attribution. This is corridor-of-mouth (OSE-267 referral instrumentation) made concrete.

5. **Defensible against group-chat default.** Bar owners do _not_ have a customer WhatsApp group for Thursday trivia regulars — they have an Instagram post that gets buried in four hours. OSE replaces the _gap_, not the _group chat_. The "OSE is a layer, not a replacement" claim (OSE-265) becomes literally true for this ICP.

## What gets sold

The bar buys a **recurring events stack with anonymous attendance signal + a corridor-anchored sponsor surface**. Specifically:

- A public event surface (`/events/:id`) the bar can share via QR codes, Instagram bio, printed coasters, or chalkboard signs — designed for the phone the attendee is already holding when they walk in.
- An admin surface where the bar's manager creates the recurring trivia / league series in under five minutes.
- A `/poster` surface that prints a QR code carrier for bathroom walls and coaster racks.
- A `/display` surface for the TV behind the bar showing the night's leaderboard, sponsor rotation, or "next league night" countdown.
- A monthly `/sharedReport` showing: unique gatherings, return rate, corridor density vs. neighborhood baseline, headcount trend, sponsor-rotation impressions.

What the bar **does not** get, by architectural design:

- Attendee names, emails, phone numbers, IP addresses, or device IDs.
- A roster they can export.
- A way to remarket to attendees outside of "show up at the same bar next Thursday."

The "you cannot accidentally collect attendee identity because the platform cannot accidentally show it to you" line is the architectural moat translated to bar-owner English.

## Phase sequencing

| Phase                    | ICP                                                                                                 | Regulatory tier                 | Compliance posture                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Phase 1** (now)        | Medium-and-smaller adult venues hosting sports leagues + trivia (bars, taprooms, neighborhood pubs) | None — adult-only               | General. Anonymous ID + 15-min time buckets.                                                   |
| **Phase 2** (Q3-Q4 2026) | Community recreation centers, YMCAs, rec-league venues (still adult-led but family-adjacent)        | Light — opt-in disclosure flows | Same architecture; expanded organizer types.                                                   |
| **Phase 3** (2027+)      | School-affiliated events (PTAs, school athletics, recitals)                                         | COPPA-tier                      | Regulatory pool routing live in production; third-party COPPA attestation as launch criterion. |
| **Phase 4** (2027+)      | Hospital wellness programs, museum-medical-adjacent events                                          | HIPAA-tier                      | Regulatory pool routing + BAA + third-party HIPAA attestation as launch criterion.             |

Each phase reuses the architecture; each phase adds one capability (organizer-type model, compliance posture, attestation) without rewriting the moat. The phases are GTM expansion, not platform rewrite.

**Critical discipline:** Phase 3 and Phase 4 are _roadmap_, not _current defensibility_. Marketing language must distinguish them clearly. See OSE-264.

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

Validation needed before commit. The brief currently has one $200/mo number that is an orphan; this tier structure replaces that. **No tier above $149/mo for Phase 1.** Anything more is Phase 2 (rec center, multi-venue accounts) or Phase 3+ (regulated tiers).

## Risks to watch (specific to this ICP)

| Risk                                                         | Severity | Mitigation hypothesis                                                                                                                                                                                        |
| ------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Trivia franchises see OSE as a competitor, not a layer       | High     | Lead with sponsor surface (bar buys, franchise doesn't pay) and anonymity (franchise can't see attendee identity even if they wanted to). The franchise gets _better leaderboards_, not a competing product. |
| Bar owners are not tech-buyers — UX bar is brutally high     | High     | One-tap admin onboarding. QR-based "create your first event in 60 seconds" inside the printed sales sheet. Engineering quality is invisible to this buyer; UX is everything.                                 |
| Alcohol-adjacent regulation (DRAM, state liquor commissions) | Medium   | OSE doesn't sell or promote alcohol — it sells _recurring events at the venue_. Default templates avoid "happy hour" language. No age-verification storage.                                                  |
| Small bars are price-sensitive and high-churn                | Medium   | Free tier is generous. House at $49/mo is below the Yelp Premium floor. Pricing validates _before_ the Sponsor tier is the upsell ask.                                                                       |
| Trivia is seasonal and competitive in dense neighborhoods    | Low      | Saturated corridors = _higher_ signal density. The platform's value goes up when there are five bars on the same block; it doesn't matter which one any single attendee picks.                               |

## What this ICP changes in the broader artifact set

| Artifact                               | Change                                                                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `COMPETITIVE-BRIEF-2026-05-14.md`      | Add a "Phase 1 ICP" callout near the top pointing to this doc. Soften pluralized vertical lists in audience pitches. (OSE-266 closure work.) |
| `EXTERNAL-LANDING-*.md` (when written) | Hero leads with bar/trivia ICP. (OSE-268.)                                                                                                   |
| `pool-contract.ts`                     | No change. Phase 3+ is what exercises HIPAA/COPPA routing; Phase 1 is general-tier only.                                                     |
| `/poster` surface roadmap              | Re-prioritize against bar bathroom-wall / coaster-rack use case.                                                                             |
| `/display` surface roadmap             | Re-prioritize against TV-behind-the-bar leaderboard + sponsor rotation.                                                                      |
| `/sharedReport` surface roadmap        | Re-prioritize against monthly bar-owner PDF email with corridor density + retention.                                                         |
| OSE-267 (referral codes)               | Venue code = bar code. Commissioner code = trivia franchise / rec-league commissioner. The PLG hypothesis is now specific and testable.      |
| OSE-264 (strip overreach)              | Becomes nearly trivial — HIPAA/COPPA just _are_ Phase 2+, no awkward "architecturally ready but not attested" framing needed.                |

## When to revisit

This document is updated when:

- The first ten bar customers reveal a pricing tier or surface need that this ICP doesn't anticipate.
- A franchise partnership lands and reshapes the unit-of-sale economics.
- A Phase 2+ vertical surfaces faster than expected and pulls forward the regulatory pool routing work.
- A competitor (Eventbrite, Partiful, Posh, etc.) launches a bar-trivia-targeted product.

It is **not** updated to chase competitor positioning or to soften ICP discipline. The whole point of this artifact is to resist the gravitational pull toward "everyone is our customer."

## References

- `docs/positioning/COMPETITIVE-BRIEF-2026-05-14.md` — strategic spine; this doc sharpens its ICP section
- `docs/adr/ADR-001-anonymous-identity-architecture.md` — the architecture that makes the "no attendee identity" promise truthful
- `docs/adr/ADR-002-static-invariant-gates.md` — the CI pattern that makes the architecture enforceable
- Linear: OSE-266 (this doc closes it), OSE-264 (strip overreach, now simpler), OSE-265 (group-chat default, now sharper), OSE-267 (referral codes), OSE-268 (external landing artifact)
