# OurSharedEvents Brand Voice Guidelines

**Status:** v1.1 (founder-confirmed 5 of 6 Open Questions 2026-05-16) · **Source:** `.claude/brand-voice-audit-context.md` + `docs/brand-voice-audit-2026-05-16.md` + founder confirmation thread · **Owner:** mzdan (founder) + Co-Architect · **Effective:** 2026-05-16

This document is the canonical brand-voice reference for OurSharedEvents (OSE). The `/brand-voice:enforce-voice` skill reads this file to validate copy across the 13 customer-visible surfaces. Update this file as decisions evolve — its diff history IS the voice's evolution log.

---

## 1. Brand essence

OurSharedEvents is **the platform that makes communities visible to themselves.**

Hosts run events. Attendees show up. OSE is the layer that tracks "groups gathered, here, when" without ever tracking "who you are." The product makes anonymous community signal real and durable so neighborhoods can SEE themselves coalescing through the events they hold together.

**One-line positioning:** Community events that bring people together — tracked anonymously so the patterns stay honest.

**Core promise (kept explicit on every public surface):**

> You're part of the group, anonymously. OurSharedEvents tracks when groups gather — never who you are.

This sentence is load-bearing. Every surface inherits its tone.

### 1.1 The customer-facing mental model — Event Triangle (Pre / Event / Post)

Customers should picture three phases for every event. This is the canonical customer-facing model — what they see, hear, and remember:

- **Pre-event** — sharing that the event is coming. Hosts post; attendees see; word travels. The flyer goes up, the QR code spreads, the calendar fills.
- **Event** — the gathering itself. Attendees enjoy. QR codes connect them to sponsors. Real-time check-ins prove "groups gathered, here, when."
- **Post-event** — additional ops. Recap data flows to hosts. Sponsor funneling continues. The event's signal compounds into the next one.

**Use these phrases in customer copy:** `event flow`, `event cycle`, `event triangle`. The three phases. The customer's mental model.

**Do NOT use customer-facing:** `flywheel`. That's behind-the-scenes platform terminology (briefing deck, internal docs, founder talks). It's our mechanism, not their mental model.

**Why this distinction matters:** "flywheel" is a B2B-mechanic metaphor — useful when explaining HOW the platform compounds value. "Event triangle" is the customer experience — useful when explaining WHAT they'll do this Saturday. Pick the right one for the audience.

---

## 2. Voice Constant — the "We Are / We Are Not" table

The Voice Constant is what stays the same across every surface. Tone (formality, energy, technical depth) flexes per surface; voice does not.

| We Are                                                                                                                                                          | We Are Not                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Warm but precise** — neighborhood language that names specifics ("$10 at door, BYOB, food trucks on site")                                                    | Generic, corporate, safe ("Great events for everyone")                   |
| **Neighborhood-rooted** — the brand belongs to a place, named or implied                                                                                        | Geography-agnostic SaaS-shaped ("Bring your community together!")        |
| **Privacy-forward by design** — make specific anti-promises, not legal disclaimers; the brand intends to be the privacy standard for community-events platforms | Privacy-policy-PDF-link defensive ("By using this site you consent to…") |
| **Action-verb led** — every button is a verb the customer is choosing to do                                                                                     | Generic-button passive (`Click here`, `Submit`, `OK`, `Continue`)        |
| **Plain-language technical** — say "corridors and venues, not people"; "a single click"                                                                         | Engineer-jargon ("anon_id", "phase 1", "tier mid", "tranche")            |
| **First-person inclusive** — "you're part of the group", "we'll be in touch"                                                                                    | Third-person institutional ("Users may", "the system tracks")            |
| **Specific and concrete** — placeholder examples are real things real bar owners would type                                                                     | Vague and abstract ("amazing community", "next-level events")            |
| **Apologetic-helpful on errors** — name what went wrong, suggest a next action                                                                                  | Terse-blame (`Error 500`, `Invalid input`, "Failed to process")          |
| **Celebratory on success** — earned exclamations on customer wins                                                                                               | Receipt-style ("Submission received", "Transaction complete")            |
| **Confident without overclaim** — "Built for the Southside, by the Southside"                                                                                   | Marketing puffery ("The #1 platform for…", "Best-in-class")              |

**Voice constant in one sentence:** _Warm, specific, first-person, action-verb language that names the neighborhood, makes anti-promises about privacy, and treats customers like neighbors instead of users._

---

## 3. Tone-by-context matrix

Tone is the surface-specific calibration of the Voice Constant. Three dials per surface: **formality**, **energy**, **technical depth**. The Voice Constant attributes (above) apply regardless of where the tone dial sits.

