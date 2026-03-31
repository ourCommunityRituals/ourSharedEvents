# Ring Emergence Methodology — ourCommunityRituals NCR System

**Status:** Living Document — Part 1 LOCKED, Part 2 DEFERRED pending data
**Last Updated:** 2026-03-30
**Author:** Matt Zdanis (analytical conversation preserved by Claude Code)
**Cross-references:** `docs/features/NCR-METHODOLOGY.md` (forward ref — not yet merged), D1 schema migrations `0003`, `0004`, `0006`

---

## Preface

This document preserves the formal scientific methodology for ring emergence in the ourCommunityRituals NCR (Neighborhood Corridor Research) system. It was produced from a deep analytical session and is intended to serve as the governing specification for how behavioral geographic data collected through the ourSharedEvents platform is interpreted.

The document has two parts with intentionally different statuses:

- **Part 1 (Infrastructure Methodology)** — fully formalizable from current platform capabilities. Locked now.
- **Part 2 (Research Applications)** — deliberately deferred until sufficient corridor data exists to fit an appropriate cluster model. The deferral is not a gap. It is scientific discipline.

Arbitrary thresholds pre-registered before data collection exist to satisfy the methodology section of a grant proposal, not to understand human behavior. This project does the opposite: build the instrument, collect the data, fit the model to reality.

---

# PART 1: INFRASTRUCTURE METHODOLOGY

> **Status: LOCKED**
> The definitions, rules, and signal classifications in Part 1 are fixed. They govern how the ourSharedEvents platform captures and categorizes behavioral geographic data. Changes to Part 1 require a version bump and rationale entry in the change log at the end of this document.

---

## 1.1 Signal Taxonomy

The ourSharedEvents platform produces two classes of behavioral signal. Their interpretation is not interchangeable.

### Class A Signal — Ad Scan (Poster or Tabletop)

**Definition:** A QR code scan originating from a `poster_deployment` record — a poster or tabletop ad placement — that is geographically associated with a specific node but is not linked to event attendance. Class A is the **advertising/awareness layer** of the behavioral funnel.

**What it proves:** A probe was within geographic reach of a node. Someone was physically present in a node's orbit and engaged with an ad placement. This is an awareness signal, not a behavioral commitment.

**What it does NOT prove:** That the probe crossed a corridor. That the probe has any relationship to any event at a different node. That any behavioral community connection exists.

**Schema anchor:**

```sql
-- poster_deployments (migration 0003)
latitude   REAL,   -- node location of the deployment
longitude  REAL,
qr_token   TEXT NOT NULL UNIQUE

-- scans (migration 0004)
poster_deployment_id  TEXT,   -- links scan back to node
scan_bucket           TEXT,   -- time window (privacy — no exact timestamp)
user_agent_hash       TEXT,   -- anonymous probe identifier
region_code           TEXT    -- geographic resolution
```

**Analytical value:** Class A scans capture the **awareness pool** — people in a node's orbit who have been exposed to the platform but have not yet attended an event. This is the denominator for conversion rate modeling. A node with zero Class A scans and strong Class B signals is a different analytical situation than a node with 400 Class A scans and strong Class B signals. The ratio matters as much as either number alone.

**Signal weight:** Supporting only. Cannot validate a corridor alone.

---

### Class B Signal — Event Attendance via QR Funnel

**Definition:** A probe that completes at least one step of the QR-to-form funnel at an event hosted by a specific node. Class B is the **conversion/behavioral layer** of the funnel. Requires intentional behavior: a person chose to appear at a specific event in a specific community and engaged with the platform.

**What it proves:** Intentional community participation at a node. This is a meaningful behavioral act, not incidental geographic proximity.

**What it does NOT prove (alone):** Cross-node movement. Corridor existence. Ring membership.

**Schema anchor:** Class B signals are derived by joining `scans` or form submission records (in the forms D1 database) to `events` by `event_id`, then associating those events to nodes via the node registry defined in `NCR-METHODOLOGY.md`.

**Signal weight:** Primary. Corridor hypotheses are built on Class B clusters. Class B validates corridors.

---

### 1.2 Conversion Rate Model

The conversion rate model is the first compound analytical operation. It requires both signal classes and produces a metric that neither class can produce alone.

