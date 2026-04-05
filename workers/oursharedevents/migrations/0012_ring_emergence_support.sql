-- Migration 0012: Ring Emergence Support
--
-- Addresses 3 structural gaps identified in CCR Loop 1 ring readiness audit:
--
--   1. BIDIRECTIONALITY: Corridors need directional flow tracking.
--      A ring requires reciprocal movement (A→B AND B→A).
--      Core nodes require full bidirectional; periphery can be unidirectional.
--
--   2. TEMPORAL CONSISTENCY: Ring emergence must be observable across
--      2+ distinct time windows (different seasons) to rule out
--      seasonal clusters masquerading as structural rings.
--
--   3. SIGNAL CLASS CLARIFICATION: Rename from ambiguous CLASS_A/CLASS_B
--      to explicit SIGNAL_PRESENCE / SIGNAL_BEHAVIORAL per NCR methodology.
--      - SIGNAL_PRESENCE = Class A scan (poster/tabletop, proves proximity)
--      - SIGNAL_BEHAVIORAL = Class B attendance (QR funnel, proves intent)
--
-- Ring topology minimum: 3+ nodes in a cycle (A ↔ B ↔ C ↔ A).
-- Spokes to a hub are corridors, not rings.

-- ─────────────────────────────────────────────────────────
-- Bidirectionality tracking on corridors
-- ─────────────────────────────────────────────────────────

-- Whether this corridor shows flow in both directions
-- UNIDIRECTIONAL  = signal observed in one direction only
-- BIDIRECTIONAL   = signal observed in both directions
-- UNKNOWN         = not yet measured
ALTER TABLE corridors ADD COLUMN directionality TEXT
  DEFAULT 'UNKNOWN'
  CHECK (directionality IN ('UNIDIRECTIONAL', 'BIDIRECTIONAL', 'UNKNOWN'));

-- ─────────────────────────────────────────────────────────
-- Ring role on nodes (core/periphery model)
-- ─────────────────────────────────────────────────────────

-- Core nodes must show full bidirectional flow to other core nodes
-- Periphery nodes can connect to the ring unidirectionally
-- Unclassified = not yet evaluated for ring membership
ALTER TABLE node_hierarchy ADD COLUMN ring_role TEXT
  DEFAULT 'UNCLASSIFIED'
  CHECK (ring_role IN ('CORE', 'PERIPHERY', 'UNCLASSIFIED'));

-- ─────────────────────────────────────────────────────────
-- Temporal validation fields on corridors
-- ─────────────────────────────────────────────────────────

-- When was signal first/last observed on this corridor?
ALTER TABLE corridors ADD COLUMN first_observed TEXT;
ALTER TABLE corridors ADD COLUMN last_observed TEXT;

-- How many distinct time windows (seasons) show validated signal?
-- Ring emergence requires >= 2 to rule out seasonality
ALTER TABLE corridors ADD COLUMN validation_window_count INTEGER DEFAULT 0;

-- Is this corridor seasonal or structural?
-- STRUCTURAL = signal persists across seasons
-- SEASONAL   = signal only appears in specific season(s)
-- UNKNOWN    = not enough data to determine
ALTER TABLE corridors ADD COLUMN temporal_pattern TEXT
  DEFAULT 'UNKNOWN'
  CHECK (temporal_pattern IN ('STRUCTURAL', 'SEASONAL', 'UNKNOWN'));

-- ─────────────────────────────────────────────────────────
-- Signal class migration: expand CHECK to include new values
-- Old: CLASS_A, CLASS_B (ambiguous)
-- New: SIGNAL_PRESENCE, SIGNAL_BEHAVIORAL (explicit)
-- Both old and new values accepted during transition
-- ─────────────────────────────────────────────────────────

-- D1/SQLite cannot ALTER CHECK constraints, so we drop and recreate
-- the column. For safety, we preserve data by migrating through
-- a temp column approach.

-- Step 1: Add new column with expanded CHECK
ALTER TABLE corridors ADD COLUMN signal_class TEXT
  DEFAULT 'SIGNAL_BEHAVIORAL'
  CHECK (signal_class IN (
    'CLASS_A', 'CLASS_B',                     -- legacy (transitional)
    'SIGNAL_PRESENCE', 'SIGNAL_BEHAVIORAL'    -- NCR v2 standard
  ));

-- Step 2: Copy existing data, translating old values
-- CLASS_A (was "high confidence" in old ADR) → SIGNAL_BEHAVIORAL
-- CLASS_B (was "hypothesized" in old ADR) → SIGNAL_PRESENCE
-- This corrects the inversion: behavioral signal IS the strong signal
UPDATE corridors SET signal_class = CASE
  WHEN corridor_signal_class = 'CLASS_A' THEN 'SIGNAL_BEHAVIORAL'
  WHEN corridor_signal_class = 'CLASS_B' THEN 'SIGNAL_PRESENCE'
  ELSE 'SIGNAL_BEHAVIORAL'
END;

-- Note: corridor_signal_class column retained for backwards compatibility
-- New code should use signal_class. Old column can be dropped in future migration.

-- ─────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_corridors_directionality
  ON corridors(directionality);

CREATE INDEX IF NOT EXISTS idx_corridors_temporal
  ON corridors(temporal_pattern);

CREATE INDEX IF NOT EXISTS idx_corridors_signal_class
  ON corridors(signal_class);

CREATE INDEX IF NOT EXISTS idx_node_hierarchy_ring_role
  ON node_hierarchy(ring_role);
