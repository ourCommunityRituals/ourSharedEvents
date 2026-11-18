-- Migration 0112: the room's own vote code, and a vote set follows its event's
-- status (OSE-2140 and OSE-2142, S3d and S3e of OSE-1193; OSE ADR-040
-- decision 6 and the amendment "nothing is more live than its container",
-- owner decisions of 2026-11-18).
--
-- 1. poster_deployments.is_vote_code. A vote code is a placement of its own,
--    marked here, with a token of its own. Only that placement's scan may
--    mint a vote pass at /q (src/lib/vote-sets.ts, voteCodeMayMint). An
--    ordinary poster code with ?type=vote mints nothing. The public poster
--    bundle never resolves a placement marked here (handlers/poster-bundle.ts),
--    so its token is in no public answer. Every existing row reads 0.
-- 2. One vote code in use per event: a partial unique index over the rows in
--    use. A retired code (is_active = 0) stays, so its scans keep their place.
-- 3. A vote set is never more open than its event. When an app path moves an
--    event out of 'active' (Published, listed or unlisted), it closes the
--    event's open set in the same D1 batch, one transaction
--    (closeVoteSetUnlessPublished, src/lib/vote-sets.ts): the admin edit and
--    the QR verify undo. The nightly vote job closes any set a path outside
--    the app left open (a seed, a script). No trigger: migration 0025 keeps
--    D1 free of triggers, because `wrangler d1 migrations apply --remote`
--    once split trigger bodies on `;` (tests/migration-smoke.spec.ts).
-- 4. A set already open on an event that is not Published when this runs is
--    closed now. On staging these are the synthetic nights the S3 runs opened
--    on draft events. Production has no vote sets. Nothing here makes a set
--    final; a host reopens it, within the usual rules, once the event is
--    Published again.
--
-- Time: the UPDATE stamps updated_at to the hour, the format of hourStamp
-- (src/lib/scan-buffer.ts), like every vote set write.
--
-- Gates: tests/e2e/0-architecture/votes-never-who.invariant.spec.ts (T0),
-- workers/oursharedevents/tests/vote-code.spec.ts and
-- tests/vote-set-admin.spec.ts (workers pool), and on staging
-- bruno/ose-api/26. Vote code and event status (OSE-2140 OSE-2142).
--
-- Rollback: revert the Worker and leave the column and the index. See
-- ROLLBACK_PLAN.md, 0112.

ALTER TABLE poster_deployments ADD COLUMN is_vote_code INTEGER NOT NULL DEFAULT 0
  CHECK (is_vote_code IN (0, 1));

CREATE UNIQUE INDEX IF NOT EXISTS idx_poster_deployments_one_vote_code
  ON poster_deployments(event_id) WHERE is_vote_code = 1 AND is_active = 1;

UPDATE vote_sets
   SET state = 'closed', updated_at = strftime('%Y-%m-%d %H:00:00', 'now')
 WHERE state = 'open' AND is_final = 0
   AND event_id IN (SELECT id FROM events WHERE status <> 'active');
