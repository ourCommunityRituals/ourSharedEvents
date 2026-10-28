# Event types to the six base templates: a proposal for the PO

Drafted 2026-10-28. **The type-by-type mapping is a proposal. One decision is made: option C, a type may have no template (owner, 2026-10-28).** Nothing in code, the registry or ADR-010 has changed yet. It exists so OW-162 and the event-type picker can match event types to profile facets.

**Rule being applied.** OCR-docs ADR-010: every event type rolls up under exactly one of six base templates (Worship, Arts, Sports, Academic, Volunteer, Hobbyist), which double as a person's profile facets. Its six worked examples are the definitions I used.

**What was read.** The 48 active event types: the 47 seeded in migration 0024 plus Watch Party (migration 0097), and the 15 clusters in migration 0076. The cluster is the prefix of the UEC code (REC, SOC, and so on).

## Result

| Template             |  Types | Of which clear | Of which a judgment call |
| -------------------- | -----: | -------------: | -----------------------: |
| Sports               |      7 |              6 |                        1 |
| Worship              |      2 |              2 |                        0 |
| Arts                 |     11 |              9 |                        2 |
| Volunteer            |      6 |              3 |                        3 |
| Academic             |      2 |              1 |                        1 |
| Hobbyist             |     10 |              4 |                        6 |
| **No template fits** | **10** |                |                          |
| Total                |     48 |             25 |                       13 |

"Clear" means ADR-010 names the type or a near synonym. "Judgment call" means the ADR's text allows it, but a reasonable person could put it elsewhere.

## The mapping, type by type

**Sports** (the recurring, team-based gathering; "my team / my league")

- Clear: Bocce Tournament, Softball League Game, Volleyball Meetup, Cornhole Tournament, Pickup Basketball, Kickball Game (all REC)
- Judgment: Running Club Meetup (FIT). A recurring crew, but not a league.

**Worship** ("how I worship")

- Clear: Community Faith Service, Interfaith Community Gathering (both FAI)

**Arts** (the local scene; "my art / who I create with")

- Clear: Art Show & Gallery Opening, Live Music Event, Cultural Festival, Community Mural Unveiling, Photography Exhibition (ART); Open Mic Night, Poetry Slam, Storytelling Night, Stand-Up Comedy Night (PER)
- Judgment: Film Screening (ENT), Karaoke Night (ENT). Karaoke is amateur performance, so it could also be Hobbyist.

**Volunteer** ("how I serve"; service days, food drives, cleanups, mutual aid)

- Clear: Neighborhood Cleanup, Food Drive, Mutual Aid Distribution (all VOL)
- Judgment: Silent Auction Fundraiser, Walkathon / Fun Run Fundraiser, Car Wash Fundraiser (all FND). Giving back, but ADR-010 does not name fundraisers.

**Academic** ("what I study / teach"; lectures, workshops, study groups, library programmes)

- Clear: Professional Development Workshop (BIZ). ADR-010 names workshops.
- Judgment: Book Club Meeting (LIT). A study group, or a hobby.

**Hobbyist** ("what I make / play / collect"; the long tail)

- Clear: Board Game Night and Tabletop RPG Session (TAB; ADR-010 names the board-game night), Game Night (ENT), Craft Fair (MKT)
- Judgment: Community Garden Planting Day, Garden Harvest Festival, Nature Trail Walk (GAR); Community Swap Meet, Flea Market (MKT); Trivia Night (ENT)

**No template fits (10)**

- Community Dinner, Neighborhood Potluck, Block Party, Community Cookout, Watch Party (SOC)
- Neighborhood Association Meeting, Community Forum, Block Captain Election (CIV)
- Business Networking Meetup, Industry Mixer (BIZ)

## Sports is thin in the registry

Sports is the founding case in ADR-010 (the Thursday bocce league, the youth league), yet only 7 of the 48 types map to it, 15 percent, and 6 of those are the REC cluster. No wider list exists to draw from: a search of OCR-docs and the OSE docs found no other REC type codes, so anything below is new.

Two existing types are sports-adjacent. I kept both where they are, and either is a one-line move if you want it:

- **Watch Party** stays with no template. Its description covers "a game, a show or a big night", so it is not only sports. A separate game-day type would make the sports case a clean fit; that is a new type, not a move.
- **Walkathon / Fun Run Fundraiser** stays Volunteer, because it is a fundraiser first.

**A starter list of sports types the registry lacks.** For the PO to trim; none of it is in the registry or in a migration. Names and codes follow the existing pattern, and I kept to types that need no permit, like the current ones.

