-- Migration 0029: Add 5W content + corridor_id to events
--
-- OSE-236 / BE-22 — closes a latent Brain contract gap:
-- src/lib/pool-contract.ts:65 already declares `corridor_id` as a
-- REQUIRED_TAG on every record this product emits to BigQuery, but
-- events.corridor_id didn't physically exist as a column. This
-- migration makes the runtime contract realizable on the events table.
--
-- The 5W content columns (what/who/why/how/where) are the substantive
-- payload that makes a shared event link forward-able — without them,
-- a `ose.link/abc123` paste into a text message has nothing to render
-- on the recipient side. FEAT-03.2 (lifecycle public page) consumes
-- these directly; FEAT-03.3 (OG preview) renders them into share cards.
--
-- AC corrections from the original spec (per ground-truth investigation
-- 2026-05-14):
--   - corridor_id is TEXT, not INTEGER. corridors.id is `TEXT PRIMARY KEY`
--     (migrations/0010:35-36). FK type-affinity invariant gate (PR #154)
--     enforces this on CI.
--   - No venue_lat/venue_lng additions. Migration 0021 already added
--     events.lat + events.lon; this story reuses them. Renaming would be
--     a breaking change for any consumer of the geo data already
--     populated.
--   - No pool-contract.ts changes. The original AC referenced a
--     "BIGQUERY_DATASETS streaming-insert schema" step but that target
--     does not exist in pool-contract.ts (it carries pool routing +
--     REQUIRED_TAGS only). corridor_id is ALREADY in REQUIRED_TAGS;
--     this migration closes the gap from the schema side.
--
-- All new columns are nullable to preserve backward compatibility with
-- the existing staging events. Non-goals (handled in downstream stories):
--   - Admin form to capture these at creation → OSE-239
--   - Geocoding service to derive lat/lon/corridor_id from address → OSE-238
--   - Shortlink generation → OSE-240
--   - Public lifecycle page rendering → OSE-241 / OSE-243 / OSE-244 / OSE-245

-- 5W content (substantive payload for shareable event links)
ALTER TABLE events ADD COLUMN what_short    TEXT;   -- 1-2 sentence share description
ALTER TABLE events ADD COLUMN who_host      TEXT;   -- host/organizer display name
ALTER TABLE events ADD COLUMN why_purpose   TEXT;   -- why is this happening
ALTER TABLE events ADD COLUMN how_details   TEXT;   -- price, what to bring, what to expect
ALTER TABLE events ADD COLUMN where_address TEXT;   -- human-readable address (display copy)

-- Corridor reference (closes pool-contract.ts REQUIRED_TAG gap).
-- TEXT to match corridors.id PRIMARY KEY type.
ALTER TABLE events ADD COLUMN corridor_id   TEXT REFERENCES corridors(id);