**Definition:** For a given season and pair of nodes (Node X, Node Y), the conversion rate is:

```
Conversion Rate (X → Y) =
  (Class B signals at Node Y from probes with prior Class A signals at Node X)
  ÷
  (Total Class A signals at Node X in same season)
```

**Example (concrete):**

> 200 Class A ad scans (poster and tabletop) recorded at Beverly venues over a season.
> 40 of those same `user_agent_hash` values later generate Class B signals at EP events.
> Conversion Rate (Beverly → EP) = 40 / 200 = **20%**

This 20% is a statement about corridor strength that neither the 200 Class A awareness-layer scans nor the 40 Class B behavioral-layer signals could make independently. Class A establishes the awareness pool; Class B measures how deeply that awareness penetrated into another node's event participation.

**Implementation note:** `user_agent_hash` is the anonymous continuity mechanism across scans. The schema intentionally does not store PII. The conversion rate model operates on hashed probes, not individuals. Individual threads are invisible; aggregate behavioral patterns are what surface. See `docs/DATA_POLICY.md` for the privacy architecture governing this.

**Limitations of the conversion rate model:**

1. `user_agent_hash` is not a persistent identity. Device rotation, browser privacy modes, and natural hash collisions introduce noise.
2. Seasonal variation affects the denominator significantly.
3. The model assumes Class A scans are geographically attributable to a node via `latitude`/`longitude` on `poster_deployments`. Posters placed on node boundaries require a placement classification rule (see §1.3).

---

## 1.3 Node Definition Rules

Nodes are the fundamental geographic unit of the NCR system. They are defined within the NCR geographic hierarchy established in `NCR-METHODOLOGY.md`.

**Hierarchy (7 levels, outermost to innermost):**

1. **Continental region** — e.g., Midwest
2. **Multi-state corridor** — e.g., Chicago–Milwaukee–Detroit arc
3. **Metro area** — e.g., Chicagoland
4. **Sub-metro zone** — e.g., Southwest Side / North Shore
5. **Community area** — e.g., Beverly, Edgewater Park, Oak Lawn
6. **Venue cluster** — e.g., 95th Street commercial strip
7. **Venue** — e.g., Cork n Kerry's, specific bocce courts

**Political constraint ordering:** When a node boundary is ambiguous, political/administrative boundaries (ward, municipality, park district jurisdiction) take precedence over perceived community identity. This ensures node definitions remain objectively reproducible.

**Naming convention:** `{Level}-{Region}-{Name}`, e.g., `L5-CHI-BEVERLY`, `L5-CHI-EP`, `L6-CHI-BEVERLY-95TH`. Formal naming conventions to be finalized in `NCR-METHODOLOGY.md`.

**Poster placement rule:** A `poster_deployment` record is attributed to the node whose geographic centroid it is closest to, subject to the constraint that it does not cross a political boundary into a different L5+ node. `latitude`/`longitude` on `poster_deployments` is the authoritative geographic anchor.

---

## 1.4 Corridor Tracking Rules

A corridor is a hypothesized or validated pattern of cross-node behavioral movement.

### Corridor States

| State            | Definition                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Hypothesized** | At least one Class B signal exists from a probe associated with a different origin node. Minimum evidence threshold not yet met. |
| **Validated**    | Signal cluster meets the minimum evidence threshold (defined per-season in the analysis protocol).                               |

### Signal Weighting

- **Class B signals are primary.** A corridor hypothesis requires at least one Class B signal from a probe with traceable origin at a different node.
- **Class A signals are supporting.** They contribute to conversion rate calculations and strengthen a corridor hypothesis but cannot establish one alone.
- **Unidirectional flow CAN validate a corridor.** Beverly probes generating Class B signals at EP events constitute a Beverly → EP corridor signal even in the complete absence of EP probes appearing at Beverly events. Geographic and cultural asymmetry is real data. The system does not penalize corridors for being asymmetric.

### What a Validated Corridor Is Not

A validated corridor between Node A and Node B is not a ring. It is not evidence of ring membership. It is a directed behavioral relationship between two nodes. The ring analysis layer sits above corridor analysis and requires additional structure.

---

## 1.5 Minimum Ring Topology — Graph Theory Floor