| Proposed type               | Code                 | Note                            |
| --------------------------- | -------------------- | ------------------------------- |
| Pickleball Meetup           | REC-PICKLEBALL-001   |                                 |
| Soccer Pickup / League Game | REC-SOCCER-001       |                                 |
| Darts League Night          | REC-DARTS-001        | A bar-night league              |
| Pool / Billiards League     | REC-POOL-001         | A bar-night league              |
| Bowling League Night        | REC-BOWLING-001      |                                 |
| Ultimate Frisbee Pickup     | REC-ULTIMATE-001     |                                 |
| Flag Football Game          | REC-FLAGFOOTBALL-001 |                                 |
| Tennis Meetup               | REC-TENNIS-001       |                                 |
| Group Bike Ride             | FIT-CYCLING-001      | Sits beside Running Club Meetup |

**Youth is out.** Owner, 2026-10-28: a youth type cannot be used because of COPPA restrictions, so I removed the youth league type I had proposed, and no youth or children's type should be added. ADR-010's sports and academic examples still cite a youth league and a programme for students; that wording should be aligned when ADR-010 is amended. I did not change it.

Adding all nine would take Sports from 7 types to 16. Each new type is a registry migration (a row per type plus the category code), a seed or catalog test update, and a poster and picker check, so it is its own story, not part of OW-162.

A fan's "my team" could also be a Sports facet, since ADR-010 calls it "often collective, not just individual". If you want fans represented, a game-day type is how.

## Types the owner has asked for

**Fish fry** (owner, 2026-10-28). It is not in the registry: a search of the OSE, OCR-docs, OW and spine sources found no such type in any migration or catalog. It is in the product's own story, though. The landing design mock (`packages/ui/design-system/canvas/Landing.dc.html`) shows a "Fish fry" chip and says "In the spring your shop sponsors the fish fry", so the landing promises a type the picker cannot yet offer.

| Proposed type | Code            | Template                  | Note                                                                                                 |
| ------------- | --------------- | ------------------------- | ---------------------------------------------------------------------------------------------------- |
| Fish Fry      | SOC-FISHFRY-001 | Volunteer (judgment call) | A fish dinner, often on a Friday and often in Lent, hosted by a parish, hall or club to raise money. |

- **Cluster:** SOC (Social & Community Dining) is where someone looking for a dinner would look. FND (Fundraisers) is the other candidate.
- **Template:** Volunteer, because it is volunteer-run and raises money for the host, the same reasoning that put the three fundraiser types there. Worship is the alternative when a parish hosts, but a type cannot know its host, and one type gets one template.
- **It tests the open decision below.** Community Dinner, Potluck, Block Party and Cookout have no template, yet a fish fry does once you ask who runs it. If you want dinners to carry a facet, that argues for option A or for judging each dinner by its purpose.
- Like the sports list, adding it is a registry migration and its own story, not part of OW-162.

You know the corridor's calendar better than I do. Other gatherings of the same family may be missing (a pancake breakfast, a spaghetti dinner, a chili cook-off, a bake sale). I did not add any beyond the one you named.

## Legal guardrails: HIPAA, COPPA, SOPPA (owner, 2026-10-28)

**Rule.** Nothing proposed here may involve health care or health information (HIPAA), children under 13 or youth programmes (COPPA), or students or school programmes (SOPPA). That covers event types, template labels, facets, and the copy around them.

**What already enforces it.** OSE ADR-018 declines all three regimes: tiers 4 and 5 are refused and cannot be reached by config, and the CI gate `scripts/guard-declined-regimes.js` fails a migration that seeds a tier-4 or tier-5 event type. All 47 seeded types are tier 1, and so is Watch Party. Every proposal here (the nine sports types and Fish Fry) should ship at tier 1 as well.

**Audit of this proposal.**

- The nine sports types and Fish Fry are adult or all-ages gatherings with no health, youth or school element. Nothing to remove.
- None of the 48 existing types is a health, youth or school type. The Interfaith description already says "non-health, non-youth-primary".
- **Garden Planting Day** has the description "a community or school garden". The word "school" is the closest thing to a clash in the registry. Suggest dropping it from the description when the registry is next edited. Not changed.
- **Mutual Aid Distribution** and **Walkathon / Fun Run Fundraiser** are fine as events. A fundraiser's cause can be a health cause. OSE records only the event and counts, so that is the health-adjacent case ADR-018 allows, but it is worth knowing.
- **Academic** is the template nearest SOPPA. The only types under it are one adult workshop and one book club, and the starter lists add no school or student type. Keep it that way.

