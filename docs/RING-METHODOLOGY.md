# Ring Emergence Methodology — ourCommunityRituals NCR System

**Status:** Living Document — Part 1 LOCKED, Part 2 DEFERRED pending data
**Last Updated:** 2026-03-31
**Author:** Matt Zdanis (analytical conversation preserved by Claude Code)
**Schema basis:** Migrations 0010–0012, ADR-009 (branch `claude/setup-claude-code-9AktL`)
**Cross-references:**

- `docs/adr/ADR-009-ncr-v2-geographic-hierarchy.md` — architectural decisions governing this doc
- `docs/features/NCR-METHODOLOGY.md` — original NCR data pipeline description
- `config/corridors.js` — founding corridor seed data and growth constants
- D1 migrations: `0010_create_ncr_v2_hierarchy.sql`, `0011_corridor_growth_model.sql`, `0012_ring_emergence_support.sql`

---

## Preface

This document preserves the formal scientific methodology for ring emergence in the ourCommunityRituals NCR (Neighborhood Community Rituals) system. It was produced from a deep analytical session and reflects the ring emergence schema that was implemented as a result of the CCR Loop 1 ring readiness audit.

The document has two parts with intentionally different statuses:

- **Part 1 (Infrastructure Methodology)** — fully formalizable from current platform capabilities. Locked now. The schema is implemented and stable.
- **Part 2 (Research Applications)** — deliberately deferred until sufficient corridor data exists to fit an appropriate cluster model. The deferral is not a gap. It is scientific discipline.

Arbitrary thresholds pre-registered before data collection exist to satisfy the methodology section of a grant proposal, not to understand human behavior. This project does the opposite: build the instrument, collect the data, fit the model to reality.

---

## Terminology Note: Signal Class Naming (NCR v2 Correction)

Migration 0012 corrected an inversion in the original signal class naming. The old `CLASS_A`/`CLASS_B` labels were ambiguous and, as implemented, assigned in the wrong order of analytical weight. The NCR v2 standard introduces explicit names:

| NCR v2 Name         | Legacy Name | Meaning                                                                     |
| ------------------- | ----------- | --------------------------------------------------------------------------- |
| `SIGNAL_PRESENCE`   | `CLASS_A`   | Ad scan (poster/tabletop) — proves proximity, not intent                    |
| `SIGNAL_BEHAVIORAL` | `CLASS_B`   | Event attendance via QR funnel — proves intentional community participation |

**Why the rename:** `SIGNAL_BEHAVIORAL` is the primary, stronger signal. It was previously labeled `CLASS_B` which incorrectly implied it was secondary or lesser. The behavioral signal — someone choosing to attend an event at a specific community — is the evidentiary backbone of corridor validation. The new names make the analytical hierarchy unambiguous.

Both old values are retained in the `signal_class` CHECK constraint during the transition period. New code uses `SIGNAL_PRESENCE` and `SIGNAL_BEHAVIORAL`. The legacy `corridor_signal_class` column is preserved for backwards compatibility.

---

# PART 1: INFRASTRUCTURE METHODOLOGY

> **Status: LOCKED**
> The definitions, rules, and signal classifications in Part 1 are fixed. They govern how the ourSharedEvents platform captures and categorizes behavioral geographic data. Changes to Part 1 require a version bump and rationale entry in the change log at the end of this document.

---

## 1.1 Signal Taxonomy

The ourSharedEvents platform produces two classes of behavioral signal. Their interpretation is not interchangeable.

### SIGNAL_PRESENCE — Ad Scan (Poster or Tabletop)

**Legacy name:** `CLASS_A`
**NCR v2 schema value:** `SIGNAL_PRESENCE` (in `corridors.signal_class`)

**Definition:** A QR code scan originating from a `poster_deployment` record — a poster or tabletop ad placement — geographically associated with a specific node but not linked to event attendance. This is the **advertising/awareness layer** of the behavioral funnel.

**What it proves:** A probe was within geographic reach of a node and engaged with an ad placement. Someone was physically present in a node's orbit.

**What it does NOT prove:** That the probe crossed a corridor. That the probe has any relationship to any event at a different node. That any behavioral community connection exists.

**Schema anchor:**

