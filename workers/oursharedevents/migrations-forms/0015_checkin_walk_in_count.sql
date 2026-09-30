-- Migration 0015: per-arrival-path check-in counter (OSE-1373)
--
-- The post-event recap shows a Walk-in line: how many check-ins arrived through
-- the WALK-IN path (the door page's "walk-in" button) rather than the plain
-- check-in tap. checkin_counts has always been a running count per event with
-- no per-person rows (migration 0002); the path is recorded the same way — a
-- second running count, incremented by the check-in handler from the request's
-- own `arrival_path` categorical.
--
-- Never-who: this is a count PER ARRIVAL PATH. It is never derived by matching a
-- registration to a check-in, and nothing about who checked in decides it.

ALTER TABLE checkin_counts ADD COLUMN walk_in_count INTEGER NOT NULL DEFAULT 0;
