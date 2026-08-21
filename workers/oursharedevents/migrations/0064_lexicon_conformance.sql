-- OSE-801 (A4, milestone M0) — the honesty lexicon at the persistence layer.
-- Two banned words (per Invariant #25 / the honesty doctrine) are column names,
-- so every ORM type, export header, log line and error message inherits them.
-- A surface lint that stops at the boundary while storage speaks the banned
-- vocabulary is aspirational, and gets routed around by accident.
--
--   scan_aggregates.unique_agents   → distinct_agent_hashes   ("unique" — the
--       re-identification hint; the column already holds COUNT(DISTINCT hash),
--       not a per-person "unique visitors" figure, so the honest name is the
--       distinct-hash count it computes.)
--   sponsors.impression_token       → display_token           ("impression" —
--       the ad-tech audience claim; OSE's honest word is "display" = an ad
--       rendered on screen. Pure lexical rename, no substance change.)
--
-- Both tables are EMPTY in every environment at authoring time (scans/sponsors
-- = 0), so this is a free structural fix now and a coordinated data rename
-- later. RENAME COLUMN preserves the sponsors.display_token TEXT UNIQUE
-- constraint (a column constraint, not a named index).
--
-- The paired lint (tests/schema-lexicon.spec.ts) reads the built schema
-- (sqlite_master + PRAGMA) and goes red if any future migration reintroduces a
-- banned-word identifier. Tracked exemptions (sponsor_impressions → OSE-931,
-- anon_id_returns.visit_count → OSE-932) carry their own reconciliation ticket.

ALTER TABLE scan_aggregates RENAME COLUMN unique_agents TO distinct_agent_hashes;
ALTER TABLE sponsors        RENAME COLUMN impression_token TO display_token;