```sql
-- poster_deployments (migration 0003) — physical anchor for SIGNAL_PRESENCE
latitude   REAL,   -- node location of the deployment
longitude  REAL,
qr_token   TEXT NOT NULL UNIQUE

-- scans (migration 0004) — each scan record is a SIGNAL_PRESENCE event
poster_deployment_id  TEXT,   -- links scan back to node via poster_deployments
scan_bucket           TEXT,   -- time window (privacy — no exact timestamp stored)
user_agent_hash       TEXT,   -- anonymous probe identifier
region_code           TEXT    -- geographic resolution
```

**Analytical value:** `SIGNAL_PRESENCE` scans capture the **awareness pool** — people in a node's orbit who have been exposed to the platform but have not yet attended an event. This is the denominator for the Conversion Rate Model (§1.2). A node with zero presence scans and strong behavioral signals is a different analytical situation than a node with 400 presence scans and the same behavioral signal count. The ratio matters as much as either count alone.

**Signal weight:** Supporting only. Cannot validate a corridor alone.

---

### SIGNAL_BEHAVIORAL — Event Attendance via QR Funnel

**Legacy name:** `CLASS_B`
**NCR v2 schema value:** `SIGNAL_BEHAVIORAL` (in `corridors.signal_class`)

**Definition:** A probe that completes at least one step of the QR-to-form funnel at an event hosted by a specific node. This is the **conversion/behavioral layer** of the funnel. Requires intentional behavior: a person chose to show up at a specific event in a specific community.

**What it proves:** Intentional community participation at a node. This is a meaningful behavioral act, not incidental geographic proximity.

**What it does NOT prove (alone):** Cross-node movement. Corridor existence. Ring membership.

**Schema anchor:** `SIGNAL_BEHAVIORAL` signals are derived by joining `scans` or form submission records (forms D1 database) to `events` by `event_id`, then associating those events to nodes via `node_hierarchy`. The event's venue is mapped to a node using `poster_deployments.latitude`/`longitude` and node centroid proximity.

**Signal weight:** **Primary.** Corridor hypotheses are built on `SIGNAL_BEHAVIORAL` clusters. Corridor validation requires `SIGNAL_BEHAVIORAL` evidence.

---

### 1.2 Conversion Rate Model

The conversion rate model is the first compound analytical operation. It requires both signal classes and produces a metric that neither class can produce alone.

**Definition:** For a given season and pair of nodes (Node X, Node Y), the conversion rate is:

```
Conversion Rate (X → Y) =
  (SIGNAL_BEHAVIORAL events at Node Y from probes with prior SIGNAL_PRESENCE at Node X)
  ÷
  (Total SIGNAL_PRESENCE events at Node X in same season)
```

**Concrete example:**

> 200 `SIGNAL_PRESENCE` ad scans (posters and tabletops) recorded at Beverly-area
> deployments over a season. 40 of those same `user_agent_hash` values later generate
> `SIGNAL_BEHAVIORAL` signals at EP events.
> Conversion Rate (Beverly → EP) = 40 / 200 = **20%**

This 20% is a statement about corridor strength that neither the 200 presence scans nor the 40 behavioral signals could make independently. `SIGNAL_PRESENCE` establishes the awareness pool. `SIGNAL_BEHAVIORAL` measures how deeply that awareness penetrated into cross-node event participation.

**Implementation note:** `user_agent_hash` (on `scans`) is the anonymous continuity mechanism across signal classes. The schema prevents individual identification by design. The conversion rate model operates on hashed probes, not persons. Individual threads are invisible; aggregate behavioral patterns are what surface. See `docs/DATA_POLICY.md` for the privacy architecture.

**Limitations:**

1. `user_agent_hash` is not a persistent identity. Device rotation and browser privacy modes introduce noise.
2. Seasonal variation affects the denominator significantly.
3. Node attribution of poster placements depends on `poster_deployments.latitude`/`longitude` proximity to node centroids (`node_hierarchy.latitude`/`longitude`). Boundary placements require the political constraint tie-breaker in §1.3.

---

## 1.3 Node Definition Rules

Nodes are the fundamental geographic unit of the NCR system, stored in the `node_hierarchy` table (migration 0010).

**Schema:**

