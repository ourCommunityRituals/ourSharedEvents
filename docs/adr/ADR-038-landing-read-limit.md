# ADR-038: Limit the landing and the event list by the minute, and answer a refused reader with a page

**Status:** Proposed. Built as written here; the owner ratifies it by merging the pull request.
**Date:** 2026-11-16
**Deciders:** Owner (PO). Dr of Security owns the threshold, the gate and the invariant 3 wording.
**Ticket:** OSE-1986 (decided as its own story in OSE ADR-027, D7)

## Context

`/` and `/events` were public pages with no limit. Each request to `/` reads up to 1000 event rows,
the latches, the sponsor titles and the event-type catalog from D1, and asks the street-map bucket.
`?area=<res-7 cell>` and a searched place let a caller look events up area by area, which is the
reason OSE-1247 gave for limiting `/api/v2/events/map`. `docs/security/ROUTE_CLASSIFICATION_POLICY.md`
has listed rate limiting as a required control on both pages since before the map existed. The
threat ledger carries it as TL-100.

Staging's street switch is on (owner, 2026-11-15). The day an archive is loaded, every request to
`/` becomes an R2 read and a draw as well.

Three things made this more than one line in the router:

1. **The refusal.** `publicReadLimitResponse` answers JSON. That is right for an API and wrong for
   a person who opened a page.
2. **A venue's Wi-Fi.** The edge layer allows 60 requests in 10 seconds for each address
   (`lib/edge-rate-limit.ts`). A room of people behind one address opening the landing at a door
   would be refused at the 61st.
3. **Invariant 3's wording.** AGENTS.md says "no `CF-IP*` header is read". The limiter reads
   `CF-Connecting-IP` as a bucket key. The gates already allow exactly that
   (`tests/poster-deployments-h3-tagging.spec.ts`, `tests/log-never-who.spec.ts`), and the
   sentence does not say so.

## Decision

**D1. One wrapper for pages.** `publicPageLimited(scope, handler, refused)` in
`lib/public-read-limit.ts`. It applies the same count as `publicReadLimited` and the same
fail-open rule. The caller supplies the refusal, so a page answers a page.

**D2. What is behind it.** `/` and its aliases `/home`, `/welcome`, `/landing`, `/about` and
`/info`, and the landing under each language prefix, share the scope `landing`. `/events`, with and
without a prefix, has the scope `events-page`. A prefix is not a second allowance, and the landing
and the list do not spend each other.

**D3. The number: 600 loads a minute for each caller, and no 10-second layer.**
`PUBLIC_PAGE_MAX = 600`. `isPublicReadLimited` already skips the edge layer for any limit above
the API's 360, so a page is counted by the minute only. Six hundred is ten loads a second held for
a whole minute from one address: a full room at a door passes, and a script walking every area
does not get far (a metro is about 2,800 cells).

**D4. The refusal is a page.** Status 429, HTML, one `<h1>`, in the language the page itself would
have used: the path's prefix when there is one, otherwise `Accept-Language` (with
`Vary: Accept-Language`). Arabic is written right to left. It says "Please wait", not "Error 429".
It carries `Retry-After: 60` and `Cache-Control: no-store`, sets no cookie, and its "Try again"
link goes to the page's own address with nothing from the request's query in it.

**D5. A gate over every page address.** `tests/public-page-limit-gate.spec.ts` asks the real router
for every address in `tests/helpers/page-surfaces.ts` (held equal to the route table since OSE
ADR-031) from an address nobody else has used, and checks whether the router counted that caller.
An address must be limited or be in `tests/helpers/unlimited-pages.ts` with a reason. An address
on that list that is in fact limited fails too.

**D6. Invariant 3, said plainly.** `CF-Connecting-IP` is read in one place for one use: as the key
of a rate-limit bucket. It is hashed before it reaches KV, kept by the edge binding in memory for
one window, never written to the database and never logged. It is not used to place anyone:
nothing about where a reader is comes from it. This ADR is the written exception. AGENTS.md is
not changed here, because a change to it needs a five-loop review with the owner at each loop;
the sentence to add there is "except `CF-Connecting-IP` as a rate-limit bucket key (OSE ADR-038)".

**D7. The other pages that read data (OSE-2086, added 2026-11-16).** The gate in D5 found 23 more
page addresses served with no limit. They are now behind the same wrapper and the same number, 600
loads a minute for each caller, with one allowance for each kind of page:

| Scope          | Addresses                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------- |
| `event-page`   | `/events/<id>`, `/events/<id>/<name>`, and both under a language prefix                       |
| `form-page`    | `/events/<id>/register`, `/checkin`, `/survey`, `/updates` (GET), prefixed too; `/forms/<id>` |
| `display-page` | `/display`, `/tv`, `/kiosk`, `/screen`, `/events/<id>/tv`                                     |
| `poster-page`  | `/poster`, `/posters`, `/flyers`, `/tabletop`, `/tent`, `/signage`, `/events/<id>/poster`     |
| `report-page`  | `/sharedReport`, `/report`, `/analytics`, `/reports`, `/insights`, `/stats` (the shell)       |
| `health`       | `/health`, `/api/status`                                                                      |

