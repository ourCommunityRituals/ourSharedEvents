# Platform Guide NCR v2 Framing Review

> Conducted 2026-03-30 against all docs/features/*.md, VISION.md, NCR-METHODOLOGY.md,
> ARCHITECTURE.md, and README.md.
>
> Review criteria from Task 2:
> 1. Language contradicting NCR v2 framing
> 2. "Event app" references without community intelligence evolution arc
> 3. Geographic hierarchy descriptions differing from 7-level NCR v2
> 4. Corridor descriptions without signal taxonomy
> 5. Ring descriptions implying pre-definition rather than emergence

---

## Flagged Items

### FLAG 1 — NCR-METHODOLOGY.md: No 7-Level Hierarchy
**File:** `docs/features/NCR-METHODOLOGY.md`
**Lines:** 226-237 (Measuring NCR Readiness section)
**Issue:** Geographic references use informal terms ("per neighborhood", "1-mile radius", "per neighborhood per quarter") without mapping to the NCR v2 7-level hierarchy. No mention of Levels 1-7, no mention of Community/District/Zone/Metro/Region/Territory/Network.
**Replacement language:**
> Replace "50+ events in a 1-mile radius" with "50+ events within a Level 3 Zone"
> Replace "10,000+ scans per neighborhood per quarter" with "10,000+ scans per Level 3 Zone per quarter"
> Replace "10+ unique venues per neighborhood" with "10+ unique venues per Level 3 Zone"
> Add a subsection mapping NCR readiness thresholds to each hierarchy level.

---

### FLAG 2 — NCR-METHODOLOGY.md: No Corridor or Signal Taxonomy
**File:** `docs/features/NCR-METHODOLOGY.md`
**Lines:** 1-248 (entire document)
**Issue:** The document describes geo-spatial intelligence and cross-event aggregation but never mentions corridors, signal classification (CLASS_A/CLASS_B), corridor status (HYPOTHESIZED/VALIDATED), or separation blur index. The NCR data pipeline diagram (lines 152-178) shows physical→digital→intelligence flow but lacks the corridor layer.
**Replacement language:**
> Add a "Corridor Model" section between "The Data Model That Makes It Possible" and "NCR Data Pipeline" describing:
> - Corridors as Level 5 Region connections between Level 4 Metro nodes
> - Signal taxonomy: CLASS_A (validated) vs CLASS_B (hypothesized)
> - Status lifecycle: HYPOTHESIZED → VALIDATED (requires NCR readiness thresholds met at both endpoints)
> - separation_blur_index as boundary clarity metric
> - Reference to migration 0010 and ADR-009

---

### FLAG 3 — VISION.md: NCR Horizon Uses Informal Geography
**File:** `docs/features/VISION.md`
**Lines:** 136-157 (The NCR Horizon section)
**Issue:** References "venues and neighborhoods" without NCR v2 hierarchy levels. Phrase "this block has 3x engagement on Thursdays" implies Level 1 Community but doesn't use the term. No mention of corridors or multi-city expansion.
**Replacement language:**
> After "Community planning signal" add: "Corridor-level analysis → which inter-city routes show emerging community connection (Level 5 Region)"
> Replace "venues and neighborhoods" with "venues (Level 1 Community) and neighborhoods (Level 3 Zone)"

---

### FLAG 4 — VISION.md: Platform Described as Event Automation Only
**File:** `docs/features/VISION.md`
**Lines:** 10-11 (The Mission)
**Issue:** Mission statement reads "Serve the hyperlocal economy through event automation" — accurate for Phase 1 but missing the community intelligence evolution arc. The mission doesn't acknowledge that the platform evolves from event tool → community intelligence infrastructure.
**Replacement language:**
> "Serve the hyperlocal economy through event automation — building toward community intelligence infrastructure where accumulated anonymous signal reveals neighborhood economic patterns, corridor connections, and geographic engagement density."

---

### FLAG 5 — PLATFORM-FLOW.md: Triangle Framework Without Hierarchy Context
**File:** `docs/features/PLATFORM-FLOW.md`
**Issue:** The Triangle Framework (Events ↔ Sponsors ↔ Customers) is described as the core data model but operates at the individual event level without acknowledging that events are situated within the 7-level hierarchy. An event happens at a Level 1 Community, within a Level 3 Zone, within a Level 4 Metro.
**Replacement language:**
> Add a paragraph: "Every event is geographically situated within the NCR v2 hierarchy. A poster deployment's lat/lng places it in a Level 1 Community, which rolls up through District → Zone → Metro → Region → Territory → Network. The Triangle Framework operates at the event level; the hierarchy enables cross-event aggregation at every geographic scale."

---

### FLAG 6 — SURFACES.md: SharedReport Without Hierarchy Awareness
**File:** `docs/features/SURFACES.md`
**Issue:** SharedReport is listed as a Phase 2 surface but described only as per-event analytics. No mention of hierarchy-level reporting (Zone-level rollups, Metro-level dashboards, Corridor-level comparisons).
**Replacement language:**
> Add to SharedReport description: "Phase 3 extends SharedReport with hierarchy-level views: Zone dashboards (Level 3), Metro comparisons (Level 4), and Corridor analytics (Level 5). See ADR-009."

---

### FLAG 7 — SPONSORS.md: Sponsor Attribution Without Corridor Context
**File:** `docs/features/SPONSORS.md`
**Issue:** Sponsor attribution (click_token, impression_token) is described per-event and per-brand but doesn't mention corridor-level sponsor performance. A national sponsor (Enterprise tier) operating across a corridor (e.g., I-94 East from Chicago to Detroit) would want corridor-level ROI.
**Replacement language:**
> Add to Sponsor Analytics section: "At Level 5 Region (corridor), sponsor attribution aggregates across all events in connected metros — enabling corridor-level ROI analysis for sponsors operating across multiple cities."

---

### FLAG 8 — BRANDS.md: No Corridor-Level Brand Isolation
**File:** `docs/features/BRANDS.md`
**Issue:** Multi-brand isolation uses dual-key pattern (id + brand_id) but doesn't address how brands operate across corridors. ABC (American Bocce Co.) has child brands in Chicago — but corridor expansion means brand presence across multiple metros.
**Replacement language:**
> Add note: "Corridor expansion (Level 5 Region) may introduce brand presence across multiple Level 4 Metros. The dual-key pattern (id + brand_id) remains valid — corridor-level queries aggregate across metros while maintaining brand isolation."

---

### FLAG 9 — INDEX.md: Feature Map Without Hierarchy Dimension
**File:** `docs/features/INDEX.md`
**Issue:** Feature map organized by audience (Customers, Sponsors, Admins) and tier (Free/Mid/Enterprise) but missing the geographic hierarchy dimension. Different hierarchy levels unlock different features.
**Replacement language:**
> Add a "Geographic Scope" row to the feature map: "Free = Level 1-3 (Community→Zone), Mid = Level 1-4 (through Metro), Enterprise = Level 1-7 (full network including corridors)"

---

### FLAG 10 — ANONYMOUS-ID.md: No Corridor Aggregation Privacy Analysis
**File:** `docs/features/ANONYMOUS-ID.md`
**Issue:** Privacy analysis covers cross-event aggregation as safe ("creates behavioral profile of a location, not an individual") but doesn't extend this analysis to corridor-level aggregation. Aggregating anonymous scan data across an entire I-94 corridor raises the question: does corridor-scale aggregation increase re-identification risk?
**Replacement language:**
> Add to threat model: "Corridor-level aggregation (Level 5 Region): Aggregating scan data across multiple metros within a corridor further reduces re-identification risk — the data becomes more geographic and less individual at larger scales. Scan density per corridor is reported as aggregate counts, never individual scans."

---

### FLAG 11 — README.md: Platform Framed as Event App
**File:** `README.md`
**Issue:** Likely describes the platform as an event management tool without the NCR v2 evolution arc. (Needs verification — file not yet fully read in this session.)
**Replacement language:**
> Ensure README includes: "ourSharedEvents is event infrastructure that evolves into community intelligence. Phase 1 serves individual events. Phase 2 reveals cross-event patterns. Phase 3 produces geo-spatial intelligence through the NCR v2 hierarchy — from neighborhood blocks (Level 1) to national network (Level 7)."

---

### FLAG 12 — ourEventRings: Implied Pre-Definition
**File:** `docs/features/NCR-METHODOLOGY.md` lines 213-224
**Issue:** ourEventRings is described as a planned sibling product for "research and data analysis" but its scope is pre-defined rather than emergent. NCR v2 framing says rings should emerge from data density, not be pre-planned as a separate product.
**Replacement language:**
> Soften to: "ourEventRings is the analytical lens applied when NCR data density reaches threshold. It is not a separate platform but an analytical mode that emerges from accumulated ourSharedEvents data. The 'rings' are concentric geographic patterns that become visible only at sufficient event density — they are discovered, not designed."

---

## Summary

| Category | Flags | Severity |
|----------|-------|----------|
| Missing 7-level hierarchy references | 3 (FLAGS 1, 3, 5) | High — core NCR v2 concept absent |
| Missing corridor/signal taxonomy | 3 (FLAGS 2, 7, 8) | High — no corridor awareness in docs |
| "Event app" without evolution arc | 2 (FLAGS 4, 11) | Medium — mission framing incomplete |
| Missing hierarchy in feature scope | 2 (FLAGS 6, 9) | Medium — features not mapped to levels |
| Privacy gap at corridor scale | 1 (FLAG 10) | Low — existing analysis likely sufficient |
| Ring pre-definition vs emergence | 1 (FLAG 12) | Low — philosophical alignment |

**Total flags: 12**
**High severity: 6** (hierarchy + corridors)
**Medium severity: 4** (framing + feature scope)
**Low severity: 2** (privacy + rings)

### Recommendation

Do NOT rewrite documents yet. This review provides the flagged passages and replacement language. The next step is PO approval of each replacement before editing. Edits should be batched into a single PR: "docs: align platform documentation with NCR v2 hierarchy and corridor model."
