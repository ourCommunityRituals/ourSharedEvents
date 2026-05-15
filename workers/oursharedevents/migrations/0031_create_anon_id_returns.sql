-- Migration 0031: anon_id_returns — return rate aggregate (OSE-272 Session 2)
--
-- This table feeds SharedReport field #2 (return rate: % of anon-IDs seen at
-- prior events at this venue). It's the first table in the OSE-272 data
-- pipeline. Background + design contract:
-- docs/features/SHARED-REPORT-DATA-PIPELINE.md
--
-- Anonymity invariants (CI-enforced via tests/shared-report-pipeline-invariants.spec.ts):
--
--   1. The column anon_id_hash stores SHA-256(anon_id || ANON_ID_HASH_PEPPER)
--      truncated to 32 hex chars. NEVER the raw anon_id.
--   2. No column named `anon_id` (raw) appears in this table — the static gate
--      will fail any future migration that adds one.
--   3. This table lives in main DB (NOT FORMS_DB). Architectural isolation
--      per ADR-001 — non-forms handlers MUST NEVER read FORMS_DB and
--      vice-versa. SharedReport aggregates are NOT per-attendee form data;
--      they're per-event aggregate signal, so main DB is the correct home.
--   4. WRITTEN BY SCHEDULED WORKER ONLY (same discipline as scan_aggregates,
--      migration 0006). User-facing endpoints MUST NOT write here.
--   5. The hash uses ANON_ID_HASH_PEPPER — a NET-NEW Wrangler secret distinct
--      from IP_HASH_PEPPER (OSE-207). Per Q1 ratified decision
--      (2026-05-15): separate peppers + separate rotation cadence so the
--      two anonymity scopes (per-attendee event correlation vs. rate-limit
--      subscriber identity) have independent compromise blast radii.
--
-- Materialization:
--
--   Hourly cron worker (src/handlers/shared-report-materialize.ts in
--   Session 3) reads scan telemetry events by venue, hashes anon_id with
--   pepper, and upserts the row. Return rate at SharedReport read time:
--
--     COUNT(*) WHERE venue_id = ? AND visit_count > 1
--     ─────────────────────────────────────────────────  × 100%
--     COUNT(*) WHERE venue_id = ?
--
-- Q3 ratified (2026-05-15): the "lifetime" window for return rate is bounded
-- naturally by the 1-year anon_id cookie TTL. No additional windowing is
-- imposed at the table level.

CREATE TABLE IF NOT EXISTS anon_id_returns (
  anon_id_hash    TEXT NOT NULL,                              -- SHA-256(anon_id||ANON_ID_HASH_PEPPER)
  venue_id        TEXT NOT NULL,                              -- the venue's anchor event_id
  first_seen_at   TEXT NOT NULL,                              -- ISO date, 15-min bucket-quantized
  last_seen_at    TEXT NOT NULL,                              -- ISO date, 15-min bucket-quantized
  visit_count     INTEGER NOT NULL DEFAULT 1,
  computed_at     TEXT NOT NULL DEFAULT (datetime('now')),    -- when cron last touched this row
  PRIMARY KEY (anon_id_hash, venue_id),
  FOREIGN KEY (venue_id) REFERENCES events(id)
);

-- Hot path: SharedReport read pattern computes return rate for a venue at
-- materialization time. The (venue_id, visit_count) index lets the
-- "visit_count > 1" filter use the index directly.
CREATE INDEX IF NOT EXISTS idx_anon_id_returns_venue_visit
  ON anon_id_returns(venue_id, visit_count);