**Formal definition:** A ring is a directed cycle in the corridor graph. The minimum cycle length in graph theory is 3 — three nodes with corridors connecting them such that traversal returns to the origin: A → B → C → A (or equivalently, a set of edges forming a closed loop).

**Two-node case:** A validated corridor between exactly two nodes is a corridor. It is not a ring. A ↔ B = corridor with bidirectional flow. This has its own analytical value but does not constitute ring topology.

**Three-node case:** Beverly ↔ EP ↔ Oak Lawn forms a candidate three-node cycle. Whether this constitutes a ring or a "tight corridor cluster" is an empirical question that Part 2 addresses. The graph theory minimum is 3; the behavioral minimum is a research question.

**Why this matters for the platform:** The `ourEventRings` product exists because the platform architecture supports multi-hop corridor analysis. The schema captures enough geographic and temporal resolution to identify cycle patterns. The analytical model for when a cycle qualifies as a ring is deferred to Part 2.

---

# PART 2: RESEARCH APPLICATIONS

> **Status: LIVING DOCUMENT — Analytical criteria DELIBERATELY DEFERRED**
> Part 2 grows as data accumulates. Ring emergence criteria are not pre-registered until sufficient corridor data exists to fit an appropriate cluster model. Sections marked **[DEFERRED]** will be completed when data warrants, with academic partnership validation.

---

## Governing Principle

The NCR infrastructure is built to capture the data that will eventually make the analytical model possible — not to predict its conclusions in advance.

Pre-registering arbitrary thresholds before data collection would impose theoretical structure on what is designed to be an empirically-derived geographic finding. The result would be a methodology that answers the question the researcher had in mind before collecting data, rather than the question the data is actually equipped to answer. That is not scientific discipline. It is confirmation bias with good documentation.

The correct sequence is:

1. Lock the infrastructure methodology (Part 1). ✅ Done.
2. Collect data across multiple seasons.
3. Explore corridor cluster structure with an academic partner.
4. Pre-register the analytical model _before_ running the confirmatory test.
5. Run the confirmatory test.
6. Lock Part 2.

---

## 2.1 Four Formal Problems for Ring Emergence

Ring emergence is not a single analytical question. It decomposes into four distinct formal problems, each of which must be resolved before a ring can be declared.

---

### Problem 1: Minimum Topology

**Question:** Is 3 the behavioral minimum for a ring, or does behavioral reality require more nodes before a cycle constitutes a meaningful community ring?

**Graph theory answer:** 3 is the floor. A cycle of length 3 is the smallest possible ring in graph theory.

**Behavioral research question:** Does a three-node cycle reflect genuine community circulation or is it an artifact of dense local geography? Beverly, EP, and Oak Lawn are geographically proximate. Their inter-connection may reflect proximity rather than a distinct ring identity.

**Resolution approach:** This is an empirical question. The data will reveal whether three-node cycles show qualitatively different behavioral signatures than two-node corridors. Minimum topology for behavioral ring classification is **[DEFERRED]** to Phase 2 analysis.

---

### Problem 2: Bidirectionality Requirement

**Question:** Must all corridors in a ring be bidirectional, or can a ring include unidirectional corridors?

A corridor can be unidirectional and still be scientifically valid (see §1.4). But a ring that includes only unidirectional corridors in one direction is topologically a spoke pattern with one hub, not a ring. The bidirectionality question is about what proportion and distribution of bidirectional corridors is required before a cycle qualifies as a ring.

Three candidate models:

#### Model 1: Strict Reciprocal (100%)

Every corridor in the ring must be bidirectional before the ring is declared.

- **Strength:** Scientifically cleanest. Easiest to operationalize.
- **Weakness:** Too strict for geographic reality. Structurally asymmetric corridors — Beverly families who spend summers in SW Michigan, for instance — would disqualify a ring that may be behaviorally genuine. Imposes a symmetry assumption the data may not support.
- **Status:** Candidate, likely too conservative.

#### Model 2: Majority Bidirectional (60–70% threshold)

Some threshold proportion of corridors in the ring must be bidirectional.

