# ADR-015 — Invariant #2 retires the tier sort and named-slot filter (governance)

- **Status:** Accepted
- **Date:** 2026-08-19
- **Deciders:** PO / invariant owner — Matt (Invariant #2 carries no separate `owner` field, so per X-7 the PO decides)
- **Linear:** OSE-839 (X-7) · relates OSE-835 (WALL-3b), OSE-878/879 (display de-tier), OSE-864 (poster de-tier)
- **Invariants touched:** #2 `hyperlocal_geo_resolution` (live), governed by #25 `sponsor_share_covenant` (live); sources #5 `tier_equity`, #16 `api_response_schema_stability`

## Context

Invariant **#2** (`hyperlocal_geo_resolution`, `status: live`) still instructed every
implementer, in its `enforces` block and `enforcement_statement (a)`, to build:

- a **tier sort** — `title > platinum > gold > silver > bronze > primary`, and
- a **per-surface named-slot filter** — `display→tvTop|tvSide`, `poster→posterTop`,
  `public→mobileBanner`, `sharedReport→all`.

Both rules are **retired** by two other live invariants:

- **#5** (`tier_equity`) — _"the locals-first tierSort is RETIRED."_
- **#25** (`sponsor_share_covenant`) — _"the named-slot filter is retired… The locals-first
  tierSort of #5 is RETIRED and superseded by this share model on every rotation surface."_

So the constitution gave a front-end engineer **two contradictory instructions** per
sponsor strip. The runtime already does the right thing (`buildSponsorBundle` assigns the
same uniform frequency-share rotation to every surface key), but the written invariant
disagreed with the code and with #25 — and that paper contradiction blocked the display
de-tier (OSE-878) from merging.

Amending a `status: live` invariant is a **governance act**, not a routine code change,
so it is recorded here.

## Decision

**Option (a):** strike the retired tier-sort and named-slot mandate from Invariant #2, and
cite **#25** as the governing rotation rule. Specifically:

1. **Brain** (`ocr-docs-brain/architectural-invariants.yaml`, #2): remove the tier-sort +
   named-slot from `enforces` and `enforcement_statement (a)`; add an explicit **RETIRED**
   note naming both and citing #5/#25. #2 now scopes _which_ sponsors resolve to a corridor
   — never their order, size, or slot. (OCR-docs PR.)
2. **Test** (`tests/e2e/0-architecture/geo-resolution.invariant.spec.ts`): **invert** the
   stale `sponsors are returned sorted by tier priority` case (§3) into an **affirmative
   guard** — reconstruct the order a tier sort _would_ produce and assert the live response
   is **not** that order. Correct the file header. (This ADR's repo.)
3. **Resolver** (`workers/oursharedevents/src/lib/sponsor-resolver.ts`): comment the
   `posterTop/tvTop/tvSide/mobileBanner` keys as retained for response-schema stability
   under **#16**, explicitly **not** as purchasable slots.

Rejected alternatives:

- **(b)** Downgrade #25 to preserve #2 — rejected on its face; #25 is the covenant.
- **(c)** Mark #2 `status: partial` and defer — leaves the contradiction live in a document
  engineers are told to obey.

Secondary decision (same owner): the stale tier-sort case is **inverted**, not deleted, so a
live affirmative guard proves the retired sort stays retired on the API-order side (WALL-3b
covers the CSS side).

## Consequences

- The constitution gives **one** instruction per sponsor strip; #2 and #25 no longer conflict.
- **OSE-878** (display de-tier) is unblocked — its "held until X-7" gate is cleared.
- The `surface_sponsors` response keys survive as **schema** (#16), so no API consumer breaks.
- Reintroducing a tier sort in the resolver now **detonates** the inverted guard, and
  reintroducing tier-keyed CSS detonates WALL-3b (OSE-835) — the retirement is enforced on
  both the order side and the render side.
