# OurSharedEvents Competitive Brief — Consumer / Community Event Coordination

**Date:** 2026-05-14 (last revised: 2026-05-14, OSE-264 + OSE-265)
**Audience:** Internal — sales conversations, organizer pitches, sponsor outreach, press
**Status:** Current
**Companion docs:** [BEACHHEAD-ICP-2026-05-14.md](BEACHHEAD-ICP-2026-05-14.md) (the operational spine — the ICP, the product narrative, the 5-phase model). This brief covers the _competitive landscape_ and the _language for selling against it_; BEACHHEAD-ICP covers _what we sell and to whom_.

## Strategic thesis

OSE is not competing with Eventbrite, Partiful, Luma, Posh, Facebook Events, or Meetup on features. The actual default for hyperlocal recurring events isn't any of those — it's **group chats** (WhatsApp / Signal / Telegram / iMessage). **OSE is playing a different category of game from all of them.** Each named tool is optimized for one mode:

| Tool                                   | Optimized for                                                           |
| -------------------------------------- | ----------------------------------------------------------------------- |
| Group chats (WhatsApp/Signal/Telegram) | Friend-and-regulars RSVP layer — the actual default, free, frictionless |
| Eventbrite                             | Ticket sales at scale                                                   |
| Partiful                               | Friend-group RSVP via SMS                                               |
| Luma                                   | Tech-community conferences                                              |
| Posh                                   | Nightlife / influencer drops                                            |
| Facebook Events                        | Ad-targeted mass-market                                                 |
| Meetup                                 | Cross-city interest groups                                              |

**OSE doesn't replace the group chat.** Group chats handle the friend-group RSVP layer perfectly well — that's not a market gap. The gap OSE serves is the **sponsor + corridor density + compliance** layer that group chats cannot supply: no measurable signal, no SKU for local sponsors to buy, no compounding data across years. OSE is the _layer above_ the group chat that turns invisible recurring events into measurable corridor infrastructure.

**OSE is optimized for community infrastructure** — recurring hyperlocal events where the unit of value is the corridor over a multi-year horizon, identity is anonymous by architectural design, and regulatory tier is a routing concern built into the platform from day one.

The strategic wedge is **three simultaneous bets** no competitor is making:

1. **Anonymous-ID as the primary identity primitive.** Not "privacy as a feature bolted onto an identity-first stack." The two-database split (DB ↔ FORMS_DB), anon_id cookie + 15-minute time bucket as the only correlation key, and CI-enforced static invariant gate mean that cross-linking attendee identity to event-author identity requires bypassing a CI-enforced static invariant gate; under the current commit-and-CI workflow, no such PR can land on main. The moat is architecture-enforced, not policy-enforced. (See [ADR-001](../adr/ADR-001-anonymous-identity-architecture.md) and [ADR-002](../adr/ADR-002-static-invariant-gates.md).)

2. **Multi-phased event-type support — roadmap.** Phase 1 ships general-tier adult events (bars, taprooms, recurring sports leagues, trivia — see [BEACHHEAD-ICP](BEACHHEAD-ICP-2026-05-14.md)). Phases 2-3 expand to community recreation and civic events, still general-tier. Phases 4-5 introduce HIPAA-tier and COPPA-tier event support, each backed by a net-new physically-separate D1 database, with third-party attestation as a launch criterion per tier. The regulatory tier routing contract exists today (`src/lib/pool-contract.ts`); the operational tier rollouts are roadmap, not current defensibility.

3. **Long-game patience.** Corridor signal aggregation over months and years, not weekly DAU optimization. The platform is designed for the 6-week pre-event share-propagation window + multi-year corridor density buildup, not for first-day conversion.

The "only platform that..." sentence that captures this:

> **"The only event platform whose architecture, regulatory routing, and time horizon are all designed for community infrastructure — not for ticket sales, friend invites, or influencer drops."**

## Per-competitor breakdown

