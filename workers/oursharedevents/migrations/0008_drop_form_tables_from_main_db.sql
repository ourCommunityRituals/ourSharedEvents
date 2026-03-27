-- Migration 0008: Remove checkins and registrations from main DB.
-- These tables were created in 0005 before the 4-layer forms spec.
-- Form data belongs in FORMS_DB (separate database), not alongside scans.

DROP TABLE IF EXISTS checkins;
DROP TABLE IF EXISTS registrations;

DROP INDEX IF EXISTS idx_checkins_event_id;
DROP INDEX IF EXISTS idx_registrations_event_id;
DROP INDEX IF EXISTS idx_registrations_source_placement;
