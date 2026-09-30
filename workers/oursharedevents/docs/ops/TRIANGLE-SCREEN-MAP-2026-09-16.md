# Triangle screen map — who is on each corner, and what screen they stand on

**Date:** 2026-09-16 · **Scope:** OSE surfaces · **Standing directive:** the three corners of the triangle (event, sponsor, attendee) and the SharedReport at its centre must be connected by _screens_, not by links someone has to keep. Every hop a person makes should land them somewhere they can come back to, with the next thing to do visible, nothing on the screen they don't need, and the security posture unchanged.

## The people

| Corner                | Who, concretely                                                                                                | Comes in through                                                   | What they need to be able to do without asking                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **Event / organizer** | Bar or lodge owner, rec-department staff, a parish volunteer. Often 55+. Phone in hand.                        | `/admin` behind CF Access (brand-scoped membership).               | Create, find their own events (incl. drafts), go live, get the poster, add sponsors, see how it went, share the report.       |
| **Brand owner**       | Same surface, several brands (a league operator, a multi-venue owner).                                         | `/admin`, brand tree.                                              | Everything above across brands, plus the portfolio rollup.                                                                    |
| **Sponsor**           | A local business owner. Was created FOR them by the organizer; they never had a login and should not need one. | **New:** `/sponsor?t=…` signed link the organizer mints and sends. | See which events they're on, whether each is live, accept or decline a placement, open their own report.                      |
| **Attendee**          | Someone with a phone in front of a poster, or texted a link. Anonymous by design.                              | `/events`, `/events/:id`, `/q/`, `/s/`, `/forms/:id`.              | Find what's on (tonight, this weekend, near me, "the trivia thing"), register / check in, see the recap. Never be identified. |
| **Operator (you)**    | CI keys, demo seeding, the person on the phone when something's wrong.                                         | key actors + `ADMIN_SCOPE_ALL`, audit log.                         | Trace any "it didn't work" to an audit row without touching who.                                                              |

## Screens: before and after this pass