```sql
-- node_hierarchy (migration 0010 + 0012)
id              TEXT PRIMARY KEY,
brand_id        TEXT NOT NULL,
name            TEXT NOT NULL,
level           INTEGER NOT NULL CHECK (level BETWEEN 1 AND 7),
level_label     TEXT NOT NULL,    -- 'Community', 'District', 'Zone', etc.
parent_node_id  TEXT,             -- self-referential: tree structure
latitude        REAL,             -- node centroid
longitude       REAL,             -- node centroid
ring_role       TEXT DEFAULT 'UNCLASSIFIED'   -- migration 0012
                CHECK (ring_role IN ('CORE', 'PERIPHERY', 'UNCLASSIFIED')),
event_verticals TEXT,             -- JSON array: migration 0011
legal_clearance_tier TEXT DEFAULT 'OPEN'  -- migration 0011
```

**7-Level Hierarchy (ADR-009):**

| Level | Label     | Example                                                   |
| ----- | --------- | --------------------------------------------------------- |
| 1     | Community | Single venue cluster, neighborhood block                  |
| 2     | District  | Multi-block area, ward-level                              |
| 3     | Zone      | Named neighborhood (Beverly, Bronzeville, Evergreen Park) |
| 4     | Metro     | City (Chicago, Detroit, Milwaukee)                        |
| 5     | Region    | Multi-city corridor (Chicago → Detroit via I-94)          |
| 6     | Territory | State/multi-state (Great Lakes)                           |
| 7     | Network   | Full platform network                                     |

**Political constraint ordering:** When a node boundary is ambiguous, political/administrative boundaries (ward, municipality, park district jurisdiction) take precedence over perceived community identity. This ensures node definitions remain objectively reproducible across time and researchers.

**Naming convention:** `{Level}-{Region}-{Name}` — e.g., `L3-CHI-BEVERLY`, `L3-CHI-EP`, `L4-IL-CHICAGO`. See `config/corridors.js` for founding node IDs.

**Poster placement attribution:** A `poster_deployment` record is attributed to the node whose geographic centroid (`node_hierarchy.latitude`/`longitude`) is closest to the deployment's `latitude`/`longitude`, subject to the constraint that the deployment does not cross a political boundary into a different L3+ node.

---

## 1.4 Corridor Tracking Rules

A corridor is a hypothesized or validated pattern of cross-node behavioral movement. Corridors are stored in the `corridors` table (migration 0010, extended by 0011 and 0012).

**Schema:**

```sql
-- corridors (migrations 0010 + 0011 + 0012)
id                    TEXT PRIMARY KEY,
brand_id              TEXT NOT NULL,
name                  TEXT NOT NULL,
origin_node_id        TEXT NOT NULL,      -- FK → node_hierarchy
destination_node_id   TEXT NOT NULL,      -- FK → node_hierarchy
signal_class          TEXT DEFAULT 'SIGNAL_BEHAVIORAL'
                      CHECK (signal_class IN (
                        'CLASS_A', 'CLASS_B',                     -- legacy
                        'SIGNAL_PRESENCE', 'SIGNAL_BEHAVIORAL'    -- NCR v2
                      )),
corridor_status       TEXT DEFAULT 'HYPOTHESIZED'
                      CHECK (corridor_status IN ('HYPOTHESIZED', 'VALIDATED')),
separation_blur_index REAL,               -- 0.0 (sharp) to 1.0 (blurred boundary)
level                 INTEGER DEFAULT 5,
route_designation     TEXT,               -- e.g. 'I-94 East'

-- Migration 0011: growth model
parent_corridor_id    TEXT,               -- fractal branching: sub-corridors
growth_pattern        TEXT
                      CHECK (growth_pattern IN ('SPIDERWEB', 'FRACTAL', 'REVERB')),
reverb_strength       REAL,              -- 0.0 to 1.0

-- Migration 0012: ring emergence support
directionality        TEXT DEFAULT 'UNKNOWN'
                      CHECK (directionality IN ('UNIDIRECTIONAL', 'BIDIRECTIONAL', 'UNKNOWN')),
first_observed        TEXT,
last_observed         TEXT,
validation_window_count INTEGER DEFAULT 0,
temporal_pattern      TEXT DEFAULT 'UNKNOWN'
                      CHECK (temporal_pattern IN ('STRUCTURAL', 'SEASONAL', 'UNKNOWN'))
```

### Corridor Status Lifecycle

```
HYPOTHESIZED → VALIDATED
```

| Status         | Condition                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `HYPOTHESIZED` | At least one `SIGNAL_BEHAVIORAL` exists from a probe with traceable origin at a different node. Minimum evidence threshold not yet met. |
| `VALIDATED`    | Signal cluster meets the minimum evidence threshold (defined per-season in the analysis protocol).                                      |

### Signal Weighting

