# SharedReport L1 Coverage Matrix — Design

> **The gating system-of-record for the one surface everything converges on.**
> This doc pins the *structure* of the L1 (API-level) coverage matrix for the
> SharedReport so that a reader — or an agent authoring the next spec — never has
> to infer "which cases must exist and why" from the code.
>
> **Layer context:** L1 in the OSE-1167 API-first layered model (owner-ratified
> 2026-09-02). L0 = invariants (free, per-PR). **L1 = this — the exhaustive
> auth + mutation matrix, run from the command line, stupid-cheap.** L2 = thin UI
> smoke. L3 = UI-deep (wizard flows + render faithfulness). This doc governs L1
> for the SharedReport only; the same shape generalizes to forms and the wizard.
>
> **Contract sources (authoritative, do not restate — cite):**
> [ADR-017](../adr/ADR-017-sharedreport-depth-enforcement.md) (depth enforcement),
> [REPORT-DEPTH.md](REPORT-DEPTH.md) (section catalog + role table),
> [SHARED-REPORT-READ-API.md](SHARED-REPORT-READ-API.md) (wire shape),
> Invariant #5 (tier equity), Invariant #9 (tenant isolation).
> **Linear:** Feature C = OSE-1172 (this matrix's engine); Epic = OSE-1167.

---

## 0. Why this exists — the proof bounds the pitch

The SharedReport is **the one place covenant, product, and revenue are literally
the same feature** ([[sharedreport-convergence-proof-licenses-pitch]]). The moment
"provably anonymous" becomes a *sold* sentence in the enterprise deck, the privacy
claim is **capped by the privacy proof**: a composition/differential leak isn't a
covenant slip, it falsifies a commercial promise three parties stand on (attendee,
enterprise, sponsor).

Therefore this matrix is **not QA overhead — it is what licenses the sentence in
the deck.** The governing rule, restated so it can't be forgotten:

> **Market exactly what the tests certify — not one inch more.**
> The strength of the privacy pitch = the strength of the privacy proof.

That rule is what makes the covenant-critical **edge** rows (§4) *mandatory and
mutation-verified*, not optional.

---

## 1. The matrix shape

```
        cells  =  profiles  ×  {happy, rainy, edge}  ×  intents
                  ─────────     ───────────────────     ───────
                  a point in    the "weather" of        what the caller
                  the 6-dim     the request             is trying to do
                  convergence
                  space
```

Three orthogonal factors, evaluated over the **six SharedReport convergence
dimensions** (§2):

- **Profile** — a fixed point in the six-dimensional space: *who is asking, with
  what token, at what tier, over what composition, against an event in what
  state.* A profile is one row of the "who/what" table (§3).
- **Weather** — the disposition of the request against that profile:
  - **happy** — a valid, entitled request → the exact, entitled payload.
  - **rainy** — an *expected* refusal → the exact status + `code`, fail-closed.
    (401 no/garbage token, 403 wrong role, 400 malformed, 404 disabled event.)
  - **edge** — a **boundary or covenant-critical** case where the honest answer
    is subtle: K-floor at exactly K, composition differential, scopeless-sponsor
    empty-set, fail-closed depth on a garbage claim. **These are the rows the
    pitch is sold on** — §4 enumerates the mandatory ones.
- **Intent** — the verb (§5): `mint`, `read`, `configure-composition`, `export`.

A **cell** is one `(profile, weather, intent)` triple and compiles to exactly one
parametrized assertion (`test.each` row, §6). The matrix is the enumeration of
cells we assert; the **build-list** (§7) is the enumeration of cells that don't
exist yet.

---

## 2. The six convergence dimensions (the axes)

Each dimension's axis values are taken from the live contract, not invented.

| # | Dimension | Axis values (from code/contract) | Authority |
|---|-----------|----------------------------------|-----------|
| 1 | **Depth** | `local` · `mid` · `premium` — additive section ladder; sponsor caps at `mid`, fail-closed `local` | REPORT-DEPTH.md §"Sections by depth"; `lib/report-depth.ts` |
| 2 | **Scope** | own-rows (sponsor + `sponsor_id`) · none (sponsor, no `sponsor_id` → **empty**, OSE-595) · all-rows (`admin`/`bar_owner`) | REPORT-DEPTH.md §"Scope isolation"; `shared-report-read.ts:108-124` |
| 3 | **Composition** | single-node · A+B (incl. B's subgroups) · C-independent · roll-up-to-parent | [[sharedreport-convergence-proof-licenses-pitch]] §Composition; `portfolio-rollup.invariant.spec.ts` |
| 4 | **Tier / flags** | free / mid / enterprise feature preset — decides which **composition powers** are on (per-node vs configurable cross-node grouping) | `@ocr/flags`; distinct vocabulary from depth (REPORT-DEPTH.md §"Three tier vocabularies") |
| 5 | **Role** | `bar_owner` · `admin` · `internal` · `sponsor` · (WKRP cross-product → fails closed at auth boundary, not a depth role) | ADR-017 §Decision.3; `VALID_MINT_ROLES` in `shared-report-read.ts:363` |
| 6 | **Stateful config** | the grouping is a **mutable object** — create → add C → move B's subgroup out → change-your-mind; earns the same indecision/wizard invariants as the event wizard | [[sharedreport-convergence-proof-licenses-pitch]] §Stateful-config |

> **Vocabulary discipline (do not collapse):** three "tier" words coexist
> deliberately — `sponsors.tier` (display priority), flag tiers (feature presets),
> report depth (viewer sections). Only `lib/report-depth.ts` may name more than
> one. A matrix cell must state *which* it means. Same trap as `corridor_map` the
> **section** vs `corridor_map` the **h3 substrate** ([[feedback-first-pass-legibility]]).

---

## 3. Profiles (the "who/what" rows)

A profile fixes dims 1–6 to concrete values. The canonical set (extend as the
composition endpoint lands):

| Profile | Role | Depth | Scope | Composition | Event state |
|---------|------|-------|-------|-------------|-------------|
| `P-local-sponsor` | sponsor | local | own-rows | single-node | post |
| `P-mid-sponsor` | sponsor | mid (capped) | own-rows | single-node | post |
| `P-sponsor-scopeless` | sponsor | (any) | **none** | single-node | post |
| `P-organizer` | bar_owner | premium | all-rows | single-node | post |
| `P-admin-xevent` | admin | premium | all-rows | roll-up | post |
| `P-internal-batch` | internal | premium | all-rows | single-node | post |
| `P-wkrp-crossproduct` | (WKRP) | — | — | — | post |
| `P-enterprise-config` | admin/config-owner | premium | all-rows | A+B+subgroups | post |
| `P-league-rollup` | admin | premium | all-rows | roll-up over weeks×teams | recurring |

**Data-maturity axis (dim-orthogonal, applied per profile) — NOT event lifecycle
state.** Verify-first correction (2026-09-08): the SR read path is **event-status-
blind** — `events.status` (`draft|ready|active|archived`) is never consulted by
the handler, and the builder is state-blind by design (ADR-017 / Invariant #5).
The section *set* is governed by **depth**, never by lifecycle. What actually
varies across an event's life is **data volume through the K=5 floor**: empty/young
→ sections present but `null`/suppressed (sub-K); mature (≥K) → published exact.
So the axis is `empty · sub-K · ≥K` (+ `status`-invariance as a born-red guard),
not `pre/live/post/ended`. Covered by
`tests/shared-report-event-state-maturity.spec.ts` (this slice).

---

## 4. The covenant-critical EDGE rows (mandatory · mutation-verified)

These are the cells the enterprise sentence is sold on. Each is **born-red**
(prove it fails when the guard is neutralized) **and** mutation-verified (Feature G
/ OSE-1186, Stryker) — because the repo is agent-authored and a `toContain`-style
assertion that can't fail certifies nothing.

| Edge | The exact claim | Where it binds today | Falsifies-the-pitch if wrong |
|------|-----------------|----------------------|------------------------------|
| **K-floor at the boundary (4 vs 5)** | A bucket with `distinct_agent_hashes < K (=5)` is **dropped before summation**, not floored on the sum. K=4 → suppressed/null; K=5 → exact count. | `shared-report-builder.ts:37,422,438-440,480,486-487`; `applyCountFloor` | "aggregate-only, never-who" — a sub-K bucket leaking = a re-identifiable individual |
| **Composition differential** | Publishing A, then A+B, must not let `(A+B) − A` re-identify B's sub-floor cells. Floor is **per published grain**, monotonic across grains (OSE-1149). | *builder floors per bucket; differential across two published compositions is the unproven frontier* | the covenant's **most plausible break** ([[covenant-composition-doctrine]]) — the JOIN is the unit of privacy, not the row |
| **Scopeless-sponsor → empty** | `sponsor` role + **no** `sponsor_id` on token → **empty set**, never "all rows". `null` scope means opposite things for admin (all) vs sponsor (none). | `shared-report-read.ts:114-116`; `sponsorScopeRequired` (OSE-595) | one scopeless token dumping every competitor's rows |
| **Depth fail-closed on garbage** | An invalid/garbage depth claim on a sponsor token resolves to **`local`**, never to the nearest valid value; sponsor can never self-grant `premium` (cap `mid`). | `resolveDepth()` (ADR-017 §Decision.3) | paid sections (map, cross-event trend) delivered free = commercial leak |
| **Two-DB non-join** | `DB` (anon vote/scan) ↔ `FORMS_DB` (identified roster) cannot be joined. "This address chose X" must not be expressible. | Invariant A-7 / two-DB isolation | the whole tourney/league severed-track model collapses |
| **Omission ≠ degradation** | Same event, lower depth = **fewer sections, identical numbers**. No rounding/delay/degrade per tier (Invariant #5). | `filterReportByDepth()` omission-only; `tier-equity.invariant.spec.ts` | tier equity violated — a lower tier gets a *different number* |

> **Rule for this table:** every row must have a *born-red proof it can fail* and
> a *mutation score covering its guard*. A green edge row with no kill = a rented
> green ([[honest-green-runnable-reconciliation]]). If the "where it binds today"
> cell says *unproven frontier*, that row is a **build-list item**, not a
> certification.

---

## 5. Intents (the verbs)

| Intent | Endpoint (from `shared-report-read.ts`) | Auth | Notes |
|--------|------------------------------------------|------|-------|
| `mint` | admin-gated mint of a signed link `event × role × depth` | ADMIN (scoped-email operator, §6) | `VALID_MINT_ROLES` = bar_owner/sponsor/admin; sponsor requires `sponsor_id` (OSE-595); non-sponsor depth ∈ {local, premium} (mid dormant) |
| `read` | `GET …/shared-report` with signed token | bearer signed link | the depth/scope gate; the bulk of the matrix |
| `configure-composition` | *(build-list — the mutable grouping object, dim 6)* | ADMIN + enterprise flag | earns wizard/indecision invariants; not yet an endpoint |
| `export` | `shared-report-export.ts` / BigQuery pipeline | ADMIN/internal | aggregate-only; K-floor already applied upstream |

---

## 6. The engine (how a cell becomes a running assertion)

**Ratified (2026-09-02 CCR):** the gating system-of-record is **code-parametrized
Vitest/Playwright `request` + `test.each`** in the **workers pool** — **not** a
Bruno/Postman collection. Bruno stays for *exploration*; it does not gate.
~70% of the matrix already exists as per-spec worker tests (§7); this is
**extend `test.each`, don't build a new harness.**

**Environment (ratified):** **ephemeral per-PR** (Miniflare/workerd preview +
per-run D1) — never shared staging. The workers pool self-provides the signing
secret, seed helpers, and a per-run D1, so the earlier "owner must set
`SHARED_REPORT_SIGNING_SECRET` on staging + seed `sp_test`" prereqs are **moot**.

**Seeding:** migrate-once harness (the k-anon-floor pattern) to seed
`sponsor_impressions` past the 0018-FK-corruption; mint tokens inline via
mint-link + `ADMIN_KEY`. No `SMOKE_RPT_*` secrets.

### ⚠️ The auth-boundary MUST-FIX (CCR 🔴 #1 — false-green risk)

Running the authZ matrix as **`key:admin` + `ADMIN_SCOPE_ALL`** *skips object-scope*
(`admin-object-scope.ts:118`) → a green that proves nothing about isolation. Every
scope/isolation cell **must** drive a **scoped-email operator**
(`headersAsEmail` + `ADMIN_BRAND_MEMBERSHIP`), never `key:admin` + `ADMIN_SCOPE_ALL`.
This is a *test-authoring discipline*, already exercised at
`admin-object-scope.invariant.spec.ts:294/:341` — the matrix must adopt it, not
reinvent it.

**Cell → assertion contract:**
```
test.each(CELLS)('$intent · $profile · $weather', async (cell) => {
  const token = await mintFor(cell.profile);        // scoped-email operator, not key:admin
  const res   = await SELF.fetch(urlFor(cell.intent, token));
  assertWire(res, cell.expect);                      // parse the emitted JSON — never toContain
});
```
Assertions **parse the emitted artifact** (SDET artifact-integrity standard,
[[sdet-artifact-integrity-standard]]) — assert on `body.upgrade.locked_sections`,
section presence/absence, `code`, and floored values; never string-match the DOM
or the raw body.

> **Wire-contract gotchas already learned (don't re-drift):** depth is section
> **omission** — there is **no top-level `body.depth`**; `upgrade` lives at
> `report.upgrade`; `corridor_map` is a **Mid** section (`headcount_trend` is the
> sole premium-only one). A dead E2E test drifted on exactly these (OSE-834). The
> handler is authoritative, CI-locked by `shared-report-read.spec.ts`.

---

## 7. Build-list (what exists vs what's net-new)

**Verify-first:** the matrix must be built on collections whose trust is already
established — a matrix over untrustworthy specs multiplies vacuity. Base trust is
established; fan out from it.

### Exists (extend into `test.each`, don't rebuild)
- Depth resolution + fail-closed + next-rung symmetry — `report-depth.spec.ts`
- Depth wiring (one gate, sponsor-guarded) — `shared-report-read.spec.ts`,
  `shared-report-read-depth-wiring.spec.ts`
- Sponsor slice isolation (OSE-1172 **slice 1, merged #466**) —
  `shared-report-sponsor-isolation.spec.ts`
- **Depth × section gating on the wire** (the dim-1 "heart": local/mid/premium
  section set + `upgrade.locked_sections`, L1 Vitest — the cheap version of the
  E2E T4f) — `shared-report-depth-section-matrix.spec.ts` (this slice)
- Data-maturity / status-invariance on the wire — `shared-report-event-state-maturity.spec.ts`
- K-anon floor (report + poster) — `shared-report-kanon-floor.spec.ts`,
  `poster-attribution-kanon-floor.spec.ts`
- Pipeline invariants (already `test.each`) — `shared-report-pipeline-invariants.spec.ts`
- Composition roll-up — `portfolio-rollup.invariant.spec.ts`
- Theft/red-team — `red-team/shared-report-theft.spec.ts`

### Net-new (the OSE-1172 remaining slices + siblings)
| Build-list item | Weather focus | Ticket |
|-----------------|---------------|--------|
| ~~Event-state axis~~ → **Data-maturity axis** (status-invariance + empty/sub-K/≥K on the read path) — ✅ `shared-report-event-state-maturity.spec.ts` | happy + edge | OSE-1172 slice (done) |
| **Forms PHASE_REQUIRED gate** (survey/email → 403 below clearance Phase 2; register ungated) — ✅ `forms-phase-required-gate.spec.ts`. *(No SharedReport intersection: forms=FORMS_DB, report=DB, severed — the earlier "× SharedReport" framing was spurious.)* | rainy + edge | OSE-1172 slice (done) |
| **Abuse cells** (429 / QR-dedup) as data-driven rows | rainy | OSE-1172 slice |
| **Missing-signing-secret HTTP path** (mint 503 / read 401) | rainy | OSE-1172 slice (optional) |
| **Composition differential** `(A+B)−A` re-id proof | **edge (covenant)** | OSE-1149 + Feature G (OSE-1186) |
| **`configure-composition`** mutable-object flow + wizard invariants | happy + edge | OSE-1173 (D, UI) + endpoint build-list |
| Mutation testing over every §4 guard (Stryker) | — | OSE-1186 (G) |

> **No silent caps:** if a build round ships only a subset of cells, `log()` /
> ticket-note exactly which weather×profile cells were deferred — a partial matrix
> that reads as "covered" is the false-green this whole layer exists to kill.

---

## 8. Open questions for the owner (governance-gated)

1. **Unit-of-publication** (OSE-1149): floor-at-published-grain + grain-monotonic
   is proposed but amends the ratified OSE-683 — needs a **Tier-2 governance CCR**
   before the composition-differential edge rows can be certified (not just
   asserted). Until then that row is a **build-list item, not a certification**.
2. **h3-base-to-customer-at-use-time** (OSE-1253 spike): whether the tier-blind
   substrate is ever surfaced to the *customer* is a separate story from depth —
   flagged so a future matrix author doesn't fold it into the depth axis.

---

_Design doc — structure only; the cells live in the specs. Part of OSE-1167
(Feature C = OSE-1172). Contract authorities cited inline; where this doc and the
handler disagree, the handler + `shared-report-read.spec.ts` win and this doc is
the drift to fix._
