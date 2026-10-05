> **Status: research plan, 2026-10-04. Recommendations and hypotheses only, not PO decisions.** Nothing here changes pricing, ICP, naming, ADRs or code until the PO accepts it. Every number below is either read from a named repo file or marked HYP. Discovery anonymization rules (`README.md` in this folder) apply: no venue, owner or address names in any finding written here.

# Year-1 user research plan: hyperlocal event economies

**Question asked (PO, 2026-10-04):** What does the current infrastructure look like from a user-research point of view? The short-term business model has rated C every time, because the bet is long-game. How do we maximize income and reach in year 1? Is the answer user research into hyperlocal economies, across event, sponsor and attendee? And can OCR claim "you are not tracked on OSE; OW is where you plant a flag", a network that is a real choice rather than the false choice of surveillance or no service?

## 1. Bottom line

1. **The infrastructure measures events extremely well and has heard from almost no humans.** There are 7 first-party measures, a spine-key plan and a full interview kit. Logged interviews: **zero**. `COMPETITIVE-BRIEF-2026-05-14.md:127` says it plainly: until OSE-271 conversations are logged, the brief is "well-reasoned hypothesis".
2. **Three documents name three different first customers.** May's beachhead: bars running trivia and leagues (`BEACHHEAD-ICP-2026-05-14.md`). October's brand structure: parish groupings, libraries, chambers, then league operators (`BRAND-MARKETING-SALES-STRUCTURE-2026-10-04.md`). The live work: a fundraiser and a bocce club with an Oct 24 deadline, plus a bocce regional campaign in spring 2027. Research's first job is to choose, with evidence, which of these is the year-1 wedge.
3. **The C rating is arithmetic, and it points at services, not subscriptions.** Using your own pricing hypotheses (section 4), a year-1 subscription base is a few hundred to low thousands of dollars a month. Year-1 income is therefore a services and campaign problem; **year-1 reach is the asset that makes the long game real.** Research should find who pays for reach now.
4. **The "not tracked" claim is strong but needs exact wording, and should be tested.** The code sets an `ose_anon` cookie (HttpOnly, one year) on a QR scan and on form submits (`.telemetry` tracking plan, section 3). The true statement is "counted, never identified". "Not tracked" will be read by a skeptic as "no cookie, no ID, nothing". Test the wording before it goes on a poster.

## 2. Current infrastructure from a user-research point of view

### 2.1 What exists

| Asset                                     | Where                                                                                                                              | Research value                                                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 7 first-party measures                    | `.telemetry/tracking-plan.md` section 2: qr_scan, shortlink_click (daily), impression, click, checkin, email_signup, report_access | Behavior of **events and sponsor placements**, never of persons. This is the behavioral-evidence half of every study below.        |
| Spine keys (corridor, venue, type, event) | `.telemetry/tracking-plan.md`, epic OSE-1612; `venue_canonical_id` and `event_correlation_id` not built yet (OSE-1615)             | Lets one study compare the same venue or type across weeks without touching identity.                                              |
| Pre-event reach by week                   | `shortlink_click_daily` (migration 0094)                                                                                           | The "shared link drives pre-event" claim is now measurable per event. No read path yet; any added must floor before leaving admin. |
| SharedReport                              | `/sharedReport`, depth tiers, K=5 floor                                                                                            | The thing a sponsor actually reads. It is also the single best research stimulus: show the real one and watch.                     |
| Interview kit (bar owners)                | `docs/discovery/` guide, template, target-list framework                                                                           | Good backbone with a stop criterion (3 of 5 contradict a core claim). **Never run.**                                               |
| Pricing hypotheses                        | `docs/positioning/PRICING-PLAN.md`                                                                                                 | Every figure is HYP. Includes five manual-invoice asks as the cheapest WTP test.                                                   |
| Two live studies on the calendar          | The launch fundraiser; the Oct 24 bocce client                                                                                     | Real organizers, real sponsors, real posters. Free field research if instrumented and debriefed on purpose.                        |

