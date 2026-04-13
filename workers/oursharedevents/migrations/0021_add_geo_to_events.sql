-- Migration 0021: Add geo columns to events
--
-- Enables hyperlocal sponsor matching: events with zip_code and/or
-- lat/lon can be matched against sponsor_areas.

ALTER TABLE events ADD COLUMN zip_code TEXT;
ALTER TABLE events ADD COLUMN lat REAL;
ALTER TABLE events ADD COLUMN lon REAL;
