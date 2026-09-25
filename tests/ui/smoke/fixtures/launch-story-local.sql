-- Local-only fixture for launch-story T4/T2 vetting against `wrangler dev --local`
-- (OSE-1367). Seeds test-event-001 (already created by migration 0013) with the
-- minimum a contributor needs to exercise the launch-story surfaces without
-- staging: a public shortlink (so /events/:id/calendar.ics returns 200 instead
-- of 409 PUBLIC_SHORTLINK_MISSING) and a poster deployment (so the OSE-1357
-- poster-deployments list has a row to enrich with shortlink slots).
--
-- Apply against the LOCAL D1 only — never --remote:
--   cd workers/oursharedevents
--   npx wrangler d1 migrations apply ocr-db-local --local
--   npm run seed:local-launch
--
-- Idempotent: INSERT OR IGNORE keyed by stable ids; safe to re-run.
--
-- Optional follow-ups (not seeded here, add by hand if a specific test branch
-- needs them — see docs/testing/local-first-t3-t4-t5-vetting.md):
--   * cover_image_url on test-event-001, to exercise the OSE-1356 art-viewport
--     print-clamp assertion instead of it skipping.
--   * a second shortlink of kind='donate' PLUS what_url/what_url_type='donate'/
--     what_url_enabled=1 on test-event-001, to exercise the OSE-1357 multi-slot
--     print-overflow assertion instead of it skipping.

INSERT OR IGNORE INTO shortlinks (code, event_id, kind, clicks, created_at)
VALUES ('Lnch01', 'test-event-001', 'public', 0, datetime('now'));

INSERT OR IGNORE INTO poster_deployments
  (id, event_id, qr_token, placement_label, location_desc, is_active, created_at, updated_at)
VALUES
  ('pd_local_launch_001', 'test-event-001', 'qrt_local_launch_001', 'Library window',
   'Beverly Branch Library', 1, datetime('now'), datetime('now'));