| Competitor                                                | Their identity model                                                                             | Their monetization model                                                                                                          | Where OSE wins                                                                                                                                                                                            | Where they win                                                                                                                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Group chats** (WhatsApp / Signal / Telegram / iMessage) | Phone-number identity within the chat; recipient list is the contact graph                       | Free. Not a competitor in the SaaS sense — it's the de-facto default for friend-and-regulars RSVP for hyperlocal recurring events | Group chats can't generate a SharedReport, can't expose a sponsor SKU, can't aggregate corridor density across venues or years. OSE adds the **measurement + sponsor + compliance** layer above the chat. | Friend-group RSVP frictionlessness; zero cost; works on the phone everyone already has; no learning curve. The chat is the right tool for friend RSVPs and OSE doesn't try to displace it. |
| **Eventbrite**                                            | Real-name accounts, full purchase history, ad-tech pixels on event pages                         | Ticket fees (~3.7% + $1.79/ticket) + paid promotion; attendee data fuels their discovery feed                                     | Hyperlocal corridor targeting, anonymous RSVP, no attendee re-marketing to your list                                                                                                                      | Discovery scale, payment rails, mature ticketing/refunds for paid events                                                                                                                   |
| **Partiful**                                              | Phone-number-first identity; full contact graph implied                                          | Free to organizers; monetization unclear (likely future ads/data); VC-funded                                                      | Sponsor layer doesn't exist on Partiful; OSE owns the local-sponsor wedge entirely. Recurring leagues need persistence Partiful's friend-group model doesn't serve                                        | Friend-group invite UX is best-in-class; SMS delivery is frictionless; brand cachet under-30                                                                                               |
| **Luma**                                                  | Email + optional Google/social login; hosts see attendee list with LinkedIn-style enrichment     | Free + paid tier ($49+/mo); host pays for analytics on attendee identity                                                          | Anonymous attendance + sponsor matching without identity disclosure. Luma's value prop is the _opposite_ (network reveal)                                                                                 | Crypto/tech/founder vertical lock-in, calendar UX, beautiful event pages, network-effect discovery in tech hubs                                                                            |
| **Posh**                                                  | Phone + social ID; explicitly tracks attendee social graphs to power influencer "host" mechanics | Ticket fees + "host commissions" (attendee resale + influencer payouts); attendee identity is the asset                           | OSE serves community events Posh ignores (PTAs, leagues, recitals). Posh's moat REQUIRES identity tracking                                                                                                | Nightlife/club vertical, influencer-driven distribution, payment-by-resale economics                                                                                                       |
| **Facebook Events**                                       | Full Meta identity graph; events are a Trojan horse for ad targeting                             | Free to host; Meta monetizes attendee data across the entire ad network                                                           | Anonymous RSVP without joining the surveillance machine; under-35 organizers actively fleeing Meta                                                                                                        | Free, zero-friction, every household has it. For one-off public events with older demographic, still unbeatable                                                                            |
| **Meetup**                                                | Real-name accounts, interest-graph, public attendance history                                    | Organizer subscription ($24+/mo) + ads. Attendee data used for matching                                                           | Recurring leagues don't need Meetup's interest-discovery overhead. OSE's corridor model is geographic; Meetup's is interest-based                                                                         | Cross-city interest groups (book clubs, language exchanges) where discovery matters more than locality                                                                                     |

## Defensible "only platform that..." claims

> **Note on framing.** The section below reflects OSE's _architectural posture_, not third-party-audited compliance. Claims involving the regulatory pool router describe the architectural readiness that exists today; the operational rollout of HIPAA-tier (Phase 4) and COPPA-tier (Phase 5) is roadmap, gated on third-party attestation per tier.

Anonymity-lite is everywhere ("we don't sell your data" is table stakes). The architectural moat requires more precision. **Three claims OSE can truthfully make today** that no competitor can match without rebuilding their stack, plus one claim that becomes defensibly true when Phase 4 or Phase 5 ships:

1. **"The only event platform where the database schema makes cross-linking attendee identity to event-author identity require bypassing a CI-enforced static invariant gate — enforced by a failing build, not by a privacy policy."** The two-database split (`DB` ↔ `FORMS_DB`) with the static-invariant gate is the proof. Competitors could _promise_ identity isolation in their TOS; OSE has it in `wrangler.toml` and a CI gate that fails the PR. (See [ADR-001](../adr/ADR-001-anonymous-identity-architecture.md), [ADR-002](../adr/ADR-002-static-invariant-gates.md).)

2. **"The only sponsor-matching system that targets venues and corridors instead of people."** Eventbrite/Meta sell audience targeting (interests, demographics, lookalikes). OSE sells geographic-density targeting. A sponsor buys "the 2-mile radius around the Beverly Bocce courts on Thursday nights" — they cannot buy "35-year-old women who attended yoga events last month." This is a different SKU, not a privacy-friendlier version of the same SKU.

3. **"The only platform that surfaces the anonymity model to the attendee on the event page, before RSVP."** The in-page anonymity affordance (OSE-243a, shipped 2026-05-14) is a trust artifact, not a footer link. Partiful/Luma/Posh actively _don't want_ attendees thinking about identity at the RSVP moment.

