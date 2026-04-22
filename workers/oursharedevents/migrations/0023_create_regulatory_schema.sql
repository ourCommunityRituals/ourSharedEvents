-- Migration 0023: Regulatory Phase Schema — event_type_registry + corridor_regulatory_status
--
-- Two-axis gating model foundation (OSE-138 / REG-6):
--
--   Axis 1 (Payment):    Free / Mid / Enterprise — monetization tier (existing flag system)
--   Axis 2 (Regulatory): Phase 1-5 — compliance ceiling per corridor
--
-- Phase ceiling per corridor:
--   Phase 1 — Community/recreational (no permit required): bocce, block parties, markets
--   Phase 2 — Commerce layer: PCI DSS, ticketed events, vendor fairs
--   Phase 3 — Licensed activities: state licensing, civic/advocacy, gambling charity
--   Phase 4 — HIPAA layer: health events, medical, institutional partnerships
--   Phase 5 — COPPA layer: youth events, school functions, parental consent

-- ─────────────────────────────────────────────────────────
-- event_type_registry
-- Catalog of all event types with phase mapping and UEC code.
-- Populated by REG-1 seed (OSE-133). FK target for events.event_type_id.
-- ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS event_type_registry (
  id                   TEXT PRIMARY KEY,
  uec_code             TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  description          TEXT,
  phase                INTEGER NOT NULL DEFAULT 1 CHECK (phase BETWEEN 1 AND 5),
  legal_clearance_tier INTEGER NOT NULL DEFAULT 1,
  regulatory_notes     TEXT,
  is_active            INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_event_type_registry_phase
  ON event_type_registry(phase);

CREATE INDEX IF NOT EXISTS idx_event_type_registry_uec
  ON event_type_registry(uec_code);

-- ─────────────────────────────────────────────────────────
-- corridor_regulatory_status
-- Tracks which regulatory phase each corridor has unlocked.
-- One row per corridor; UNIQUE(corridor_id) enforces single-phase-ceiling.
-- Override at corridor level via feature_flags (scope='corridor').
-- ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS corridor_regulatory_status (
  id              TEXT PRIMARY KEY,
  corridor_id     TEXT NOT NULL UNIQUE,
  phase_unlocked  INTEGER NOT NULL DEFAULT 1 CHECK (phase_unlocked BETWEEN 1 AND 5),
  unlocked_at     TEXT NOT NULL DEFAULT (datetime('now')),
  notes           TEXT,
  FOREIGN KEY (corridor_id) REFERENCES corridors(id)
);

CREATE INDEX IF NOT EXISTS idx_corridor_regulatory_status_corridor
  ON corridor_regulatory_status(corridor_id);

-- ─────────────────────────────────────────────────────────
-- events table: regulatory columns
-- legal_clearance_tier mirrors the phase ceiling for quick query filtering.
-- event_type_id references event_type_registry for type-specific rules.
-- ─────────────────────────────────────────────────────────

ALTER TABLE events ADD COLUMN legal_clearance_tier INTEGER DEFAULT 1;
ALTER TABLE events ADD COLUMN event_type_id TEXT;
