# OurSharedEvents Brand Voice Guidelines

**Status:** v1 (initial generation 2026-05-16) · **Source:** `.claude/brand-voice-audit-context.md` + `docs/brand-voice-audit-2026-05-16.md` · **Owner:** mzdan (founder) + Co-Architect · **Effective:** 2026-05-16 once founder confirms drift-class resolutions in the Open Questions section

This document is the canonical brand-voice reference for OurSharedEvents (OSE). The `/brand-voice:enforce-voice` skill reads this file to validate copy across the 13 customer-visible surfaces. Update this file as decisions evolve — its diff history IS the voice's evolution log.

---

## 1. Brand essence

OurSharedEvents is **the platform that makes communities visible to themselves.**

Bar owners run events. Attendees show up. OSE is the layer that tracks "groups gathered, here, when" without ever tracking "who you are." The product makes anonymous community signal real and durable so neighborhoods can SEE themselves coalescing through the events they hold together.

**One-line positioning:** Community events that bring people together — tracked anonymously so the patterns stay honest.

**Core promise (kept explicit on every public surface):**

> You're part of the group, anonymously. OurSharedEvents tracks when groups gather — never who you are.

This sentence is load-bearing. Every surface inherits its tone.

---

## 2. Voice Constant — the "We Are / We Are Not" table

The Voice Constant is what stays the same across every surface. Tone (formality, energy, technical depth) flexes per surface; voice does not.

| We Are                                                                                                       | We Are Not                                                               |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| **Warm but precise** — neighborhood language that names specifics ("$10 at door, BYOB, food trucks on site") | Generic, corporate, safe ("Great events for everyone")                   |
| **Neighborhood-rooted** — the brand belongs to a place, named or implied                                     | Geography-agnostic SaaS-shaped ("Bring your community together!")        |
| **Privacy-forward by design** — make specific anti-promises, not legal disclaimers                           | Privacy-policy-PDF-link defensive ("By using this site you consent to…") |
| **Action-verb led** — every button is a verb the customer is choosing to do                                  | Generic-button passive (`Click here`, `Submit`, `OK`, `Continue`)        |
| **Plain-language technical** — say "corridors and venues, not people"; "a single click"                      | Engineer-jargon ("anon_id", "phase 1", "tier mid", "tranche")            |
| **First-person inclusive** — "you're part of the group", "we'll be in touch"                                 | Third-person institutional ("Users may", "the system tracks")            |
| **Specific and concrete** — placeholder examples are real things real bar owners would type                  | Vague and abstract ("amazing community", "next-level events")            |
| **Apologetic-helpful on errors** — name what went wrong, suggest a next action                               | Terse-blame (`Error 500`, `Invalid input`, "Failed to process")          |
| **Celebratory on success** — earned exclamations on customer wins                                            | Receipt-style ("Submission received", "Transaction complete")            |
| **Confident without overclaim** — "Built for the Southside, by the Southside"                                | Marketing puffery ("The #1 platform for…", "Best-in-class")              |

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

**Decision:** `host` is the canonical customer-facing term.

| Context                                                         | Use                                                            | Don't use                                 |
| --------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------- |
| Public-facing copy (error messages, anonymity copy, event page) | `host`                                                         | `organizer`, `event manager`, `bar owner` |
| Admin form labels                                               | `host` (sole word — remove the `/ organizer` slash)            | `host / organizer`                        |
| Admin signin lede                                               | `event hosts` (instead of current `event organizers`)          | `event organizers`                        |
| Internal docs / Linear / commit messages                        | `host` OR `bar owner` (both ok internally)                     | mix in same paragraph                     |
| Formal legal / GDPR copy (the existing notice blocks)           | `organizer` is acceptable here only — legal copy can be formal | drift back into customer surfaces         |

**Rationale:** `host` is warmer, shorter, and matches how the customer actually thinks ("I'm hosting an event"). `organizer` is formal-coded and reads as "professional event planner," which mis-anchors what most OSE customers are.

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

