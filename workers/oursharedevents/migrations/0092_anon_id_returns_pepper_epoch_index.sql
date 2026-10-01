-- Migration 0092: index anon_id_returns(pepper_epoch) (OSE-1460 review).
--
-- The nightly materializer purges rows of any pepper other than the current
-- one, and the returns export reads only the current one. Without this index
-- both scan the whole longitudinal table every night, even when there is
-- nothing to purge. The purge predicate is written as
-- `pepper_epoch IS NULL OR pepper_epoch < ?1 OR pepper_epoch > ?1` so SQLite
-- can serve it with this index (a `<>` comparison cannot use one).
--
-- A separate migration, not an edit to 0091: 0091 is already applied on
-- staging, and an edited migration is never re-run.

CREATE INDEX IF NOT EXISTS idx_anon_id_returns_pepper_epoch ON anon_id_returns(pepper_epoch);