### 2.2 What is missing, by stakeholder

| Stakeholder        | What we know                                                             | What we do not know                                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event organizer    | Wizard and publish flow are built and journey-tested                     | Who they are in practice. Whether they want a "report" at all. What they use today. **Where they drop in the wizard**: the 7 measures contain no organizer-funnel event.                                                           |
| Local sponsor      | Placement mechanics, consent trace, flat-fee hypothesis ($10-25/mo, HYP) | Whether any pays. What proof they need. Who decides. **The pricing plan calls $200/mo "the one attested WTP point" and cites `COMPETITIVE-BRIEF:88`; that line is sales-pitch copy, not an observation.** Treat WTP as unattested. |
| Attendee           | Architecture refuses to know them                                        | Whether they notice the privacy promise, believe it, or care. Whether the QR/poster is the thing that gets them to act. This must be studied **outside** OSE (see 5.3).                                                            |
| Channel gatekeeper | Parish groupings, library systems, chambers named as channels            | Whether any gatekeeper will carry the kit, what they need to say yes, and how long it takes.                                                                                                                                       |

### 2.3 The structural constraint that shapes all methods

Never-who means the platform cannot do the usual product analytics on attendees, **by design**. That is the brand, not a defect. Three consequences for research:

- **Attendee understanding must be learned with consent, in person, off-platform.** Paper intercepts and recorded interviews, never joined to check-ins (the Oct 4 brand doc already says this).
- **Organizer and sponsor behavior is entity data and can be instrumented** (wizard steps, publish, poster printed, report opened). That does not touch the promise.
- **The strongest evidence available is behavioral and aggregate**: scans per poster, shortlink clicks by day, report reads, renewals. Pair each interview claim with the matching aggregate.

## 3. Hypotheses to falsify

Each has a kill criterion, in the style of the existing OSE-271 stop rule. "Pass" thresholds are proposals to calibrate.

