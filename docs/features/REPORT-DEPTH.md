# SharedReport Depth

> **What a report _viewer_ sees, and why it's exactly that much.**
> Depth is the paid dimension of the SharedReport: same event, same numbers,
> more sections as the tier rises. This doc pins the contract so a reader never
> has to infer enforcement from a code comment again.
>
> Decision record: [ADR-017](../adr/ADR-017-sharedreport-depth-enforcement.md).
> Pricing context: [SPONSOR-PRICING.md](SPONSOR-PRICING.md) · Tiers overview:
> [TIERS.md](TIERS.md).

---

## The one rule

**Depth is enforced server-side, in the read handler, at exactly one point, for
the `sponsor` role only. Filtering is by _omission_ — never by changing a value.**

A `local` sponsor and a `premium` organizer looking at the same event see the
**same numbers**; the sponsor just sees **fewer sections**. Nothing is rounded,
delayed, or degraded for a lower tier (that would break Invariant #5, tier
equity). The client never re-filters — an under-entitled caller simply never
receives the section on the wire.

---

## Who sees what

| Viewer (token role)             | Depth                     | How it's decided                                                                                                                                                                                                 |
| ------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Organizer** (`bar_owner`)     | `premium` (full)          | Always full — organizers see their own event whole. A depth claim on the token is ignored, not honoured downward.                                                                                                |
| **Platform** (`admin`)          | `premium` (full)          | Cross-event intelligence; sees all sponsor rows.                                                                                                                                                                 |
| **In-fleet batch** (`internal`) | `premium` (full)          | Anonymity-respecting service class (OSE-577).                                                                                                                                                                    |
| **Sponsor** (`sponsor`)         | `local` → capped at `mid` | Depth carried in the signed link the organizer mints. Sponsors **cannot self-grant `premium`** — the cap is `mid`, and any invalid/garbage claim **fails closed to `local`** (never to the nearest valid value). |

> The cross-product WKRP token is **not** a depth role — it fails closed at the
> handler auth boundary and never reaches depth resolution.

---

## The plan caps depth (OSE-682)

Everyone gets a SharedReport (PO, 2026-08-10). The plan flag
`analytics.shared-report` is the **paid** report (the flags contract maps it to
`tier-gates.features.shared_report_interactive`). With it off, as on the Free
preset, **every signed-link viewer reads at `local`**: organizer, platform and
sponsor alike. With it on, each role reads at the depth in the table above.

- The report page loads on every plan. The old Free-plan 403 page (OSE-1206) is
  gone; it left a Free event with no report at all.
- The router reads the flag (event override first, then global) and hands the
  read handler a lookup, so the handler never reaches `FORMS_DB` itself. The
  lookup runs only after the token checks out, and it fails **closed**
  (`isPaidReportEnabled`): an unreadable forms database reads as Local, never as
  paid. (`isFeatureEnabled` fails open, which is wrong for an entitlement.)
- Staging fixtures say their plan: `evt_smoke_tiers` (T4f, paid depths) carries
  an event-level paid-report override in `forms-smoke.sql`; `plancap-evt` (T2,
  the Free cap) has none.
- `capDepthToPlan` (`lib/report-depth.ts`) only lowers depth. Sponsor scoping
  (TL-040, OSE-595) is unchanged by it.
- The in-fleet batch read (`internal`) is not capped: it is a service class,
  not a customer view.
- Until the plan is per brand (OSE-1562) the flag is one setting for the whole
  deployment. Switch it with `POST /api/v2/admin/flags/apply-tier` (key actor).

## Who × plan on every read (OSE-682, owner decisions 2026-11-04)

What the front end hides does not matter if the back end returns it, so every
read that carries report data follows the same rule: **who** asks and **what
plan** the event is on. The plan is `analytics.shared-report` (event override,
then global); every plan read fails closed.

| Read                                                                       | Platform admin (scope `all` or `ose-platform` member) | Anyone else, event on a paid plan | Anyone else, event on Free                                                       |
| -------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------- |
| `GET /api/v2/events/:id/shared-report` (signed link)                       | capped like everyone: a link is a bearer token        | the role's depth                  | Local                                                                            |
| `POST /api/v2/events/shared-reports/batch` (internal token)                | —                                                     | premium                           | Local                                                                            |
| `GET /api/v2/admin/events/:id/dashboard` (and the live view that reads it) | everything                                            | everything                        | totals; `reach.scansByDay` withheld                                              |
| `GET /api/v2/admin/events/:id/pre-event-activity`                          | everything                                            | everything                        | `reach.totals` and activity totals; per-placement, per-code and per-day withheld |
| `GET /api/v2/admin/events/:id/poster-deployments`                          | everything                                            | everything                        | placements listed; per-poster `scans` withheld                                   |
| `GET /api/v2/admin/dashboards/corridor` (brand-wide)                       | everything                                            | everything                        | `event_cells`, `source_cells`, `flows` only from paid events                     |
| `GET /sponsor?t=…` (sponsor home)                                          | —                                                     | totals                            | totals (the page never prints a per-day series)                                  |