**Where a clash could still get in.** I found four, none of them in the proposed types.

1. **The facet's free-text domain (OW-162).** A person could type a health condition, a child's name or a school into it, and it shows on a public profile. OW-162 keeps the domain as free text, so this is the one open door. Options: a short refuse-list of health, minor and school terms (easy to evade, and it will catch innocent words), or constrain the domain to a list (larger, and crosses the repo boundary). **Decided 2026-10-28 (owner): a refuse-list.** Recorded on OW-162 with how it is built and its limits: it is a guard rail, not a guarantee, and the 18 floor is the real protection.
2. **No age gate found in OurWKRP.** A search of `ourWKRP/src` and its CLAUDE.md for an under-13 or minimum-age check found none. A child who plants a flag would give OW personal data. The OSE link in OSE-1753 would send children there from OSE's all-ages surfaces. **Decided 2026-10-28 (owner): the floor is 18.** That is above COPPA's 13 and keeps nearly all K-12 students (SOPPA) out of the identified flow. The gate itself still has to be built, and how it is checked is open; an "I am 18 or over" confirmation avoids collecting a birth date.
3. **Public text in OSE that still promises COPPA handling.** `handlers/privacy.ts` section 10 ("Children's privacy addendum (Phase 5 events)") says OSE complies with COPPA for events open to children, and `handlers/form-pages.ts` shows a children's notice asking a parent to submit. `handlers/briefing.ts` still describes Phase 4 health event types and Phase 5 youth event types as future work. All of it contradicts ADR-018, which declines these regimes. That is legal text, so a person should decide the wording. I changed none of it.
4. **ADR-018 is looser than your rule on youth.** It says a rec-centre youth league is servable in the general pool by tracking the league. You have ruled that youth cannot be used. ADR-010 repeats the youth-league and student-programme examples. Both should be aligned to your rule when they are amended.

**Proposed safeguard, not built.** When the registry story is written, extend `guard-declined-regimes.js` so a new type's name or description containing terms like health, medical, clinic, patient, support group, recovery, therapy, youth, kids, child, teen, school, student or camp fails the build, with an explicit allowlist for words that are innocent in context. It would be born red like every gate.

## The decision on the ten: option C (made by the owner, 2026-10-28)

**Decided: C.** A type may have no template; "exactly one" becomes "at most one". The ten types below stay in the registry, keep working everywhere, and are left out of facet matching. A and B are kept below for the record. The rest of this section is the reasoning as drafted.

ADR-010 says every type rolls up under exactly one template. Ten of 48 types do not fit any of the six without bending its meaning. They are social, civic and business gatherings, things people attend rather than something a person is. Academic is also nearly empty: the only seeded types that fit are one workshop and one book club, and its own examples (lectures, study groups, the library reading programme) have no type yet. That is fine under ADR-010's "a new kind of gathering is a new type under an existing template".

Three ways to handle the ten:

- **A. Add a seventh template**, for example neighbors and community life. Gives every type a home and gives people a facet like "my block". It changes a canon ADR-010 calls stable: it needs an ADR amendment, and OW-162's six-value check becomes seven.
- **B. Force them into the six.** Dinners and block parties under Volunteer, networking under Academic, and so on. Cheapest on paper, but it corrupts the facets: a person's flag would claim something they did not say.
- **C. Allow a type to have no template.** "Exactly one" becomes "at most one". Those ten types keep working everywhere (listing, poster, reporting); they simply do not match a facet. Nothing about a person is implied by attending a potluck.

**Recommendation: C now, and revisit A when you want a neighbor facet.** A flag is a self-description, so a type that is not an identity should not become one. C changes one sentence of ADR-010, touches no code that OW-162 needs, and A stays open later without rework. B is the one I would not do.

## If accepted, what changes

1. ADR-010 (OCR-docs): amend the "exactly one" sentence per the chosen option, through the ADR reconciliation process. Docs need review loops under AGENTS.md; this is a proposal, not that review.
2. One shared mapping, held once and read by both products (OSE and OW cannot import each other, invariant 22). The natural home is the shared taxonomy that already holds the single `uec_code` classification, with a parity test in each repo.
3. OSE: a `base_template` column on `event_type_registry`, backfilled from this table, with the existing orphan-style test that every active type resolves.
4. OW-162 stays as written; it only needs the six values.
5. The 13 judgment calls are the PO's to confirm or move. Each is one line to change.

## Not verified

The mapping is my reading of ADR-010's prose, not a decision. I did not check whether event types beyond the 48 exist in staging or production, or whether any organizer-entered type bypasses the registry.
