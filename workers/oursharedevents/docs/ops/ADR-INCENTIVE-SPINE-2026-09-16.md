# ADR (draft): The incentive spine. Anchor pledge, green check-in, corridor funnel

**Status:** DRAFT for ratification. Not a decision yet. Needs the five-loop CCR the governance rules require for constitutional material, because section 6 touches Invariant #25.
**Date:** 2026-09-16
**Owner:** Matt
**Supersedes nothing. Builds on:** `subscription-billing-decision-2026-08-18` (prepaid term, no auto-renew, lapse rule), `OSE-00-BUSINESS-FLOWS` (Flows 3, 4, 5, 6), Invariant #25 (uniform rendering; only frequency share and report depth are purchasable), doctrine rule 7 (sponsors have no account, login, or page).
**Lens:** Munger, "show me the incentive and I'll show you the outcome." Every party's reward should come from another party's action, and whoever pays should be paying for the behavior we actually want.

---

## 1. Why this exists

An incentive audit of the triangle (2026-09-16) scored it roughly 8 or 9 of 10 at removing perverse incentives and 2 or 3 of 10 at creating positive ones. The covenant, the count floor, the two unjoinable databases, and the LLM-free runtime make the platform very hard to corrupt. But as built, no corner has a reason to act:

- The attendee gets nothing for scanning, by design. Median two scans per code; a third get zero. Flow 3 has never met a stranger.
- The organizer does all the physical labor and is rewarded with a report that suppresses at exactly the venue size the mission targets.
- The sponsor's paid delta is zero or inverted at launch pool sizes (at R=1, cancelling raises share by ten points). The local tier at weight 1 is a charge for nothing.
- The operator's reward loop points at green gates, not counterparties (about 15:1 revealed allocation).

The outcome the platform produces today is the one its rewards point at: thousands of green tests and zero scans from a stranger. This ADR proposes the smallest set of mechanisms that gives each corner a reason to act, without loosening any promise to the attendee.

## 2. The spine, in one paragraph

An anchor sponsor funds a per-scan pledge into the organizer's pot, capped per night, settled seasonally from the same k-floored report the anchor already receives. The attendee's scan now visibly does something (the count and the dollars tick up on the display) without anyone knowing who scanned. The organizer gets money that arrived because their room scanned, so they push the poster. The anchor gets the community-support story they are actually buying, plus a count they have every reason to want honest. The 30% local floor keeps the neighborhood chorus on the wall around them, which is what makes "anchor of this community" credible rather than an ad. Locals stay free. Their presence is what the anchor pays to stand among.

## 3. Attendee: the green check-in has to be the useful thing

The green (check-in) code is on the door and the table tents. The landing page must be what the person would have reached for anyway, then two things they didn't expect.

**What they reached for:** their bracket or team, standings, tonight's schedule, the song request line (OurAirwaves / kiosk).

**What they didn't expect:**

1. The room's count on the display moves: "63 scans tonight" and, when an anchor is on, "$63 to the league." Aggregate, on-lexicon (scans, never people or attendance), no identity.
2. A "what's around you tonight" strip: three or four businesses within a walk, each with one thing that is true only tonight, for anyone who shows this page. Show the phone at the counter. No code, no name, no redemption record on our side. The business counts at its own register if it cares to.

**Hard rule:** offers are keyed to a time window and a place, never to a person. No per-person coupon codes, ever. That is a one-way door into tracking and this ADR closes it explicitly.

## 4. Sponsors: the ladder, and why the anchor carries the load