**Roadmap defensibility — Phases 4 and 5:**

4. **"The only platform that physically separates regulatory-tier data at the storage layer."** Today: the regulatory pool router contract (`src/lib/pool-contract.ts`) exists as architectural readiness; only the general-tier pool is exercised in production. When Phase 4 lands (HIPAA), a net-new physically-separate D1 database (`DB_HIPAA`) is bound to its own handler class via an extended static gate, with BigQuery's HIPAA-eligible dataset model + Google Cloud BAA + third-party attestation as launch criteria. Phase 5 (COPPA) follows the same pattern. Once both phases are in production, the "physically separated by regulatory tier" claim becomes literally, demonstrably true at the storage layer — not a privacy-policy assertion, a deployment artifact. (See [BEACHHEAD-ICP § Phase sequencing](BEACHHEAD-ICP-2026-05-14.md#phase-sequencing--the-five-phase-model) for the full 5-phase model.)

Claims to **avoid** because competitors can plausibly match them: "we respect privacy," "no spam," "your data is yours," "no ads." All true, all unprovable in a sales call.

## Audience pitch frames

Each audience hears the same architecture cast through a different lens. The unifying thread: **the anonymity architecture isn't a feature, it's the SKU.**

### To sponsors (corridor sales)

"Buy the corridor, not the contact list. We deliver verified gathering density at the venue level — Thursday bocce, Saturday recitals, the corner of 95th and Western — without the regulatory drag or ad-fatigue of running geofenced Meta campaigns. Your sponsorship is recurring presence in a community space; you cannot accidentally collect attendee identity because the platform cannot accidentally show it to you. This is local-sponsorship-as-infrastructure for the 2-mile radius, designed to compound over multi-year corridor density buildup."

### To organizers (bar owners, league commissioners, recurring-event hosts)

"RSVPs without the surveillance tax. Your regulars don't need an account; your local sponsor pays the bills; and nobody — including you, the platform, and any third party — walks away with your roster. Built for recurring adult community events first; the platform's regulatory architecture is forward-compatible with school and medical-adjacent expansion when those launch criteria (Phases 4-5) are met."

### To community leaders (venue owners, recreation directors, civic leaders)

"An event layer that respects how your community already operates. Your members stay anonymous to sponsors and to us. The corridor — your bar, your gym, your park — becomes the unit of value, not the individuals in it. Phase 2-3 expands the platform to community recreation and civic surfaces; regulated lanes for school events (COPPA) and medical-adjacent events (HIPAA) follow as Phase 4-5, each with third-party attestation as a launch criterion. The platform is designed to last as long as your community does."

## Sales-conversation angles

### Angle 1 — Local sponsor pitch ("2-mile radius")

**Pitch:** "You sponsor the gym, not the individuals. We deliver corridor density data — how many gatherings, what time, what venue — without ever exposing who attended. Your $200/month buys recurring presence at every league night at the Beverly Bocce courts."

**Objection (vs. Meta/Google local ads):** "Why not just buy a geofenced Meta ad?"

**Response:** "Geofenced ads target people _near_ the venue all day. You want people _at the event_. We sell event-attendance density; Meta sells phone-GPS proximity. Different product, ~10× signal-to-noise for recurring community events."

### Angle 2 — League / recital organizer pitch

**Pitch:** "Your regulars already use a WhatsApp group for the day-of stuff — keep it. What you don't have is a measurable corridor signal a local sponsor will pay for, or a way to tell whether a Thursday is actually working over a season. OSE doesn't replace the chat; it adds the measurement + sponsor + monthly-report layer on top, with anonymous attendance built into the architecture."

**Objection:** "We already have a WhatsApp / Partiful / group SMS setup that works fine for the parents."

**Response:** "Keep it. OSE doesn't sit between your regulars and the event — it sits between the bar (or league) and the sponsor / corridor analytics. You'd run OSE _alongside_ your chat, not _instead of_ it. The chat handles RSVPs; OSE handles 'this is what the season looked like, here's what a sponsor sees, here's what next Thursday should target.'"

### Angle 3 — Future regulated-event roadmap pitch (Phases 4-5)

**Pitch:** "OSE's architecture is forward-compatible with regulated event tiers. Phase 4 introduces HIPAA-tier event support backed by a net-new physically-separate D1 database; Phase 5 does the same for COPPA. Each tier launches with third-party attestation as a precondition. Today (Phase 1), OSE serves general-tier adult events — bar trivia, recurring sports leagues, taproom league nights. The regulated tiers are roadmap, on a known architectural path, not bolted on."