- **Strength:** Reflects the reality that some asymmetry exists in most geographic behavioral patterns.
- **Weakness:** The threshold (60%? 65%? 70%?) is arbitrary without baseline data. Pre-registering a number before data collection is precisely the problem this methodology is designed to avoid.
- **Status:** Candidate, threshold is **[DEFERRED]** pending baseline corridor data.

#### Model 3: Core/Periphery Bidirectionality (PREFERRED CANDIDATE)

The ring has a **core** — a set of nodes with full bidirectional corridor requirements between them — and a **periphery** — nodes that connect to the ring via validated unidirectional corridors without being required to complete reciprocal flow.

**Example:**

| Component             | Role      | Requirement                                                                                                                       |
| --------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Beverly, EP, Oak Lawn | Core      | All pairwise corridors must be bidirectional                                                                                      |
| SW Michigan venues    | Periphery | Connect via validated unidirectional seasonal corridor (Beverly → SW MI) without requiring SW MI → Beverly return flow to qualify |

- **Strength:** Maps most accurately to geographic and cultural reality. Seasonal satellite communities exist. Forcing them to meet symmetry requirements would systematically exclude legitimate ring periphery.
- **Weakness:** Requires pre-commitment to core vs. periphery classification _before_ data analysis. If core/periphery assignment is done post-hoc, it becomes a modeling choice dressed as a discovery.
- **Pre-registration requirement:** The core/periphery classification for candidate rings must be written down and locked before the dataset is analyzed for ring emergence. The infrastructure methodology (Part 1) is locked now. The core/periphery assignments are locked when corridor data reaches the Phase 2 analysis threshold.

**Resolution:** Cluster-hybrid models (Model 3 family) are better depictions of geographic reality than pure symmetry models. The specific parameterization of the cluster model is fitted to real behavioral data rather than invented in advance. Academic partnership with a quantitative social geographer (Northwestern or UChicago sociology/geography departments are the target partners) is required to co-design the statistical test and validate pre-registration.

---

### Problem 3: Temporal Consistency

**Question:** Can a ring be declared on a single season of data, or must it persist across multiple distinct time windows?

**Answer:** A corridor cluster that meets threshold in one season but not another is a seasonal activation pattern, not a ring. A ring requires behavioral persistence.

**Minimum temporal requirement:** A corridor cluster must meet the ring emergence threshold across **at least two distinct time windows** (operationally: different seasons, separated by at least one season of non-overlapping data collection). This rules out pure seasonal effects — e.g., a summer festival circuit that exists only in July and August — from qualifying as ring topology.

**Implementation note:** `scan_bucket` on the `scans` table provides the temporal granularity for this analysis. `scan_aggregates` pre-computes rollups at the `bucket_date` and `bucket_hour` level. Season assignment logic maps bucket dates to seasons and is defined in the analysis protocol (written at Phase 2).

**Status:** Temporal consistency requirement is **LOCKED** as a qualitative rule. The specific operationalization (which seasons, minimum gap, acceptable seasonality correction) is **[DEFERRED]** to Phase 2.

---

### Problem 4: Coincidental Cluster Problem

**Question:** How do we distinguish a genuine behavioral ring from a corridor cluster that would have formed between any three geographically proximate nodes regardless of shared community identity?

**This is the hardest problem.** Geographic proximity alone generates corridor-like patterns. Nodes that are close together will naturally show more cross-node behavioral signals than nodes that are far apart. A methodology that declares rings based solely on corridor cluster density without controlling for proximity would declare rings everywhere in dense urban environments.

**Required null hypothesis test:**

```
H₀: The observed corridor cluster between nodes A, B, and C is consistent with
    the baseline expected corridor activity between randomly selected nodes
    in the same geographic area and density class.

H₁: The observed corridor cluster is statistically distinguishable from
    chance, indicating non-random behavioral community connection.
```

**Implementation requirements:**

1. Establish a baseline corridor activity distribution for the NCR system across all node pairs in each density class (urban core, urban neighborhood, suburban, exurban).
2. Compute the observed corridor cluster strength for the candidate ring.
3. Apply the appropriate statistical test (specific test to be co-designed with academic partner — likely a permutation test or spatial autocorrelation measure).
4. Declare ring emergence only if the observed cluster is statistically distinguishable from the null distribution.

