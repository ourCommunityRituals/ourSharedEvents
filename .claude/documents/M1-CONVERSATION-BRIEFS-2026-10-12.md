# M1 conversation briefs: two asks, two written answers

Written 2026-10-12 for OSE-796 (Eagles Hall, "P") and OSE-979 (Harbor Cabins).
These are two conversations only the owner can have. Nothing here has been sent to
anyone, and nothing in it is a fact about either person beyond what the tickets say.

M1 turns green on one thing: a row in `scans` in `ocr-db-production` that is not yours,
from a poster hung at a real venue, at a real event, with `events.data_class =
'production'`. Both conversations exist to put a poster in a real place on a real date.

**The rule for both: only silence is a loss.** A date and a "no" are both wins.
A "no" is written down as a "no", not carried as "maybe".

---

## 1. Eagles Hall, "P" (OSE-796, Urgent)

**Who:** P is the floor anchor at Eagles Hall, the person the UX is built around and the
acceptance test is named after: "if P can run Eagles on Thursday without Matt, it ships."
Status has been "feeler" for four months. He has never been asked a yes or no.

**The one question:** _Will you run Eagles on a named Thursday without me there?_
Which Thursday?

**What to write down (one line, in the outcomes log):**

- a date: "P runs Eagles on Thursday <date>, without Matt", or
- "No", with his reason in his own words.

**If yes**

- The date is the ship date for the first real poster. Work back from it: event created
  as `production`, poster printed with its own deployment and QR, TV and page checked
  the day before.
- The scan that turns M1 green can be the first one at that event.

**If no**

- The ship criterion is rewritten in public, not drifted. Write the new criterion in the
  outcomes log the same day.
- Harbor Cabins (below) becomes the primary fall target.

**Ask for one more thing in the same conversation (it costs nothing extra):**
five businesses within half a mile that are not the venue. One each from: a barber or
salon, an insurance agent, a dentist or chiropractor, a pizza place, a hardware or auto
shop. Skip realtors, mortgage brokers, staffing agencies and lenders: housing, employment
and credit exposure, and they would say yes for reasons that will not generalize.
Those five names are the input to OSE-797 (C3: walk one paper sponsor card into five
corridor businesses and ask for $150).

**Do not** leave with "he seems interested". That is the outcome the ticket exists to
prevent.

---

## 2. Harbor Cabins (OSE-979, Urgent)

**Who:** the second named fall go-to-market target, in Sawyer, MI. The ticket treats
Harbor Cabins and "Sawyer, MI" as the same venue. Separately, your project notes list Harbor County Bocce as a
second client in Sawyer with a deployed version needed by 2026-10-24. **Confirm before
the conversation whether these are the same place and the same contact.** If they are,
this question is already half answered by the bocce date, and it should be asked as
"will the bocce event on 10/24 be the first event with a poster?"

**The one question:** _Will you run a real event on a named date this fall?_
Which date?

**What to write down:**

- a date: "Harbor Cabins runs <event> on <date>", or
- "No", and Eagles/P is the primary fall target.

**If yes**

- Same path as above: production event, its own poster deployment and QR, checked the
  day before.
- Say what OSE does for them in one sentence they can repeat: a poster with a QR, a page
  for the event, a count of how many people scanned. Never who.

**If no**

- Record it as "no". Do not move the date and keep the ticket open.

**What is already true for them (verified in the code this session):**

- Scans are counted as a number, floored at 5 for any published figure, with no person
  identifier on any report.
- A browser's second scan in the same hour is one scan.

**Do not** promise the production launch date. The production deploy and its gates
(Access app, founder row, `PRODUCTION_LIVE`) are tracked in OSE-1353, OSE-1415 and
OSE-1511; say "the week of the 24th" only if those are done.

---

## What happens after each answer

| Answer                | Next step                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| P: a date             | create the event as `production`, mint the poster, schedule the day-before check; M1's scan can happen there |
| P: no                 | rewrite the ship criterion in the log; Harbor Cabins becomes primary                                         |
| Harbor Cabins: a date | same as P: a date                                                                                            |
| Harbor Cabins: no     | Eagles/P stays primary; note the next candidate in the log                                                   |
| Both: no              | stop feature work and write the reason in the outcomes log first (M1's own rule)                             |
