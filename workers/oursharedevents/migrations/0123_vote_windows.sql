-- Migration 0123: voting windows run their full length, and a result cannot be
-- held back (OSE-2234; OSE ADR-040 decision 4, owner decision card 2026-11-26,
-- "No: windows run their full length"; CCR loop 5).
--
-- Two columns, each written once. NO TRIGGERS (migration 0025): the T0 gate
-- votes-never-who (rule 5) holds every statement that writes them to a
-- "<column> IS NULL" guard.
--
--   vote_sets.opened_at         The hour the set first opened, written by that
--                               open. The nightly final job treats a set as due
--                               30 days after it first opened, whatever the
--                               event's dates say, so moving the end date
--                               forward cannot hold a result back. Null for a
--                               set opened before this migration.
--
--   votable_objects.window_seconds  The window length an object opened with,
--                               written by its open, from draft. Every object
--                               of one kind in a set opens with the same
--                               length, so a host cannot give one entry a
--                               longer window than its rivals. Null until the
--                               object opens.
--
-- Adds columns only; writes no row. Invariant #19: > 0122, unique prefix,
-- append-only, no table drop. ADR-001: MAIN DB only.

ALTER TABLE vote_sets ADD COLUMN opened_at TEXT;

ALTER TABLE votable_objects ADD COLUMN window_seconds INTEGER
  CHECK (window_seconds IS NULL OR window_seconds BETWEEN 30 AND 43200);