| Surface                                                                      | Formality             | Energy                  | Technical depth                             | Notes                                                       |
| ---------------------------------------------------------------------------- | --------------------- | ----------------------- | ------------------------------------------- | ----------------------------------------------------------- |
| Landing `/`                                                                  | Casual-warm           | High celebratory        | Low                                         | Brand's loudest surface; loudest copy                       |
| Public events listing `/events`                                              | Casual-functional     | Medium                  | Low                                         | Index-shaped; minimal copy ok                               |
| Public event page `/events/:id` (pre_event)                                  | Casual-narrative      | Medium                  | Low                                         | 5W format; anonymity affordance present                     |
| Public event page (event-live)                                               | Casual-action         | Medium-high (real-time) | Low                                         | "Live now" + "Navigate now" tone                            |
| Public event page (post_event)                                               | Neutral-archival      | Low                     | Low                                         | Has-ended sparseness                                        |
| Error pages (`renderErrorPage`)                                              | Apologetic-helpful    | Low (calm)              | None                                        | "We couldn't" + recovery CTA                                |
| Forms — register / survey / email-signup                                     | Casual-conversational | Medium (form action)    | Low (legal isolated)                        | Privacy notice as visual block, not inline                  |
| Forms — checkin                                                              | Minimal-action        | High (single tap)       | None                                        | One verb, one button                                        |
| Admin dashboard                                                              | Instructional-warm    | Medium                  | Medium (placeholder examples)               | Bar owner is the audience; teach by example                 |
| Admin signin                                                                 | Professional-formal   | Low                     | None                                        | Onboarding-aware                                            |
| Shared Report (admin mode)                                                   | Data-neutral          | Low                     | Medium (metric names)                       | Numbers do the work                                         |
| Shared Report (signed-link error)                                            | Apologetic-helpful    | Low                     | None                                        | Same template as form errors                                |
| Poster preview `/poster` `/posters` `/tabletop` `/tent` `/flyers` `/signage` | Functional            | Low                     | None                                        | Print-targeted; minimal interactive copy                    |
| Display `/display` (TV)                                                      | Ambient-informational | Low                     | None                                        | 10-foot viewing; ticker carries brand tagline               |
| Anonymity affordance (universal block)                                       | Plain-precise         | Calm-reassuring         | Low (technical precision in plain language) | This block is the Voice Constant's reference implementation |

---

## 4. Canonical patterns (templates to copy)

### 4.1 The anonymity-affordance pattern (voice anchor)

Confidence: HIGH (in production, multi-surface, founder-validated).

```
You're part of the group, anonymously. OurSharedEvents tracks when groups
gather — never who you are. Event hosts and sponsors see corridors and
venues, not people. The link you followed counted as a single click;
nothing about your device, location, or identity was collected to display
this page.
```

**Pattern rules:**

- First-person inclusive opener (`You're part of`)
- Brand name appears once, in context, as the active subject
- One anti-promise per sentence (`never who you are`, `not people`, `nothing about your device`)
- Technical precision in plain language (`a single click` — not `one HTTP request`)
- No legal citations, no policy-link redirects
- Em-dash separator for the privacy clarification

**Generalize for new surfaces by:**

