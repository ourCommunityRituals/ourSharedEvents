-- Migration 0025: Event state machine — add 'ready' state and enforce valid transitions
-- OSE-199 / BE-12
--
-- SQLite does not support ALTER TABLE ADD CONSTRAINT, so enforcement is done
-- via BEFORE INSERT / BEFORE UPDATE triggers. Application layer also enforces
-- valid states through src/domain/event-state.ts.
--
-- Valid status values: draft | ready | active | archived
-- Valid transitions enforced by application code (see VALID_TRANSITIONS in event-state.ts):
--   draft    → ready | archived
--   ready    → active | draft | archived
--   active   → archived | ready
--   archived → active | draft

CREATE TRIGGER IF NOT EXISTS trg_events_status_insert
  BEFORE INSERT ON events
  FOR EACH ROW
  WHEN NEW.status NOT IN ('draft', 'ready', 'active', 'archived')
BEGIN
  SELECT RAISE(ABORT, 'Invalid event status: must be draft, ready, active, or archived');
END;

CREATE TRIGGER IF NOT EXISTS trg_events_status_update
  BEFORE UPDATE OF status ON events
  FOR EACH ROW
  WHEN NEW.status NOT IN ('draft', 'ready', 'active', 'archived')
BEGIN
  SELECT RAISE(ABORT, 'Invalid event status: must be draft, ready, active, or archived');
END;