| Concept                       | Preferred                                                              | Acceptable                         | Forbidden                                                                    |
| ----------------------------- | ---------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| Person who creates an event   | `host`                                                                 | `organizer` (formal contexts only) | `event manager`, `user`, `admin user`, `bar owner` (in customer-facing copy) |
| Person who attends            | `attendee` (in admin), `you` (in customer copy)                        | `participant`                      | `user`, `guest` (unless event is private)                                    |
| Customer creating event       | `you` (admin copy)                                                     | —                                  | `the admin`, `the user`, `the system administrator`                          |
| Place an event happens        | `venue` (the name) + `address` (the location string)                   | `location` (generic)               | mix in same surface                                                          |
| Event in past tense           | `ended`                                                                | `past`, `archived`                 | `dead`, `expired`, `closed`                                                  |
| Event in future tense         | `upcoming`                                                             | `scheduled`, `coming up`           | `pending`, `queued`, `planned`                                               |
| Event happening now           | `live`                                                                 | `live now`, `happening now`        | `active`, `current`, `in progress`                                           |
| The platform itself           | `OurSharedEvents` (always full name, no abbreviation in customer copy) | OSE (internal / API contexts only) | `the platform`, `the site`, `the service`                                    |
| The product family            | `OurCommunityRituals` (when referenced; rarely customer-facing)        | OCR (internal only)                | "Our system"                                                                 |
| Anonymous tracking            | `anonymously` (the brand promise word)                                 | `private`, `not identified`        | `untracked` (false), `confidential` (different meaning)                      |
| Sponsor's role                | `local sponsor`, `neighborhood sponsor`, `supporting [event]`          | `partner`                          | `advertiser`, `customer`                                                     |
| Tier "Free"                   | `Free plan`                                                            | `Free`                             | `basic`, `starter`, `free tier` (the word "tier" is jargon)                  |
| Tier "mid" / "Pro"            | `Pro plan`                                                             | `Pro`                              | `Mid`, `Mid+`, `paid plan`                                                   |
| Tier "Enterprise"             | `Enterprise plan`                                                      | `Enterprise`                       | `business tier`, `corporate plan`                                            |
| Server failure                | `having trouble`                                                       | `briefly unavailable`              | `error`, `failure`, `down`                                                   |
| Bad user input                | `doesn't look right`                                                   | `isn't valid` (sparing)            | `invalid`, `incorrect`, `wrong`                                              |
| Success                       | `You're [state]!` shape                                                | `Thanks for [thing]!`              | `successful`, `complete`, `received`                                         |
| The 5-minute-tracker concept  | `tracks when groups gather`                                            | `anonymous community signal`       | `collects user data`, `monitors attendance`                                  |
| The neighborhood-ring concept | `Neighborhood Ring`, `connected flywheel` (brand-flair)                | `community`                        | `community ecosystem`, `our network`                                         |

---

## 7. Surface-specific exceptions

Most surfaces use the patterns above. Three surfaces earn documented exceptions:

### 7.1 GDPR privacy notices (form-pages.ts)

The privacy notices on `/forms` pages cite GDPR articles explicitly:

```
GDPR Art. 6(1)(a) — your consent. Your data is deleted when the event ends.
```

This is intentionally MORE formal than the Voice Constant. Justification: legal precision in customer-facing copy is itself a trust signal in EU markets. The legal precision is contained to the privacy-notice block — it should NOT bleed into form labels, button text, or success messages.

**Rule:** GDPR / legal citation lives in dedicated visual blocks (the privacy-notice card). Adjacent copy stays Voice Constant.

### 7.2 Display `/display` ticker

The TV ticker (`OurSharedEvents — Community events on Chicago's Southside`) is the LONGEST consistent tagline use in the codebase. It functions as both brand reinforcement (people see the TV from across a room) AND geographic anchor (signals "this venue is part of THIS network").

**Rule:** the ticker copy is brand-asset, not voice-flexed. Don't rewrite for tone; it's the tagline.

### 7.3 Admin placeholder text (5W form)

Admin placeholders teach by example (see 4.6). Public-facing form placeholders are conversational + minimal (`Jane Smith`, `you@example.com`, `Tell us what you thought...`). This disparity is INTENTIONAL — the admin user wants concrete examples to scaffold their data entry; the public user wants a clean field they can fill quickly.

**Rule:** placeholder-as-example is reserved for admin authoring surfaces. Customer-facing forms use minimal placeholders.

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

These were surfaced in the audit context file and remain unresolved. Co-Architect recommendations included where applicable. Founder direction needed for v1.1 of this document.

### Open Question 1 — Does the brand voice generalize beyond Chicago's Southside?

