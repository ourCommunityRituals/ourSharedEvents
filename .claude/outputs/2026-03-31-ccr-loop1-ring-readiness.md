# CCR Loop 1 — NCR Ring Emergence Readiness Audit

> Method: Continuous Confidence Review against ring topology requirements
> Date: 2026-03-31
> Artifacts reviewed: migrations 0010+0011, config/corridors.js, config/ncr-regions/\*, ADR-009

---

## Problem 1: Minimum Topology (3+ node cycle)

**Requirement:** A ring = a cycle in graph theory. A ↔ B ↔ C ↔ A. Minimum 3 nodes with corridors forming a closed loop. The schema must support cycle detection — not just tree/spoke relationships.

**Finding: FAIL — Corridors are directed edges, not cycles.**

The corridors table has `origin_node_id` and `destination_node_id`. This models **directed edges** (A → B), not cycles. To detect a ring, you need to query for cycles: does a path from A through connected corridors return to A?

**Structural gaps:**

1. **No inter-community corridors exist.** The founding corridors all point from community → metro (Beverly → Chicago, Hammond → Chicago, etc.). These are **spoke patterns**, not cycles. There is no Beverly → Evergreen Park corridor, no Evergreen Park → Hammond corridor, no Hammond → Beverly corridor. You cannot form a ring from spokes to a hub.
2. **No ring detection query is possible** without node-to-node corridors at the same hierarchy level. Beverly (Zone) → Evergreen Park (Zone) → Hammond (Zone) → Beverly would be a candidate ring. None of these corridors exist in the seed data.
3. **The schema supports it** (corridors table can hold any origin→destination pair at any level), but **the seed data doesn't express it.**

**Fix required:** Add inter-community corridors between founding nodes. Beverly ↔ Evergreen Park, Evergreen Park ↔ Hammond, Beverly ↔ Bronzeville, etc. These form the candidate ring topology.

---

## Problem 2: Bidirectionality

**Requirement:** A corridor can validate unidirectionally (Beverly probes at EP events). A ring requires reciprocal flow. Some bidirectionality threshold needed. The core/periphery model: core nodes require full bidirectional, periphery nodes can connect unidirectionally.

**Finding: FAIL — No bidirectionality tracking in schema.**

The corridors table has one row per corridor with `origin_node_id` → `destination_node_id`. This is inherently **unidirectional**. To track bidirectionality, you need either:

- Two corridor rows (A→B and B→A) with separate signal data, OR
- A `directionality` field (UNIDIRECTIONAL, BIDIRECTIONAL) on the corridor, OR
- A separate signal/flow table that tracks directional counts per corridor

**Additional gap:** No `core_periphery_role` field on nodes or corridors. The core/periphery model discussed in the methodology has no schema representation.

**Fix required:** Add `directionality` field to corridors schema. Add `ring_role` to node schema (CORE, PERIPHERY, UNCLASSIFIED).

---

## Problem 3: Temporal Consistency

**Requirement:** Ring emergence must be observable across 2+ distinct time windows, ideally different seasons. Prevents declaring seasonal clusters as structural rings.

**Finding: FAIL — No temporal dimension in corridors or nodes.**

The corridors table has `created_at` and `updated_at` but no:

- `first_signal_date` / `last_signal_date` (when was this corridor first/last observed?)
- `time_windows_validated` (how many distinct seasons show signal?)
- `seasonal_pattern` (is this corridor seasonal or structural?)

The `scans` table has `scan_bucket` for temporal data, but there's no bridge between scan temporal data and corridor temporal validation. The corridor status is binary (HYPOTHESIZED → VALIDATED) with no temporal metadata about _when_ or _how consistently_ it was validated.

**Fix required:** Add temporal validation fields to corridors: `first_observed`, `last_observed`, `validation_window_count`, `seasonal_flag`.

---

## Problem 4: Coincidental Cluster (Null Hypothesis)

**Requirement:** Observed corridor cluster must be statistically distinguishable from random baseline activity between geographically proximate nodes. Needs academic partner for methodology, but the infrastructure must capture the data needed for the test.

**Finding: CONSERVATIVE — Schema captures enough for future analysis, but no baseline mechanism exists.**

The scan data (`scans`, `scan_aggregates`) provides the raw behavioral data. The `poster_deployments` table provides geographic anchoring. Combined, you can compute corridor signal strength.

**Gap:** No mechanism to compute or store baseline expected activity between nodes. This is correctly identified as a Phase 2 analytical problem, not a Phase 1 infrastructure problem. But the schema should have a place to eventually store the baseline comparison result.

**Fix: Deferred** — add `statistical_confidence` field to corridors when the analytical methodology is ready. Flag in ADR-009 as planned Phase 2 addition.

---

## Problem 5: Signal Taxonomy (Class A vs Class B)