**Academic partner requirement:** This problem cannot be resolved without a collaborator who has expertise in spatial statistics and social network analysis. The platform can collect the data. It cannot design its own null hypothesis test without expert validation. This is not a limitation — it is the correct allocation of expertise.

**Status:** **[DEFERRED]** — academic partnership required. Candidate partner institutions: Northwestern (sociology, geography), UChicago (sociology, CRES). This is the primary Phase 2 analytical dependency.

---

## 2.2 Three Architectural Descriptions of the NCR System

The NCR system has three valid architectural descriptions, operating at different levels of abstraction. None of them is more correct than the others. They describe the same system from spatial, structural, and temporal perspectives.

---

### The Spider Web (Spatial Description)

Start at the Beverly/EP core. Two validated corridors form the first strand. Each new node adds a strand extending outward. Each additional validated corridor strengthens the connection between existing nodes.

As rings emerge, the web changes character. Isolated strands become part of a load-bearing structure. The web stops being a collection of point-to-point connections and becomes self-supporting architecture. A strand that breaks no longer brings down the whole structure because multiple paths exist between nodes.

The web strengthens inward simultaneously as it grows outward. Adding SW Michigan to the periphery does not just extend the web geographically — it retroactively clarifies the meaning of Beverly/EP/Oak Lawn core signals that predated SW Michigan's node activation.

---

### The Fractal (Structural Description)

The same analytical structure operates at every geographic scale:

| Scale                  | Example                                                   |
| ---------------------- | --------------------------------------------------------- |
| Venue-to-venue         | Cork n Kerry's bocce court ↔ adjacent bar ↔ nearby park |
| Community-to-community | Beverly ↔ Edgewater Park ↔ Oak Lawn                     |
| Metro-to-metro         | Chicago ↔ Milwaukee ↔ Detroit arc                       |
| Regional               | Midwest ring system                                       |

A venue-to-venue corridor has the same mathematical architecture as a metro-to-metro corridor. A three-node community ring operates on the same graph-theoretic logic as a three-city regional ring. The methodology does not change at different scales — it recurses.

This self-similarity is not an aesthetic observation. It is what makes the methodology genuinely scalable. The same infrastructure, the same signal taxonomy, the same corridor tracking rules, and the same ring emergence criteria apply at every level. What changes is the geographic resolution of the nodes.

---

### Reverberation (Temporal Description)

An event fires at a node. The behavioral signal travels outward through corridors. Adjacent nodes experience activation — probes appear at events they would not otherwise attend. Those probes generate new signals. The signals travel back through the corridors and arrive at the origin node differently than before — because the origin node's context is now better understood by virtue of what the outbound signal revealed.

The system does not just grow. It echoes back through itself.

Three specific reverberation effects:

1. **Nodes redefine corridors.** A new node that activates on an existing corridor changes the meaning of that corridor. Beverly → EP was a two-node corridor. Beverly → EP → Oak Lawn is a cycle candidate. The Beverly → EP corridor means something different once Oak Lawn is added.

2. **Corridors redefine rings.** A corridor that was isolated becomes ring-constituting once the cycle closes. The meaning of every corridor in a ring is upgraded when the ring is declared.

3. **Past data gets richer as present data accumulates.** A Beverly Class A scan from year one means something different after year three's ring emergence than it did when it was collected. The historical record is not static. It is continuously reinterpreted by new evidence. This is not data manipulation — it is the normal operation of science. The original raw data does not change; its interpretation within the model does.

This reverberation property is why the platform is designed as a longitudinal system rather than a point-in-time measurement tool. The longer it runs, the richer the historical dataset becomes — not just because more data was collected, but because each new data point retroactively clarifies the meaning of prior data.

---

## 2.3 Organic Data Growth — The Telephone Game

The platform does not require any participant to understand the research. It operates through ordinary community behavior.

Illustrative trace:

> Event at Cork n Kerry's. Attendee mentions the bocce tournament to a colleague at work on Monday. That colleague shows up to the tournament, scans the poster, signs up via the QR funnel — Class B signal generated. That person mentions the tournament to their family. Some family members attend an OurOpenTable event in a different node — another Class B signal, different node.