- **`SIGNAL_BEHAVIORAL` is primary.** A corridor hypothesis requires at least one behavioral signal from a probe with traceable origin at a different node.
- **`SIGNAL_PRESENCE` is supporting.** It contributes to conversion rate calculations and strengthens a hypothesis but cannot establish one alone.
- **Unidirectional flow CAN validate a corridor.** Beverly probes generating behavioral signals at EP events constitute a Beverly → EP corridor (`directionality = 'UNIDIRECTIONAL'`) even without EP probes appearing at Beverly events. Geographic and cultural asymmetry is real data. The system does not penalize corridors for being structurally asymmetric.

### Directionality Values (Migration 0012)

| Value            | Meaning                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| `UNIDIRECTIONAL` | Signal observed in one direction only. Sufficient for corridor validation. NOT sufficient for core ring membership. |
| `BIDIRECTIONAL`  | Signal observed in both directions. Required for core ring node qualification.                                      |
| `UNKNOWN`        | Not yet measured — insufficient data.                                                                               |

### What a Validated Corridor Is Not

A validated corridor between Node A and Node B is not a ring. It is not evidence of ring membership. It is a directed behavioral relationship between two nodes. The ring analysis layer sits above corridor analysis and requires additional structure (minimum 3-node cycle, bidirectionality requirements, temporal consistency — all defined in §1.5 and Part 2).

---

## 1.5 Minimum Ring Topology — Graph Theory Floor

**Formal definition:** A ring is a directed cycle in the corridor graph. The minimum cycle length in graph theory is 3 — three nodes with corridors connecting them such that traversal returns to origin: A → B → C → A (or equivalently, a set of edges forming a closed loop).

**Two-node case:** A validated corridor between exactly two nodes is a corridor. It is not a ring. A ↔ B with `directionality = 'BIDIRECTIONAL'` is a bidirectional corridor. It has its own analytical value but does not constitute ring topology.

**Three-node case:** Beverly ↔ EP ↔ Oak Lawn forms a candidate three-node cycle. Whether this constitutes a ring or a "tight corridor cluster" is an empirical question addressed in Part 2. The graph theory minimum is 3; the behavioral minimum is a research question.

**Schema encoding:** Ring topology is not stored as a single record — it is derived from the corridor graph. The `ring_role` column on `node_hierarchy` (`CORE`/`PERIPHERY`/`UNCLASSIFIED`) pre-registers which nodes are candidates for which ring positions before the confirmatory analysis runs. This is the pre-registration mechanism for ring topology claims.

---

## 1.6 Corridor Growth Model

Migration 0011 encodes the three architectural growth patterns as schema-level first-class concepts, not just analytical metaphors.

### SPIDERWEB Growth

**Schema value:** `corridors.growth_pattern = 'SPIDERWEB'`

Highway corridors branch into sub-corridors at every intermediate point. I-94 East doesn't just connect Chicago → Detroit — it spawns community corridors at every exit, town, school gym, dance studio, and park along the route.

```
I-94 East (Level 5, SPIDERWEB):
  Chicago ──┬── Michigan City ──┬── Benton Harbor ── Detroit
            ├── Gary            ├── Kalamazoo
            ├── Hammond*        ├── Ann Arbor
            └── ...             └── ...
            (* = founding corridor, already active)
```

Sub-corridors are stored with `parent_corridor_id` pointing to the highway corridor, enabling queries that traverse the corridor tree at any level.

### FRACTAL Growth

**Schema value:** `corridors.growth_pattern = 'FRACTAL'`

The branching pattern is self-similar at every hierarchy level. A Level 5 highway corridor spawns Level 4 metro corridors, which spawn Level 3 zone corridors, which spawn Level 1 community corridors. The same structure recursively.

```
Level 5: Chicago ════════════ Detroit          (highway corridor)
Level 4:    ├── South Side ──── Hammond        (metro corridors)
Level 3:    │     ├── Beverly                  (zone corridors)
Level 1:    │     │     ├── school gym         (community corridors)
            │     │     ├── dance studio
            │     │     └── park pavilion
```

**Analytical implication:** The methodology is genuinely scale-invariant. The same signal taxonomy, corridor tracking rules, and ring emergence criteria apply at every hierarchy level. What changes is the geographic resolution of the nodes, not the analytical structure.

### REVERB Growth

**Schema value:** `corridors.growth_pattern = 'REVERB'`
**Schema field:** `corridors.reverb_strength` (0.0–1.0)

