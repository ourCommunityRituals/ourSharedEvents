-- Migration 0045: Add geographic coordinates and H3 NCR cells to sponsors.
-- Enables capture-time geo-tagging of sponsor physical locations so the admin
-- UI can auto-suggest is_local based on corridor proximity to the event venue.
-- All columns nullable — existing rows unaffected, geo-tagging is opt-in.

ALTER TABLE sponsors ADD COLUMN lat REAL;
ALTER TABLE sponsors ADD COLUMN lon REAL;
ALTER TABLE sponsors ADD COLUMN h3_res9 TEXT;   -- NCR Node cell (res 9 ≈ 0.1 km²) at sponsor location
ALTER TABLE sponsors ADD COLUMN h3_res7 TEXT;   -- NCR Corridor cell (res 7 ≈ 5 km²) at sponsor location
