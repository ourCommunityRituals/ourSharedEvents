-- Migration 0011: Corridor Growth Model — Spiderweb, Fractal, Reverb
--
-- Corridors are not static point-to-point lines. They are living structures:
--
--   SPIDERWEB: A highway corridor branches into sub-corridors at every
--     intermediate point. I-94 East doesn't just connect Chicago→Detroit —
--     it spawns community corridors at every exit, town, school gym,
--     dance studio, and park along the route.
--
--   FRACTAL: The branching pattern repeats at every scale. A Level 5
--     highway corridor spawns Level 4 metro corridors, which spawn
--     Level 3 zone corridors, which spawn Level 1 community corridors.
--     Same pattern, every scale.
--
--   REVERB: Signal travels both directions and amplifies. An event in
--     one node generates awareness and attendance from connected nodes.
--     A bocce tournament in Beverly reverbs through Evergreen Park,
--     Hammond, and back. Signal doesn't decay — it compounds.
--
-- Growth sequence:
--   1. Sports leagues (bocce, rec leagues, pickup games)
--   2. Dance, gymnastics, school-funded gatherings
--   3. Post-legal clearance (HIPAA/COPPA): museums, art institutes,
--      school functions, every public/private event
--   4. Countryside expansion — where people actually live

-- ─────────────────────────────────────────────────────────
-- Add parent_corridor_id for fractal branching
-- ─────────────────────────────────────────────────────────
ALTER TABLE corridors ADD COLUMN parent_corridor_id TEXT
  REFERENCES corridors(id);

-- ─────────────────────────────────────────────────────────
-- Add growth pattern fields to corridors
-- ─────────────────────────────────────────────────────────

-- Growth pattern: how this corridor expands
-- SPIDERWEB = branching outward from route into surrounding communities
-- FRACTAL   = self-similar pattern replicating at smaller scale
-- REVERB    = signal echo between connected nodes amplifying engagement
ALTER TABLE corridors ADD COLUMN growth_pattern TEXT
  CHECK (growth_pattern IN ('SPIDERWEB', 'FRACTAL', 'REVERB'));

-- Reverb strength: 0.0 (no echo) to 1.0 (full signal propagation)
-- Measures how strongly events in one node generate attendance from connected nodes
ALTER TABLE corridors ADD COLUMN reverb_strength REAL;

-- ─────────────────────────────────────────────────────────
-- Add event vertical tracking to nodes
-- ─────────────────────────────────────────────────────────

-- JSON array of event verticals active at this node
-- e.g. ["sports", "dance", "school", "museum", "community"]
-- Tracks what types of events have activated this node
ALTER TABLE node_hierarchy ADD COLUMN event_verticals TEXT;

-- Legal clearance tier for sensitive verticals
-- OPEN       = sports, dance, general community (no special clearance)
-- RESTRICTED = school functions, youth events (COPPA compliance required)
-- REGULATED  = healthcare-adjacent, museum partnerships (HIPAA/institutional)
ALTER TABLE node_hierarchy ADD COLUMN legal_clearance_tier TEXT
  DEFAULT 'OPEN'
  CHECK (legal_clearance_tier IN ('OPEN', 'RESTRICTED', 'REGULATED'));

-- ─────────────────────────────────────────────────────────
-- Indexes for growth queries
-- ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_corridors_parent
  ON corridors(parent_corridor_id);

CREATE INDEX IF NOT EXISTS idx_corridors_growth_pattern
  ON corridors(growth_pattern);

CREATE INDEX IF NOT EXISTS idx_node_hierarchy_legal_tier
  ON node_hierarchy(legal_clearance_tier);
