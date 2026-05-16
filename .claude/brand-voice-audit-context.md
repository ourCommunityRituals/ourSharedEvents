# OSE Brand-Voice Generation Context

**Audit source:** `docs/brand-voice-audit-2026-05-16.md` (full inventory + line refs)
**Use:** input for `/brand-voice:generate-guidelines` skill
**Generated:** 2026-05-16 by Co-Architect agent

---

## Product context (for the guidelines author)

**OurSharedEvents (OSE)** is the events surface of a 7-product OCR ecosystem
("OurCommunityRituals"). The product runs on Cloudflare Workers + D1, ships to
two domains (admin and customer-facing), and has 13 user-visible surfaces:
landing, public events listing, public event page (3 lifecycle phases),
admin dashboard (auth + signin variants), form pages (4 type variants), shared
report (2 modes), poster preview (4 path-aliased formats), display TV surface,
and error pages.

The product audience is **two-sided**:

- **Attendees** (mobile-first phone users) — register / check in / take surveys
- **Bar owners + event organizers** ("hosts" / "organizers" — terminology
  varies, see drift class #1 below) — create events, manage sponsors, view
  reports

**Brand positioning thread** (load-bearing across surfaces):

- Community-first, neighborhood-anchored ("Chicago's Southside" is currently
  the literal launch geography; voice should generalize to "your
  neighborhood")
- Privacy-forward by architecture — the platform makes specific
  anti-promises ("never who you are", "corridors and venues, not people")
- "Flywheel" is the internal metaphor for how events compound community
  signal — used in landing copy as a customer-facing term

---

## The strongest existing voice samples (anchor these in the Voice Constant)

### Sample 1 — Anonymity affordance (appears on every public event page)

```
You're part of the group, anonymously. OurSharedEvents tracks when groups
gather — never who you are. Event hosts and sponsors see corridors and
venues, not people. The link you followed counted as a single click;
nothing about your device, location, or identity was collected to display
this page.
```

**Why this is the voice anchor:** first-person inclusive ("you're part of
the group"). Specific anti-promises ("never who you are", "nothing about
your device"). Technical precision in plain-language form ("corridors and
venues, not people"; "a single click"). No legal boilerplate. Reads as a
brand promise, not a disclaimer.

### Sample 2 — Friendly error mapping (`form-pages.ts`)

```
INVALID_EVENT_ID  → "This event link doesn't look right. Try the original
                     link or contact the host."
INVALID_EMAIL     → "That email doesn't look right. Please check and try
                     again."
DB_ERROR          → "We're having trouble right now. Please try again in a
                     moment."
PAYLOAD_TOO_LARGE → "Your message is too long. Please shorten it and try
                     again."
```

**Why this is the error-voice template:** every server failure mapped to
specific copy. Apologetic ("We're having trouble", "Sorry"). Specific
("doesn't look right", "too long", "all required fields"). Always
instructs a next action ("try the original link", "shorten it", "contact
the host"). NEVER leaks raw codes.

### Sample 3 — Landing hero (warm + concrete)

```
Gather with your neighborhood on Chicago's Southside

Community events that bring people together. Stay in the loop and be
the first to know when something's happening near you.
```

**Why:** verb-led ("Gather"). Geographically specific
(neighborhood-anchored). Inclusive ("bring people together"). Action
follow-through ("Stay in the loop").

### Sample 4 — Action-verb CTAs (across surfaces)

```
Browse upcoming events     Navigate now      Check in at this event
Stay in the Loop           Sign me up        Tap to Check In
Sign in to admin           Print             Register
```

**Why:** action-verb-led. No `Click here` / `Submit` / `OK` placeholder
language anywhere in the codebase. This is a strong, consistent pattern
to formalize.

---

## We Are / We Are Not (founder draft — refine as needed)

| We Are                                                                         | We Are Not                                                |
| ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| **Warm but precise**                                                           | Generic / corporate / safe                                |
| **Neighborhood-rooted** (Chicago Southside today; "your neighborhood" pattern) | Geography-agnostic SaaS-shaped                            |
| **Privacy-forward by design** (make specific anti-promises)                    | Privacy-policy-PDF-link defensive                         |
| **Action-verb led** (Gather / Browse / Check in / Stay)                        | Generic-button passive (Click here / Submit / OK)         |
| **Plain-language technical** (corridors, venues, single click, anon counter)   | Engineer-jargon ("anon_id", "phase 1", "tier mid")        |
| **First-person inclusive** (you're part of the group, we'll be in touch)       | Third-person institutional (users may, the system tracks) |
| **Specific & concrete** ($10 at door, BYOB, food trucks on site)               | Vague & abstract (great events, amazing community)        |
| **Apologetic-helpful on errors** (We couldn't, try the original link)          | Terse-blame ("Error 500. Invalid input.")                 |
| **Celebratory on success** (You're registered! You're on the list!)            | Receipt-style ("Submission received.")                    |

---

## Tone-by-context matrix (founder draft — calibrate)

| Surface                           | Formality             | Energy               | Technical depth                             |
| --------------------------------- | --------------------- | -------------------- | ------------------------------------------- |
| Landing                           | Casual-warm           | High celebratory     | Low                                         |
| Public events listing             | Casual-functional     | Medium               | Low                                         |
| Public event page (pre/live)      | Casual-narrative      | Medium               | Low                                         |
| Public event page (post/ended)    | Neutral-archival      | Low                  | Low                                         |
| Error pages                       | Apologetic-helpful    | Low (calm)           | None                                        |
| Forms (register/survey/email)     | Casual-conversational | Medium (form action) | Low (legal blocks isolated)                 |
| Forms (checkin)                   | Minimal-action        | High (single tap)    | None                                        |
| Admin dashboard                   | Instructional-warm    | Medium               | Medium (examples-rich placeholders)         |
| Admin signin                      | Professional-formal   | Low                  | None                                        |
| Shared report (admin mode)        | Data-neutral          | Low                  | Medium (metrics names)                      |
| Shared report (signed-link error) | Apologetic-helpful    | Low                  | None                                        |
| Poster preview                    | Functional            | Low                  | None                                        |
| Display (TV)                      | Ambient-informational | Low                  | None                                        |
| Anonymity block (universal)       | Plain-precise         | Calm-reassuring      | Low (technical precision in plain language) |

---

## Four drift classes for the guideline author to resolve

### Drift 1 — Host terminology

Same role appears as three names:

- `host` (intimate, used in error copy: "contact the host")
- `organizer` (formal, used in admin signin: "event organizers")
- `host / organizer` (noncommittal slash, in admin form label)

**Founder recommendation needed:** pick one for customer-facing surfaces.
"Host" suggested as the warmer, more bar-venue-appropriate term. Reserve
"organizer" for formal contexts (legal copy, admin onboarding emails).

### Drift 2 — Button capitalization

Two patterns coexist:

- **Title Case** action: `Register`, `Create Event`, `Submit Feedback`,
  `Browse upcoming events`, `Check In`, `Print`
- **Sentence case** action: `Sign me up`, `Stay in the Loop` (first cap
  - mid-phrase cap because "Loop" is a noun phrase)

**Recommendation:** Title Case for the verb + sentence case for the rest.
`Create Event` → `Create Event`. `Sign me up` → `Sign me up`. `Stay in
the Loop` is the genuinely-marketing-flair exception that should stay.

### Drift 3 — Tier naming

The same paid tier appears as two names:

- Admin tier-badge JS map: `Pro plan` (mapped from internal slug `mid`)
- Shared Report export button tooltip: `Mid+ plan required` (the `+`
  meaning is unexplained to users)
- Briefing deck: `Pro`

**Recommendation:** `Pro plan` everywhere user-facing. Drop `Mid+`
entirely. The `+` ambiguity ("this tier or higher" vs. "Pro premium")
creates more questions than it answers.

### Drift 4 — Empty-state voice

Three variants of "nothing here":

- Public listing: `No events scheduled.`
- Admin events: `No events found.`
- Display: `No upcoming events scheduled.`
- Display "more events" section uses warmest pattern: `Also Coming Up`
  (invites next-step rather than reports absence)

**Recommendation:** adopt `Also Coming Up`-style invite-next-step for
empty/loading/transitional states. E.g.:

- Public listing empty: `Nothing scheduled right now. Sign up to hear
when the next one drops.`
- Admin events empty: `No events yet. Create your first one above.`
- Display empty: `Nothing on the calendar this minute. New events
posted as they're confirmed.`

---

## Five questions for the guideline author to surface

1. **Does the brand voice generalize beyond Chicago's Southside?** Today's
   landing copy is geographically specific. Should the voice principle
   be "neighborhood-rooted" (every deployment names its own
   neighborhood) or "Chicago-Southside-specific" (the geography is part
   of the brand)?

2. **Is "flywheel" customer-facing brand language?** Currently appears in
   landing subhead ("Six Southside communities. One connected
   flywheel."). It's strong, specific, slightly insider. Keep, soften,
   or replace?

3. **Should success states earn exclamations?** Pattern today: register /
   email signup / survey all use `!`. Check-in is silent. Decide whether
   silent-success (Apple-style "did it") or celebratory-success
   (Mailchimp-style "high five!") is the brand pattern.

4. **GDPR legal blocks — voice or compliance?** Form-pages.ts privacy
   notices contain GDPR Art. references inside otherwise-conversational
   copy. Is the legal precision part of the brand voice (trust
   signal) or a separate compliance layer that should stay visually
   distinct?

5. **Emoji-only buttons — yes or no?** Only one exists: `🖨 Print` on
   the poster preview. Other action buttons use text. Keep as the one
   exception, formalize as a pattern, or unify with text-only?

---

## Open question expected to surface in generation

- **"Bar owner" — is that a customer segment or a brand-voice phrase?**
  The internal documentation consistently uses "bar owner" to describe
  the primary B2B customer. NONE of the customer-visible copy currently
  uses the phrase. Should it become customer-facing (admin onboarding
  email: "Welcome, bar owner") or stay internal-only (admin says "event
  organizer" / public says "host")?

---

## Workflow for the founder

1. Review this context file + the full audit at `docs/brand-voice-audit-2026-05-16.md`
2. Run `/brand-voice:generate-guidelines` — paste this file's contents OR point the skill at the docs paths
3. The skill produces `brand-voice-guidelines.md` (typically at `.claude/brand-voice-guidelines.md` or wherever the skill's `--out` directs)
4. Resolve the 4 drift classes + 5 questions during generation (or accept the recommendations baked in here)
5. Re-invoke `/brand-voice-enforcement` with guidelines in hand — the skill can then produce unified per-surface copy across the 13 surfaces

---

## Co-Architect note

This context file is intentionally opinionated. The skill expects either raw
discovery material OR structured input like this — providing the latter
lets the founder spend the generation step VALIDATING recommendations
rather than producing them from scratch. If any recommendation here is
wrong, the founder overrides during generation.