Today's landing copy is geographically specific (`Gather with your neighborhood on Chicago's Southside`). Should the voice principle be:

- **(a) Neighborhood-rooted with deployment-specific geography** — every deployment names its own neighborhood; the pattern is "rooted somewhere specific" rather than "rooted in Chicago"
- **(b) Chicago-Southside-specific** — the geography IS part of the brand; expansion happens via partnerships, not white-label

**Co-Architect recommendation:** (a). The brand essence (`makes communities visible to themselves`) is geography-agnostic; the geographic specificity is the BRAND'S COMMITMENT to specifics, not a commitment to Chicago. Future deployments substitute their neighborhood; the pattern stays.

### Open Question 2 — Is "flywheel" customer-facing brand language?

Currently appears in landing subhead (`Six Southside communities. One connected flywheel.`). It's strong, specific, slightly insider.

- **(a) Keep as customer-facing** — the metaphor IS the brand's central thesis; using it on the landing teaches the customer to think in those terms
- **(b) Soften** — `Six Southside communities. One connected network.`
- **(c) Replace** — find a more accessible metaphor (ripple, current, signal)

**Co-Architect recommendation:** (a). "Flywheel" is the kind of specific-noun choice the rest of the voice celebrates. If we use plain language for privacy mechanics (`a single click`), we can use a specific-but-slightly-insider noun for the brand's mechanic.

### Open Question 3 — Should success states earn exclamations?

Three of four customer flows use `!`. Checkin is silent.

- **(a) Silent-success Apple-style** — quiet "did it" state (e.g., the count just increments)
- **(b) Celebratory-success Mailchimp-style** — exclamation across the board
- **(c) Mixed (current state)** — checkin is silent because it's repeatable in seconds; first-time interactions get celebration

**Co-Architect recommendation:** (c). Current behavior is correct: register/survey/signup are one-time identity-affirming moments → celebrate; checkin is mundane-repeat → silent. Document this as an intentional pattern: `One-time identity moments earn exclamation. Repeatable transactional moments stay silent.`

### Open Question 4 — GDPR legal blocks — voice or compliance layer?

`form-pages.ts` privacy notices contain GDPR Art. references. Compliance precision sits inside otherwise-conversational copy.

- **(a) Voice** — the legal precision IS the brand voice in EU contexts (trust signal)
- **(b) Compliance layer** — visually distinct block, voice-neutral

**Co-Architect recommendation:** (b) with documentation. The notices STAY where they are (already in a `.privacy-notice` visual block per `form-pages.ts` CSS), but documented as exception 7.1 above. The Voice Constant doesn't apply inside the notice block — it applies to the labels + buttons + microcopy AROUND it.

### Open Question 5 — Emoji-only buttons?

Only one exists: `🖨 Print` on the poster preview. Other action buttons use text.

- **(a) Keep as the lone exception** — print is the universal symbol; text adds nothing
- **(b) Formalize as a pattern** — emoji + verb for canonical actions
- **(c) Unify with text-only** — `Print` becomes just the word

**Co-Architect recommendation:** (a). Print on the admin /poster preview is a documented exception. Don't proliferate emoji-only CTAs to other surfaces; don't strip this one because it works in context (high-affordance, low-density admin surface where the emoji adds visual scan-anchor for the bar owner).

### Open Question 6 — Is "bar owner" customer-facing?

The audit notes this question separately. Internal docs use "bar owner" everywhere; customer-visible copy uses "host" / "organizer."

- **(a) Internal only** — keep "bar owner" out of customer copy entirely
- **(b) Onboarding only** — admin signin / onboarding email may say "bar owners", everything else uses "host"
- **(c) Customer-facing** — promote "bar owner" to a customer-visible term

**Co-Architect recommendation:** (a). The customer creating events at OSE may not BE a bar owner specifically (could be church organizer, league coordinator, neighborhood association lead). "Bar owner" is the dominant SEGMENT internally but isn't an accurate self-description for all customers. Stay with "host" externally; "bar owner" remains internal shorthand.

---

## 10. Confidence scores per section

The `/brand-voice:enforce-voice` skill uses these to weigh strict-vs-flexible enforcement.

| Section                             | Confidence                                                                              | Source                                                                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Brand essence (§1)                  | HIGH                                                                                    | Co-Architect synthesis from anonymity affordance + landing hero + briefing.ts                                          |
| Voice Constant / We Are-Not (§2)    | HIGH                                                                                    | Founder-validated audit + grounded in 13-surface in-production samples                                                 |
| Tone-by-context matrix (§3)         | HIGH                                                                                    | Direct mapping from existing surface tone observed in audit                                                            |
| Anonymity-affordance pattern (§4.1) | HIGH                                                                                    | In production, multi-surface, founder authored                                                                         |
| Friendly-error pattern (§4.2)       | HIGH                                                                                    | In production across form-pages + sharedReport + error page; explicit pattern                                          |
| Action-verb CTA pattern (§4.3)      | HIGH                                                                                    | Zero counter-examples in 13-surface audit                                                                              |
| Success-message pattern (§4.4)      | HIGH                                                                                    | 3 of 4 flows; check-in deliberately silent per Open Question 3                                                         |
| Empty-state pattern (§4.5)          | MEDIUM                                                                                  | Display's `Also Coming Up` is the only existing example of the proposed pattern; migration of 3 other surfaces follows |
| 5W placeholder pattern (§4.6)       | HIGH                                                                                    | In production; bar owner feedback positive                                                                             |
| Host terminology (§5.1)             | HIGH (Co-Architect recommendation) → PENDING (founder confirmation)                     | Resolved tentatively; Open Question 6 dependency                                                                       |
| Button capitalization (§5.2)        | HIGH → PENDING                                                                          | Resolved tentatively; founder confirms migration scope                                                                 |
| Tier naming (§5.3)                  | HIGH → PENDING                                                                          | Resolved tentatively; cross-checks briefing.ts already uses `Pro`                                                      |
| Empty-state migrations (§5.4)       | MEDIUM                                                                                  | Proposed copy is new; needs founder review before migration PRs land                                                   |
| Terminology glossary (§6)           | HIGH for in-production terms; MEDIUM for forbidden-list items not currently in codebase | Composite                                                                                                              |
| Surface exceptions (§7)             | HIGH                                                                                    | All documented exceptions observed in current production                                                               |
| Migration backlog (§8)              | (deferred work — not a confidence claim)                                                | —                                                                                                                      |
| Open questions (§9)                 | (unresolved — confidence is FOUNDER PENDING)                                            | —                                                                                                                      |

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

- **2026-05-16 — v1 initial generation** (this file). Co-Architect synthesis from `.claude/brand-voice-audit-context.md`. Confidence HIGH on existing-pattern sections; PENDING on drift-class resolutions until founder confirms.