The platform captured this entire sequence. No individual thread was tracked. The aggregate effect is visible in node activation patterns across the corridor. The anonymous architecture means no individual privacy is compromised while the community-level behavioral pattern is captured.

**"You see the reverberation without seeing the individual."**

This is the design intent of the `user_agent_hash` architecture in `scans`. Individual attribution is architecturally prevented. Community-level pattern detection is architecturally enabled. These are not in tension — they are the same design decision.

---

## 2.4 Inter-Referencing as Self-Clarifying Engine

The NCR system is self-clarifying across time because its analytical objects (nodes, corridors, rings) are mutually defining:

- Validated corridors redefine what the nodes at their endpoints mean — a node is no longer isolated; it has demonstrated community reach.
- Discovered rings redefine what the corridors forming them mean — a corridor that is ring-constituting is categorically different from an isolated bilateral corridor.
- Better-understood nodes reveal corridor potentials that were not visible before ring emergence — because the research question changes once you know a ring exists.

This creates a continuously improving interpretation of prior data. A Beverly scan from year one sits in a different analytical context after year three's ring emergence. The raw data is unchanged. Its interpretive weight within the model is upgraded.

**The system revises the meaning of its history as it understands its present.** This is not a methodological flaw. It is the expected behavior of a longitudinal research instrument operating on social behavior in a complex system.

---

## 2.5 Commercial-Civic Convergence Flywheel

The NCR ring methodology creates a flywheel that unifies the commercial engine and the civic mission of the ourCommunityRituals platform.

**Flywheel trace:**

1. Brewery sponsors a bocce tournament (commercial transaction)
2. SharedReport validates Beverly → EP corridor (research output)
3. Corridor visibility attracts EP-area sponsor (commercial growth)
4. New EP sponsor funds new EP-area events (infrastructure growth)
5. New events generate new Class B signals (data growth)
6. Data contributes to ring emergence detection (research milestone)
7. Validated ring becomes visible to park district planners, school administrators, municipal agencies (institutional visibility)
8. Institutional partnerships generate new event infrastructure across nodes (flywheel accelerates)
9. New infrastructure generates new data → each layer feeds every other layer

The commercial engine and the civic research mission are the same flywheel. Optimizing for sponsor revenue optimizes for data collection quality. Optimizing for ring emergence methodology optimizes for sponsor value (because ring-validated corridors are demonstrable reach metrics). The interests are aligned by architecture, not by intention.

**At saturation:** The platform stops being an event company that also does community research. It becomes the shared instrument that commercial partners, civic institutions, and municipal planners all use to understand the communities they serve. A longitudinal, anonymous behavioral dataset that never expires, applied through a geographic methodology that scales fractally from a single bocce court to a multi-city regional ring system.

---

## 2.6 Pre-Registration Standard

Scientific discipline in this methodology is operationalized through pre-registration: the analytical criteria must be written down and locked _before_ the dataset is analyzed for the conclusion those criteria are meant to detect.

**What is locked now (Part 1):** Signal taxonomy, node definition rules, corridor tracking rules, minimum ring topology definition. These are infrastructure-level definitions. They govern data collection and do not depend on the analytical outcome.

**What is deferred (Part 2):** Ring emergence criteria — specifically the bidirectionality model parameterization (§2.1, Problem 2), the minimum topology behavioral floor (§2.1, Problem 1), temporal consistency operationalization (§2.1, Problem 3), and the null hypothesis test design (§2.1, Problem 4).

**When Part 2 locks:** When corridor data reaches Phase 2 analysis threshold AND an academic partnership agreement is in place. The academic partner co-designs the statistical test and co-signs the pre-registration. This is not a formality. The null hypothesis test (Problem 4) genuinely requires expertise in spatial statistics that the platform team does not currently hold.

**Pre-registration repository:** The locked Part 2 document will be filed at a pre-registration registry (OSF, AsPredicted, or equivalent) before confirmatory analysis begins. The timestamp of that filing is the scientific boundary between exploratory and confirmatory analysis.

---

## Change Log

| Date       | Section | Change                                                | Author                    |
| ---------- | ------- | ----------------------------------------------------- | ------------------------- |
| 2026-03-30 | All     | Initial document created from analytical conversation | Matt Zdanis / Claude Code |