| #   | Hypothesis                                                                                                      | Evidence for                                                    | Kill criterion                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| H1  | Organizers of recurring events want a sponsor-ready proof of turnout and will do setup work to get one          | They already chase sponsors or board approval for the series    | 3+ of the first 5 organizers say a headcount is enough, or never wanted sponsors              |
| H2  | At least one segment pays real money in year 1 for **reach** (a campaign across many posters), not software     | A named buyer approves a paid campaign or a paid pilot          | After 15 organizer + 8 sponsor conversations, no one names a budget line this would come from |
| H3  | Local sponsors already spend on community events and will pay a flat fee for a placement plus a report          | They sponsored something in the last 12 months, name the amount | Fewer than 2 of 5 manual invoice asks convert (the `BRAND-MARKETING-SALES` threshold)         |
| H4  | An older, volunteer-run organizer needs **no tech** to launch (kit-only)                                        | A kit-only launch with the founder absent works                 | Any first node needs more than 15 founder-hours (the brand doc's own tripwire)                |
| H5  | "Keep Facebook. Add a choice." lands better than a privacy message                                              | Higher comprehension and intent in A/B copy test                | The privacy-first line outperforms, or neither is understood in under 5 seconds               |
| H6  | "You are not tracked" is believed when stated as "counted, never identified", and not believed when over-stated | Skeptic participants repeat the claim back correctly            | More than 1 in 3 attendees read "not tracked" as "nothing is stored at all"                   |
| H7  | A venue or organizer retains for the report, not the setup                                                      | They open the report and name a decision it changed             | Reports unopened after the first event, or no decision changed after two                      |
| H8  | The "plant your flag" (OW) side is a separate demand from the OSE side                                          | Performers and organizers ask to be known                       | Named-side interest only appears inside anonymous events, never on its own                    |
| H9  | A channel partner (parish grouping, library system, chamber, league operator) multiplies reach                  | One yes produces 3+ nodes                                       | Gatekeepers want custom work or a fee per node, or the cycle exceeds the year                 |

## 4. Year-1 income and reach: what the arithmetic says

Illustrative only, built from the repo's own HYP prices. Not market data.

| Revenue line                                                    | HYP unit price                | Example year-1 count | Monthly                                   | Time to first dollar                                                                                |
| --------------------------------------------------------------- | ----------------------------- | -------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Local business sponsors, flat fee                               | $10-25/mo (`PRICING-PLAN.md`) | 20                   | $200-$500                                 | Weeks, manual invoice                                                                               |
| Mid event managers                                              | $49/mo                        | 15                   | about $735                                | Months: the plan itself says the median manager converts around day 110-120 after first live render |
| Single-event live-map unlock                                    | $19 each                      | 40                   | $760 one-time, not recurring              | Weeks                                                                                               |
| **Founder-led campaign or consulting** (Pulse, poster campaign) | not priced in repo; PO to set | 1-3                  | one engagement can exceed all lines above | Weeks                                                                                               |

Reading: the three subscription lines together are roughly $1-2k a month at 20 sponsors and 15 managers, with the first manager dollars arriving after the first quarter. A single paid campaign or consulting engagement matches that in one invoice. That is consistent with the C rating and with the October brand doc's "founder-led consulting wedge" ("Now to the first hire").

**What this implies for how to use the year:**

- Treat **reach as the product you are building** (nodes, scans per poster, direct versus Facebook-referred visits) and **services as the cash that funds it.** The spring bocce campaign (a poster campaign across a state's bocce spaces, anonymous reach map as the deliverable) is the clearest paid-reach product already scoped.
- Research must find **who has a budget for reach today**: a league operator or association (the niche-sports line), a chamber, a brewery or winery group, a parish grouping. These buyers are different from the venue owner.
- Do not set a year-1 MRR target on the subscription tiers until H3 and H7 have data. Book year-1 as "number of paid campaigns, number of nodes that tipped, number of sponsors who renewed once".

## 5. Research design

**Total: about 40 conversations plus two live studies, over 10 weeks.** That is 4 to 5 a week for a solo founder, the pace the existing kit assumes. Fieldwork starts now; the Oct 24 deploy is a hard date to build around, and production deploy is still gated on the prod Access app (OSE-1353, OSE-1415, `PRODUCTION_LIVE`).

### 5.1 Who to talk to (sample)

| Segment                               | n     | Why                                                                                                                                                     | Source                                                                                     |
| ------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Organizers of recurring events, mixed | 15    | Resolve the three-ICP conflict: 5 bar/taproom (existing kit), 5 parish/faith/civic (fest, fish fry, bingo, library program), 5 league or club operators | Target-list framework for bars; parish groupings and library systems for the rest          |
| Local sponsors who already give       | 8-10  | Test H3. Pick businesses that sponsored something in the last 12 months (insurance, credit union, realtor, brewery, orthodontist)                       | Sponsors on local league shirts, fest banners, school or club programs                     |
| Channel gatekeepers                   | 5     | Test H9. League operator, chamber director, parish grouping staff, library programming lead, one equipment or franchise company                         | Warm intros from the first organizers (snowball question)                                  |
| Attendees, recorded or intercept      | 15-20 | Test H5 and H6 outside the data plane. Mix of ages; include the 65+ Facebook-native group the brand doc targets                                         | In person at the Oct 24 event and one or two others; paper only; never tied to OSE records |
| Skeptics (privacy-concerned)          | 4-5   | The claim is for them; test whether the line holds up under a hard read                                                                                 | Snowball; one local privacy or civic-tech contact                                          |

Do **not** pay for the first 5 organizer interviews (existing guidance). Compensation is fine for the skeptic and attendee panels.

### 5.2 Methods

| Method                                      | Tests      | How it runs                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| JTBD interviews with current-solution probe | H1, H2, H4 | "Tell me about the last event you ran." Walk the whole sequence: how they promoted it, how they knew it worked, who paid, what they used. Use the existing 5-phase flow, add the parish/league/library delta in section 6.                                                     |
| Sponsor interviews                          | H3         | Last sponsorship bought: how it started, what they got, how they judged it, who decided, what they would need to see to renew. Then the "$X a month" reaction question.                                                                                                        |
| Show-the-report session                     | H3, H7     | After the first live event, sit with a sponsor and an organizer with the **real** SharedReport (not a mockup). Silent first read, then think-aloud. Note what they skip, what they ask for, what they do next.                                                                 |
| Manual invoice ask (5 asks)                 | H3         | Already specified in the brand doc: five real asks for a basic report. Fewer than 2 of 5 pay = reprice or bundle.                                                                                                                                                              |
| Concierge pilot as study                    | H1, H4, H7 | The Oct 24 client and the fundraiser are the pilots. Pre-event: record what the organizer says they want. Post-event: debrief within a week. Founder-operated admin is the right mode while client admin access is gated (OSE-1456).                                           |
| 5-second copy test (mockup only)            | H5, H6     | Show door copy on a phone mockup for 5 seconds, then ask "what does this do?" and "who sees what?". Test **three** lines head to head: "Keep Facebook. Add a choice.", "Never who. Always how many.", and a "not tracked" variant. Mockup only, to keep the reveal sequencing. |
| Claim-comprehension probe                   | H6         | Ask: "A sign says 'counted, never identified'. What do you think is saved?" then the same for "not tracked". Code the answers, not the preference.                                                                                                                             |
| Aggregate behavior pairing                  | all        | For every interview with an organizer who has run an event: pull that event's scans, link clicks by day, impression and report reads. Pair stated behavior with measured behavior.                                                                                             |
| Channel-tagged short links                  | H5, H9     | Every host's Facebook post carries a channel-tagged `/s/` link so direct versus Facebook-referred visits can be compared per node (the brand doc's saturation ratio).                                                                                                          |

### 5.3 Attendee research stays off the data plane

- Paper cards or a **separate** short link that never joins to check-ins, scans or `FORMS_DB`.
- Recorded interviews only with consent, notes anonymized at write time (discovery README).
- Publish the method on the "how we keep this promise" page; the research obeys the promise it tests.

### 5.4 Instrumentation worth adding (entity data only)

Candidates, to be ticketed only if the PO agrees. None touches attendees:

- Organizer funnel: wizard step reached, wizard abandoned at step N, publish, poster printed, first report opened.
- Sponsor funnel: sponsor-home link opened, request made, placement accepted, report opened.
- A read path for `shortlink_click_daily` in admin, floored before any export.

### 5.5 Synthesis plan

- **Affinity map** per segment, one board each for organizer, sponsor, attendee, channel.
- **JTBD statements** per segment in the participants' own words ("When ___, I want to ___, so I can ___").
- **Segment scorecard** (1-5) on: pain, existing spend, reach multiplier, time to first dollar, privacy-claim resonance, founder hours per node. Output: **one** year-1 wedge and one backup.
- **Claim decision**: keep, reword or drop each of the five candidate lines from section 5.2, with the comprehension data attached.
- Deliverable at week 10: `docs/discovery/INTERVIEWS-SYNTHESIS-YYYY-MM-DD.md` plus the recommended edit to `BEACHHEAD-ICP`. That file becomes the cited source for pricing and brand decisions, as the discovery README intends.

### 5.6 Timeline

| Weeks | Work                                                                                                                               | Output                                              |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 0-1   | Pick first 5 organizers (existing framework); book 2-3 sponsor talks; prepare Oct 24 debrief script; write the 3-line copy mockups | Sprint-1 target list; scripts below                 |
| 1-3   | 5 organizer interviews (apply the stop rule); 3-4 sponsor interviews; Oct 24 live study and attendee intercept                     | `BAR-OWNER-INTERVIEWS` batch 1; observation notes   |
| 3-5   | 10 more organizers across parish/civic and league segments; 4-5 sponsors; first show-the-report sessions                           | Segment contrasts                                   |
| 5-7   | 5 gatekeepers; 5 manual invoice asks; copy test and comprehension probe; skeptic panel                                             | H3, H5, H6, H9 data                                 |
| 7-9   | Pair interviews with aggregate behavior; second live study (fundraiser or next event)                                              | H7 data                                             |
| 10    | Synthesis, scorecard, decision memo                                                                                                | Wedge decision, claim decision, pricing implication |

## 6. Interview guides (extensions of the existing bar-owner guide)

Run the existing 5-phase flow for bars. Add these.

### 6.1 Organizer delta (parish, civic, league, club)

- "Tell me about the last event you ran, start to finish. What did you do the week before?"
- "How did you decide whether it went well?" (listen for numbers, stories, money, board approval)
- "Who else had to say yes, and what did they ask you for?"
- "Where do you tell people about it?" (probe Facebook, bulletin, newsletter, sign, word of mouth)
- "Have you ever asked a business to help pay for it? What happened?"
- "Do you keep a sign-in sheet or list? What for? Has anyone objected?"
- "If your event could hand your board one page after the night, what should be on it?" (do **not** pitch the report first)
- Wrap: "Who runs something like this that I should talk to?"

### 6.2 Sponsor guide (25-30 minutes)

1. **Open:** "Tell me about your business and how people find you."
2. **Last sponsorship:** "What is the last local thing you put money or your name behind?" "How did that start?" "What did you pay?" "What did you get?"
3. **Judgment:** "How did you know whether it was worth it?" "Who decided?" "Did you do it again? Why or why not?"
4. **Alternatives:** "What else did you consider instead (a mailer, a social ad, a banner)?"
5. **Proof:** "If you got one page after the event, what would you need on it to renew?" Show nothing yet.
6. **Reaction (once, late):** "A local event offers your name on the poster and screen for a season at $X a month, and you'd see how many people came, never who. What's your first reaction?" Listen for the first answer, not the considered one.
7. **Privacy:** "Does it matter to you that you wouldn't know who attended?" (some sponsors **want** names; that is a finding)
8. **Wrap:** "Anything I should have asked? Who else sponsors things like this?"

### 6.3 Attendee intercept (3-5 minutes, paper, off-platform)

1. "How did you hear about today's event?" (probe: Facebook, sign, friend, calendar)
2. "Have you used a QR code at an event like this before? What happened?"
3. "This sign says [line A]. What do you think it means? What do you think gets saved?" (rotate A, B, C so each participant sees one line)
4. "Would that make you more or less likely to scan?"
5. "Is there anything you'd want it to do that it doesn't?"

- No names, no emails, no joins to scans. Record the line shown and the answer code only.

### 6.4 Gatekeeper delta (league operator, chamber, parish grouping, library)

- "How do your members or sites currently promote events? Who pays?"
- "If a venue or parish in your group wanted to use this, who would you want to approve it?"
- "What would you need from us to say yes? Kit, training, a pilot, a reference?"
- "Is there a budget line for anything like this, such as a campaign across your sites or a report for your board?" (listen for H2)

## 7. What this study does **not** do

- It does not price anything. It produces WTP evidence that PRICING-PLAN can then cite.
- It does not decide the brand name. The copy test checks whether the **claim** lands, not which master name wins (trademark screens are in the brand doc and are not clearance).
- It does not replace the staging chain, the CCR loops or the Oct 24 deploy. Interviews happen around them.
- It makes no promises of an investor story; it produces the node-repeatability evidence the brand doc says should come first.

## 8. Risks to the research itself

| Risk                                                     | Mitigation                                                                                                                   |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Friendly-network bias (people who like you say yes)      | Cold walk-ins and gatekeeper-referred sponsors for at least half the sample; ask about the **last** purchase, not intentions |
| Pitching in the interview                                | Existing rule: no deck, no demo until the show-the-report session                                                            |
| Leading the privacy question                             | Ask what they think is saved before saying what is saved                                                                     |
| Founder time (the brand doc's 15-hour tripwire)          | Log hours per node and per interview; cap sprint size at 5                                                                   |
| One live event looks like proof                          | Two live studies plus the five manual asks; call a single event an anecdote                                                  |
| Over-claiming "not tracked" in the interviews themselves | Use "counted, never identified" in every script unless the item under test is the over-claim                                 |

## 9. First three actions

1. Run the existing OSE-271 batch of 5 organizers now; it is the cheapest unfinished item in this whole plan. Use the sample mix in 5.1 rather than five bars.
2. Book the Oct 24 debrief and the show-the-report session before the event, so the data is not an afterthought.
3. Decide whether the three copy lines in 5.2 may go on a mockup. That unlocks the H5/H6 test within a week.

## 10. Three showcase efforts, run separately

Added after reading the founding-corridor vision (`OCR-docs/docs/OCR_VISION.md` section 8), the free-forever thesis (`docs/cost-sustainability/FREE-FOREVER-THESIS.md`, `tier-gates.yaml`) and the Harbor County client notes (memory, 2026-09-14). The sections above treat the 40 conversations as one pool. These three are different kinds of node with different buyers, so each gets its own study, its own debrief and its own scorecard. Pooling them would hide the contrast that tells you which to repeat.

|                          | A. Founding Six corridors                                                                                                                 | B. Churches, free                                                                                                            | C. Sawyer, MI bocce                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **What it is**           | Six residential corridors in the south and southwest Chicago ring: Blue Island, Beverly, Brainerd, Evergreen Park, Oak Lawn, Mt Greenwood | Faith organizations at `forced_tier: free`, `duration: indefinite`, locked by `tier-equity.invariant.spec.ts`                | A destination venue running a bocce weekend, deployed by Oct 24; a four-day regional campaign in spring 2027 |
| **What it should prove** | The corridor and ring model: nodes saturate, sponsors cluster, the density report means something                                         | The free promise is sustainable and the church channel multiplies reach (H9)                                                 | A node can run without the founder, and a paid reach campaign across a state is sellable (H2, H4)            |
| **Evidence today**       | The doc itself says the six are "asserted from VISION, not from field data". Only 2 of 6 have a named anchor                              | Thesis is cost-side only: serving a free user costs about nothing while the runtime stays LLM-free. No parish has been asked | Config-only launch, scope confirmed 2026-09-14. A real client and real sponsors, none interviewed            |
| **Who pays**             | Local sponsors (flat fee or community-use free), Mid managers later                                                                       | Nobody, by design. Money comes from sponsors placed around parish events, and from any diocese or grouping-level report      | The client (campaign or services fee, PO to price), then partner breweries, wineries and area sites          |
| **Role in year 1**       | Reach and density: the compounding asset                                                                                                  | Reach and legitimacy: the cheapest way to 100+ parishes                                                                      | Cash and proof: the one dated, paid-reach showcase                                                           |

### A. Founding Six corridors (the map study)

- **Question:** which of the six lights up first, and why? Pick by cadence, not geography (`PRICING-PLAN.md` section C: weekly slot, 5 scans in one hour, turnover of new attendees).
- **Method:** the existing organizer and sponsor guides, run corridor by corridor. Four corridors have no anchor, so the first task there is finding one recurring event and one organizer, not selling anything.
- **Instrument:** per-corridor scans per poster-hour, shortlink clicks by day, and the Facebook-referral versus direct ratio. A corridor is saturated when direct beats Facebook for 8 straight weeks (brand doc).
- **Kill criterion:** if after 10 organizer conversations across the six, no corridor has a weekly slot with turnout that can clear K=5, the ring model is a drawing, not a market. Reconsider before adding corridor seven.
- **Separation rule:** one corridor, one `brand_id`, one scorecard. Do not average the six.

### B. Churches, free (the channel study)

- **Question:** does a parish want this, who decides, and does one yes produce more? (H4, H9)
- **What "free" changes:** it removes price from the interview. Test **effort and trust** instead: will a fest committee print a code, say the volunteer line, and read the count afterward? Measure founder hours per node (tripwire 15).
- **Open items from existing docs that research must settle first:**
  - **Regulated-advertiser policy** on a parish-hall card: who may appear, who decides, what happens if the pastor objects. Unanswered in every prior document (`ADR-INCENTIVE-SPINE` section 8).
  - **UBI tax position.** Measured, comparative delivery can turn a sponsorship gift into advertising income. Flagged since August, still needs a CPA.
  - **Faith sponsors vs faith hosts.** `faith_organization` is free as a sponsor type. Confirm that the same promise is stated, in plain words, for a church that hosts.
- **Method:** parish and grouping staff interviews (the gatekeeper delta in 6.4), one fest or fish fry as a live study with a founder-absent launch, and the attendee intercept at that event with the 65+ Facebook-native group included.
- **Honest limit:** free means this effort produces **no revenue**. Judge it only on nodes launched without the founder and on sponsors who later pay around parish events. Do not report it as an income line.
- **Separation rule:** keep church data and claims apart from bar and club data. Faith audiences are the likeliest to read "not tracked" literally (H6), so test wording here first.

### C. Sawyer, MI bocce (the showcase and the cash study)

- **Question:** can a visitor-facing node run on a poster, a display and a page while the founder is elsewhere, and will anyone pay for the reach? (H2, H4, H7)
- **It is a different node type.** Sawyer is a destination, not a residential corridor, and is not one of the six. Its audience is visitors and occupancy, not neighbors, so corridor saturation (return rate, distinct local attendees) may never apply. The brand doc already uses a different success test: founder-absent for at least one event, and occupancy-linked sponsor renewals.
- **Timing:** Oct 24 is the only dated event in all three efforts, so it is the first live study. Dependencies: production deploy is still gated on the prod Access app (OSE-1353, OSE-1415, `PRODUCTION_LIVE`), and client `/admin` access is gated (OSE-1456), so plan founder-operated admin for that day.
- **Method:** pre-event interview of the operator (what they want the report to say, what they would pay), a sponsor conversation with each partner before they go public, the show-the-report session within a week, and an intercept card at the event.
- **Instrument:** poster scans by placement, pre-event shortlink clicks by week, sponsor impressions. These feed the spring 2027 reach pitch: an anonymous reach map across the state is the deliverable.
- **Kill criterion for the campaign:** if the operator and one league or association contact name no budget for a poster campaign, the regional campaign is a favor, not a product.
- **Separation rule:** Sawyer sponsors and reports stay on their own brand tenant; object-level brand scoping is still list-level only (OSE-1080), so use one tenant per client and do not share a report link across them.

### How the three run together

| Order | Effort                 | Why this order                                                                  |
| ----- | ---------------------- | ------------------------------------------------------------------------------- |
| 1     | C, Oct 24              | Fixed date, real client, free field data. Prepare the debrief before the event. |
| 2     | A, first two corridors | Blue Island and Beverly have named anchors, so interviews can start now.        |
| 3     | B, one parish fest     | Needs the advertiser policy and tax answers first, and a fest date.             |

One decision for the PO that the research cannot make: whether year 1 is judged on **cash from C**, **nodes tipped in A**, or **parishes carried in B**. They pull the founder in different directions, and the scorecard in 5.5 should say which of the three outranks the others before the first interview.
