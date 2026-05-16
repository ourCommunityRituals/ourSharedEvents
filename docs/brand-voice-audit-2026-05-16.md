# OSE Brand-Voice Audit — Cross-Surface Copy Inventory

**Generated:** 2026-05-16 by Co-Architect agent
**Scope:** All customer-visible copy across 13 OSE front-end surfaces (10 customer surfaces + admin signin + anonymity affordance + error pages)
**Source files audited:**

- `workers/oursharedevents/src/handlers/pages.ts` (3200 lines)
- `workers/oursharedevents/src/handlers/form-pages.ts` (437 lines)

**Purpose:** Input artifact for the `/brand-voice:generate-guidelines` skill. Founder uses this audit to articulate "what voice DO we have today, and where does it fragment?" before authoring formal brand guidelines that the `/brand-voice-enforcement` skill can then apply across surfaces.

---

## Why this audit exists

OSE has shipped 13+ user-facing surfaces over the past 3 months without a written brand-voice standard. Copy was authored per-surface by whoever was building that surface — the founder, the Co-Architect agent, audit-driven fixes, etc. The result is genuinely good copy in places (anonymity affordance, friendly error mapping) but with **drift between surfaces** where the same concept is named differently, the same emotional register is hit at different intensities, or the same UX pattern (empty state, success state, error tone) is handled differently.

This audit is **descriptive, not prescriptive**. It documents what exists. The next step (`/brand-voice:generate-guidelines`) is where the founder decides which patterns to canonicalize.

---

## Executive summary — three strongest voice patterns + four biggest drift classes

### Three strongest voice patterns (keep)

1. **Privacy-forward plain language.** The `ANONYMITY_AFFORDANCE` block ("You're part of the group, anonymously. OurSharedEvents tracks when groups gather — never who you are. Event hosts and sponsors see corridors and venues, not people…") is consistently surfaced across all 3 public-event renders. Reads as a load-bearing brand promise, not legal boilerplate.

2. **Friendly error-code mapping.** No raw codes (`INVALID_EVENT_ID`, `UNAUTHORIZED`) leak to user-visible text. Every server failure maps to specific actionable copy ("This event link doesn't look right. Try the original link or contact the host."). Pattern shared across `form-pages.ts` errors AND `SHARED_REPORT_ERROR_COPY` AND `renderErrorPage`.

3. **Action-verb CTAs.** `Browse upcoming events`, `Navigate now`, `Check in at this event`, `Sign me up`, `Stay in the Loop`. Verbs do the work; no `Click here` / `Submit` / `OK` placeholders.

### Four biggest drift classes (need resolution before guidelines)

