-- OSE-798 (A1) — Split the scan path (doctrine rule 6).
-- "No durable row carries both a session-derived value and a placement id."
-- The shipped `scans` table carried poster_deployment_id (placement) AND
-- anonymous_id/user_agent_hash (session-derived) in one row, with an index
-- making the forbidden correlation a single seek. `scans` = 0 rows in every
-- environment at authoring time, so this is a FREE structural fix now and an
-- attendee-PII migration after the first write — the one migration we never
-- want to run later. Unblocks OSE-625 (ingestion) + OSE-563 (anti-logging proof).

-- Placement side: WHERE a physical scan happened. No session-derived column, ever.
CREATE TABLE IF NOT EXISTS scan_placement_events (
  id                   TEXT PRIMARY KEY,
  event_id             TEXT NOT NULL,
  poster_deployment_id TEXT NOT NULL,
  scan_bucket          TEXT NOT NULL,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (poster_deployment_id) REFERENCES poster_deployments(id)
);
CREATE INDEX IF NOT EXISTS idx_spe_event_poster
  ON scan_placement_events(event_id, poster_deployment_id);

-- Return/session side: WHO returned to a node. No placement id, ever.
-- Carries only the session-derived aggregation inputs the SharedReport rollup
-- needs at EVENT/BUCKET level (never per-placement): anonymous_id, the
-- user_agent_hash fallback for unique_agents, and country_code for top_country.
-- region_code + referrer_domain from the old table are dropped as unused.
CREATE TABLE IF NOT EXISTS scan_node_returns (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL,
  anonymous_id    TEXT,
  user_agent_hash TEXT,
  country_code    TEXT,
  scan_bucket     TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES events(id)
);
CREATE INDEX IF NOT EXISTS idx_snr_event_bucket
  ON scan_node_returns(event_id, scan_bucket);

-- Retire the combined table + the correlating index. scans = 0 → no data to move.
DROP INDEX IF EXISTS idx_scans_anonymous;
DROP TABLE IF EXISTS scans;
