# OurSharedEvents Competitive Brief — Consumer / Community Event Coordination

**Date:** 2026-05-14
**Audience:** Internal — sales conversations, organizer pitches, sponsor outreach, press
**Status:** Current

## Strategic thesis

OSE is not competing with Eventbrite, Partiful, Luma, Posh, Facebook Events, or Meetup on features. **OSE is playing a different category of game.** Each of the six incumbents is optimized for one mode:

| Competitor      | Optimized for                |
| --------------- | ---------------------------- |
| Eventbrite      | Ticket sales at scale        |
| Partiful        | Friend-group RSVP via SMS    |
| Luma            | Tech-community conferences   |
| Posh            | Nightlife / influencer drops |
| Facebook Events | Ad-targeted mass-market      |
| Meetup          | Cross-city interest groups   |

**OSE is optimized for community infrastructure** — recurring hyperlocal events where the unit of value is the corridor over a multi-year horizon, identity is anonymous by architectural design, and regulatory tier is a routing concern built into the platform from day one.

The strategic wedge is **three simultaneous bets** no competitor is making:

1. **Anonymous-ID as the primary identity primitive.** Not "privacy as a feature bolted onto an identity-first stack." The two-database split (DB ↔ FORMS_DB), anon_id cookie + 15-minute time bucket as the only correlation key, and CI-enforced static invariant gate make cross-linking attendee identity to event-author identity _physically impossible_ — not policy-enforced, _architecture-enforced_.

2. **Multi-phased event-type support.** Phase 1 general events (bocce, recitals, leagues, community gatherings). Phase 2 HIPAA-tier (museum/medical-adjacent) and COPPA-tier (school events). Phase 3 BIPA-strict states (IL, MI, IN, WI). Regulatory tier routes at the BigQuery export boundary into physically separate datasets. Compliance is not bolted on; it's built in.

3. **Long-game patience.** Corridor signal aggregation over months and years, not weekly DAU optimization. The platform is designed for the 6-week pre-event share-propagation window + multi-year corridor density buildup, not for first-day conversion.

The "only platform that..." sentence that captures this:

> **"The only event platform whose architecture, regulatory routing, and time horizon are all designed for community infrastructure — not for ticket sales, friend invites, or influencer drops."**

## Per-competitor breakdown

| Competitor          | Their identity model                                                                             | Their monetization model                                                                                | Where OSE wins                                                                                                                                                     | Where they win                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| **Eventbrite**      | Real-name accounts, full purchase history, ad-tech pixels on event pages                         | Ticket fees (~3.7% + $1.79/ticket) + paid promotion; attendee data fuels their discovery feed           | Hyperlocal corridor targeting, anonymous RSVP, no attendee re-marketing to your list                                                                               | Discovery scale, payment rails, mature ticketing/refunds for paid events                                        |
| **Partiful**        | Phone-number-first identity; full contact graph implied                                          | Free to organizers; monetization unclear (likely future ads/data); VC-funded                            | Sponsor layer doesn't exist on Partiful; OSE owns the local-sponsor wedge entirely. Recurring leagues need persistence Partiful's friend-group model doesn't serve | Friend-group invite UX is best-in-class; SMS delivery is frictionless; brand cachet under-30                    |
| **Luma**            | Email + optional Google/social login; hosts see attendee list with LinkedIn-style enrichment     | Free + paid tier ($49+/mo); host pays for analytics on attendee identity                                | Anonymous attendance + sponsor matching without identity disclosure. Luma's value prop is the _opposite_ (network reveal)                                          | Crypto/tech/founder vertical lock-in, calendar UX, beautiful event pages, network-effect discovery in tech hubs |
| **Posh**            | Phone + social ID; explicitly tracks attendee social graphs to power influencer "host" mechanics | Ticket fees + "host commissions" (attendee resale + influencer payouts); attendee identity is the asset | OSE serves community events Posh ignores (PTAs, leagues, recitals). Posh's moat REQUIRES identity tracking                                                         | Nightlife/club vertical, influencer-driven distribution, payment-by-resale economics                            |
| **Facebook Events** | Full Meta identity graph; events are a Trojan horse for ad targeting                             | Free to host; Meta monetizes attendee data across the entire ad network                                 | Anonymous RSVP without joining the surveillance machine; under-35 organizers actively fleeing Meta                                                                 | Free, zero-friction, every household has it. For one-off public events with older demographic, still unbeatable |
| **Meetup**          | Real-name accounts, interest-graph, public attendance history                                    | Organizer subscription ($24+/mo) + ads. Attendee data used for matching                                 | Recurring leagues don't need Meetup's interest-discovery overhead. OSE's corridor model is geographic; Meetup's is interest-based                                  | Cross-city interest groups (book clubs, language exchanges) where discovery matters more than locality          |

## Defensible "only platform that..." claims

Anonymity-lite is everywhere ("we don't sell your data" is table stakes). The architectural moat requires more precision. **Four claims OSE can truthfully make that no competitor can match without rebuilding their stack:**

1. **"The only event platform where the database schema makes it physically impossible for a sponsor or organizer to see an individual attendee's name, email, or device identifier — enforced in CI, not in a privacy policy."** The two-database split with the static-invariant gate is the proof. Competitors could _promise_ this in their TOS; OSE has it in `wrangler.toml` and a failing build.