| Tier   | What they give                                                  | What they get                                                                                                     | Purchasable dimension (#25) |
| ------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Local  | Nothing. Optionally one tonight-only offer.                     | Name on the wall at weight 1, a slot on the corridor card, their own counter code.                                | none (free)                 |
| Mid    | A per-scan pledge at one venue, one season, small cap.          | Weight 3, the venue-level report, the pledge line on the display.                                                 | frequency share, depth      |
| Anchor | A per-scan pledge across the corridor for a season, larger cap. | Weight 7, the corridor report (the only report that clears k_venues=3), standing "anchor of this corridor" claim. | frequency share, depth      |

Three reasons the anchor product is a corridor season, not a night:

1. The report sold at anchor depth needs k_venues of three to publish. A single-night anchor buys a suppression notice; a corridor-season anchor buys the one report that can exist. Align the product shape to the privacy floor instead of fighting it.
2. Frequency share is only perceptible at scale. Across a season of eight-logo rotations the 7x weight is visible; on one poster with two sponsors it is not.
3. "Anchor of this community" is a standing claim, and a season is the smallest unit a standing claim can be made in.

The local tier is no longer a charge for nothing. It is the recruitment mechanism: a free local is a future mid or anchor, and a wall full of free locals is what the anchor is paying to stand among.

**Displacement fix.** Under the old model OSE's revenue would have come out of what the hardware store already gives the league. Under the pledge, OSE's fee sits on top of money that flows to the league. The organizer experiences the platform as the reason they got paid.

## 5. The corridor funnel: how it becomes a network

**Corridor card (event to business).** The strip in section 3 is the existing sponsor resolver (Path 2: template plus zip or radius) run for "active locals near this venue," rendered as uniform cards on the check-in landing. Because it is geo-derived, the funnel is honest the same way `is_local` is: a business appears on the Eagles card because it is near Eagles. Nobody can buy onto a card for a corridor they are not in.

**Counter codes (business to event).** Each participating business gets a code for its counter that lands on the discovery page filtered to walking distance and the next few days. The hardware store becomes a node feeding events; events are nodes feeding the hardware store. The post-event recap's return-loop aside points at the next thing in the corridor, not only the next night of the same league.

**Public spaces.** A code on the park district board or the library door is a node with no offer and no sponsor, just the map. This is how the public half of public-private gets on the network for free.

**Retention mechanism.** Reciprocity, not subscription. Nobody renews anything; they leave the card up because it brings their regulars to nearby things that send people back.

## 6. Covenant compliance, and the one place this rubs

Everything in sections 2 through 5 fits inside what is already ratified:

- Uniform rendering holds. Locals on the corridor card are identical in size, slot, and treatment. Tiers change weight (frequency) and report depth only.
- `is_local` and "near" stay geo-derived, never a toggle, never purchasable.
- Doctrine rule 7 holds in substance. No sponsor account, login, portal, or SKU picker. The Epic TRIANGLE `/sponsor` page (PR #567) is not a counter-example: it is a token-in-link, no-login, expiring VIEW an organizer mints and hands over out-of-band — a signed link, not an account, session, or portal — so rule 7's "no account / no login" constraint is intact; the "no page" wording is refined to "no logged-in portal." The counter code is a printed card. (Reconciled per CCR-PR567 M7.)
- Lexicon gate applies to the display count line and the corridor card. Scans, never people, attendance, impressions, reach.
- Two-database isolation untouched. Offers are time-and-place keyed; no redemption rows exist on our side.
- Prepaid term, invoiced, no stored card, no auto-renew (billing decision) holds. Pledge settlement is seasonal and manual.

**The rub.** Naming the anchor on a rendered surface ("Tonight's pledge: Southside Hardware, $1 per scan to the league") is a treatment difference, and #25 forbids treatment differences inside a sponsor region. The argument for allowing it: the line states a fact about money that went to the community, not a bigger logo, and it is a separate, labeled region rather than a sponsor slot. The argument against: it is exactly the kind of "better spot" #25 exists to refuse, and once one labeled region exists the pressure to add another never stops. This is a constitutional amendment, not a config change. Ratify it as its own region with its own gate or do not do it. Default if unratified: the pledge line shows the dollars and the recipient, not the payer.

## 7. Two things that must be ratified before the first anchor pays

1. **Monotonicity.** No downgrade or lapse may ever raise a sponsor's share. Pick the weight vector that satisfies it at R=1 through 6 and add the named CI test the billing pack proposed. If a paying anchor can be out-shown by a lapsed one, the ladder is a story we cannot keep.
2. **The lapse rule, one line, into OSE-819:** nobody who has ever appeared ever stops appearing; they appear at weight 1 and they stop learning. The 402 governs first promotion only. `placement_paused` is reserved for chargeback, fraud, and abuse. Today three shipped artifacts encode three different products; the promise "your name never comes off the wall" is currently false in public repos.

## 8. What this rewards that we do not want, and the guards

- **Fake scans.** Pay-per-scan invites them. Existing defenses: node dedup, rate limits, hour buckets, count floors. Add: a per-night cap set by the anchor, and settlement from the k-floored report rather than raw scans, so gaming the count means gaming the report and the floor eats small manipulation.
- **Coupon drift.** Offers pull toward tracking. Guard: time-and-place keyed, show-the-page, no per-person codes, no redemption table, lint the public-page templates for anything that looks like a unique code.
- **Regulated advertisers.** Who may be on a parish-hall check-in card, who decides, and what happens when the organizer objects. Unanswered in every prior document. Must be answered before a card ships.
- **"Near" that isn't.** A strip that shows a business a twenty-minute drive away breaks the promise in one glance. Ratify a radius per venue type; the resolver already has the machinery.
- **Tax position of the parish.** Measured, comparative delivery is what can turn a sponsorship gift into advertising income (UBI). Flagged since August; still needs the CPA.
- **Operator load.** The corridor walk is exactly the counterparty work the operator loop points away from, and it is also the product. There is no version where the code does it.

## 9. Sequence, so each layer pays for the next

| Layer | What                                                                                                 | Cost                                                     | Depends on         |
| ----- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------ |
| 0     | The night itself. Poster on the wall.                                                                | done                                                     | Flows 1, 2         |
| 1     | Green check-in with utility; live count line on display.                                             | public-page change, one display line                     | lexicon gate       |
| 2     | Corridor card on the check-in landing. Five businesses within a walk of one venue.                   | resolver already exists; rendering; one afternoon's walk | radius ratified    |
| 3     | Counter codes at businesses; corridor filter on discovery; recap return-loop points at the corridor. | mostly built (discovery, shortlinks)                     | Layer 2            |
| 4     | Anchor pledge: weight change, cap field, display line, seasonal settlement.                          | 3 to 5 points plus manual process                        | section 7 ratified |

## 10. The experiment that decides it (before any of section 9 beyond Layer 1)

Run OSE-797 with one paper card, five corridor businesses, both a per-night and a season price, and three added lines:

- "Every scan is a dollar from you to the league, up to fifty."
- "Your name never comes off the wall. If you stop paying, you just appear less often."
- "Free option: your name on the wall and a spot on the check-in page, if you'll give the room one thing tonight."

Record verbatim answers. Three of five yes at a real price validates the spine and the covenant in one afternoon. Five of five no at every price means the ladder is wrong and a season was saved. Five of five yes to the free option only means the network layer is the product and the pledge is premature.

Then stand in the hall one Thursday and count scans with Layer 1 live. If median-two holds even with utility on the page, the attendee corner needs more than this ADR offers, and that is worth knowing before the anchor conversation.

## 11. Open questions (owner: Matt unless noted)

- Which five businesses, which venue, which Thursday. Start with the league's existing givers, RIPH, Harbor Cabins.
- Radius per venue type for "near."
- Whether the pledge line may name the payer (section 6). Requires CCR.
- The regulated-advertiser policy for check-in cards.
- Pledge cap defaults per tier.
- Whether a second human with billing authority exists before seasonal settlement is promised to anyone.

## 12. What this ADR does not decide

Prices. Whether venue and organizer are one wallet (A5, self-rated probably false). Whether the report can publish for the first cohort. Whether the founder's objective is income, sustainability, civic infrastructure, or a saleable asset. Those were unvalidated in August and remain so; the experiment in section 10 is the cheapest way to move any of them.