- A capped admin response carries `plan: { paid_report: false, locked_sections, next_plan: 'mid' }`,
  naming what it left out. The admin page prints "comes with the Mid plan" for a
  withheld line, never "nothing yet".
- **Writing the plan is the platform's.** An event override is how a plan
  reaches one event, so `PUT /api/v2/admin/events/:id/flags/:key` is an
  entitlement write: a brand admin may switch a feature on only when its plan
  already includes it (`isFlagInPlan`, fails closed), and may always switch one
  off or remove an override. Anything beyond the plan answers 403
  `EVENT_FLAG_ABOVE_PLAN` and is audited; a platform admin may grant it.
  Within the plan, a brand admin's "on" follows the plan: the override is
  removed, not written, so a later downgrade reaches the event too. Only a
  platform admin's grant is a stored "on" that outlives the plan.
- A platform admin's full view of a capped read is audited (`READ_PAST_PLAN`,
  with actor, request id and the event or brand) after the handler answers,
  with its real outcome (a refused read is `denied`).
- Brand scoping is unchanged and still decides **which** events a caller
  reaches; the plan decides **how much** of each.
- Entity totals stay on every plan: event and poster counts, registrations,
  check-ins, the operations dashboard's brand totals, the portfolio rollup.
- Code: `lib/report-plan.ts` (`hasPaidReport`, `paidEventsSql`, `planNote`),
  `readReportPlan` / `isPaidReportEnabled` in `lib/feature-flags.ts`,
  `isPlatformActor` in `lib/admin-object-scope.ts`, `reportPlanFor` in `router.ts`.
- Tests: `tests/admin-reads-plan-cap.spec.ts` (workers pool, brand owner vs
  platform, Free vs Mid vs event override), `tests/report-plan.spec.ts`, and the
  batch block in `tests/shared-report-read.spec.ts`.
- Staging: the Bruno suite authenticates as a key actor, which is a platform
  admin, so on its own it cannot exercise the brand-admin cap. OSE-1800 adds a
  CI identity that is a **brand** admin: a second Cloudflare Access service token,
  accepted on staging only as `svc:<common_name>` (`auth/admin.ts`
  `serviceActorName`) when the signature verifies, the Access audience is pinned
  and carried, `WORKER_ENV` is staging and the name is listed in
  `CI_SERVICE_ACTORS`. Its scope is exactly `CI_SERVICE_ACTOR_BRAND`
  (`ci-brand`), never `all` and never the platform brand, and key-only routes
  refuse it. Folder 6 reads `ci-free-evt` with it while staging is on Free
  (`bruno/fixtures/ci-brand-seed.sql`); until the token's secrets and
  `CI_SERVICE_ACTORS` exist, those requests skip under a test named for what is
  missing. Production can never carry either setting
  (`tests/prod-admin-scope-config.spec.ts`).

## Sections by depth (additive ladder)

Each tier is a superset of the one below. `sponsor_class_breakdown` is present at
**every** depth (OSE-719): it is class-level aggregate — the tier-neutral
competitive view — never per-competitor, so it is never a paid section.

| Section                                                         | Local | Mid | Premium |
| --------------------------------------------------------------- | :---: | :-: | :-----: |
| `event_id` / `event_title` / dates                              |   ●   |  ●  |    ●    |
| `distinct_scanners`                                             |   ●   |  ●  |    ●    |
| `sponsor_displays` (own rows only)                              |   ●   |  ●  |    ●    |
| `sponsor_class_breakdown`                                       |   ●   |  ●  |    ●    |
| `campaign_summary`                                              |       |  ●  |    ●    |
| `poster_attribution`                                            |       |  ●  |    ●    |
| `return_rate`                                                   |       |  ●  |    ●    |
| `corridor_density`                                              |       |  ●  |    ●    |
| `corridor_map` (the visible map — the paid value line, OSE-682) |       |  ●  |    ●    |
| `headcount_trend` (cross-event)                                 |       |     |    ●    |

> **Free (local) stays honest, not crippled:** it keeps the smoke-test basics
> ("I was there": headcount + own logo counts). The map is the first paid line.

> **Name clash to know — the section is not the substrate.** `corridor_map`
> names two different things: (1) the **delivered report section** in the table
> above (Mid+, paid), and (2) the **h3 base-layer map** the whole report is
> _built from_ (`shared-report-builder.ts`, built **unconditionally and
> tier-blind** — it references every cell to derive `corridor_density`,
> `distinct_scanners`, and the map itself). Depth gates only (1); (2) is never
> tier-gated (Invariant #5). Reading a delivery-layer omission (no `corridor_map`
> _section_ at Local) as a statement about the base layer is a mistake — a dead
> E2E test once did exactly that and asserted the wrong contract (OSE-834).
> Whether the base layer is ever surfaced to the _customer_ at use time is a
> separate question (tracked as its own spike), not a depth decision.