A poster link, a TV and a door. The story asked that these are never refused, by counting without
refusing or by choosing a number and writing it down. The number is chosen: 600. Counting without
refusing (`publicCountLimited`) fits a link that writes a count; these pages write nothing, so
there would be nothing to stop and the limit would do nothing. Six hundred a minute is ten loads a
second from one address for a whole minute, with no 10-second layer, which a room of phones at a
door or a wall of TVs does not reach. The poster links people scan (`/q/`, `/e/`) still never
refuse. The owner can change the number for one scope without changing the others.

A refused reader gets the wait page of D4 with a link back to the page they asked for: the path
only, never the query, so a SharedReport token is not written into it.

`/health` answers a machine, so past the limit it gets the API's JSON 429, on the page number so a
monitor and a deploy check behind one address are not refused. `/robots.txt` takes the API's
public-read default, as `/sitemap.xml` does.

No page address is on the known-gap list after this.

## Alternatives Considered

### Alternative A: The API's limit and the 10-second layer, as they are

Wrap the pages in `publicReadLimited` unchanged: 60 in 10 seconds, 360 a minute.

**Rejected because:** a venue behind one address is refused at the 61st phone inside 10 seconds.
The people most likely to open the landing together are the people standing at an event.

### Alternative B: Count without refusing, as `/q` does

`publicCountLimited` never answers 429; past the limit it stops counting.

**Rejected because:** nothing is counted on the landing. The limit exists to stop the read, and a
limit that never refuses stops nothing.

### Alternative C: Raise the edge binding's limit for pages

A second `ratelimits` binding with a higher 10-second limit.

**Rejected because:** it is a deploy-time binding in three environment blocks for one number, and
the measured behaviour of the binding on staging (about 500 reads let through before its first
refusal, `lib/edge-rate-limit.ts`) does not give the precision the number would claim. It stays an
option if the minute count proves too slow.

### Alternative D: A gate that reads the router's text

Find each route block in `src/router.ts` and look for a limiter call in it.

**Rejected because:** a first cut misread several routes (it missed the form routes' limiter and
could credit a route with its neighbour's). Asking the router and watching for the count cannot be
fooled by how the code is laid out.

## Consequences

### Positive

- The landing and the list can no longer be read without bound from one address.
- A refused person gets a page they can read, in their language.
- A new public page cannot ship without a limit or a written reason.
- The gate found 23 page addresses that read data with no limit. They were listed with a ticket
  (OSE-2086) instead of being unknown, and D7 limits them.

### Negative

- **A flood can run past 600 before it is refused.** The minute count lives in KV, which is
  eventually consistent. The 10-second layer that would catch a burst sooner is the one given up
  for venues.
- **The limit is per address, and an IPv6 caller has many.** The key is the whole address
  (street-map review, finding R37). Not changed here.
- **A very large venue behind one address can be refused.** More than 600 loads in a minute from
  one address gets the wait page. The number is the owner's to change.
- **The limit does not make a served request cheaper.** The landing still reads and draws on every
  request it serves. The stored copy of the drawn layer (finding R5) is still open.
- Callers with no Cloudflare address (direct calls in tests) share one bucket, as on every limited
  read.

### Neutral

- The gate covers page addresses. Addresses under `/api/` are not in it; their limit shows at each
  call site in the router.
- The Polish and Arabic text of the wait page was written with the catalog's other text and has
  not had a native reader's pass.

## Implementation Notes

- Code: `workers/oursharedevents/src/lib/public-read-limit.ts` (`PUBLIC_PAGE_MAX`,
  `publicPageLimited`), `src/handlers/pages.ts` (`pageLimitResponse`; `renderErrorPage` takes a
  language), `src/router.ts`, `src/lib/i18n/catalog*.ts` (`limit.*`).
- Tests: `tests/landing-read-limit.spec.ts`, `tests/public-page-limit-gate.spec.ts`,
  `tests/helpers/unlimited-pages.ts` (workers pool); the Bruno case "GET / (landing) - served, not
  the wait page" on staging.

## References

- OSE-1986 (this story), OSE-2086 (the pages that were still without a limit; D7), OSE-1247 (the first public
  read limit), OSE-1509 (the edge layer).
- OSE ADR-027 D7 (why this is its own story), OSE ADR-031 (the page list held to the route table).
- Threat ledger TL-100. Street-map review 2026-11-15, findings R5 and R37.

## Revisit Criteria

- A real venue is refused, or the rate-limit stats show the minute count is too slow for a flood.
- The drawn street layer gets a stored copy, which changes what a request costs.
- AGENTS.md invariant 3 is next reviewed: add the sentence in D6.