| #   | Drift class                                              | Examples                                                                                                                                                                                                                                                                                                                                                                        | Why it matters                                                                                                                                                                                       |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Host terminology** — same role, three names            | Admin form: `Who (host / organizer)` ; anonymity copy: `Event hosts and sponsors` ; signin page: `event organizers`                                                                                                                                                                                                                                                             | Founder needs to pick: "host" (concise, intimate) OR "organizer" (formal, planning-coded). Currently noncommittal forward-slash treatment in admin form telegraphs indecision.                       |
| 2   | **Button capitalization** — Title Case vs. sentence case | Title Case: `Register` `Create Event` `Submit Feedback` `Browse upcoming events` ; sentence case: `Sign me up` `Stay in the Loop` (mixed mid-phrase) ; one-word: `Register`                                                                                                                                                                                                     | Customers see both within minutes. Pick one.                                                                                                                                                         |
| 3   | **Tier naming** — same paid tier, two labels             | Admin tier-badge: `Pro plan` (mapped from `mid`) ; SharedReport export disabled state: `Mid+` (the `+` suggests "this tier or higher" but isn't explained); `briefing.ts` deck: `Pro`                                                                                                                                                                                           | A bar owner who upgrades from Free shouldn't see "you're now on Pro plan" in admin and "Mid+ required" in report.                                                                                    |
| 4   | **Success/empty-state silence vs. celebration**          | Register: `You're registered!` (exclamation, contraction) ; Email signup: `You're on the list!` (same energy) ; Survey: `Thanks for your feedback!` (gratitude-forward) ; Check-in: NO success message (only count increment) ; Empty states: `No events scheduled.` `No events found.` `No upcoming events scheduled.` (three flavors of "nothing here" across three surfaces) | Success states earned exclamations except check-in. Empty states all sound apologetic-passive. Pattern is "celebrate creation, mourn absence" — could become "celebrate creation, invite next-step." |

---

## Surface-by-surface inventory

### 1. Landing `/` (`PUBLIC_HTML`)

| Element          | Copy                                                                                                                          | Line      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------- |
| Hero heading     | `Gather with your neighborhood on Chicago's Southside`                                                                        | 1275      |
| Hero subhead     | `Community events that bring people together. Stay in the loop and be the first to know when something's happening near you.` | 1276      |
| Subscribe input  | placeholder `Enter your email`                                                                                                | 1279      |
| Subscribe button | `Stay in the Loop`                                                                                                            | 1280      |
| Section title    | `Our Neighborhood Ring`                                                                                                       | 1285      |
| Section subhead  | `Six Southside communities. One connected flywheel.`                                                                          | 1286      |
| Feature 1        | `Shared Events` / `Browse upcoming gatherings, leagues, and community nights happening across the neighborhood.`              | 1300–1301 |
| Feature 2        | `Local Sponsors` / `Neighborhood businesses supporting the events you love. Real partnerships, real impact.`                  | 1305–1306 |
| Feature 3        | `Community First` / `Built for the Southside, by the Southside. Every event strengthens the bonds that matter.`               | 1310–1311 |
| Footer           | `© 2026 OurSharedEvents · Browse Events`                                                                                      | 1316      |

**Voice notes**: warmest surface in the codebase. Neighborhood / community / bonds / flywheel — load-bearing brand metaphors. "Flywheel" is internal jargon graduating to customer-facing; defensible because the brand IS the flywheel. "Stay in the Loop" mixed-case is the only mixed-case button in the codebase.

### 2. Public events listing `/events`

| Element        | Copy                                       | Line |
| -------------- | ------------------------------------------ | ---- |
| Heading        | `Upcoming Events`                          | 114  |
| Loading        | `Loading events…`                          | 115  |
| Empty          | `No events scheduled.`                     | 125  |
| Event card CTA | `Register`                                 | 142  |
| Error          | `Could not load events. Please try again.` | 146  |
| Sponsor strip  | `Supported by`                             | 329  |

**Voice notes**: functional minimum. "Register" single-word CTA contrasts with the longer landing-page copy. Empty state is terse + passive.

### 3. Public event page `/events/:id`

| Phase         | Element        | Copy                                      | Line       |
| ------------- | -------------- | ----------------------------------------- | ---------- |
| pre_event     | Section labels | `What` `Where` `Who` `Why` `How`          | 1675+      |
| pre_event     | Maps link      | `See on Google Maps`                      | 1621       |
| pre_event     | RSVP CTA       | `RSVP for this event`                     | (template) |
| event-live    | Live badge     | `Live now`                                | 1802       |
| event-live    | Check-in CTA   | `Check in at this event`                  | 1807       |
| event-live    | Maps link      | `Navigate now` (vs. pre_event's "See on") | 1757       |
| post_event    | Message        | `This event has ended.`                   | 1870       |
| event (phase) | Message        | `This event is happening now.`            | 1870       |

**Voice notes**: 5W content surface (What/Where/Who/Why/How). Maps link verb shifts pre→live ("See" → "Navigate") — intentional? It's an undocumented voice choice that happens to land well; codify it.

### 4. Event error page (`renderErrorPage` — OSE-R-004)

| Scenario   | Copy                                                                                                 | Line                |
| ---------- | ---------------------------------------------------------------------------------------------------- | ------------------- |
| 503 title  | `We're having trouble loading this event`                                                            | 1916                |
| 503 body   | `Our event service is briefly unavailable. Try again in a minute, or browse what else is coming up.` | 1917                |
| 404 title  | `We couldn't find that event`                                                                        | 1928, 1959          |
| 404 body   | `This event link doesn't work anymore — it may have been archived. See what's coming up next.`       | 1929, 1960          |
| CTA (both) | `Browse upcoming events`                                                                             | 1919/1931/1952/1962 |

**Voice notes**: apologetic ("We couldn't"), explanatory ("may have been archived"), recovery-pathed ("Browse upcoming events"). The "—" em-dash usage is consistent here AND in the anonymity affordance.

### 5. Forms `/forms/:id?type=<...>` (4 variants)

#### 5a. register

| Element | Copy                                                     | Line    |
| ------- | -------------------------------------------------------- | ------- |
| Title   | `Register for this event`                                | 341     |
| Name    | label `Your name`, placeholder `Jane Smith`              | 344–345 |
| Email   | label `Email (optional)`, placeholder `jane@example.com` | 346–347 |
| Button  | `Register`                                               | 348     |
| Success | `You're registered!`                                     | 360     |

#### 5b. checkin

| Element       | Copy                             | Line |
| ------------- | -------------------------------- | ---- |
| Title         | `Check In`                       | 370  |
| Button        | `Tap to Check In` (with `<br/>`) | 372  |
| Count display | dynamic `{n} checked in`         | 388  |
| Success       | (none — only count increments)   | —    |

#### 5c. survey

| Element  | Copy                                                                   | Line    |
| -------- | ---------------------------------------------------------------------- | ------- |
| Title    | `How was the event?`                                                   | 404     |
| Rating   | `Overall rating`                                                       | 407     |
| Comments | label `Comments (optional)`, placeholder `Tell us what you thought...` | 415–416 |
| Button   | `Submit Feedback`                                                      | 417     |
| Success  | `Thanks for your feedback!`                                            | 436     |

#### 5d. email-signup (per-event)

| Element       | Copy                                                                     | Line    |
| ------------- | ------------------------------------------------------------------------ | ------- |
| Title         | `Stay in the loop` (lowercase "loop" — vs. landing's "Stay in the Loop") | 446     |
| Tagline       | `Get notified about future events. We'll never share your email.`        | 447     |
| Email         | label `Your email`, placeholder `you@example.com`                        | 450–451 |
| Button        | `Sign me up`                                                             | 452     |
| Success (new) | `You're on the list!`                                                    | 463     |
| Success (dup) | `You're already signed up!`                                              | 463     |

#### 5e. Friendly error copy (`form-pages.ts:187–205`)

| Code                | Friendly copy                                                                    |
| ------------------- | -------------------------------------------------------------------------------- |
| `INVALID_EVENT_ID`  | `This event link doesn't look right. Try the original link or contact the host.` |
| `INVALID_BODY`      | `We couldn't read your response. Please refresh the page and try again.`         |
| `PAYLOAD_TOO_LARGE` | `Your message is too long. Please shorten it and try again.`                     |
| `MISSING_FIELD`     | `Please fill out all required fields and try again.`                             |
| `INVALID_EMAIL`     | `That email doesn't look right. Please check and try again.`                     |
| `CONFIG_ERROR`      | `Something's not set up on our side. Please try again in a few minutes.`         |
| `DB_ERROR`          | `We're having trouble right now. Please try again in a moment.`                  |
| rate limit          | `Too many tries. Please wait a moment and try again.`                            |
| 5xx fallback        | `Sorry, something went wrong. Please try again.`                                 |

**Voice notes**: error copy is the SINGLE best brand-voice asset in the codebase — apologetic, specific, action-instructed. Should be the template for ALL error tone across surfaces.

### 6. Admin `/admin` (authed — `ADMIN_HTML`)

| Element            | Copy                                                                                                                                                                                               | Line                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Header subtitle    | `Admin`                                                                                                                                                                                            | 428                     |
| Create card        | `Create Event`                                                                                                                                                                                     | 434                     |
| Field labels       | `Event Name` `Start Date` `Venue`                                                                                                                                                                  | 438/442/446             |
| 5W fields          | `What (short share description)`, `Who (host / organizer)`, `Where (full address)`, `Why (purpose)`, `How (price, what to bring, what to expect)`                                                  | 454/458/462/466/470     |
| Placeholders       | `Summer Block Party`, `Evergreen Park`, `Beverly Hills Bocce League`, `12345 South Western Ave, Blue Island IL 60406`, `Why is this happening? Why now?`, `$10 at door, BYOB, food trucks on site` | 439/447/459/463/467/471 |
| Submit             | `Create Event`                                                                                                                                                                                     | 475                     |
| List heading       | `All Events`                                                                                                                                                                                       | 487                     |
| Empty              | `No events found.`                                                                                                                                                                                 | 525                     |
| Tier badge labels  | `Free plan` / `Pro plan` / `Enterprise plan` (from JS `TIER_LABELS`)                                                                                                                               | OSE-R-005               |
| Phase badge labels | `Community events` / `Commerce events` / `Licensed activities` / `Health events` / `Youth events`                                                                                                  | OSE-R-005               |

**Voice notes**: placeholder-rich; teaches the bar owner by example. "$10 at door, BYOB" is the friendliest brand-voice moment in the admin surface. The `host / organizer` slash is the smoking-gun terminology drift.

### 7. Admin sign-in `/admin` (unauthed — `ADMIN_SIGNIN_HTML`)

| Element | Copy                                                                                                                   | Line |
| ------- | ---------------------------------------------------------------------------------------------------------------------- | ---- |
| Heading | `Admin sign-in required`                                                                                               | 2083 |
| Lede    | `This page is for event organizers. Sign in with your authorized work email to manage your events and access reports.` | 2084 |
| CTA     | `Sign in to admin`                                                                                                     | 2085 |
| Helper  | `New to OurSharedEvents? Request access from the home page — subscribe and we'll be in touch.`                         | 2087 |

**Voice notes**: formal register vs. the warm landing. "event organizers" (NOT "hosts" — same role, different word).

### 8. Shared Report `/sharedReport`

| Element         | Copy                                                             | Line                |
| --------------- | ---------------------------------------------------------------- | ------------------- |
| Header subtitle | `Shared Report`                                                  | 2846                |
| Loading         | `Loading your event report…`                                     | 2853                |
| Sections        | `Events Overview` `Events` `Sponsor Overview` `Advanced Metrics` | 2865/2872/2876/2880 |
| Advanced badge  | `Mid+`                                                           | 2880                |
| Export JSON     | `⬇ Export JSON`                                                  | 2858                |
| Export PDF      | `📊 Export PDF` ; tooltip `Mid+ plan required`                   | 2860                |

#### Signed-link friendly errors (`SHARED_REPORT_ERROR_COPY`, lines 2905–2925)

| Code                      | Friendly copy                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `UNAUTHORIZED`            | `This share link has expired or isn't valid. Ask the sender for a fresh link.`          |
| `FORBIDDEN`               | `This share link is for a different event.`                                             |
| `NOT_FOUND`               | `We couldn't find that event report.`                                                   |
| `MATERIALIZATION_PENDING` | `Your event report is almost ready — usually takes a few minutes. Refresh in a moment.` |
| `NON_JSON_RESPONSE`       | `We're having trouble reaching the report service. Try again in a moment.`              |
| `NETWORK_ERROR`           | `Couldn't reach the report service. Check your connection and try again.`               |
| DEFAULT                   | `Something went wrong loading your event report. Try again in a moment.`                |

**Voice notes**: error tone matches form-pages.ts. Tier naming `Mid+` is the OUTLIER — every other surface using the same tier says `Pro plan`.

### 9. Poster `/poster` (+ /posters /tabletop /tent /flyers /signage per OSE-310)

| Element      | Copy                           | Line      |
| ------------ | ------------------------------ | --------- |
| Header       | `OurSharedEvents — Poster`     | 2598      |
| Print link   | `🖨 Print`                     | 2599      |
| Picker label | `Select Event`                 | 2603      |
| Loading      | `Loading events…` / `Loading…` | 2604/2606 |
| Org line     | `OurSharedEvents`              | 2622      |

**Voice notes**: minimal interactive copy because the surface is print-targeted. "🖨 Print" emoji button is the only emoji-only CTA in the codebase.

### 10. Display `/display`

| Element        | Copy                                                        | Line |
| -------------- | ----------------------------------------------------------- | ---- |
| Featured label | `Upcoming Event`                                            | 2358 |
| Next-events    | `Also Coming Up`                                            | 2365 |
| Empty          | `No upcoming events scheduled.`                             | 2351 |
| Error          | `Could not load events.`                                    | 2375 |
| Ticker         | `OurSharedEvents — Community events on Chicago's Southside` | 2333 |

**Voice notes**: TV/kiosk surface. Ticker carries the brand tagline; this is the LONGEST consistent tagline use in the codebase. "Also Coming Up" is the warmest empty-bridge phrase in the codebase ("here's MORE" instead of "nothing here").

### 11. Anonymity affordance (appears on all 3 public-event phase renders)

```
Heading: How this works

Body: You're part of the group, anonymously. OurSharedEvents tracks when
groups gather — never who you are. Event hosts and sponsors see corridors
and venues, not people. The link you followed counted as a single click;
nothing about your device, location, or identity was collected to
display this page.
```

**Voice notes**: this is the brand. If guidelines can capture this voice and apply it elsewhere, the unified-front-end goal is largely achieved. Plain-language. First-person inclusive ("you're part of the group"). Specific anti-promises ("never who you are"). Technical precision in customer-readable form ("corridors and venues, not people"; "a single click; nothing about your device").

---

## Recommended next steps

1. **Founder runs `/brand-voice:generate-guidelines`** with `.claude/brand-voice-audit-context.md` (sibling file) as input. The skill will turn this audit into a structured Voice-Constant / Tone-Flex doc.

2. **Resolve the 4 drift classes** explicitly during guideline generation:
   - Pick: host / organizer / event manager (recommend: "host" for warmth + brevity; "organizer" only in formal admin-onboarding contexts)
   - Pick: button-case convention (recommend: Title Case for action verbs to match `Browse upcoming events` and `Create Event` precedent)
   - Pick: tier name (recommend: drop "Mid+" entirely; use "Pro plan" everywhere it's the user-facing name)
   - Pick: empty-state pattern (recommend: invite next-step like Display's "Also Coming Up" rather than terse passive)

3. **Promote `form-pages.ts` error-copy block** as the canonical error-voice template. Cross-apply its tone to any new error path.

4. **Codify the anonymity-affordance voice as the brand's voice constant** — first-person inclusive + plain technical language + specific anti-promises. Other surfaces should sound like extensions of this paragraph.

5. **After guidelines exist**, re-run `/brand-voice-enforcement` against each surface in priority order:
   - Highest leverage: landing + admin signin (the two surfaces customers see first by role)
   - Medium: forms (register / survey / signup variants)
   - Lower: poster / display (minimal copy; less drift surface area)

---

## Companion artifacts

- **`.claude/brand-voice-audit-context.md`** — same content formatted as input for `/brand-voice:generate-guidelines`
- **This file** — durable reference for future brand-voice work; survives even if `.claude/` is wiped

---

## Co-Architect framing

This audit is the FE-Design + Brand discipline's first pass at making OSE's surfaces sound like one product instead of N disjoint pages. It's not the guideline; it's the **prerequisite input** to authoring one. The skill workflow (`discover-brand` → `generate-guidelines` → `enforce-voice`) needs concrete material to chew on — this audit IS that material.

The pattern is the same as OCR-42's three-phase invariant arc:

- **GOVERN** = author the standard (= brand guidelines, after this audit feeds them)
- **DRAIN** = drain each surface to compliance
- **REFINE** = post-validation refinement once the first audit cycle reveals standard-debt

Tonight delivers the discovery input for the brand-voice GOVERN phase. The DRAIN and REFINE phases happen across subsequent sessions, one surface at a time, with the founder-approved guidelines as the canonical reference.
