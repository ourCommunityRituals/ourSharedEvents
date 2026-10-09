# OCR_STANDARD_declinedRegimes

| Field | Value |
|-------|-------|
| Status | Ratified |
| Ratified | 2026-09-04 (HIPAA, COPPA) · 2026-09-10 (SOPPA added) |
| Owner | Matt (founder) |
| Scope | Fleet-wide (all OCR data-contributing products) |
| Enforced by | OSE-1220 (`phaseToPool` refusal + CI gate), brain conformance |

---

## Statement

**Hospital PII (HIPAA), COPPA under-13 child data — including parental-clearance
mechanics — and SOPPA student data are declined regimes.** They are *not* tiers
the platform matures into. There is no roadmap on which any OCR product acquires
them.

A declined regime is refused, not gated. The distinction matters: a *gated*
capability is one env var or one config change away from activating; a *declined*
regime is structurally absent — no pool, no dataset, no consent-management model,
no roadmap rung.

## The three declined regimes

| Regime | Law | What it would govern | Clearance tier |
|--------|-----|----------------------|----------------|
| **HIPAA** | Health Insurance Portability and Accountability Act | Hospital/PHI data, BAA-controlled access | 4 |
| **COPPA** | Children's Online Privacy Protection Act | Under-13 child data, verifiable parental consent | 5 |
| **SOPPA** | Student Online Personal Protection Act (IL) | Student/school-held personal data | — (never modeled) |

HIPAA and COPPA retain declined **schema records** (`ocr-docs-brain/bigquery-schemas/{hipaa,coppa}.json`,
marked `"status": "declined"`) so the refusal is documented, not silently
deleted. **SOPPA is declined without ever being modeled** — there is no SOPPA
pool, dataset, or schema, and none is to be created. Declining is not modeling.

### HIPAA: hospital business is allowed; HIPAA participation is not

Declining HIPAA is **not** declining hospital business. OCR may do business in
and with hospitals and other health-adjacent venues — served in the `general`
pool by item-tracking, exactly as any other venue is. What is refused is
**participation in the HIPAA regime itself**: OCR handles no PHI, and **OCR signs
no Business Associate Agreement (BAA)**.

The consequence is a hard engagement rule: **if an engagement requires HIPAA
compliance or a BAA, there is no business** — OCR declines the engagement rather
than entering the regime. A hospital that wants item-level scan analytics with no
PHI and no BAA is a customer; a hospital that requires a BAA or PHI handling is
not. The refusal is at the point where PHI/BAA becomes required, never at the
hospital's door.

## Why item-tracking makes this safe, not limiting

A library summer-reading programme, a rec-centre youth league, and a school
activity are all servable **without entering a declined regime**, because what
OCR tracks is the **item**, never the participant. The institution holds the
card, the membership, the enrolment, and the consent. OCR holds the item's scans
by week.

A child-adjacent, health-adjacent, or student-adjacent context therefore
produces `general`-pool data: no age bracket, no consent batch, no participant
identity, no student record. The declined regime is avoided by construction, not
by policy.

## Enforcement (what makes this structural)

1. **Routing refuses.** `src/lib/pool-contract.ts` `phaseToPool()` throws
   `PoolRoutingError` on `legal_clearance_tier` 4 (HIPAA) and 5 (COPPA); the
   export boundary quarantines and skips the row (fail-closed). It never routes
   into `oureventring_hipaa` / `oureventring_coppa`.
2. **The ceiling is capped, not configurable upward.** `resolveAllowedMaxTier`
   clamps to `DECLINED_REGIME_MAX_TIER = 3`; no env value can raise OSE above
   tier 3.
3. **CI forbids re-entry.** A named gate fails the build if `ALLOWED_MAX_TIER`
   is set above 3, or if any migration seeds an event type at
   `legal_clearance_tier >= 4`.
4. **The governance layers exclude all three.** `REGULATORY_POOLS` for OSE is
   `['general']`; tests assert HIPAA, COPPA, and SOPPA appear in no active
   governance layer (pool list, dataset map, brain registry) — only as declined
   records.

## Addendum, 2026-10-08: the named pole (proposed, pending owner ratification)

> Status: **proposed**. Items 1 and 2 describe enforcement that exists in
> code. Items 3 and 4 are rules for the owner to ratify. Nothing here changes
> the three declined regimes above.

The item-tracking argument above protects OSE, which never knows who anyone
is. **It does not protect OW**, which stores a contributor's name. On the
named plane the refusal has to hold by **field absence**: OW never holds a
field one of the three regimes would govern.

1. **Brain invariant #29 `declined_regulatory_regimes`** names this standard,
   so the conformance check can see whether each product still refuses. It
   was partial on creation and went live on 2026-10-09, once
   `declined-regimes.invariant.test.ts` was green in both ourSharedEvents and
   ourWKRP.
2. **OW gate (OW-159).** `tests/security/declined-regimes.invariant.test.ts`
   fails the build if a migration, request schema or page holds any of these,
   or if code names a pool or dataset for a declined regime:
   - COPPA: an age, birth date or parental-consent field
   - SOPPA: a student, school or grade field
   - HIPAA: a patient, diagnosis or medical field
3. **SOPPA engagement rule (proposed).** OW does not run a school-directed
   deployment with student accounts. A school event served through OSE's
   anonymous model is unaffected: OSE holds the item's scans, and the school
   holds its roster.
4. **COPPA on the named plane (proposed, owner decision).** OW is a
   general-audience service. Under COPPA such a service is responsible once
   it has actual knowledge that a user is under 13. The proposal is a
   neutral 13+ age screen at sign-up ("Are you 13 or older?") that keeps no
   birth date and turns away anyone younger without storing anything. The
   legal reading is for OCR-60 (human-only).

**Open legal question (OCR-60, human-only).** OSE's anonymous cookie
(`ose_anon`) is a persistent identifier. Whether it is COPPA personal
information on an event page directed at children is a question for counsel.
OSE-680 (child-directed vertical taxonomy) was written when COPPA was a
future tier, so its "on enablement" scope predates this standard and needs
restating against it.

## Reconsideration

Removing a regime from this list is a founder decision recorded here with a
date. Until then, code and CI treat all three as refused.
