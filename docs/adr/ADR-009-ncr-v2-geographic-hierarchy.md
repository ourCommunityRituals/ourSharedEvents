# ADR-009: NCR v2 Geographic Hierarchy & Corridor Model

**Status:** ACCEPTED
**Date:** 2026-03-30
**Deciders:** Product Owner, Lead Backend Architect

> **Supersession-of-routing note (2026-09-10, OSE-1285).** The **COPPA/HIPAA
> growth-wave on-ramps** in this ADR — the "Growth Sequence (Event Verticals)"
> table (Wave 2 "RESTRICTED (COPPA) — Next", Wave 3 "REGULATED (HIPAA) —
> Post-legal") and the Consequences line "Legal clearance tiers gate event
> verticals: OPEN → RESTRICTED (COPPA) → REGULATED (HIPAA)" — are **superseded by
> [ADR-018](ADR-018-declined-regulatory-regimes.md)**. HIPAA and COPPA are _not_
> future waves OSE activates; they are _declined regimes_ (refuse, not route).
> Youth-/health-adjacent verticals are served in the `general` pool via
> item-tracking, with the tier ceiling clamped to 3. **The NCR v2 hierarchy and
> corridor model — the actual subject of this ADR — are unchanged and stand.**
> Only the regulatory framing of the growth waves is superseded.

---

## Context

The platform's NCR (Neighborhood Community Rituals) methodology required a formalized geographic hierarchy to support corridor-based expansion beyond the founding Chicago-area communities. The original NCR approach described 3 phases (Event Automation → Pattern Recognition → Geo-Spatial Intelligence) but lacked a structured node hierarchy for multi-level geographic reasoning.

NCR v2 introduces a 7-level hierarchy that enables the platform to reason about community engagement at every scale — from a single venue cluster to the full national network.

## Decision

Adopt a 7-level geographic node hierarchy with corridor connections:

| Level | Label     | Example                                                   |
| ----- | --------- | --------------------------------------------------------- |
| 1     | Community | Single venue cluster, neighborhood block                  |
| 2     | District  | Multi-block area, ward-level                              |
| 3     | Zone      | Named neighborhood (Beverly, Bronzeville, Evergreen Park) |
| 4     | Metro     | City (Chicago, Detroit, Milwaukee)                        |
| 5     | Region    | Multi-city corridor (Chicago→Detroit via I-94)            |
| 6     | Territory | State/multi-state (Great Lakes)                           |
| 7     | Network   | Full platform network                                     |

Corridors connect nodes (primarily Level 4+ metros) with signal taxonomy:

- **SIGNAL_PRESENCE** (legacy CLASS_A): Poster/tabletop scan. Proves proximity to a node but NOT corridor crossing. Cannot validate a corridor alone. Useful as denominator — establishes the pre-event population pool at a node.
- **SIGNAL_BEHAVIORAL** (legacy CLASS_B): Event attendance via QR funnel. Proves intentional behavior — someone chose to attend an event at a specific community. Primary signal for corridor validation. Conversion rate (PRESENCE pool → BEHAVIORAL crossings) measures corridor strength.

Corridor status lifecycle: `HYPOTHESIZED` → `VALIDATED`

Corridor directionality:

- **UNIDIRECTIONAL**: Signal observed in one direction only (A→B but not B→A). Sufficient for corridor validation. NOT sufficient for ring membership.
- **BIDIRECTIONAL**: Signal observed in both directions. Required for core ring nodes.
- **UNKNOWN**: Not yet measured.

The `separation_blur_index` (0.0–1.0) quantifies boundary clarity between connected nodes.

### Ring Emergence — Phase 2 Analytical Problem

Ring emergence criteria are treated as a Phase 2 analytical problem, intentionally deferred until sufficient corridor data exists to fit an appropriate cluster-hybrid model. Pre-registering arbitrary thresholds before data collection would impose theoretical structure on what is designed to be an empirically-derived geographic finding. The NCR infrastructure is built to capture the data that will eventually make the analytical model possible — not to predict its conclusions in advance.

**Minimum topology:** 3+ nodes in a cycle (A ↔ B ↔ C ↔ A). Spokes to a hub are corridors, not rings.

**Core/periphery model:** Core nodes require full bidirectional flow to each other. Periphery nodes connect to the ring unidirectionally (e.g., SW Michigan seasonal connection to Beverly/EP/Hammond core).

**Temporal requirement:** Ring must be observable across 2+ distinct time windows (different seasons) to rule out seasonality.

**Statistical validation:** Deferred to academic partner. The infrastructure captures the data needed for null hypothesis testing.

### Corridor Growth Model — Spiderweb, Fractal, Reverb

Corridors are not static point-to-point lines. They are living structures that grow organically as events activate nodes along routes:

**SPIDERWEB** — Highway corridors branch into sub-corridors at every intermediate point. I-94 East doesn't just connect Chicago→Detroit — it spawns community corridors at every exit, every town, every school gym, dance studio, and park along the route. Each sub-corridor can itself spiderweb further.

**FRACTAL** — The branching pattern is self-similar at every hierarchy level. A Level 5 highway corridor spawns Level 4 metro corridors, which spawn Level 3 zone corridors, which spawn Level 1 community corridors. The pattern repeats infinitely — the same structure at every scale.

**REVERB** — Signal travels both directions through corridors and amplifies over time. A bocce tournament in Beverly generates awareness and attendance from Evergreen Park and Hammond. That signal doesn't decay — it compounds as more events activate more nodes. Reverb is what turns isolated events into community rituals.

```
SPIDERWEB (I-94 East):
  Chicago ──┬── Michigan City ──┬── Benton Harbor ── Detroit
            ├── Gary            ├── Kalamazoo
            ├── Hammond*        ├── Ann Arbor
            └── ...             └── ...
            (* = founding corridor, already active)

FRACTAL (same pattern, every scale):
  Level 5: Chicago ════════════ Detroit          (highway corridor)
  Level 4:    ├── South Side ──── Hammond        (metro corridors)
  Level 3:    │     ├── Beverly                  (zone corridors)
  Level 1:    │     │     ├── school gym         (community corridors)
              │     │     ├── dance studio
              │     │     └── park pavilion
              │     ├── Bronzeville
              │     └── Evergreen Park
              └── ...

REVERB:
  Beverly event → signal reaches Evergreen Park → reaches Hammond
  Hammond event → signal reaches Beverly → reaches Bronzeville
  Signal compounds, never decays. Corridor strengthens with each cycle.
```

### Growth Sequence (Event Verticals)

Nodes activate through successive waves of event types:

| Wave | Verticals                                 | Legal Tier         | Timeline   |
| ---- | ----------------------------------------- | ------------------ | ---------- |
| 1    | Sports, dance, gymnastics, rec leagues    | OPEN               | Now        |
| 2    | School-funded gatherings, youth events    | RESTRICTED (COPPA) | Next       |
| 3    | Museums, art institutes, school functions | REGULATED (HIPAA)  | Post-legal |
| 4    | Every public/private event along routes   | OPEN               | Scale      |

Wave 4 is where corridors span into countryside — where people actually live. The route towns between metros (Kalamazoo, Rockford, Bloomington-Normal, Lafayette) are not just waypoints. They're communities with their own event ecosystems waiting to activate.

## Consequences

- D1 migration `0010_create_ncr_v2_hierarchy.sql` implements `node_hierarchy` and `corridors` tables
- D1 migration `0011_corridor_growth_model.sql` adds `parent_corridor_id`, `growth_pattern`, `reverb_strength`, `event_verticals`, `legal_clearance_tier`
- All geographic seed data (founding communities + highway corridors) follows this schema
- Founding corridors are children of highway corridors (e.g., Hammond and SW Michigan are children of I-94 East)
- SharedReport BI wing can query by hierarchy level for multi-scale analytics
- ABC partnership strategy aligns with corridor-level (Level 5) engagement tracking
- Legal clearance tiers gate event verticals: OPEN → RESTRICTED (COPPA) → REGULATED (HIPAA)

## References

Confirmed as architectural foundation for SharedReport BI wing and ABC partnership strategy. See ABC-Partnership-Strategy.docx.

## Cross-References

- [ADR-010](ADR-010-templates-breadth-tiers-depth.md) — **axis cross-reference (OSE-1293 / F5):** ADR-010's "templates never gate" and this ADR's "legal clearance gates verticals" are **different axes, not a contradiction**. Templates = breadth (never gated); feature-tiers = depth (gated in ADR-010); legal clearance = which verticals are served at all (gated here, and refined by [ADR-018](ADR-018-declined-regulatory-regimes.md) — declined regimes refuse, not route).
- [NCR-METHODOLOGY.md](../features/NCR-METHODOLOGY.md) — NCR methodology and data pipeline
- [VISION.md](../features/VISION.md) — Platform vision and NCR horizon
- Migration: `workers/oursharedevents/migrations/0010_create_ncr_v2_hierarchy.sql` (base schema)
- Migration: `workers/oursharedevents/migrations/0011_corridor_growth_model.sql` (growth patterns)
- Config: `config/corridors.js` (seed data + growth constants)