| Corner    | Screen                      | Before (2026-09-16 morning)                                                | After                                                                                                                                                                                                                       |
| --------- | --------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organizer | Front door                  | Create sponsor / Create event / Show everything                            | **+ Your events**                                                                                                                                                                                                           |
| Organizer | Events list                 | "All Events", hidden behind Show everything, no filters, silent 50 cap     | **Your events**: Drafts / Ready / Live / Archived, Only mine, Show more, status badge, unlisted marker                                                                                                                      |
| Organizer | Status                      | _none_ — every UI-created event stayed a draft forever                     | **Status panel**: Mark ready / Go live / Take offline / Archive / Reopen, on the state machine's edges only                                                                                                                 |
| Organizer | Wizard step 5               | "🎉 ready to go" + links that 404'd                                        | Honest "saved as a draft" + **Go live now**                                                                                                                                                                                 |
| Organizer | Where am I?                 | Four cards, read one at a time                                             | **Event timeline**: Set up → Live → Poster out → People scanning → Sponsors on → Report, with **Next:** one link into the right card                                                                                        |
| Organizer | Sponsors card               | Edit / Deactivate                                                          | **+ Sponsor link** (mint the sponsor's page, copy, send)                                                                                                                                                                    |
| Sponsor   | Home                        | _none_                                                                     | **`/sponsor`**: name, Live / Coming up / Need your answer counts, one card per placement with state, Event page link (when live), **Your report** (sponsor-scoped, once there is something to report), **Accept / Decline** |
| Sponsor   | Report                      | Signed per-event link the organizer had to mint by hand                    | Reached from the sponsor home, minted on the fly, sponsor-scoped                                                                                                                                                            |
| Attendee  | `/events`                   | Flat list, newest-first, no question you could ask it                      | **Search** (name / venue) + **Everything / Today / This weekend / Next 7 days / This month / Recently wrapped** chips; server-rendered; the URL is the state (`/events?when=weekend` is a link you can text)                |
| Attendee  | `/events/:id`, forms, recap | Already good (canonical 5W order, anonymity affordance, staleness forward) | unchanged                                                                                                                                                                                                                   |
| Cron      | Drafts                      | pile up forever                                                            | Archived after 30 untouched days (`DRAFT_EXPIRY_DAYS`), reversible                                                                                                                                                          |

## The stitches (how a person moves)

1. **Organizer creates** → wizard → _saved as a draft_ → **Go live now** → links on step 4 work → Done → lands on **Your events** with the new event selected → **timeline** says _Next: Print a poster_.
2. **Organizer returns next week** → front door **Your events** → **Drafts** chip (auto-selected when drafts exist) → tap → status panel + timeline → _Next: Go live_ or _Next: Add a sponsor_.
3. **Organizer adds a sponsor** → sponsors card → **Sponsor link** → copy → text it to the business owner.
4. **Sponsor opens the link** → `/sponsor` → sees _Please confirm_ on the new placement → **Accept** → placement is on every public surface (the resolver already honoured `sponsor_accepted`; now something sets it) → later, **Your report**.
5. **Attendee** scans the poster → `/events/:id` → registers (anonymous) → after the event, the recap → **What's on** → `/events?when=weekend`.
6. **Report** → organizer mints the venue link from the forms card (unchanged); the sponsor reaches theirs from their own page. Same table, two scoped views: the _shared_ in SharedReport.

## Security ledger for this pass (nothing new was invented)

- **No new login.** The sponsor page is a signed, expiring, sponsor-scoped bearer (`lib/sponsor-home-auth.ts`), same construction as the report and invite tokens, with a distinct `kind` so tokens are not interchangeable. Fail-closed without a secret. Minted only by an authenticated organizer inside brand scope; audited (`MINT_SPONSOR_HOME_LINK`); rate-limited like the report mint.
- **Tenant isolation (#9)** holds by SQL: every sponsor-home read is `id = ? AND brand_id = ?` from the signed claim; the respond endpoint proves ownership in the UPDATE's WHERE; misses are 404, never 403.
- **Attendee anonymity**: the sponsor page renders no attendee data; counts live behind the report's own token and k-floor. Discovery filters never touch SQL (applied over the already-scoped, published projection) and the reflected `q` is escaped exactly once.
- **State machine**: `PUT status` now enforces the same transition table as verify-qr. The admin timeline reads only k-floored counts.
- **CSP**: every new page goes through the nonce `html()` helper; the sponsor page has one inline script (accept/decline) and the discovery bar has none.

## What is still not a screen (next slices, in order)

> **Update 2026-09-30 (PR #700):** 1 ✅ attendee map (landing map view, `lib/attendee-map.ts`); 2 ✅ sponsor discovery (`/sponsor` "Events you could back" → organizer Approve/Decline, `lib/sponsor-discovery.ts`); 3 ✅ organizer inbox (Event checklist "Needs your attention"); 4 ✅ Soonest first (`?sort=upcoming`); 5 re-scoped — measured, admin costs ~0 ms at startup and `h3-js` ~85% (`STARTUP-COST-2026-09-30.md`). Also: `/sponsor` now has PR-gating browser E2E.

1. **Attendee map** over `GET /api/v2/events/map` (H3 res-7 cells, no coordinates accepted) — render with the existing CSP-clean `renderCorridorMap` SVG rather than a map library.
2. **Sponsor discovery**: a sponsor browsing events they _could_ back (the invite flow exists; a browse-and-ask flow does not).
3. **Organizer inbox**: pending sponsor drafts and declined placements surfaced on the timeline card rather than inside the sponsors table.
4. **Sort by upcoming date** on the admin list (needs its own cursor).
5. **Admin split**: `admin.html` is now ~250 KB and carried on every anonymous request; the sponsor page is its own template on purpose. The organizer surface should follow.
