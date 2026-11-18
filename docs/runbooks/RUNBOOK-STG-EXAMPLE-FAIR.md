# Runbook: the example fair on staging (OSE-2009)

One made-up fair with twelve stalls on stg.oursharedevents.com, so the stall list
(`/events/:id/booths`), the stall pages (`/events/:id/booths/:number`) and the
"See the stalls" link on the event page can be shown to a person.

Everything in it is invented: the fair ("Lantern Row Craft Fair"), its hall, and
the twelve trading names. No real fair, business, person or address. The fixture
is `scripts/ci/example-fair.json`; a unit test refuses it if any text looks like
an email address, a phone number or a web address. It has no sponsors.

## Load it

Actions, **Example fair (stg)**, **Run workflow** on `main`:

- `action`: `load`
- `state`:
  - `draft` (the default, the ticket's words): the fair is on stg but not public.
    The event page, the stall list and the stall pages all answer 404, by design.
  - `open-by-link`: the fair is live (`active`) but off the map
    (`is_published` false). The three pages open for whoever has the address; no
    list, map or search shows it, and the pages send `noindex`.

Or from a terminal with the GitHub CLI:

```bash
gh workflow run stg-example-fair.yml --ref main -f action=load -f state=open-by-link
```

The run summary gives the event id and the three addresses to open: the event
page, the stall list and stall A1. It then reads them back and shows a pass or
fail line for each (the status, the "See the stalls" link, 12 rows in 4 groups,
the stall's name, `noindex`, and that neither `/events` nor the public events
list shows it).

Running it again is safe. It finds the fair by its slug
(`example-fair-lantern-row`) and brings it back to the fixture: same id, the
same twelve stalls, nothing new. Running it with the other state moves the same
fair between draft and open-by-link (through `ready`, as the state machine asks).

## Remove it

Run the workflow with `action`: `remove`. It deletes the fair and, through the
delete route's cascade, its stalls and the event's own derived rows (a short
link or code, if one was made). If anyone scanned it,
the delete route refuses (409, by design) and the fair is archived instead,
which takes it off every public page; the summary says which happened. With no
fair there, it removes nothing and says so.

## What it touches, and what it does not

- One event, root brand, labelled `data_class` `synthetic`, made by the admin
  key. The dashboards leave synthetic rows out by default; public pages do not
  filter on the label, so the pages above show it when it is open-by-link.
- It acts only on the event with the fixture's slug that carries all its marks
  (root brand, synthetic, an automation creator). If any other event holds the
  slug, the run stops and changes nothing.
- The daily stock load deletes only rows its manifest names, so it never touches
  the fair. The fair has no address, zip or map position, and none of its text
  matches the stock searches, so it cannot move a stock total.
- The cleanup in the language spec (PR #1423) archives only events with its
  own slugs (`language-prefix-`, `language-pairwise-`, `language-forms-`), so
  it never touches the fair. The nightly lifecycle sweep deletes only events
  titled "Nightly lifecycle check".
- A draft is archived by the nightly draft expiry only once its date has
  passed and it has gone 30 days unchanged. The fair is dated 2027-09-18.

## When the date passes

The fixture's date is 2027-09-18. After it, an open-by-link fair's event page
shows the post-event view (the stall link and pages still open); a draft fair
is archived 30 days after its last change. To keep showing it as upcoming,
move `start_date` forward in `scripts/ci/example-fair.json` and run `load`
again: the same fair is updated in place. A load after the date prints a warning.

## Secrets and limits

The job uses the repository secrets the nightly event lifecycle and the T2 Bruno
run already use: `ADMIN_KEY`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`
and `OCR_CI_EDGE_TOKEN`. No new secret and no Cloudflare API token. It runs only
from `main`, only by hand, in the `stg-writer` queue (one stg writer at a time),
and refuses production before it sends anything. It prints the event id, the
addresses and counts, never a header, token or cookie.