- Lead with first-person inclusive
- State what IS tracked in lay terms
- State 2-3 specific anti-promises
- Close with what THIS interaction specifically collected (or didn't)

### 4.2 The friendly-error pattern (error-voice template)

Confidence: HIGH (in production, multi-surface, founder-validated).

Structure: `[acknowledge specifically] + [suggest a next action]`. No raw codes, no HTTP numbers, no "failure" language.

Examples to model:

| Situation                   | Copy                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------- |
| Bad event link              | `This event link doesn't look right. Try the original link or contact the host.`        |
| Bad email shape             | `That email doesn't look right. Please check and try again.`                            |
| Server transient            | `We're having trouble right now. Please try again in a moment.`                         |
| Payload too big             | `Your message is too long. Please shorten it and try again.`                            |
| Rate-limited                | `Too many tries. Please wait a moment and try again.`                                   |
| Auth share link expired     | `This share link has expired or isn't valid. Ask the sender for a fresh link.`          |
| Auth share link wrong event | `This share link is for a different event.`                                             |
| Report not yet ready        | `Your event report is almost ready — usually takes a few minutes. Refresh in a moment.` |

**Pattern rules:**

- Specific first noun ("This event link", "Your message", "This share link") — never "Error" or "Problem"
- Use "doesn't look right" / "isn't valid" / "having trouble" — soft, recoverable language
- Always end with a verb the user can do next ("Try", "Please check", "Refresh", "Ask")
- "Please" is OK and welcome here; it's NOT corporate filler in this context
- "Sorry" appears in the fallback case only (`Sorry, something went wrong. Please try again.`) — reserved, not default

### 4.3 The action-verb CTA pattern

Confidence: HIGH (in production across all surfaces; zero `Click here` / `Submit` / `OK` in the codebase).

Every button is a verb the customer is choosing to do. The verb belongs to the customer's action, not the system's response.

Models:

| Surface                                         | CTA copy                 |
| ----------------------------------------------- | ------------------------ |
| Landing subscribe                               | `Stay in the Loop`       |
| Public events card                              | `Register`               |
| Public event pre                                | `RSVP for this event`    |
| Public event live                               | `Check in at this event` |
| Maps link pre                                   | `See on Google Maps`     |
| Maps link live                                  | `Navigate now`           |
| Form register                                   | `Register`               |
| Form checkin                                    | `Tap to Check In`        |
| Form survey                                     | `Submit Feedback`        |
| Form email signup (per-event)                   | `Sign me up`             |
| Admin create                                    | `Create Event`           |
| Admin signin                                    | `Sign in to admin`       |
| Error page recovery                             | `Browse upcoming events` |
| Poster preview                                  | `Print`                  |
| Empty-state invite-next (preferred new pattern) | `Also Coming Up`         |

**Verb-shift discipline (codify the existing instinct):** when the user's relationship to the action changes, the verb changes. Pre-event maps link `See on Google Maps` (you're learning) → live-event maps link `Navigate now` (you're going). This pattern is currently undocumented but lands beautifully — keep it.

### 4.4 The success-message pattern

Confidence: HIGH (3 of 4 customer flows celebrate; checkin is silent — see Open Questions).

Earned exclamation. Contraction. Customer-state, not system-state.

| Flow               | Success copy                                                    |
| ------------------ | --------------------------------------------------------------- |
| Register           | `You're registered!`                                            |
| Email signup (new) | `You're on the list!`                                           |
| Email signup (dup) | `You're already signed up!`                                     |
| Survey             | `Thanks for your feedback!`                                     |
| Checkin            | (currently silent — only count increment) — **Open Question 3** |

**Pattern rules:**

- `You're <state>!` is the canonical shape for direct user actions
- `Thanks for your <thing>!` when the user gave us something (feedback, time)
- Exclamation is mandatory on direct success — earned, not gratuitous
- NEVER use `Submission received.` `Transaction complete.` `Operation successful.` — these are system-state, not customer-state

### 4.5 The empty-state pattern (invite-next-step, NOT report-absence)

Confidence: MEDIUM (Display's `Also Coming Up` is the warmest example; other empty states are passive and should be migrated).

| Surface           | Today                                     | Proposed migration                                                                                                           |
| ----------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Public listing    | `No events scheduled.`                    | `Nothing scheduled right now. Sign up to hear when the next one drops.`                                                      |
| Admin events      | `No events found.`                        | `No events yet. Create your first one above.`                                                                                |
| Display secondary | `Also Coming Up` (already canonical-good) | keep                                                                                                                         |
| Display primary   | `No upcoming events scheduled.`           | `Nothing on the calendar this minute. New events posted as they're confirmed.`                                               |
| Report empty      | (loading skeleton)                        | acceptable; once data check returns 0: `No event data here yet — your event reports populate once attendees start arriving.` |

**Pattern rules:**

- State the absence factually (one short sentence)
- Immediately invite the next-step the user CAN take
- "Yet" and "right now" signal "this is temporary, not broken"
- Never bare `No events.` — that reads like an error, not a state

### 4.6 The 5W placeholder pattern (admin form fields)

Confidence: HIGH (in production; bar owners report it teaches them what to write).

Placeholders teach by example. Use real-shaped content, not abstractions.

| Field                      | Placeholder                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Event Name                 | `Summer Block Party`                                                                                         |
| Venue                      | `Evergreen Park`                                                                                             |
| Who (host / organizer)     | `Beverly Hills Bocce League`                                                                                 |
| Where (full address)       | `12345 South Western Ave, Blue Island IL 60406`                                                              |
| Why (purpose)              | `Why is this happening? Why now?` (Socratic prompt is fine here — Why is the rare 5W where reflection helps) |
| How (price, what to bring) | `$10 at door, BYOB, food trucks on site`                                                                     |

**Pattern rules:**

- Use realistic Southside-specific examples (signals neighborhood-rootedness even in admin UX)
- Show texture: "$10 at door, BYOB" is more useful than "Free!" because it teaches FORMAT
- Why-field is the exception that proves the rule — that question wants a prompt, not an example

---

## 5. Terminology decisions (drift class resolutions)

The audit surfaced 4 drift classes. Co-Architect recommendations resolved here. Founder reviews the Open Questions section to confirm.

### 5.1 Host vs. organizer vs. event manager

**Decision (founder-confirmed 2026-05-16 — Q6):** `host` is the canonical customer-facing term. Internal admin-rights model uses tiered roles: **Super admin** (platform-side) and **Host admin** (the customer logged into /admin to run their own events). See §6 glossary.

| Context                                                         | Use                                                            | Don't use                                 |
| --------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------- |
| Public-facing copy (error messages, anonymity copy, event page) | `host`                                                         | `organizer`, `event manager`, `bar owner` |
| Admin form labels (Host admin UX)                               | `host` (sole word — remove the `/ organizer` slash)            | `host / organizer`                        |
| Admin signin lede                                               | `event hosts` (instead of current `event organizers`)          | `event organizers`                        |
| Internal docs / Linear / commit messages                        | `host` OR `bar owner` (both ok internally)                     | mix in same paragraph                     |
| Formal legal / GDPR copy (the existing notice blocks)           | `organizer` is acceptable here only — legal copy can be formal | drift back into customer surfaces         |
| Platform-side admin UX (Super admin, when built)                | `Super admin`                                                  | `super user`, `root admin`, `staff`       |
| Customer-side admin UX (Host admin = today's /admin)            | `Host admin` (when role-distinguishing); `host` in copy        | `bar owner` (customer-facing)             |

**Rationale:** `host` is warmer, shorter, and matches how the customer actually thinks ("I'm hosting an event"). `organizer` is formal-coded and reads as "professional event planner," which mis-anchors what most OSE customers are. The Super admin / Host admin tiering captures the future product role distinction without leaking "bar owner" into customer copy.

**Migrations required (file follow-on stories):**

- `admin form label`: `Who (host / organizer)` → `Who (host)` (pages.ts:458)
- `signin lede`: `This page is for event organizers.` → `This page is for event hosts.` (pages.ts:2084)

### 5.2 Button capitalization

**Decision:** Title Case for action-verb buttons. Sentence case for buttons that ARE a phrase the customer would speak (`Sign me up`, `Stay in the Loop`).

| Pattern                                    | Examples                                                                                             | When to use                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Title Case** (verb [+ object])           | `Register`, `Create Event`, `Submit Feedback`, `Browse Upcoming Events`, `Sign In to Admin`, `Print` | Default. Use for every action-taking button.                                              |
| **Sentence case** (customer-spoken phrase) | `Sign me up`, `Stay in the Loop` (intentional brand-flair exception with mid-phrase cap)             | Reserved for tone-shifted moments where the button reads as "what the customer would say" |

**Migrations required:**

- `Browse upcoming events` (error page CTA) → `Browse Upcoming Events`
- `Stay in the loop` (per-event email signup form title at form-pages.ts:446) → `Stay in the Loop` (match landing button's intentional flair)

### 5.3 Tier naming

**Decision:** `Pro plan` everywhere user-facing. Drop `Mid+` entirely.

| Surface                              | Today                | Replace with        |
| ------------------------------------ | -------------------- | ------------------- |
| Admin tier badge JS map              | `Pro plan` ✅        | (keep)              |
| Shared Report PDF export tooltip     | `Mid+ plan required` | `Pro plan required` |
| Shared Report advanced-metrics badge | `Mid+`               | `Pro`               |
| `briefing.ts` deck                   | `Pro` ✅             | (keep)              |

**Rationale:** "Mid+" raises three unanswered questions (what's Mid? what does + mean? am I above or below?). "Pro plan" is unambiguous and matches the customer's mental model of "Free → Pro → Enterprise."

**Migrations required:** pages.ts:2880 (`Mid+` badge), pages.ts:2860 (PDF export tooltip).

### 5.4 Empty-state voice

**Decision:** Invite-next-step pattern (per 4.5 above). Replace all three current passive empty states.

See **4.5 The empty-state pattern** for the proposed copy.

**Migrations required:** pages.ts:125, pages.ts:525, pages.ts:2351.

---

## 6. Terminology glossary (preferred / acceptable / forbidden)

| Concept                                                      | Preferred                                                                                                   | Acceptable                                                | Forbidden                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Person who creates an event                                  | `host`                                                                                                      | `organizer` (formal contexts only)                        | `event manager`, `user`, `admin user`, `bar owner` (in customer-facing copy)   |
| Person who attends                                           | `attendee` (in admin), `you` (in customer copy)                                                             | `participant`                                             | `user`, `guest` (unless event is private)                                      |
| Customer creating event                                      | `you` (admin copy)                                                                                          | —                                                         | `the admin`, `the user`, `the system administrator`                            |
| Place an event happens                                       | `venue` (the name) + `address` (the location string)                                                        | `location` (generic)                                      | mix in same surface                                                            |
| Event in past tense                                          | `ended`                                                                                                     | `past`, `archived`                                        | `dead`, `expired`, `closed`                                                    |
| Event in future tense                                        | `upcoming`                                                                                                  | `scheduled`, `coming up`                                  | `pending`, `queued`, `planned`                                                 |
| Event happening now                                          | `live`                                                                                                      | `live now`, `happening now`                               | `active`, `current`, `in progress`                                             |
| The platform itself                                          | `OurSharedEvents` (always full name, no abbreviation in customer copy)                                      | OSE (internal / API contexts only)                        | `the platform`, `the site`, `the service`                                      |
| The product family                                           | `OurCommunityRituals` (when referenced; rarely customer-facing)                                             | OCR (internal only)                                       | "Our system"                                                                   |
| Anonymous tracking                                           | `anonymously` (the brand promise word)                                                                      | `private`, `not identified`                               | `untracked` (false), `confidential` (different meaning)                        |
| Sponsor's role                                               | `local sponsor`, `neighborhood sponsor`, `supporting [event]`                                               | `partner`                                                 | `advertiser`, `customer`                                                       |
| Tier "Free"                                                  | `Free plan`                                                                                                 | `Free`                                                    | `basic`, `starter`, `free tier` (the word "tier" is jargon)                    |
| Tier "mid" / "Pro"                                           | `Pro plan`                                                                                                  | `Pro`                                                     | `Mid`, `Mid+`, `paid plan`                                                     |
| Tier "Enterprise"                                            | `Enterprise plan`                                                                                           | `Enterprise`                                              | `business tier`, `corporate plan`                                              |
| Server failure                                               | `having trouble`                                                                                            | `briefly unavailable`                                     | `error`, `failure`, `down`                                                     |
| Bad user input                                               | `doesn't look right`                                                                                        | `isn't valid` (sparing)                                   | `invalid`, `incorrect`, `wrong`                                                |
| Success                                                      | `You're [state]!` shape                                                                                     | `Thanks for [thing]!`                                     | `successful`, `complete`, `received`                                           |
| The 5-minute-tracker concept                                 | `tracks when groups gather`                                                                                 | `anonymous community signal`                              | `collects user data`, `monitors attendance`                                    |
| The neighborhood-ring concept                                | `Neighborhood Ring`                                                                                         | `community`                                               | `community ecosystem`, `our network`                                           |
| Customer mental model for an event (Q2 confirmed 2026-05-16) | `event triangle` (the 3 phases), `event flow`, `event cycle`                                                | —                                                         | `flywheel` in customer copy (the platform mechanic word is internal-only)      |
| Pre-event phase (customer-facing)                            | `pre-event`                                                                                                 | `before the event`, `sharing the event is coming`         | `T-minus`, `staging`, `prep`                                                   |
| Event phase (customer-facing)                                | `event`, `live`                                                                                             | `the gathering`, `during the event`                       | `runtime`, `live ops`                                                          |
| Post-event phase (customer-facing)                           | `post-event`                                                                                                | `after the event`, `event recap`                          | `wrap-up`, `teardown`, `post-mortem`                                           |
| Internal compounding mechanism                               | `flywheel` (briefing deck + internal docs only)                                                             | `mechanism`, `compounding signal`                         | use in customer copy                                                           |
| Platform-side admin (Q6 confirmed 2026-05-16)                | `Super admin`                                                                                               | `platform admin`, `OCR staff` (in legal contexts)         | `super user`, `root admin`, `god mode`                                         |
| Customer-side admin (today's /admin)                         | `Host admin` (role-distinguishing); `host` in customer copy                                                 | `event creator`, `event organizer` (formal contexts only) | `bar owner` (customer-facing), `merchant`, `vendor`                            |
| Privacy-as-positioning (Q4 confirmed 2026-05-16)             | `the privacy standard for community events`, `built privacy-first`, `you're part of the group, anonymously` | `privacy by design`                                       | `GDPR-compliant` (true but defensive — say what we DO not what we comply with) |

---

## 7. Surface-specific exceptions

Most surfaces use the patterns above. Three surfaces earn documented exceptions:

### 7.1 GDPR privacy notices (form-pages.ts)

The privacy notices on `/forms` pages cite GDPR articles explicitly:

```
GDPR Art. 6(1)(a) — your consent. Your data is deleted when the event ends.
```

This is intentionally MORE formal than the Voice Constant. Justification (founder-confirmed 2026-05-16 — Q4): GDPR legal precision is a **compliance layer** that lives in dedicated visual blocks. It is NOT brand voice. The brand-voice angle on privacy is separate AND positions OSE to lead the privacy standard for community-events platforms as the regulatory landscape tightens.

**Rule:** GDPR / legal citation lives in dedicated visual blocks (the privacy-notice card). Adjacent copy stays Voice Constant. The voice statement on privacy is the anonymity affordance ("you're part of the group, anonymously…"); the legal statement is the GDPR notice. Both serve different jobs; they don't blend.

**Strategic positioning note (Q4):** the founder intends for OSE to be at the forefront of privacy standards for community-events platforms. The Voice Constant attribute "Privacy-forward by design" is therefore not aspirational — it's competitive positioning. Copy across surfaces should reinforce "this is what we do" (the active stance) rather than "this is what we comply with" (the passive stance).

### 7.2 Display `/display` ticker

The TV ticker (`OurSharedEvents — Community events on Chicago's Southside`) is the LONGEST consistent tagline use in the codebase. It functions as both brand reinforcement (people see the TV from across a room) AND geographic anchor (signals "this venue is part of THIS network").

**Rule:** the ticker copy is brand-asset, not voice-flexed. Don't rewrite for tone; it's the tagline.

### 7.3 Admin placeholder text (5W form)

Admin placeholders teach by example (see 4.6). Public-facing form placeholders are conversational + minimal (`Jane Smith`, `you@example.com`, `Tell us what you thought...`). This disparity is INTENTIONAL — the admin user wants concrete examples to scaffold their data entry; the public user wants a clean field they can fill quickly.

**Rule:** placeholder-as-example is reserved for admin authoring surfaces. Customer-facing forms use minimal placeholders.

### 7.4 Icon-only buttons (founder-confirmed 2026-05-16 — Q5)

Two icon-only buttons are sanctioned. Both are universally-recognized affordances where the icon adds visual scan-anchor without losing meaning:

| Icon             | Use                                                        | Surface                                                                  |
| ---------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| `🖨` (printer)   | Print action — universally recognized                      | Admin /poster preview header                                             |
| `ℹ` (i for info) | Info / help / explanation popover — universally recognized | TBD — will be introduced as mobile space pressure makes text-CTAs costly |

**Rule:** these two icons may stand alone as button content. Any third icon-only CTA requires a guidelines update — the principle is "universally-recognized affordance + space-constrained context," not "icons are cool."

**Forward-looking note:** as mobile UI density increases (small phones, more controls per surface), additional icon-only patterns may become necessary. Each new pattern requires:

- Documented user-research evidence that the icon is recognized without label
- An entry in this section
- Accessibility plan: `aria-label` carries the full text equivalent so screen readers don't lose meaning

**Forbidden:** `❌` `✓` `▶` `⬇` `📊` AS button content (the existing `⬇ Export JSON` / `📊 Export PDF` on shared report are icon-PREFIX buttons, not icon-only — text follows the icon). Don't strip the text.

---

## 8. Migration backlog (deferred work, not in this PR)

This document is the GUIDELINE. Migrating existing surfaces to fully comply is a separate, multi-PR workstream. The following items would be filed as follow-on stories under an OSE-313 (Brand Voice Migration) parent:

| Priority | Surface                           | Change                                                                                                           | Rationale                                |
| -------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| HIGH     | admin form label                  | `Who (host / organizer)` → `Who (host)`                                                                          | resolves drift class #1                  |
| HIGH     | admin signin lede                 | `event organizers` → `event hosts`                                                                               | resolves drift class #1                  |
| HIGH     | shared report PDF tooltip         | `Mid+ plan required` → `Pro plan required`                                                                       | resolves drift class #3                  |
| HIGH     | shared report advanced badge      | `Mid+` → `Pro`                                                                                                   | resolves drift class #3                  |
| HIGH     | error page CTA                    | `Browse upcoming events` → `Browse Upcoming Events`                                                              | resolves drift class #2                  |
| HIGH     | per-event email-signup form title | `Stay in the loop` → `Stay in the Loop`                                                                          | matches landing button intentional flair |
| MEDIUM   | public listing empty state        | `No events scheduled.` → `Nothing scheduled right now. Sign up to hear when the next one drops.`                 | invite-next-step pattern                 |
| MEDIUM   | admin events empty state          | `No events found.` → `No events yet. Create your first one above.`                                               | invite-next-step pattern                 |
| MEDIUM   | display primary empty state       | `No upcoming events scheduled.` → `Nothing on the calendar this minute. New events posted as they're confirmed.` | invite-next-step pattern                 |
| LOW      | checkin success state             | (currently silent) → see Open Question 3                                                                         | UX completeness                          |

Each migration is a small surgical PR with a regression-guard vitest test asserting the new copy.

---

## 9. Open questions (founder review)

5 of 6 confirmed 2026-05-16. Q3 re-posed below with clearer framing.

### Open Question 1 — Does the brand voice generalize beyond Chicago's Southside? ✅ CONFIRMED 2026-05-16

**Decision:** Neighborhood-rooted is ubiquitous. The pattern is "rooted somewhere specific" — every deployment names its own neighborhood. Chicago Southside is today's neighborhood; the brand voice extends to wherever the platform deploys next.

**In practice:** when authoring copy for a non-Chicago deployment, replace "Chicago's Southside" with the local neighborhood name; the surrounding voice stays. Treat geography as a CONTENT variable, not a brand variable.

### Open Question 2 — Is "flywheel" customer-facing brand language? ✅ CONFIRMED 2026-05-16

**Decision:** No. `flywheel` is behind-the-scenes / internal terminology only (briefing deck, founder talks, internal docs). Customer-facing language uses **`event triangle`** / **`event flow`** / **`event cycle`**.

**The customer mental model (Pre / Event / Post):**

- **Pre-event** — the customer pictures sharing the event is coming with others
- **Event** — the customer pictures enjoying it + sharing QR codes with sponsors
- **Post-event** — the customer pictures additional ops, sponsor funneling

**In practice:**

- Landing subhead `Six Southside communities. One connected flywheel.` → migrate to use `event triangle` / `event cycle` framing. Suggested rewrite: `Six Southside communities. One event cycle that compounds with every gathering.` OR `Six Southside communities. Pre, Event, Post — the cycle that makes neighborhoods visible to themselves.`
- Internal copy (briefing.ts deck) keeps `flywheel` — that's the mechanic-explainer for B2B / investor / partner audiences.

See §6 glossary for full set of triangle-phase term mappings.

### Open Question 3 — Should the check-in success message celebrate or stay silent? 🔄 RE-POSED 2026-05-16

(The previous framing referenced "Apple-style" / "Mailchimp-style" which apparently didn't land. Re-asking with concrete code examples.)

**The situation:** 4 customer success states currently behave like this:

1. Register form submit → page shows `You're registered!` (celebratory)
2. Survey form submit → page shows `Thanks for your feedback!` (celebratory)
3. Email-signup form submit → page shows `You're on the list!` (celebratory)
4. Check-in form tap → page shows NO message; the visible count just goes from "12 checked in" to "13 checked in"

**The question — is #4 (check-in) a bug or a feature?**

- **(a) Bug — add a celebratory message.** Customers tap "Check In" and expect feedback like the other 3. Add something like `You're checked in!` so it matches.
- **(b) Feature — check-in stays quiet on purpose.** A customer at an event might tap the button multiple times (e.g., re-tap to verify it counted) OR multiple attendees might tap from the same phone. A loud `You're checked in!` popping up every tap would be obnoxious. The count incrementing IS the feedback.

**Co-Architect recommendation: (b) — feature, keep silent.** Documenting this as an intentional pattern: _one-time identity moments earn celebration; repeatable transactional moments stay silent_.

If you agree with (b), I lock it as a pattern. If you pick (a), I file the check-in copy addition as a migration item.

### Open Question 4 — GDPR legal blocks — voice or compliance layer? ✅ CONFIRMED 2026-05-16

**Decision:** Compliance layer. GDPR is a standard; the visual block treatment stays as-is.

**Strategic positioning:** the founder intends OSE to be at the forefront of being the privacy standard for community-events platforms. The brand voice's "Privacy-forward by design" attribute is therefore not aspirational — it's competitive positioning. Privacy compliance will become more prevalent in the regulatory landscape; OSE leads rather than complies-defensively.

**In practice:** the GDPR notice block stays as the compliance layer (legal precision, contained visually). The brand-voice statement about privacy is separate and active ("you're part of the group, anonymously…") — that's the LEAD voice on privacy. Copy across surfaces should reinforce active stance ("this is what we do") not passive compliance ("this is what we comply with"). See §7.1.

### Open Question 5 — Emoji-only buttons? ✅ CONFIRMED 2026-05-16

**Decision:** Two icon-only buttons sanctioned: `🖨 Print` (existing) and `ℹ Info` (forthcoming). Both are universally-recognized affordances where the icon adds scan-anchor without losing meaning.

Forward-looking: as mobile UI density increases (small phones, more controls per surface), additional icon-only patterns may become necessary. Each requires user-research evidence the icon is recognized, plus an `aria-label` for accessibility. See §7.4 for full rule.

### Open Question 6 — Is "bar owner" customer-facing? ✅ CONFIRMED 2026-05-16

**Decision:** `bar owner` stays internal. Customer-facing uses `host`. The admin-rights model introduces a tiered role distinction:

- **Super admin** — the platform-side admin (mzdan / OCR staff). Builds the platform, manages tenants, sees cross-event data.
- **Host admin** — the customer logged into /admin to run their own events. This is today's /admin user; the role exists today but the term `Host admin` formalizes it.

**In practice:**

- Today's /admin = Host admin's surface. Copy stays customer-friendly (`host`, `your events`, `you've created`).
- Future Super admin UX (when built) = a distinct surface with platform-side controls. Copy can be more technical / direct since the audience is OSE platform staff.
- Customer-facing copy never uses "Super admin" or "Host admin" as terms — those are role distinctions in internal docs + admin UX role-distinguishing labels. The customer is just "the host" externally.

See §5.1 + §6 glossary.

**Follow-on product question (not a brand-voice question, captured here for traceability):** the Super admin / Host admin distinction implies a tiered-rights model in the app. Building that is a separate product workstream — file as its own story when prioritized. The brand-voice guidelines work doesn't block on it; the terms are now reserved in the glossary regardless of when the implementation lands.

---

## 10. Confidence scores per section

The `/brand-voice:enforce-voice` skill uses these to weigh strict-vs-flexible enforcement.

| Section                                   | Confidence                                                                                          | Source                                                                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Brand essence (§1)                        | HIGH                                                                                                | Co-Architect synthesis from anonymity affordance + landing hero + briefing.ts                                          |
| Voice Constant / We Are-Not (§2)          | HIGH                                                                                                | Founder-validated audit + grounded in 13-surface in-production samples                                                 |
| Tone-by-context matrix (§3)               | HIGH                                                                                                | Direct mapping from existing surface tone observed in audit                                                            |
| Anonymity-affordance pattern (§4.1)       | HIGH                                                                                                | In production, multi-surface, founder authored                                                                         |
| Friendly-error pattern (§4.2)             | HIGH                                                                                                | In production across form-pages + sharedReport + error page; explicit pattern                                          |
| Action-verb CTA pattern (§4.3)            | HIGH                                                                                                | Zero counter-examples in 13-surface audit                                                                              |
| Success-message pattern (§4.4)            | HIGH                                                                                                | 3 of 4 flows; check-in deliberately silent per Open Question 3                                                         |
| Empty-state pattern (§4.5)                | MEDIUM                                                                                              | Display's `Also Coming Up` is the only existing example of the proposed pattern; migration of 3 other surfaces follows |
| 5W placeholder pattern (§4.6)             | HIGH                                                                                                | In production; bar owner feedback positive                                                                             |
| Host terminology (§5.1)                   | HIGH (founder-confirmed Q6 2026-05-16)                                                              | Super admin / Host admin tiering added                                                                                 |
| Button capitalization (§5.2)              | HIGH                                                                                                | Co-Architect recommendation active; founder did not push back; migration scope greenlit via §8                         |
| Tier naming (§5.3)                        | HIGH                                                                                                | briefing.ts already uses `Pro`; consistent with founder Q answers                                                      |
| Empty-state migrations (§5.4)             | MEDIUM                                                                                              | Proposed copy is new; needs founder review before migration PRs land                                                   |
| Terminology glossary (§6)                 | HIGH for in-production terms; MEDIUM for forbidden-list items not currently in codebase             | Composite — updated with event triangle phase terms + Super admin / Host admin tiering 2026-05-16                      |
| Surface exceptions (§7)                   | HIGH (now 4 exceptions: §7.1 GDPR / §7.2 ticker / §7.3 admin placeholders / §7.4 icon-only buttons) | §7.4 added 2026-05-16 per Q5 confirmation                                                                              |
| Event triangle mental model (§1.1)        | HIGH (founder-confirmed Q2 2026-05-16)                                                              | Replaces "flywheel" as the customer-facing mental model; `flywheel` reserved for behind-the-scenes / internal use only |
| Privacy positioning (§7.1 strategic note) | HIGH (founder-confirmed Q4 2026-05-16)                                                              | OSE intends to lead privacy standard for community-events platforms — active stance, not compliance posture            |
| Icon-only buttons (§7.4)                  | HIGH (founder-confirmed Q5 2026-05-16)                                                              | Two sanctioned: `🖨 Print` + `ℹ Info`; mobile space pressure may drive future additions                                |
| Neighborhood-rooted ubiquity (§1)         | HIGH (founder-confirmed Q1 2026-05-16)                                                              | Geography is a content variable, not a brand variable                                                                  |
| Migration backlog (§8)                    | (deferred work — not a confidence claim)                                                            | —                                                                                                                      |
| Open questions (§9)                       | 5 of 6 CONFIRMED 2026-05-16; Q3 RE-POSED with clearer framing                                       | Q3 awaits founder pick                                                                                                 |

---

## 11. Enforcement workflow

For Claude (`/brand-voice:enforce-voice` skill):

1. Load this file
2. Apply Voice Constant attributes (§2) as hard constraints
3. Calibrate tone per §3 surface matrix
4. Use canonical patterns (§4) as templates
5. Run terminology check against §6 glossary; reject forbidden terms with citation
6. Honor surface exceptions (§7) when applicable
7. For ambiguity: cite the relevant Open Question (§9), apply Co-Architect recommendation by default, explain to user

For the human founder:

1. Read §1, §2, §9 (essence + voice constant + open questions)
2. Resolve open questions
3. Greenlight migration backlog (§8) or pick a subset

---

## 12. Changelog

- **2026-05-16 — v1.1 founder-confirmation pass.** 5 of 6 Open Questions resolved by founder. Q3 re-posed with clearer framing (the previous Apple/Mailchimp analogy apparently didn't land). Updates:
  - §1.1 NEW: customer-facing mental model is **Event Triangle** (Pre / Event / Post). `flywheel` reserved internal-only (Q2)
  - §2: Voice Constant "Privacy-forward" attribute strengthened — OSE intends to lead the privacy standard for community-events platforms (Q4)
  - §5.1: host terminology decision now also captures Super admin / Host admin role distinction (Q6)
  - §6 glossary: added event triangle phase terms + Super admin/Host admin entries + privacy-positioning entry; removed `connected flywheel` from preferred neighborhood-ring entry (Q2)
  - §7.1: GDPR notice block strategic-positioning note added (Q4)
  - §7.4 NEW: icon-only buttons formalized — `🖨 Print` + `ℹ Info` sanctioned (Q5)
  - §9: 5 questions marked CONFIRMED with founder text; Q3 re-posed
  - §10: confidence scores updated to reflect founder-confirmation status
- **2026-05-16 — v1 initial generation.** Co-Architect synthesis from `.claude/brand-voice-audit-context.md`. Confidence HIGH on existing-pattern sections; PENDING on drift-class resolutions until founder confirms.