**Requirement:** Class A (poster scan) = presence signal, cannot validate corridor alone. Class B (event attendance via QR funnel) = intentional behavior, primary validation signal. The conversion rate model (Class A pool → Class B penetration across node boundaries) is the scientific signal.

**Finding: FAIL — Signal class definitions are INVERTED in the schema.**

ADR-009 line 30 says:

> CLASS_A: High-confidence corridor with validated engagement data
> CLASS_B: Hypothesized corridor based on geographic/demographic reasoning

But the methodology discussion defines:

> Class B (event attendance via QR funnel) is the primary signal
> Class A (poster/tabletop scan) is a presence signal only

These are **opposite definitions**. In ADR-009, CLASS_A = strong, CLASS_B = weak. In the methodology, Class B = strong (intentional behavior), Class A = weak (presence only).

The seed data has all corridors as `CLASS_B` (which in the ADR means "hypothesized/weak" but in the methodology means "primary/strong"). This contradiction will cause confusion.

**Fix required:** Align signal class definitions. Either:

- Option A: Keep ADR-009 convention (A=strong, B=weak) and document clearly
- Option B: Flip to methodology convention (A=presence, B=behavioral) and update all seed data

**Recommendation:** Option B — match the methodology. CLASS_A = presence/scan signal, CLASS_B = behavioral/attendance signal. Rename the CHECK constraint values to be unambiguous: `SIGNAL_PRESENCE` and `SIGNAL_BEHAVIORAL`, or keep A/B but document clearly in the migration comment.

---

## Problem 6: Fractal Self-Similarity Verification

**Requirement:** A venue-to-venue corridor must have the exact same mathematical architecture as a metro-to-metro corridor. The ring that emerges from Beverly/EP/Oak Lawn operates on the same logic as Chicago/Milwaukee/Detroit.

**Finding: PASS — Schema is fractal.**

The `corridors` table uses the same structure at every level. A Level 1 corridor and a Level 5 corridor have identical schema. `parent_corridor_id` enables the fractal tree. The `level` field differentiates scale. Same query, any level. This is correct.

---

## Problem 7: Inter-Referencing / Self-Clarifying Engine

**Requirement:** Validated corridors redefine what their endpoint nodes mean. Discovered rings redefine what their corridors mean. Past data gets richer as present data accumulates.

**Finding: CONSERVATIVE — Schema supports it through metadata_json, but no explicit mechanism.**

The `metadata_json` field on both nodes and corridors can store evolving interpretations. But there's no explicit `interpretation_version` or `last_reinterpreted_at` field that would track when a node's meaning was updated by new corridor/ring data. This is arguably a Phase 2 analytical concern, not Phase 1 infrastructure.

**Fix: Deferred** — flag for Phase 2.

---

## Problem 8: Coverage Map Ring Readiness

**Requirement:** The 594-node US coverage map should be able to define rings at multiple hierarchy levels.

**Finding: FAIL — Coverage map nodes have no corridors between them.**

The `ncr-regions/` files define 594 nodes but zero corridors between them. These nodes exist in `config/` as seed data but have no relationship to each other. Only `config/corridors.js` defines corridors, and only for the Midwest founding communities and 6 highway corridors.

For the coverage map to support ring detection nationally, it needs corridor seed data between nodes — at minimum between Level 4 metros in the same state/territory. Otherwise the 594 nodes are isolated points on a map, not a graph.

**Fix: Phase 2** — corridors between metros will be hypothesized based on interstate highway connections, Amtrak routes, and geographic proximity. The infrastructure supports it; the seed data just needs expansion.

---

## CCR Loop 1 Summary

| Problem                    | Status          | Confidence   | Fix Priority                   |
| -------------------------- | --------------- | ------------ | ------------------------------ |
| 1. Minimum Topology        | **FAIL**        | RECURSIVE    | **P0 — Must fix now**          |
| 2. Bidirectionality        | **FAIL**        | RECURSIVE    | **P0 — Must fix now**          |
| 3. Temporal Consistency    | **FAIL**        | RECURSIVE    | **P1 — Fix in next migration** |
| 4. Null Hypothesis         | CONSERVATIVE    | CONSERVATIVE | P2 — Phase 2 analytical        |
| 5. Signal Class Inversion  | **FAIL**        | RECURSIVE    | **P0 — Must fix now**          |
| 6. Fractal Self-Similarity | PASS            | CRITICAL     | None                           |
| 7. Inter-Referencing       | CONSERVATIVE    | CONSERVATIVE | P2 — Phase 2 analytical        |
| 8. Coverage Map Corridors  | FAIL (expected) | CONSERVATIVE | P2 — Seed data expansion       |

**3 P0 fixes required before the output can define a ring:**

1. Add inter-community corridors (Beverly ↔ EP ↔ Hammond ↔ Bronzeville cycle)
2. Add directionality tracking + ring role fields
3. Resolve signal class definition inversion
