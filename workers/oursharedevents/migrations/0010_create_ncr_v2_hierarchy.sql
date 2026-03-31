-- Migration 0010: NCR v2 Hierarchy + Corridor Schema
-- Adds 7-level geographic node hierarchy and corridor signal taxonomy
-- per NCR v2 methodology alignment.
--
-- Node Hierarchy (7 Levels):
--   1 = Community   (neighborhood block, single venue cluster)
--   2 = District    (multi-block area, ward-level)
--   3 = Zone        (neighborhood, e.g. Bronzeville, Beverly)
--   4 = Metro       (city-level, e.g. Chicago)
--   5 = Region      (multi-city corridor, e.g. Chicago→Detroit I-94)
--   6 = Territory   (state/multi-state, e.g. Great Lakes)
--   7 = Network     (full platform network)

-- ─────────────────────────────────────────────────────────
-- Node Hierarchy Table
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS node_hierarchy (
  id              TEXT PRIMARY KEY,
  brand_id        TEXT NOT NULL,
  name            TEXT NOT NULL,
  level           INTEGER NOT NULL CHECK (level BETWEEN 1 AND 7),
  level_label     TEXT NOT NULL,           -- human-readable: 'Community', 'District', etc.
  parent_node_id  TEXT,                    -- self-referential FK for tree structure
  latitude        REAL,                    -- centroid lat for geo-spatial
  longitude       REAL,                    -- centroid lng for geo-spatial
  metadata_json   TEXT,                    -- extensible properties
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (parent_node_id) REFERENCES node_hierarchy(id)
);

-- ─────────────────────────────────────────────────────────
-- Corridors Table (Level 5+ geographic connections)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corridors (
  id                      TEXT PRIMARY KEY,
  brand_id                TEXT NOT NULL,
  name                    TEXT NOT NULL,
  origin_node_id          TEXT NOT NULL,
  destination_node_id     TEXT NOT NULL,
  corridor_signal_class   TEXT NOT NULL DEFAULT 'CLASS_B'
                          CHECK (corridor_signal_class IN ('CLASS_A', 'CLASS_B')),
  corridor_status         TEXT NOT NULL DEFAULT 'HYPOTHESIZED'
                          CHECK (corridor_status IN ('HYPOTHESIZED', 'VALIDATED')),
  separation_blur_index   REAL,           -- 0.0 (sharp boundary) to 1.0 (fully blurred)
  level                   INTEGER NOT NULL DEFAULT 5
                          CHECK (level BETWEEN 1 AND 7),
  route_designation       TEXT,           -- e.g. 'I-94 East', 'I-55'
  metadata_json           TEXT,           -- extensible properties
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (origin_node_id) REFERENCES node_hierarchy(id),
  FOREIGN KEY (destination_node_id) REFERENCES node_hierarchy(id)
);

-- ─────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_node_hierarchy_brand_level
  ON node_hierarchy(brand_id, level);

CREATE INDEX IF NOT EXISTS idx_node_hierarchy_parent
  ON node_hierarchy(parent_node_id);

CREATE INDEX IF NOT EXISTS idx_corridors_brand
  ON corridors(brand_id);

CREATE INDEX IF NOT EXISTS idx_corridors_status
  ON corridors(corridor_status);

CREATE INDEX IF NOT EXISTS idx_corridors_signal_class
  ON corridors(corridor_signal_class);
