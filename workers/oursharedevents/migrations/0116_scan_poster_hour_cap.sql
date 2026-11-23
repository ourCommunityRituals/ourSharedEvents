-- Migration 0116: the per-poster-hour scan cap (Part of OSE-1496).
--
-- WHY. Owner decision 2026-11-23 (decision card): each poster counts at most
-- 100 scans in one hour, and a figure that reached the cap reads "100 or
-- more". It bounds how far anyone (an outsider, a sponsor, an organizer) can
-- inflate one poster's figures, whoever sends the scans and whatever cookie
-- they carry. The cap needs an atomic counter: the KV get-then-put in
-- lib/rate-limit.ts is eventually consistent and cannot hold a cap. Durable
-- Objects are deferred, so this is a D1 row updated with one
-- INSERT … ON CONFLICT DO UPDATE … RETURNING (lib/poster-hour-cap.ts).
--
-- WHAT. One row per poster per UTC hour: the poster id, the hour
-- ("YYYY-MM-DDTHH", the same grain as lib/scan-cells.ts) and how many scans
-- took a place, which stops at cap + 1. No person, browser, cookie, address or
-- location column: it is a count per placement per hour, a figure already
-- derivable from scan_placement_events. The cron job deletes rows older than
-- two days (index.ts), so the table holds at most two days of hours, and
-- needs no index beyond its key.
--
-- Invariant compliance:
--   #1  — counts only; no identity column.
--   #19 — > 0115, unique prefix, append-only, no table drop.
--   ADR-001 — MAIN DB only.

CREATE TABLE IF NOT EXISTS scan_poster_hour_tally (
  poster_deployment_id TEXT NOT NULL,
  scan_hour            TEXT NOT NULL,           -- "YYYY-MM-DDTHH" (UTC)
  scans                INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (poster_deployment_id, scan_hour)
) WITHOUT ROWID;