---

## Scope isolation (the critical path)

A sponsor sees only **their own** `sponsor_displays` rows. This is independent
of depth and always binds server-side:

- **`sponsor` + a `sponsor_id`** on the token → filtered to that sponsor's rows.
- **`sponsor` + no `sponsor_id`** → **empty**, never "all rows". A scopeless
  sponsor token must not leak every competitor's data (OSE-595, rank-6). The
  `sponsorScopeRequired` flag exists precisely because a `null` scope means
  opposite things for `admin` (see all) and `sponsor` (see none).
- **`admin` / `bar_owner`** → all rows (cross-sponsor intelligence).

No attendee data and no competitor rows ever cross a depth line. The exposure a
depth cap governs is **commercial** (paid sections), not **privacy**.

---

## The upgrade hint (printed refusal, not hidden paywall)

When depth is below `premium`, the response carries:

```
upgrade: { locked_sections: string[], next_depth: 'mid' | 'premium' | null }
```

`locked_sections` **descriptively names** the next-rung sections that exist but
were withheld. It is load-bearing, not advisory: the client renders the locked
state **solely** from this field (OSE-817) — it never inspects the payload to
guess what's missing, and it carries no depth-decision logic of its own. A
`premium`/`admin`/`bar_owner` response has **no** `upgrade` key at all (nothing
locked). Adding a section to the server-side matrix therefore lights a locked
prompt with **no client change**.

---

## Three tier vocabularies — keep them apart

OSE has three "tier" words. They mean different things and only one module may
mix them:

| Vocabulary       | Values                  | Governs                                         | Home                                                 |
| ---------------- | ----------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| `sponsors.tier`  | title…primary           | **Display priority** (sort order)               | never consulted for depth                            |
| Flag tiers       | free / mid / enterprise | **Feature presets** (which capabilities are on) | `@ocr/flags`                                         |
| **Report depth** | local / mid / premium   | **What a report viewer sees**                   | `lib/report-depth.ts` — the only place >1 may appear |

`handlers/demo.ts` is the only translator of a fourth (the demo slug →
`/demo/free|mid|premium`).

---

## Invariant #5 (tier equity), by construction

- **Collection is tier-blind.** The scan/ingest path contains zero depth or tier
  references (enforced by `tier-equity.invariant.spec.ts §A`).
- **Filtering is omission-only.** `filterReportByDepth()` runs at read time over a
  built report; it removes whole sections and never touches a value.
- **Omission is compliant; degradation would not be.** A rounded or delayed value
  for a lower tier violates #5 even if the section is nominally present.

---

## Where it's enforced (all server-side, live)

| Control                                                | Where                                                              | Status                  |
| ------------------------------------------------------ | ------------------------------------------------------------------ | ----------------------- |
| Sponsor slice isolation                                | `resolveDepth()` + read handler                                    | live                    |
| Sponsor depth ceiling (cap `mid`, fail-closed `local`) | `resolveDepth()`                                                   | live                    |
| Mint-time depth validation                             | mint handler                                                       | live                    |
| Section field-stripping                                | `filterReportByDepth()` in the read handler, **sponsor role only** | live (OSE-816, ADR-017) |

**Verified by:** `tests/shared-report-read.spec.ts` (enforcement-state test —
"filterReportByDepth is WIRED in the single-read handler, sponsor-guarded", plus
the per-depth wire assertions) and `tests/report-depth.spec.ts` (lib-level
resolution, fail-closed, scope isolation, and next-rung `locked_sections`
symmetry). Both run in the T0 Gate `tests`/`node` shards on every PR.

---

## Open items (carried)

1. ~~Does commercial gating bind server-side?~~ **Resolved 2026-08-16 (ADR-017):
   yes, server-side, sponsor role only.**
2. Rename the two banned wire keys. **Half done, 2026-10-11 (OSE-818, owner
   decision):** `unique_gatherings` is now `distinct_scanners`, a **breaking wire
   change** (snapshot `shared-report.snapshot.json` 1.0.0 → 2.0.0). It counts
   distinct anonymous scanners, each bucket floored at 5 before summing; label
   "Distinct scanners". Payload, depth sections, report page, demo and docs
   moved together. `sponsor_displays` → `sponsor_displays` follows (OSE-931).
3. If depth gating is ever extended to the batch/service path, define the
   bypass explicitly rather than special-casing at the call site (OSE-577 settled
   the current class split).

> **Lexicon note:** _impressions_, _unique_, _reach_, _attendance_, _turnout_,
> _eyeballs_, _people_ are banned catalogue-wide. Report sections use _displays_,
> _scan counts_, _distinct scanners_. See [SPONSOR-PRICING.md](SPONSOR-PRICING.md).
