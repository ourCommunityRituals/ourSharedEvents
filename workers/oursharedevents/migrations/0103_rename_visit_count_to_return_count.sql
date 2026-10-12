-- Migration 0103: anon_id_returns.visit_count becomes return_count (OSE-932).
--
-- "Visit" is on the banned lexicon: it claims a person came to a place. The
-- honest word is a return, aligned to the table (anon_id_returns), as written
-- in docs/architecture/HONESTY-LEXICON.md. The schema-lexicon gate flagged the
-- column and its index, and they were held as exemptions pointing here.
--
-- What changes: the column name and the index name. Nothing else, and no row:
-- RENAME COLUMN keeps every value, and the index definition follows the
-- column. The column does not leave the database: the BigQuery return export
-- counts distinct events, never this column (docs/features/SHARED-REPORT-
-- BIGQUERY-EXPORT.md), so no wire contract moves.
--
-- Not changed: what the column counts. It is bumped once per run of the nightly
-- job that sees the pseudonym at the venue, so it counts runs, not returns, and
-- nothing reads it for a return rate (OSE-1652). The name follows the lexicon.
--
-- SQLite renames an index only by dropping and recreating it.

ALTER TABLE anon_id_returns RENAME COLUMN visit_count TO return_count;

DROP INDEX IF EXISTS idx_anon_id_returns_venue_visit;
CREATE INDEX IF NOT EXISTS idx_anon_id_returns_venue_return
  ON anon_id_returns(venue_id, return_count);
