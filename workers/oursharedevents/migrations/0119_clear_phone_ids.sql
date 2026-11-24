-- Migration 0119: clear the stored phone ids (Part of OSE-2214, PR 3).
--
-- WHY. Owner, 2026-11-23: "This should not be counting people, but traffic of
-- the clicks on in the events ... The system is not tracking the person, but qr
-- code." Since PR 1 (#1531) a poster scan sets no cookie and stores no phone id,
-- and since PR 2 (#1534) the report counts scans on the code and has no return
-- rate. Nothing reads or writes these values any more; this clears the ones
-- already stored, so OSE holds nothing that tells one phone from another.
--
-- WHAT.
--   1. anon_id_returns: every row goes. Each row was one phone's peppered hash
--      per event, for the retired return rate (migration 0031). The nightly job
--      that wrote it and the BigQuery export that read it are retired in the
--      same change. The table stays (empty) until a later migration drops it,
--      so a Worker version still running during the deploy finds it.
--   2. scan_node_returns: the keyed scan id and the browser-name hash are
--      cleared. The rows stay, so every scan total is unchanged.
--   3. scan_aggregates: the per-hour distinct-browser figure becomes 0, as the
--      nightly roll-up now writes it. Scan totals are unchanged.
--
-- Idempotent: a second run finds nothing to clear.
--
-- Invariant compliance:
--   #1 / #7 — never who, only how many: removes the last per-phone values.
--   #19 — > 0118, unique prefix, append-only, no table drop.
--   ADR-001 — MAIN DB only.

DELETE FROM anon_id_returns;

UPDATE scan_node_returns SET anonymous_id = NULL, user_agent_hash = NULL
 WHERE anonymous_id IS NOT NULL OR user_agent_hash IS NOT NULL;

UPDATE scan_aggregates SET distinct_agent_hashes = 0
 WHERE distinct_agent_hashes <> 0;
