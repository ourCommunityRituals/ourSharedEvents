# ADR-009: NCR v2 Geographic Hierarchy & Corridor Model

**Status:** ACCEPTED
**Date:** 2026-03-30
**Deciders:** Product Owner, Lead Backend Architect

---

## Context

The platform's NCR (Neighborhood Community Rituals) methodology required a formalized geographic hierarchy to support corridor-based expansion beyond the founding Chicago-area communities. The original NCR approach described 3 phases (Event Automation → Pattern Recognition → Geo-Spatial Intelligence) but lacked a structured node hierarchy for multi-level geographic reasoning.

NCR v2 introduces a 7-level hierarchy that enables the platform to reason about community engagement at every scale — from a single venue cluster to the full national network.

## Decision

Adopt a 7-level geographic node hierarchy with corridor connections:

| Level | Label | Example |
|-------|-------|---------|
| 1 | Community | Single venue cluster, neighborhood block |
| 2 | District | Multi-block area, ward-level |
| 3 | Zone | Named neighborhood (Beverly, Bronzeville, Evergreen Park) |
| 4 | Metro | City (Chicago, Detroit, Milwaukee) |
| 5 | Region | Multi-city corridor (Chicago→Detroit via I-94) |
| 6 | Territory | State/multi-state (Great Lakes) |
| 7 | Network | Full platform network |

Corridors connect nodes (primarily Level 4+ metros) with signal taxonomy:
- **CLASS_A**: High-confidence corridor with validated engagement data
- **CLASS_B**: Hypothesized corridor based on geographic/demographic reasoning

Corridor status lifecycle: `HYPOTHESIZED` → `VALIDATED`

The `separation_blur_index` (0.0–1.0) quantifies boundary clarity between connected nodes.

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

| Wave | Verticals | Legal Tier | Timeline |
|------|-----------|------------|----------|
| 1 | Sports, dance, gymnastics, rec leagues | OPEN | Now |
| 2 | School-funded gatherings, youth events | RESTRICTED (COPPA) | Next |
| 3 | Museums, art institutes, school functions | REGULATED (HIPAA) | Post-legal |
| 4 | Every public/private event along routes | OPEN | Scale |

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

- [NCR-METHODOLOGY.md](../features/NCR-METHODOLOGY.md) — NCR methodology and data pipeline
- [VISION.md](../features/VISION.md) — Platform vision and NCR horizon
- Migration: `workers/oursharedevents/migrations/0010_create_ncr_v2_hierarchy.sql` (base schema)
- Migration: `workers/oursharedevents/migrations/0011_corridor_growth_model.sql` (growth patterns)
- Config: `config/corridors.js` (seed data + growth constants)
