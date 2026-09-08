# Sponsorship Page — Spec (DRAFT for review)

> Status: DRAFT · 2026-09-08 · owner review before any ticket is filed.
> Core principle: **configure the aperture, never the honesty.** The sponsor dials
> reach + frequency + creative + report depth; the covenant guarantees the outcome is
> aggregate, fair, and never-who. Every red line below is an _executable acceptance
> test_, not fine print — market exactly what the tests certify.

## Why this exists

The outcome engine already exists and is covenant-gated (report-depth tiers/sections;
targeting via `sponsor_event_types` + `sponsor_areas`; `allocateShares` frequency +
is_local floor; full test pyramid). What's missing is the **choice UI** that lets a
sponsor drive it, and the **organizer curation** that accepts them — without ever
crossing a covenant red line. This page is purely that surface.

## What exists today (build on, don't rebuild)

- **Admin create screen** — `admin.html`: `admin-path-sponsor`, `sponsors-card`,
  `add-sponsor-toggle`, `sponsor-create-form`, `sponsors-list` (OSE-1240).
- **Flows/routes** — CRUD `/api/v2/admin/sponsors`, `…/:id/event-types`, `…/:id/areas`,
  asset upload, draft create+promote, public resolve/bundle.
- **Draft flow is API-only** (`sponsors-draft.ts`, no screen).
- **Tests** — L0 invariants, unit, contract, integration, E2E, red-team (see repo).

## Gaps this spec closes

1. Self-serve sponsor onboarding **screen** (draft→promote has no UI).
2. Admin **available-pool curation** (accept/decline matched sponsors, not accept-by-default).
3. Sponsor-facing **config → outcome preview** ("at Mid, in these corridors, over 7 days,
   you'll get _these_ questions answered").

## Core interaction — configure the aperture

Sponsor sets a bounded set of inputs; each maps to a **guaranteed, previewed outcome**:

| Lever the sponsor sets                                           | Outcome it produces                                      | Covenant bound (the page must show as a guarantee)   |
| ---------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| **Identity** (business)                                          | appears as a named business                              | never sees attendees (#1/#7)                         |
| **Assets** per format (logo/poster/banner/vertical/square)       | creative renders **uniformly**                           | no bigger/better slot by tier (#25)                  |
| **Event-type targeting** (whole category / individual sub-types) | _scope_ — which contexts                                 | reach, not exclusivity (can't buy a type out)        |
| **Area / reach** (zip / radius / corridor)                       | _scope_ — which corridors                                | can't buy "local" — geo-earned (#2/#25)              |
| **Tier** (Local free / Mid / Premium)                            | _depth_ — which report sections + rotation **frequency** | never position/size/rank; **local floored** (#25/#5) |

### The outcome preview (the page's centerpiece)

Given (tier × targeting × 7-day window), render a **live preview** of the SharedReport
the sponsor will receive — using the real `DEPTH_SECTIONS`:

- **Local ($0):** "was I there?" — gatherings, own displays, class aggregate.
- **Mid:** + corridor map, poster→scan attribution, return rate, campaign, density.
- **Premium:** + cross-event headcount trend.
  Plus an **expected frequency-share** estimate (tier × corridor density) — transparency,
  **never a slot promise**.

## Two-sided handshake

1. **Sponsor** self-serves: identity → assets → targeting → area → tier → 402 eligibility.
2. **Organizer (admin card)** sees the **available pool** (geo/template-matched sponsors)
   and **accepts/declines** each — an explicit allowlist, replacing accept-by-default.
3. **Covenant render** — accepted sponsors appear uniformly across all selected covenant
   surfaces (poster/display/public/forms), is_local-floored, frequency-rotated.

## Money (Stripe Connect, OCR never custodies)

- Sponsor → **event manager's connected account** (direct charges); OCR takes an
  application fee only. `402 PAYMENT_REQUIRED` until eligible; price **never reaches
  `allocateShares`**. Local = free floor; **Mid/Prem fund the events.**
- Reconcile epic OSE-742 off the old merchant-of-record framing before building.

## Red lines → ACCEPTANCE TESTS (each must go red on violation)

1. **No attendee questions** — the sponsor UI exposes no mechanism to add questions to
   attendees; the report answers only in aggregate. _(guards #1/#7 / `sponsor-signal-never-who`)_
2. **No bought position/size/slot** — two configs differing only in tier produce
   byte-identical placement/geometry on every surface. _(#25 / `sponsor-share-covenant`)_
3. **No bought "local"** — setting/raising tier never flips `is_local`; only geo does.
   _(#2/#25)_
4. **Price never reaches allocation** — a paid/eligible flag never appears as an input to
   `allocateShares`. _(#25 structural)_
5. **Aggregate-only outcome** — the previewed and delivered report contains no row-level or
   attendee field at any tier. _(#7)_
6. **No exempt surface** — the config cannot produce a bought-position slot on ANY surface,
   incl. landing / Create Sponsor / Create Event / Events Map / **Forms header**.
   _(covenant self-application — no exemption)_
7. **Local floor holds** — with N sponsors of mixed tiers, local retains ≥ its floor share
   regardless of how much Mid/Prem is bought. _(#25 walls)_

## Test-pyramid plan

- **Reuse:** the L0 invariants + report-depth unit + sponsor-journey/lifecycle E2E already
  cover the engine.
- **New:** (a) config→preview contract test (preview == what the resolver+depth would
  actually deliver — property over corpora, no drift); (b) the 7 red-line tests above as a
  dedicated `sponsorship-page.redteam.spec`; (c) E2E: self-serve config → 402 → (mock
  Connect) → admin accept → renders uniformly.

## Build order (proposed)

1. Sponsor-facing config screen + live outcome preview (read-only against the existing engine).
2. Admin available-pool curation card (accept/decline; retire accept-by-default).
3. Connect buy-flow (after OSE-742 reconcile).
4. Red-line acceptance suite lands **with** each slice (born-red).