Signal travels both directions through corridors and amplifies over time. An event in Beverly generates awareness and attendance from Evergreen Park and Hammond. That signal doesn't decay — it compounds as more events activate more nodes. Reverb is what turns isolated events into community rituals.

`reverb_strength` measures how strongly events in one node generate attendance from connected nodes. A corridor with `reverb_strength = 0.8` means 80% of its theoretical signal propagation potential is realized — high reverb corridors are strong candidates for ring membership.

---

## 1.7 Event Verticals and Node Activation

Nodes activate through successive waves of event types, tracked in `node_hierarchy.event_verticals` (JSON array) and gated by `node_hierarchy.legal_clearance_tier`.

| Wave | Verticals                                 | Legal Tier           | Timeline                      |
| ---- | ----------------------------------------- | -------------------- | ----------------------------- |
| 1    | Sports, dance, gymnastics, rec leagues    | `OPEN`               | Now                           |
| 2    | School-funded gatherings, youth events    | `RESTRICTED` (COPPA) | Next                          |
| 3    | Museums, art institutes, school functions | `REGULATED` (HIPAA)  | Post-legal clearance          |
| 4    | Every public/private event along routes   | `OPEN`               | Scale — countryside expansion |

Wave 4 is where corridors span into countryside — where people actually live. The route towns between metros (Kalamazoo, Rockford, Bloomington-Normal, Lafayette) are not just waypoints. They are communities with their own event ecosystems waiting to activate.

---

# PART 2: RESEARCH APPLICATIONS

> **Status: LIVING DOCUMENT — Analytical criteria DELIBERATELY DEFERRED**
> Part 2 grows as data accumulates. Ring emergence criteria are not pre-registered until sufficient corridor data exists to fit an appropriate cluster model. Sections marked **[DEFERRED]** will be completed when data warrants, with academic partnership validation.

---

## Governing Principle

The NCR infrastructure is built to capture the data that will eventually make the analytical model possible — not to predict its conclusions in advance.

Pre-registering arbitrary thresholds before data collection would impose theoretical structure on what is designed to be an empirically-derived geographic finding. The result would be a methodology that answers the question the researcher had in mind before collecting data, rather than the question the data is actually equipped to answer. That is not scientific discipline. It is confirmation bias with good documentation.

The correct sequence:

1. Lock the infrastructure methodology (Part 1). ✅ Done.
2. Collect data across multiple seasons.
3. Explore corridor cluster structure with an academic partner.
4. Pre-register the analytical model _before_ running the confirmatory test.
5. Run the confirmatory test.
6. Lock Part 2.

---

## 2.1 Four Formal Problems for Ring Emergence

Ring emergence decomposes into four distinct formal problems. All four must be resolved before a ring can be declared. The schema in migrations 0010–0012 captures the data needed for all four — but the analytical thresholds are deferred.

---

### Problem 1: Minimum Topology

**Question:** Is 3 the behavioral minimum for a ring, or does behavioral reality require more nodes before a cycle constitutes a meaningful community ring?

**Graph theory answer:** 3 is the floor. A cycle of length 3 is the smallest possible ring.

**Behavioral research question:** Does a three-node cycle reflect genuine community circulation or is it an artifact of dense local geography? Beverly, EP, and Oak Lawn are geographically proximate. Their inter-connection may reflect proximity rather than a distinct ring identity — which is exactly what the null hypothesis test (Problem 4) is designed to distinguish.

**Schema readiness:** `node_hierarchy.ring_role` (migration 0012) allows pre-registration of core/periphery assignments before analysis. The field is populated before the confirmatory dataset is examined.

**Status:** Minimum topology **[DEFERRED]** — empirical question answered by data.

---

### Problem 2: Bidirectionality Requirement

**Question:** Must all corridors in a ring be bidirectional, or can a ring include unidirectional corridors?

A corridor can be `UNIDIRECTIONAL` and still be scientifically valid (§1.4). But a ring that consists entirely of one-directional flows is topologically a spoke pattern with one hub, not a ring. The bidirectionality question is about what proportion and distribution of bidirectional corridors is required before a cycle qualifies as a ring.

Three candidate models:

#### Model 1: Strict Reciprocal (100%)

Every corridor in the ring must be `BIDIRECTIONAL`.

