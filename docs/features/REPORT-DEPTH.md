# SharedReport Depth

> **What a report *viewer* sees, and why it's exactly that much.**
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
the `sponsor` role only. Filtering is by *omission* — never by changing a value.**

A `local` sponsor and a `premium` organizer looking at the same event see the
**same numbers**; the sponsor just sees **fewer sections**. Nothing is rounded,
delayed, or degraded for a lower tier (that would break Invariant #5, tier
equity). The client never re-filters — an under-entitled caller simply never
receives the section on the wire.

---

## Who sees what

| Viewer (token role) | Depth | How it's decided |
| --- | --- | --- |
| **Organizer** (`bar_owner`) | `premium` (full) | Always full — organizers see their own event whole. A depth claim on the token is ignored, not honoured downward. |
| **Platform** (`admin`) | `premium` (full) | Cross-event intelligence; sees all sponsor rows. |
| **In-fleet batch** (`internal`) | `premium` (full) | Anonymity-respecting service class (OSE-577). |
| **Sponsor** (`sponsor`) | `local` → capped at `mid` | Depth carried in the signed link the organizer mints. Sponsors **cannot self-grant `premium`** — the cap is `mid`, and any invalid/garbage claim **fails closed to `local`** (never to the nearest valid value). |

> The cross-product WKRP token is **not** a depth role — it fails closed at the
> handler auth boundary and never reaches depth resolution.

---

## Sections by depth (additive ladder)

Each tier is a superset of the one below. `sponsor_class_breakdown` is present at
**every** depth (OSE-719): it is class-level aggregate — the tier-neutral
competitive view — never per-competitor, so it is never a paid section.

| Section | Local | Mid | Premium |
| --- | :--: | :--: | :--: |
| `event_id` / `event_title` / dates | ● | ● | ● |
| `unique_gatherings` | ● | ● | ● |
| `sponsor_impressions` (own rows only) | ● | ● | ● |
| `sponsor_class_breakdown` | ● | ● | ● |
| `campaign_summary` | | ● | ● |
| `poster_attribution` | | ● | ● |
| `return_rate` | | ● | ● |
| `corridor_density` | | ● | ● |
| `corridor_map` (the visible map — the paid value line, OSE-682) | | ● | ● |
| `headcount_trend` (cross-event) | | | ● |

> **Free (local) stays honest, not crippled:** it keeps the smoke-test basics
> ("I was there": headcount + own logo counts). The map is the first paid line.

---

## Scope isolation (the critical path)

A sponsor sees only **their own** `sponsor_impressions` rows. This is independent
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

| Vocabulary | Values | Governs | Home |
| --- | --- | --- | --- |
| `sponsors.tier` | title…primary | **Display priority** (sort order) | never consulted for depth |
| Flag tiers | free / mid / enterprise | **Feature presets** (which capabilities are on) | `@ocr/flags` |
| **Report depth** | local / mid / premium | **What a report viewer sees** | `lib/report-depth.ts` — the only place >1 may appear |

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

| Control | Where | Status |
| --- | --- | --- |
| Sponsor slice isolation | `resolveDepth()` + read handler | live |
| Sponsor depth ceiling (cap `mid`, fail-closed `local`) | `resolveDepth()` | live |
| Mint-time depth validation | mint handler | live |
| Section field-stripping | `filterReportByDepth()` in the read handler, **sponsor role only** | live (OSE-816, ADR-017) |

**Verified by:** `tests/shared-report-read.spec.ts` (enforcement-state test —
"filterReportByDepth is WIRED in the single-read handler, sponsor-guarded", plus
the per-depth wire assertions) and `tests/report-depth.spec.ts` (lib-level
resolution, fail-closed, scope isolation, and next-rung `locked_sections`
symmetry). Both run in the T0 Gate `tests`/`node` shards on every PR.

---

## Open items (carried)

1. ~~Does commercial gating bind server-side?~~ **Resolved 2026-08-16 (ADR-017):
   yes, server-side, sponsor role only.**
2. Rename `unique_gatherings` / `sponsor_impressions` off the banned lexicon —
   both are user-facing labels and the wire keys are contract, so it must be
   coordinated across payload, clients, and demo. (OSE-815 §9.2.)
3. If depth gating is ever extended to the batch/service path, define the
   bypass explicitly rather than special-casing at the call site (OSE-577 settled
   the current class split).

> **Lexicon note:** _impressions_, _unique_, _reach_, _attendance_, _turnout_,
> _eyeballs_, _people_ are banned catalogue-wide. Report sections use _displays_,
> _scan counts_, _distinct gatherings_. See [SPONSOR-PRICING.md](SPONSOR-PRICING.md).
