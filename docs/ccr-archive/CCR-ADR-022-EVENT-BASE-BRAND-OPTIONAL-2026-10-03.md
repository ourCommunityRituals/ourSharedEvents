# ADR-022 (event is the base, brand is optional) — CCR, stopped at the human gate

**Artifact:** `docs/adr/ADR-022-event-is-the-base-brand-is-optional.md`
**Date:** 2026-10-03
**Classification:** Architecture decision, custom variable set. Three loops requested.
**Lenses:** PO, Lead Backend, Lead FE Integration, Sr Design FE, Sr Automation QA,
Sr SDET/SRE, DevOps, Dr of Security, Sr Data Scientist.
**Result:** Loop 1 **0%** (hard stop, corrected). Loop 2 **85.8%** (below 95: stopped,
surfaced to the PO). **Loop 3 not run**: the protocol does not advance below 95.

This CCR scores the **decision record**. It does not say the system is safe: the
gaps it found are open tickets, not fixed code.

## Loop summary

| Loop | Score | Key finding                                                                                               |
| ---- | ----- | --------------------------------------------------------------------------------------------------------- |
| 1    | 0%    | Three load-bearing assumptions were wrong or unstated: owner isolation, plan scope, a stale prerequisite. |
| 2    | 85.8% | After corrections, two PO decisions and one stale governance line remain. Not closable without the PO.    |
| 3    | —     | Not run.                                                                                                  |

## Loop 1 — surface pass (ADR as first drafted)

**Critical layer.** Most dangerous assumption: "no brand = the platform brand" is
safe. It is not, by itself.

| #   | Finding                                                                                                               | Lens             | Severity          | Evidence                                                                                                               | State      | Deduction               |
| --- | --------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------- |
| B1  | Environmental assumptions not verified (see F1, F3)                                                                   | Base             | —                 | —                                                                                                                      | Unverified | 15                      |
| B2  | Full surface not mapped (scans, poster placements, owner boundary)                                                    | Base             | —                 | —                                                                                                                      | Unverified | 15                      |
| B3  | Partial-fix risk: "brand optional" without owner isolation is false closure                                           | Base             | —                 | —                                                                                                                      | Partial    | 5                       |
| B4  | Chunk scope defined (the ADR and the code it cites)                                                                   | Base             | —                 | ADR References                                                                                                         | Verified   | 0                       |
| B5  | Human gate not bypassed                                                                                               | Base             | —                 | PO decisions quoted on OSE-1556                                                                                        | Verified   | 0                       |
| F2  | No owner-level isolation. Organizers sharing `root` could read and change each other's events and named registrations | Security, BE     | Security Critical | `created_by` only in a `?mine=1` filter (`handlers/events.ts:262-362`); forms read guarded by brand (`router.ts:1287`) | Unverified | 15 × 1.25 (PII) = 18.75 |
| F3  | Plan is global, so free and Mid cannot coexist                                                                        | BE, PO           | Critical          | `Scope = 'global' \| 'event'` (`packages/flags/src/types.ts:1`); `applyTier(db, tier)`                                 | Unverified | 15                      |
| F1  | OSE-1080 treated as an open prerequisite; it is Done                                                                  | QA, SDET         | High              | Linear OSE-1080 completed 2026-08-29, PR #420; `lib/admin-object-scope.ts` on `main`                                   | Unverified | 10                      |
| F4  | Map is on by omission                                                                                                 | Security, FE     | High              | `handlers/events.ts:725`; migration 0070 `DEFAULT 1`                                                                   | Unverified | 10 × 1.25 = 12.5        |
| F5  | "Codes may be owned by a brand" understated the change                                                                | BE, Data, DevOps | High              | `event_id NOT NULL` on `shortlinks`, `scans`, `poster_deployments`                                                     | Unverified | 10 × log₂(4) = 20       |
| F6  | Wizard requires a venue; core values have no place rule                                                               | FE, Design       | Medium            | OSE-1515 description                                                                                                   | Unverified | 5                       |
| F8  | "One door" out of draft; there are two                                                                                | BE               | Medium            | `handlers/events.ts:1178`, `handlers/qr-verify.ts:54,90`                                                               | Unverified | 5                       |
| F10 | Clicks and scans would be added into one number; the channel split multiplies small cells                             | Data             | Medium            | `shortlinks.clicks` counter vs `scans` rows; rule in `handlers/portfolio-rollup.ts:18-26`                              | Unverified | 5                       |

**Total deduction 126.25. Score 0%.** Hard stop.