- **Strength:** Scientifically cleanest. Easiest to operationalize.
- **Weakness:** Too strict for geographic reality. Structurally asymmetric corridors — Beverly families who spend summers in SW Michigan — would permanently disqualify a ring that may be behaviorally genuine. Imposes a symmetry assumption the data may not support.
- **Status:** Candidate, likely too conservative.

#### Model 2: Majority Bidirectional (60–70% threshold)

Some threshold proportion of corridors in the ring must be `BIDIRECTIONAL`.

- **Strength:** Reflects the reality that some asymmetry exists in most geographic behavioral patterns.
- **Weakness:** The threshold (60%? 65%? 70%?) is arbitrary without baseline data. Pre-registering a number before data collection is precisely the problem this methodology is designed to avoid.
- **Status:** Candidate, threshold is **[DEFERRED]** pending baseline corridor data.

#### Model 3: Core/Periphery Bidirectionality (PREFERRED CANDIDATE)

The ring has a **core** — nodes with full `BIDIRECTIONAL` requirements between them — and a **periphery** — nodes that connect to the ring via validated `UNIDIRECTIONAL` corridors without being required to complete reciprocal flow.

**Schema encoding:** `node_hierarchy.ring_role` distinguishes `CORE` from `PERIPHERY`. This classification must be written and locked _before_ the confirmatory analysis runs (see §2.6 Pre-Registration Standard).

**Example:**

| Component             | `ring_role` | Requirement                                                                        |
| --------------------- | ----------- | ---------------------------------------------------------------------------------- |
| Beverly, EP, Oak Lawn | `CORE`      | All pairwise corridors must be `BIDIRECTIONAL`                                     |
| SW Michigan venues    | `PERIPHERY` | Connect via validated `UNIDIRECTIONAL` seasonal corridor — no return flow required |

- **Strength:** Maps most accurately to geographic and cultural reality. Seasonal satellite communities exist. Forcing them into symmetry requirements systematically excludes legitimate ring periphery.
- **Weakness:** Requires pre-commitment to `CORE`/`PERIPHERY` classification before data analysis. Post-hoc assignment becomes a modeling choice dressed as a discovery.

**Resolution:** Cluster-hybrid models (Model 3 family) are better depictions of geographic reality than pure symmetry models. The specific parameterization is fitted to real behavioral data. Academic partnership (Northwestern or UChicago) required to co-design the statistical test.

---

### Problem 3: Temporal Consistency

**Question:** Can a ring be declared on a single season of data, or must it persist across multiple distinct time windows?

**Answer:** A corridor cluster that meets threshold in one season but not another is a seasonal activation pattern, not a ring. A ring requires behavioral persistence.

**Minimum temporal requirement:** A corridor cluster must meet the ring emergence threshold across **at least two distinct time windows** (operationally: different seasons, separated by at least one non-overlapping season of data collection). This rules out pure seasonal effects from qualifying as ring topology.

**Schema encoding (migration 0012):**

```sql
-- corridors
first_observed          TEXT,    -- timestamp of first validated signal
last_observed           TEXT,    -- timestamp of most recent validated signal
validation_window_count INTEGER DEFAULT 0,  -- distinct seasons with validated signal
temporal_pattern        TEXT DEFAULT 'UNKNOWN'
                        CHECK (temporal_pattern IN ('STRUCTURAL', 'SEASONAL', 'UNKNOWN'))
```

A corridor is `temporal_pattern = 'STRUCTURAL'` only when `validation_window_count >= 2`. A corridor with `validation_window_count = 1` remains `'SEASONAL'` until the second season confirms it.

**Status:** Two-season minimum is **LOCKED** as a qualitative rule. Specific operationalization (season boundaries, acceptable seasonal correction methods) is **[DEFERRED]** to Phase 2.

---

### Problem 4: Coincidental Cluster Problem

**Question:** How do we distinguish a genuine behavioral ring from a corridor cluster that would have formed between any three geographically proximate nodes regardless of shared community identity?

**This is the hardest problem.** Geographic proximity alone generates corridor-like patterns. Nodes that are close together will naturally show more cross-node behavioral signals than nodes that are far apart. A methodology that declares rings based solely on corridor cluster density without controlling for proximity would declare rings everywhere in dense urban environments.

**Required null hypothesis test:**

```
H₀: The observed corridor cluster between nodes A, B, and C is consistent
    with the baseline expected corridor activity between randomly selected
    nodes in the same geographic area and density class.

H₁: The observed corridor cluster is statistically distinguishable from
    chance, indicating non-random behavioral community connection.
```

