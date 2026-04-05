# NCR Methodology — Neighborhood Community Rituals

> Pillar 5: Geo-spatial intelligence from anonymous event data.
> The horizon that gives accumulated scan data its purpose.

---

## What NCR Is

**NCR (Neighborhood Community Rituals)** is the methodology for extracting hyperlocal economic intelligence from anonymized event data. It's not a product — it's what the data becomes when enough events accumulate across enough venues and neighborhoods.

The platform doesn't need NCR to be useful today. Registration counts, check-in headcounts, and survey ratings serve event organizers right now. NCR is what makes the data **compound** — transforming individual event metrics into community-wide patterns.

```
One event     → "42 people checked in tonight"
Ten events    → "Thursdays at this venue draw 3x more than Tuesdays"
100 events    → "This 4-block radius has the highest engagement density on the south side"
1000 events   → Hyperlocal economic map of community gathering patterns
```

---

## The Three Phases

### Phase 1: Event Automation (Now)

The current state. Individual events generate anonymous scan data. Each event is a self-contained analytics unit.

**Data generated per event:**

- Scan counts by hourly bucket
- Unique device classes (user agent hash)
- Country/region from CF headers
- Poster deployment locations (lat/lng)
- Form submission counts (registrations, check-ins, surveys, emails)
- Sponsor placement attribution

**Value:** Organizers and sponsors see per-event metrics. "How many people came?" "Which sponsor placement got the most scans?" "What was the average rating?"

### Phase 2: Pattern Recognition (Next)

Cross-event aggregation begins. The platform starts answering questions that no single event can answer alone.

**Questions this phase answers:**

- Which venues draw the most engagement?
- What day/time combinations work best for which event types?
- Which sponsors perform consistently vs. one-off spikes?
- How does weather/season affect attendance patterns?
- Which neighborhoods are under-served by events?

**Data pipeline:**

```
scan_aggregates (per event)
        │
        ▼
Cross-event rollup by:
  - venue (poster_deployment lat/lng clustering)
  - time (bucket_date + bucket_hour patterns)
  - event type (from event data_json)
  - sponsor (click_token + impression_token patterns)
        │
        ▼
Pattern tables:
  - venue_performance (engagement by location)
  - time_patterns (engagement by day/hour)
  - sponsor_performance (attribution across events)
```

**Value:** Event organizers choose better venues and times. Sponsors allocate budgets to highest-performing events. The platform recommends optimal scheduling.

### Phase 3: Geo-Spatial Intelligence (Horizon)

The full NCR vision. AI processing of accumulated scan data produces hyperlocal economic maps.

**What becomes possible:**

- Scan density maps showing where community engagement concentrates
- Hyperlocal economic mapping: "this block has 3x engagement on Thursdays"
- Community planning signals: where to invest, where events thrive
- Neighborhood health indicators based on gathering patterns
- Real signal for urban planning, local business development, sponsor ROI

**The key insight:** This intelligence is derived entirely from **anonymous presence signal**. No individual is tracked. The value comes from volume and geography, not from personal data.

---

## The Data Model That Makes It Possible

The database schema was designed for NCR from day one, even though NCR is a future capability. Every table in the anonymous scan system serves a role in the geo-spatial pipeline.

### `poster_deployments` — The Physical Layer

