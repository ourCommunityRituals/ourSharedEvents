# ADR-028: Let a calendar app's read of a .ics address pass the edge

**Status:** Proposed. The owner decides (D1 to D3 below). No edge rule is written until then.
**Date:** 2026-11-13
**Deciders:** Owner (PO). Dr of Security advises on D1 and D2.
**Ticket:** OSE-2023 (Feature OSE-2022; found while building OSE-2013)

## Context

OSE serves two calendar addresses:

- `GET /events/:id/calendar.ics`, one event's file (OSE-1358);
- `GET /brands/:brand/calendar.ics`, a brand's public events as one feed (OSE-2013).

**What was read on stg, 2026-11-13, from a cloud container with no browser:**

| Address                               | Answer                                                 |
| ------------------------------------- | ------------------------------------------------------ |
| `/api/v2/events?brand=root`           | 200, from the Worker                                   |
| `/events/test-event-001/calendar.ics` | 403, `cf-mitigated: challenge`. The Worker did not run |
| `/brands/root/calendar.ics`           | 403, `cf-mitigated: challenge`. The Worker did not run |

The edge's managed challenge needs a browser to answer it. That has two effects.

1. **A subscription cannot load.** A person downloads the per-event file with their browser, which
   can pass a challenge. A feed is different: the calendar app itself fetches it, again and again,
   with no browser and no person. Google Calendar fetches from Google's servers; Apple Calendar and
   Outlook fetch from the person's device. None can answer a challenge.
2. **Staging tests passed without testing.** The Bruno and Playwright checks for both addresses
   accepted the challenge as a pass, so T2 and T4 could be green while nothing reached the Worker.
   That half is fixed in code (OSE-2025 to OSE-2028) and needs no decision: CI's reads carry
   `X-OCR-CI`, the stg skip rule covers `/brands/`, and a challenged read is counted and shown.

**Not checked:** production. stg shares its zone (`oursharedevents.com`) with production, so the
same products are likely on, but no read of production was made. Production is also held closed
(AGENTS.md, owner 2026-10-12), so nobody subscribes there today.

**Why the API path passes and the others do not** was not established. It is an observed fact about
the zone's rules, not a documented one.

## Decision

Proposed, for the owner:

**D1. Skip the challenge for reads of the two calendar addresses, for every caller.** One edge rule,
matching only `GET` and `HEAD` on a path that starts with `/events/` or `/brands/` and ends with
`/calendar.ics`. It skips the same products the CI skip rule skips (the managed challenge, Super Bot
Fight Mode, browser integrity check). It skips nothing else, and no other path.

**D2. The Worker's own limits are the control on those addresses.** Both routes are behind
`publicReadLimited`: 60 requests per 10 seconds and 360 per minute, per caller
(`lib/public-read-limit.ts`, `lib/edge-rate-limit.ts`). The per-event route had no limit until
2026-11-13; it was added with this ADR (`tests/public-event-calendar.spec.ts`).

**D3. Apply it to stg first, then to production when production is brought in line.** The owner
runs the command. An agent does not write edge rules (AGENTS.md, Human approval).

What makes D1 acceptable:

- The response is public data only: the public projection, the same rows the list API already
  returns unchallenged.
- Nothing is written: no scan, no click, no cookie (`tests/brand-calendar-feed.spec.ts`).
- A brand with nothing public answers like a brand that does not exist, so the feed is not a way to
  list brands.

## Alternatives Considered

### Alternative A: Leave the edge as it is

Keep the challenge on every non-browser read.

**Rejected because:** the feed then does not work for the people it was built for. A subscription is
the whole point of OSE-2013 ("followers can subscribe once"), and no calendar app can pass a
challenge.

### Alternative B: Serve the feed under `/api/v2/`

Move or mirror the feed at `/api/v2/brands/:brand/calendar.ics`, since API paths were not challenged
on stg.

**Rejected because:** it rests on a fact about the zone that nobody wrote down or decided. A later
change to the API's edge rules would break every subscription with no test to notice. It also moves
an address the owner chose, and leaves the per-event file challenged.

### Alternative C: Allow verified bots only

Skip the challenge only for callers Cloudflare lists as verified bots.

**Rejected because:** it would cover Google's fetcher at most. Apple Calendar and Outlook fetch from
the person's own device, which is not a verified bot, so most subscriptions would still fail.

### Alternative D: A signed, per-subscriber feed address

Give each subscriber their own secret address and let only those through.

**Rejected because:** it needs to know who subscribed. That is identity on the anonymous side, which
Invariant 1 ("never who") rules out, and the feed holds nothing that is not already public.

## Consequences

### Positive

- A calendar app can load the feed and the per-event file.
- The staging tests for both addresses reach the Worker, so a green T2 and T4 mean something.
- The rule is narrow: two address shapes, reads only.

### Negative

- Two public addresses lose the edge's bot protection. A script can read them as fast as the
  Worker's limit allows. The limit is per address, so a caller with many addresses can read more.
- One more edge rule in the production zone to keep in step with the code. A third calendar address
  needs the rule widened; `tests/integration/machine-read-edge-cover.test.js` fails until its probe
  and CI cover exist, but nothing checks the public rule itself.

### Neutral

- The CI skip rule and this rule are separate. The CI rule needs the `X-OCR-CI` token and covers
  more paths; this one needs no token and covers only the calendar addresses.

## Implementation Notes

Built already, and needing no decision:

- Code: `scripts/ci/edge-read.mjs`, `scripts/ci/cf-waf-stg-ci-skip.mjs` (`/brands/` added),
  `scripts/stock/edge-probe.mjs` (both calendar addresses probed).
- CI gate: `tests/integration/machine-read-edge-cover.test.js`.
- Switch: repository variable `CALENDAR_EDGE_STRICT`. The owner sets it to `1` once a read of both
  addresses passes the edge. From then a challenged calendar read fails T2 and T4.
- Runbook: `docs/runbooks/RUNBOOK-STG-CI-SKIP-RULE.md`.
- Rate limit on `GET /events/:id/calendar.ics` (`publicReadLimited('event-calendar', …)` in
  `workers/oursharedevents/src/router.ts`).

Not built, waiting on D1 to D3:

- The public rule itself, as a script the owner runs (dry run by default, in the manner of
  `cf-waf-stg-ci-skip.mjs`).
- A probe shape with no headers at all for the two calendar addresses, which is what a calendar app
  sends. Today's `plain` shape already reads them; it is not part of the verdict until D1 is applied.

## References

- OSE-2022 (feature), OSE-2023 (this decision), OSE-2013 (the feed), OSE-1358 (the per-event file).
- OSE-939 and OSE-1812: the CI skip rule. OSE-1377: the Cloudflare One posture review for stg.
- OSE ADR-024 (the `ose_anon` cookie): the feed sets no cookie, so it is outside that ruling.

## Revisit Criteria

- A third machine-read address is added (another feed, a webhook, an RSS file).
- The zone's plan or bot products change, so what the rule skips no longer matches what challenges.
- Abuse of either address shows in the rate-limit stats (`/api/v2/admin/security/rate-limit-stats`).
- Production is activated: confirm the rule is on production before a feed address is published.