**Implementation requirements:**

1. Establish a baseline corridor activity distribution for the NCR system across all node pairs in each density class (urban core, urban neighborhood, suburban, exurban).
2. Compute the observed corridor cluster strength for the candidate ring.
3. Apply the appropriate statistical test (permutation test or spatial autocorrelation — to be co-designed with academic partner).
4. Declare ring emergence only if the observed cluster is statistically distinguishable from the null distribution.

**Schema readiness:** `corridors.separation_blur_index` (0.0–1.0) quantifies boundary clarity between connected nodes, which is an input to density class assignment. `node_hierarchy.level` enables stratified null hypothesis testing by geographic scale.

**Academic partner requirement:** This problem cannot be resolved without a collaborator with expertise in spatial statistics and social network analysis. Candidate institutions: Northwestern (sociology, geography), UChicago (sociology, CRES). This is the primary Phase 2 analytical dependency.

**Status:** **[DEFERRED]** — academic partnership required.

---

## 2.2 Three Architectural Descriptions of the NCR System

The NCR system has three valid architectural descriptions, now schema-encoded as `growth_pattern` values in the `corridors` table (migration 0011). None is more correct than the others. They describe the same system from spatial, structural, and temporal perspectives.

---

### The Spider Web (Spatial)

`growth_pattern = 'SPIDERWEB'`

Start at the Beverly/EP core. Two validated corridors form the first strand. Each new node adds a strand extending outward. Each additional validated corridor strengthens the connection between existing nodes.

As rings emerge, the web changes character. Isolated strands become load-bearing structure. The web stops being a collection of point-to-point connections and becomes self-supporting architecture. A strand that breaks no longer brings down the whole structure because multiple paths exist between nodes.

The web strengthens inward simultaneously as it grows outward. Adding SW Michigan to the periphery does not just extend the web geographically — it retroactively clarifies the meaning of Beverly/EP/Oak Lawn core signals that predated SW Michigan's node activation.

---

### The Fractal (Structural)

`growth_pattern = 'FRACTAL'`

The same analytical structure operates at every geographic scale, encoded through `parent_corridor_id` creating a corridor tree:

| Scale                  | Example                                                   |
| ---------------------- | --------------------------------------------------------- |
| Venue-to-venue         | Cork n Kerry's bocce court ↔ adjacent bar ↔ nearby park |
| Community-to-community | Beverly ↔ Edgewater Park ↔ Oak Lawn                     |
| Metro-to-metro         | Chicago ↔ Milwaukee ↔ Detroit arc                       |
| Regional               | Midwest ring system                                       |

A venue-to-venue corridor has the same mathematical architecture as a metro-to-metro corridor. The methodology does not change at different scales — it recurses. This self-similarity is what makes the methodology genuinely scalable. The same signal taxonomy, the same corridor tracking rules, the same ring emergence criteria apply at every level. What changes is the geographic resolution of the nodes.

---

### Reverberation (Temporal)

`growth_pattern = 'REVERB'`, quantified by `reverb_strength`

An event fires at a node. The behavioral signal travels outward through corridors. Adjacent nodes experience activation. Those probes generate new signals. The signals travel back through the corridors and arrive at the origin node differently — because the origin node's context is now better understood by virtue of what the outbound signal revealed.

Three specific reverberation effects:

1. **Nodes redefine corridors.** Beverly → EP was a two-node corridor. Beverly → EP → Oak Lawn is a cycle candidate. The Beverly → EP corridor means something different once Oak Lawn is added.

2. **Corridors redefine rings.** A corridor that was isolated becomes ring-constituting when the cycle closes. The meaning of every corridor in a ring is upgraded when the ring is declared.

3. **Past data gets richer as present data accumulates.** A Beverly `SIGNAL_PRESENCE` scan from year one means something different after year three's ring emergence than it did when it was collected. The raw data is unchanged. Its interpretive weight within the model is upgraded.

This reverberation property is why the platform is designed as a longitudinal system. The longer it runs, the richer the historical dataset becomes — not because more data was collected, but because each new data point retroactively clarifies the meaning of prior data.

---

## 2.3 Organic Data Growth — The Telephone Game

The platform does not require any participant to understand the research. It operates through ordinary community behavior.

**Illustrative trace:**