```sql
CREATE TABLE poster_deployments (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL,
  qr_token        TEXT NOT NULL UNIQUE,
  placement_label TEXT,         -- "entrance", "sponsor table", "bar"
  location_desc   TEXT,         -- human-readable location
  latitude        REAL,         -- geo-spatial anchor
  longitude       REAL,         -- geo-spatial anchor
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Every physical QR code placement is a **geo-spatial anchor**. The lat/lng tells us exactly where in the physical world engagement happened. At scale, these anchors become a map of community gathering points.

### `scans` — The Signal Layer

```sql
CREATE TABLE scans (
  id                    TEXT PRIMARY KEY,
  event_id              TEXT NOT NULL,
  poster_deployment_id  TEXT NOT NULL,    -- links to physical location
  scan_bucket           TEXT NOT NULL,    -- hourly time window
  user_agent_hash       TEXT,             -- device class (not individual)
  country_code          TEXT,
  region_code           TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Each scan is an anonymous interaction event linked to a physical location via `poster_deployment_id`. The `scan_bucket` provides temporal resolution. Together, they answer: "how many interactions happened at this spot during this hour?"

### `scan_aggregates` — The Intelligence Layer

```sql
CREATE TABLE scan_aggregates (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL,
  bucket_date     TEXT NOT NULL,          -- daily rollup
  bucket_hour     INTEGER,               -- 0-23
  total_scans     INTEGER NOT NULL DEFAULT 0,
  unique_agents   INTEGER NOT NULL DEFAULT 0,
  top_country     TEXT,
  top_region      TEXT,
  computed_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Pre-computed rollups written by a scheduled Worker. These become the input for NCR analytics — no query-time aggregation needed. At scale, cross-event rollups of this table produce the density maps.

### `sponsors` — The Economic Layer

The sponsors table tracks `click_token` and `impression_token` per sponsor per event. When aggregated across events and venues, this reveals which locations and event types generate the most sponsor ROI — the economic signal that makes NCR valuable to local businesses.

---

## NCR Data Pipeline (Future)

```
Physical World                    Digital Layer                    Intelligence Layer
──────────────                    ─────────────                    ──────────────────

QR codes at venues ──────→ poster_deployments (lat/lng) ──→ ┐
                                                              │
Attendees scan codes ────→ scans (bucket, agent, region) ──→ ├─→ scan_aggregates
                                                              │     (hourly rollups)
Sponsors tracked ────────→ sponsors (click, impression) ──→ ┘         │
                                                                       ▼
                                                              Cross-event rollup
                                                                       │
                                                              ┌────────┴────────┐
                                                              │                 │
                                                        Density Maps    Performance
                                                        (geo-spatial)    Patterns
                                                              │         (temporal)
                                                              │                 │
                                                              └────────┬────────┘
                                                                       │
                                                                       ▼
                                                              NCR Intelligence
                                                              ─────────────────
                                                              Venue optimization
                                                              Sponsor allocation
                                                              Community planning
                                                              Economic indicators
```

---

## Future Audiences

NCR unlocks audiences that individual event analytics cannot serve:

| Audience                        | What NCR Gives Them                                                        | Data Source                                    |
| ------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| **Government**                  | Venue utilization data, public event density, community gathering patterns | scan_aggregates + poster_deployments (lat/lng) |
| **Policy Makers**               | Evidence-based community investment signals, engagement equity metrics     | Cross-neighborhood scan density comparison     |
| **Public Services**             | Library/community center event performance, nonprofit event analytics      | scan_aggregates filtered by venue type         |
| **Researchers**                 | Anonymized community engagement datasets, neighborhood economic indicators | Full NCR dataset export (anonymized)           |
| **Urban Planners**              | Where people gather, when, and how often — without surveillance            | Geo-spatial density maps by time period        |
| **Local Business Associations** | Which blocks have the most foot traffic, which events drive commerce       | Sponsor attribution + scan density overlay     |

---

## Why Anonymous ID Enables NCR

NCR is only possible **because** the data is anonymous:

1. **No retention liability** — Anonymous scan data can be kept forever. PII data creates legal obligations that grow with time. NCR needs years of data to produce meaningful patterns.

2. **No consent friction** — Attendees don't need to agree to "tracking" because there is no tracking. Every scan is an anonymous presence signal. This means higher scan rates and better data.

3. **No de-anonymization risk** — Even if NCR datasets are shared with government or researchers, there is no individual to identify. The data is aggregate by design, not by post-processing.

4. **Cross-event aggregation is safe** — Correlating scan data across events doesn't create a behavioral profile of an individual. It creates a behavioral profile of a **location** — which is exactly what NCR needs.

5. **Public trust** — Communities will share event data with planners and researchers if they trust the system isn't tracking individuals. Anonymous ID makes that trust architecturally provable.

---

## The ourEventRings Connection

**ourEventRings** is the planned sibling product that focuses on research and data analysis from ourSharedEvents data. While ourSharedEvents handles event automation (Phases 1-2), ourEventRings will handle NCR analytics (Phase 3).

| Product             | Scope                                                 | Data                                                 |
| ------------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| **ourSharedEvents** | Event automation, forms, surfaces, sponsor management | Raw scan data, form submissions, feature flags       |
| **ourEventRings**   | Research, NCR analytics, geo-spatial intelligence     | Aggregated scan data, density maps, pattern analysis |

The separation ensures that event operations and intelligence analytics evolve independently. ourSharedEvents remains fast and focused on serving events. ourEventRings can run expensive analytics without affecting event performance.

---

## Measuring NCR Readiness

NCR becomes meaningful at specific data density thresholds:

| Metric                  | Threshold for Meaningful NCR               | Current State |
| ----------------------- | ------------------------------------------ | ------------- |
| Events per neighborhood | 50+ events in a 1-mile radius              | Pre-launch    |
| Scan density            | 10,000+ scans per neighborhood per quarter | Pre-launch    |
| Venue diversity         | 10+ unique venues per neighborhood         | Pre-launch    |
| Temporal coverage       | 12+ months of continuous data              | Pre-launch    |
| Sponsor participation   | 20+ sponsors with attribution data         | Pre-launch    |

The platform needs to reach **event automation maturity** (Phase 1-2) before NCR becomes actionable. The schema is ready. The data pipeline is designed. The events need to happen.

---

## Cross-References

- [PLATFORM-FLOW.md](PLATFORM-FLOW.md) — Pillar 1: The event lifecycle that generates scan data
- [ANONYMOUS-ID.md](ANONYMOUS-ID.md) — Pillar 2: Why the data is safe to keep and aggregate
- [UEC-CODES.md](UEC-CODES.md) — Pillar 4: The QR codes that generate scans
- [VISION.md](VISION.md) — The NCR horizon section in the platform vision