**Conservative layer.** Worst case if shipped as drafted: the first two free
organizers admitted can read each other's registration lists.

**Recursive layer.** Earlier advice in this session (wave 4 order, OSE-1552's
blocker) rested on F1. Confidence in that advice was false.

## Corrections applied, Loop 1 → 2

- F2: ADR decision 2a added; ticket OSE-1561 (Urgent) filed; Alternative B recorded as fallback.
- F3: ADR decision 2b added; ticket OSE-1562 filed; OSE-1552 now blocked by it.
- F1: OSE-1080 blocker removed from OSE-1552; correction comments on OSE-1552 and OSE-1554.
- F4, F6, F8: ADR decision 1 rewritten (map never on by omission, place only when map on, one shared check for both doors); ticket OSE-1560 filed.
- F5: ADR decision 4 narrowed to brand-owned short links; poster codes are an undecided spike (OSE-1563).
- F10: ADR decisions 4 and 5 now say clicks and scans are never added, and each cell is floored first.
- Sponsor ids verified as generated (`generateId('sp')`, `handlers/sponsors.ts:470`); OSE-1556 updated.

## Loop 2 — pressure pass (corrected ADR)

**Critical layer.** What was assumed solved but never verified: that a free
organizer can get in at all.

| #     | Finding                                                                                                          | Lens         | Severity | Evidence                                                                                                        | State              | Deduction               |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------------ | -------- | --------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------- |
| B1–B5 | Base items                                                                                                       | Base         | —        | Each F-item above now cites code or a ticket                                                                    | Verified           | 0                       |
| P1    | No way for a free organizer to get in without a manual grant. The free case depends on a decision not made       | PO, DevOps   | High     | No `INSERT INTO admin_brand_memberships` in `src`; grants only in `docs/runbooks/RUNBOOK-DEPLOYMENT.md:252,298` | Partial (needs PO) | 5 × 1.25 = 6.25         |
| P2    | The founder is `brand_owner` of `root`; what that role may see of others' events and form data is undefined      | Security, PO | Medium   | `RUNBOOK-DEPLOYMENT.md:252-253`; no role branch in events handlers                                              | Partial (needs PO) | 2.5 × 1.25 × 1.25 = 3.9 |
| P3    | `CLAUDE.md` §3 and §4 still describe OSE-1080 as an open gap. Governance file: not editable under a standard CCR | SDET         | Medium   | `CLAUDE.md:143,190`                                                                                             | Partial            | 2.5 × 1.25 = 3.1        |
| P4    | All-day events: "time" undefined                                                                                 | PO, FE       | Low      | `lib/event-datetime.ts` supports date-only                                                                      | Partial (needs PO) | 1                       |

**Total deduction 14.25. Score 85.75%.** Below 95. Stop.

**Conservative layer.** The floor holds for the Mid case (a brand of its own is
isolated today). It does not hold for the free case until OSE-1561 lands and P1
and P2 are answered.

**Recursive layer.** 0% → 85.75% is real movement from real corrections. It is
not 95, and it is not rounded.

## Human gate — what is needed to run Loop 3

1. **P1.** How does a free organizer get in at launch: by invitation, or self-serve?
2. **P2.** What may the platform brand's owner see of other organizers' events and of their named form data?
3. **P4.** Is a date alone enough for an all-day event?
4. **P3.** Approve a governance edit to `CLAUDE.md` (elevated CCR, 5+ loops) to remove the stale OSE-1080 lines, or accept it as a carried item.

## Advice by lens

- **PO.** Launch the free case by invitation. Self-serve is a product and an abuse surface nobody has designed.
- **Dr of Security.** Admit no organizer to the platform brand before OSE-1561. Put a client like Harbor County Bocce in a brand of its own, where isolation already works.
- **Lead Backend.** Do OSE-1553 and OSE-1562 before production has data: production has zero events, so the backfill is free now and is not later.
- **Lead FE Integration / Sr Design FE.** OSE-1560 changes the wizard's first step; build it with OSE-1515, not after.
- **Sr Automation QA / Sr SDET.** OSE-1554's fixture needs two organizers in the platform brand; that case is the one that fails today.
- **DevOps.** None of wave 4 is on the path to the first production deploy (OSE-1511). Do not let it delay launch.
- **Sr Data Scientist.** Keep clicks and scans as separate measures at every level of the roll-up.

## Pre-conditions before ADR-022 can be Accepted

- [ ] PO answers P1, P2, P4.
- [ ] Loop 3 run and ≥ 95%, stable against Loop 2.
- [ ] ADR lands in its own docs PR (per `docs/adr/README.md`).
