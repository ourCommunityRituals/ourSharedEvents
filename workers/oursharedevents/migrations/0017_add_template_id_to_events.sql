-- Migration 0017: Add template_id column to events table
-- Links events to event_templates (ADR-010).
-- Nullable — events created before templates exist will have NULL.

ALTER TABLE events ADD COLUMN template_id TEXT;
