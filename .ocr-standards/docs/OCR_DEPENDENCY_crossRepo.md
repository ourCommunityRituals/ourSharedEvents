# OCR_DEPENDENCY_crossRepo — Cross-Repo Dependencies

> What we know today. Updated as dependencies are discovered.

---

## Active Dependencies

### OSE feature flags → OSM mock layer

When OSE changes its feature flag configuration (Free/Mid/Enterprise tiers), the OSM Postman collections and Newman CI mocks must be updated to reflect the new flag state. Otherwise franchise documentation and API testing are out of sync with the platform.

```
OSE (feature-flags.ts changes)
  → OSM (Postman collections, Newman CI mocks)
```

### OSE new corridor → OSG + OSR activation plans

When a new corridor is activated on the OSE platform, both OSG and OSR need corresponding activation plans. OSG defines the game format and cadence for the corridor. OSR defines the archive capture workflow and storage provisioning.

```
OSE (new corridor event created)
  → OSG (corridor activation plan: game format, cadence, venue)
  → OSR (archive plan: capture workflow, storage, volunteer roles)
```

### OCR-docs standards → all repos

When OCR-docs updates org-level standards (CLAUDE.md structure, SKILL.md format, ADR format, DAC compliance requirements), those changes cascade to all product repos.

```
OCR-docs (standards change)
  → OSE, OW, OSG, OSR, OSP, OSM, OWL (propagate)
```

**Mechanism:** `propagate-standards.yml` GitHub Action — not built yet, planned Phase 3. Until then, propagation is manual via the Vision Sync skill in OCR-docs SKILL.md.

### OW identity model ↔ OSE anonymous ID — never cross

OW uses named identity. OSE uses anonymous ID. This boundary is architectural and permanent. The two data models never cross. When both converge under OCR, they join at the BigQuery layer with separate schemas — not at the application layer.

```
OW (named identity: contributors, Spotify accounts, DJ attribution)
  ✕ NEVER CROSSES ✕
OSE (anonymous ID: anonymous behavioral data, no PII)
```

This is not a dependency to manage. It is a constraint to enforce. Any proposed integration that would cross this boundary must fail CCR review.

---

## Dependency Direction Summary

| Source | Target(s) | Trigger | Mechanism |
|--------|-----------|---------|-----------|
| OSE feature flags | OSM | Flag config change | Manual update (Postman/Newman) |
| OSE new corridor | OSG, OSR | Corridor activation | Manual activation plan |
| OCR-docs standards | All repos | Standards change | propagate-standards.yml (Phase 3) |
| OW ↔ OSE | — | — | **Never cross. Architectural boundary.** |

---

## Planned Dependencies (not yet active)

| Source | Target(s) | Trigger | Notes |
|--------|-----------|---------|-------|
| OSE event data | OER | Event volume threshold | OER activates when archive depth is sufficient |
| OWL client fork | OSE | New white label client | OWL forks OSE, configures per-client environment |
| OSP onboarding | OSG, OSE | New program onboarded | OSP hands off to OSG format, OSE platform |
| All products | BigQuery | Data pipeline built | All product data flows to warehouse for OER/RAG |

---

*Last updated: April 5 2026*
*Owner: Matt*
*Status: ACTIVE*