2. **"The only sponsor-matching system that targets venues and corridors instead of people."** Eventbrite/Meta sell audience targeting (interests, demographics, lookalikes). OSE sells geographic-density targeting. A sponsor buys "the 2-mile radius around the Beverly Bocce courts on Thursday nights" — they cannot buy "35-year-old women who attended yoga events last month." This is a different SKU, not a privacy-friendlier version of the same SKU.

3. **"The only platform that ships a regulatory pool router at the export boundary."** HIPAA/COPPA-tier event pools route to physically separate BigQuery destinations. None of the six competitors have this — they have one identity store and bolt compliance on top. This becomes load-bearing in Phase 2 (museum/medical/school) and is non-trivial to retrofit.

4. **"The only platform that surfaces the anonymity model to the attendee on the event page, before RSVP."** The in-page anonymity affordance (OSE-243a, shipped 2026-05-14) is a trust artifact, not a footer link. Partiful/Luma/Posh actively _don't want_ attendees thinking about identity at the RSVP moment.

Claims to **avoid** because competitors can plausibly match them: "we respect privacy," "no spam," "your data is yours," "no ads." All true, all unprovable in a sales call.

## Audience pitch frames

Each audience hears the same architecture cast through a different lens. The unifying thread: **the anonymity architecture isn't a feature, it's the SKU.**

### To sponsors (corridor sales)

"Buy the corridor, not the contact list. We deliver verified gathering density at the venue level — Thursday bocce, Saturday recitals, the corner of 95th and Western — without the regulatory drag or ad-fatigue of running geofenced Meta campaigns. Your sponsorship is recurring presence in a community space; you cannot accidentally collect attendee identity because the platform cannot accidentally show it to you. This is local-sponsorship-as-infrastructure for the 2-mile radius, designed to compound over multi-year corridor density buildup."

### To organizers (league commissioners, school PTAs, recital hosts)

"RSVPs without the surveillance tax. Your league parents don't need an account; your sponsor pays the bills; and nobody — including you, the platform, and any third party — walks away with your roster. Built for recurring community events, not one-off launches. Phase 2 adds school-event and medical-adjacent compliance lanes so the platform grows with your community, not against it."

### To community leaders (venue owners, school principals, museum directors)

"An event layer that respects how your community already operates. Your members stay anonymous to sponsors and to us. The corridor — your gym, your school, your park — becomes the unit of value, not the individuals in it. Phase 2 adds regulated lanes for school and medical-adjacent events so you can grow into compliance instead of bolting it on. The platform is designed to last as long as your community does."

## Sales-conversation angles

### Angle 1 — Local sponsor pitch ("2-mile radius")

**Pitch:** "You sponsor the gym, not the individuals. We deliver corridor density data — how many gatherings, what time, what venue — without ever exposing who attended. Your $200/month buys recurring presence at every league night at the Beverly Bocce courts."

**Objection (vs. Meta/Google local ads):** "Why not just buy a geofenced Meta ad?"

**Response:** "Geofenced ads target people _near_ the venue all day. You want people _at the event_. We sell event-attendance density; Meta sells phone-GPS proximity. Different product, ~10× signal-to-noise for recurring community events."

### Angle 2 — League / recital organizer pitch

**Pitch:** "Your parents already opted out of Facebook Events. They'll RSVP on a link that doesn't ask them to make an account, doesn't text them later, and doesn't end up in a sponsor's CRM. You get headcount; nobody gets a contact list."

**Objection:** "Partiful is free and works fine."

**Response:** "Partiful needs every parent's phone number and has no sponsor layer — so you keep eating costs. OSE lets a local sponsor underwrite the league while keeping the parent roster invisible to everyone, including you."

### Angle 3 — Phase-2 regulated-event pitch (museum / school)

**Pitch:** "Your school events touch COPPA. Your medical-adjacent events touch HIPAA. We route those event pools into separate compliance lanes at the export layer — you don't bolt compliance onto an Eventbrite export, you start from a compliant store."

**Objection:** "We just don't put kids' names in Eventbrite."

**Response:** "Right, so you can't run an RSVP. Our COPPA-tier lets you run the RSVP and the post-event analytics without ever holding the kid's PII in a non-compliant pool."

## Honest remaining gaps

- **Discovery is zero.** Eventbrite/Meetup/Luma have inbound search traffic. OSE has none.
  _Mitigation:_ lean hyperlocal — corridor-of-mouth distribution via league commissioners and venue owners, not SEO. Discovery isn't OSE's job; the platform serves communities that already know each other.

- **Payments are absent.** No ticketing rails today.
  _Mitigation:_ free RSVP only in Pulse 1. Stripe integration as Phase 2 if paid events emerge from the ICP. Bocce nights and PTA gatherings are mostly free; OSE's ICP doesn't need payments at launch.

- **Brand recognition is zero.** Parents will ask "what's this site?"
  _Mitigation:_ the in-page anonymity affordance does double duty as trust copy. Venue / league / community-leader endorsement is the distribution channel. Brand recognition is a multi-year corridor density problem, not a launch-week problem.

- **Organizer tooling depth.** Luma's event-management UX (waitlists, check-in, badges) is years ahead.
  _Mitigation:_ match the 80% feature set recurring-league organizers actually use; ignore the conference-host long tail. OSE's ICP doesn't need Luma's tooling depth.

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