> Event at Cork n Kerry's. Attendee mentions the bocce tournament to a colleague at work on Monday. That colleague shows up, scans the poster (`SIGNAL_PRESENCE`), signs up via the QR funnel (`SIGNAL_BEHAVIORAL`). That person mentions the tournament to their family. Some family members attend an OurOpenTable event in a different node — another `SIGNAL_BEHAVIORAL`, different node.

The platform captured this entire sequence. No individual thread was tracked. The aggregate effect is visible in node activation patterns across the corridor. The `user_agent_hash` architecture means individual attribution is architecturally prevented while community-level pattern detection is architecturally enabled. These are not in tension — they are the same design decision.

**"You see the reverberation without seeing the individual."**

---

## 2.4 Inter-Referencing as Self-Clarifying Engine

The NCR system is self-clarifying across time because its analytical objects — nodes, corridors, rings — are mutually defining:

- Validated corridors redefine what the nodes at their endpoints mean.
- Discovered rings redefine what the corridors forming them mean.
- Better-understood nodes reveal corridor potentials not visible before ring emergence.
- `SIGNAL_PRESENCE` records from year one sit in a different analytical context after year three's ring emergence.

**The system revises the meaning of its history as it understands its present.** This is the expected behavior of a longitudinal research instrument operating on social behavior in a complex system.

---

## 2.5 Commercial-Civic Convergence Flywheel

The NCR ring methodology creates a flywheel that unifies the commercial engine and the civic mission:

1. Brewery sponsors a bocce tournament (commercial transaction)
2. SharedReport validates Beverly → EP corridor (research output)
3. Corridor visibility attracts EP-area sponsor (commercial growth)
4. New EP sponsor funds new EP-area events (infrastructure growth)
5. New events generate new `SIGNAL_BEHAVIORAL` signals (data growth)
6. Data contributes to ring emergence detection (research milestone)
7. Validated ring becomes visible to park district planners, school administrators, municipal agencies (institutional visibility)
8. Institutional partnerships generate new event infrastructure across nodes (flywheel accelerates)
9. New infrastructure generates new data → each layer feeds every other layer

The commercial engine and the civic research mission are the same flywheel. Optimizing for sponsor revenue optimizes for data collection quality. Optimizing for ring emergence methodology optimizes for sponsor value — because ring-validated corridors are demonstrable reach metrics.

**At saturation:** The platform stops being an event company that also does community research. It becomes the shared instrument that commercial partners, civic institutions, and municipal planners all use to understand the communities they serve. A longitudinal, anonymous behavioral dataset that never expires, applied through a geographic methodology that scales fractally from a single bocce court to a multi-city regional ring system.

---

## 2.6 Pre-Registration Standard

Scientific discipline in this methodology is operationalized through pre-registration: analytical criteria must be written down and locked _before_ the dataset is analyzed for the conclusion those criteria are meant to detect.

**What is locked now (Part 1):**

- Signal taxonomy (`SIGNAL_PRESENCE`/`SIGNAL_BEHAVIORAL` definitions)
- Node definition rules and 7-level hierarchy
- Corridor tracking rules and status lifecycle
- Minimum ring topology definition (3-node cycle minimum)
- Growth model patterns (`SPIDERWEB`/`FRACTAL`/`REVERB`)
- Temporal consistency rule (≥2 distinct seasons required)

**What is deferred (Part 2):**

- Ring emergence threshold (bidirectionality model parameterization)
- Minimum topology behavioral floor
- Temporal consistency operationalization (season boundaries)
- Null hypothesis test design and statistical method

**When Part 2 locks:** When corridor data reaches Phase 2 analysis threshold AND an academic partnership is in place. The academic partner co-designs the statistical test and co-signs the pre-registration.

**Pre-registration repository:** The locked Part 2 document will be filed at a pre-registration registry (OSF, AsPredicted, or equivalent) before confirmatory analysis begins. The timestamp of that filing is the scientific boundary between exploratory and confirmatory analysis.

---

## Change Log

| Date       | Section | Change                                                                                                                                                                                                                                      | Author                    |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 2026-03-30 | All     | Initial document created from analytical conversation                                                                                                                                                                                       | Matt Zdanis / Claude Code |
| 2026-03-31 | All     | Major revision: aligned to actual schema (migrations 0010–0012, ADR-009); corrected signal class naming to `SIGNAL_PRESENCE`/`SIGNAL_BEHAVIORAL`; added growth model schema encoding; incorporated CCR Loop 1 ring readiness audit findings | Matt Zdanis / Claude Code |