**Use this angle only for:** prospects who explicitly ask about regulated-event support, future-state procurement conversations, or investor / partnership briefings where the multi-phase architectural commitment is the relevant story. **Do not use this angle as a Phase 1 sales pitch** — claiming HIPAA/COPPA today as current defensibility is a regulatory misrepresentation risk before attestation lands.

**Objection:** "When can we actually run a COPPA event?"

**Response:** "Phase 5 — currently roadmap, gated on third-party COPPA attestation + verifiable parental consent flow. Architecturally we are forward-compatible (the regulatory pool router contract exists today), but the operational lift is real (9-15 months + low six-figure compliance investment per regulated tier). Honest answer: not in 2026."

## Honest remaining gaps

- **Discovery is zero.** Eventbrite/Meetup/Luma have inbound search traffic. OSE has none.
  _Mitigation:_ lean hyperlocal — corridor-of-mouth distribution via venue owners and (eventually) trivia/rec-league commissioners (see OSE-267 referral instrumentation). Discovery isn't OSE's job; the platform serves communities that already know each other.

- **Payments are absent.** No ticketing rails today.
  _Mitigation:_ free RSVP only in Phase 1. Stripe integration as a later expansion if paid events emerge from the ICP. The BEACHHEAD-ICP (bar trivia, recurring sports leagues, taproom league nights) is mostly free at point of attendance; OSE's ICP doesn't need payments at launch.

- **Brand recognition is zero.** Buyers will ask "what's this site?"
  _Mitigation:_ the in-page anonymity affordance does double duty as trust copy. Venue / league / community-leader endorsement is the distribution channel. Brand recognition is a multi-year corridor density problem, not a launch-week problem.

- **Organizer tooling depth.** Luma's event-management UX (waitlists, check-in, badges) is years ahead.
  _Mitigation:_ match the 80% feature set recurring-event organizers actually use; ignore the conference-host long tail. OSE's ICP doesn't need Luma's tooling depth.

- **Zero discovery evidence.** Every claim in this brief and in [BEACHHEAD-ICP](BEACHHEAD-ICP-2026-05-14.md) is currently deductive (architecture → ICP → product) without primary research at the buyer layer.
  _Mitigation:_ [OSE-271](https://linear.app/oursharedevents/issue/OSE-271) — first 5 bar-owner discovery interviews, with the [discovery interview kit](../discovery/) shipping as turnkey artifacts. Until those conversations are logged, the brief is well-reasoned hypothesis.

## Surfaces — what's actually shipped

Note: the brief explicitly does **not** list "no mobile app" as a gap. OSE's surfaces are designed for their target devices by architecture, not by missing native parity:

- **`/events/:id`** — mobile-first responsive HTML. The attendee surface. Viewport meta + system fonts + touch-friendly tap targets + minimal CSS. Native parity is not the goal; the page IS the mobile app.
- **`/display`** — TV/kiosk-shaped rendering for live events. Different surface, different ICP (event-day operators).
- **`/admin`** — desktop-first organizer dashboard.
- **`/poster`** — print-shaped QR-code carrier for venue placement.
- **`/sharedReport`** — laptop-shaped sponsor reporting surface.

Each surface is intentionally shaped for the device-context it serves. Adding a native iOS/Android app would be feature parity work; the architecture treats device-shape as a surface dimension, not as a missing target.

## Positioning recommendation

OSE's three-bet thesis is the spine of every conversation:

- **Sponsors hear** "anonymous corridor density, multi-year compounding, regulatory-clean."
- **Organizers hear** "RSVPs without surveillance, sponsor underwriting, no roster leakage."
- **Community leaders hear** "respect how your community already operates, regulated lanes when you need them, designed to last as long as your community does."

Same platform, same architecture, three pitches. **The platform's defensibility is that no competitor can match all three simultaneously without rebuilding from the database layer up.** That's the moat.

## Revisit triggers

This brief is updated when:

- A new competitor materially changes the landscape (rare)
- OSE's own architecture changes in a way that strengthens or weakens a "only platform that..." claim
- A sales conversation reveals a pitch that didn't work — the artifact gets sharpened
- A new audience surfaces that needs its own pitch frame

It is **not** updated to chase competitor feature parity. If Eventbrite ships anonymous-mode tomorrow, this brief gets re-read for accuracy — but the strategic thesis doesn't shift unless OSE itself shifts.
