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

## Consequences

- D1 migration `0010_create_ncr_v2_hierarchy.sql` implements `node_hierarchy` and `corridors` tables
- All geographic seed data (founding communities + highway corridors) follows this schema
- SharedReport BI wing can query by hierarchy level for multi-scale analytics
- ABC partnership strategy aligns with corridor-level (Level 5) engagement tracking

## References

Confirmed as architectural foundation for SharedReport BI wing and ABC partnership strategy. See ABC-Partnership-Strategy.docx.

## Cross-References

- [NCR-METHODOLOGY.md](../features/NCR-METHODOLOGY.md) — NCR methodology and data pipeline
- [VISION.md](../features/VISION.md) — Platform vision and NCR horizon
- Migration: `workers/oursharedevents/migrations/0010_create_ncr_v2_hierarchy.sql`
