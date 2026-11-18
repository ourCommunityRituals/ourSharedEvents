-- Three events with no working code — staging fixture for the T2 Bruno requests
-- "OSE-1420 | go-live evidence | ... is refused" (folder 12 of bruno/ose-api).
--
-- Applied by CI before the Bruno contract run (api section), and by the
-- PR-local run (scripts/ci/run-local-vetting.sh):
--   node ../../scripts/ci/d1-seed-staging.mjs DB ../../bruno/fixtures/go-live-evidence-seed.sql
--
-- WHY A FIXTURE
-- An event goes live only when one of its codes works: a share link the
-- resolver accepts, or a poster that is switched on (lib/go-live-evidence.ts).
-- An event made through the API always gets a share link at creation, so no
-- request can make an event that lacks one. These rows are that event:
--
--   bruno-go-live-no-code           ready, no share link, no poster
--   bruno-go-live-bad-code          ready, two share links that both fail the
--                                   rule (a 7-character code; an http target)
--   bruno-go-live-archived-no-code  archived, no share link, no poster
--
-- Each has a start time and an event type, so the only thing missing is a
-- working code. The requests are pure asserts: the move is refused before any
-- write, so the rows are the same after every run.
--
-- Every pass puts the rows back. Opening one of these events in the admin
-- mints its share link (the poster-codes read does), which would let it go
-- live; the deletes below take that link away again, and any poster placed on
-- one is switched off. The draft-expiry job does not touch ready or archived
-- rows.
--
-- is_published = 0 and never active: none of the three is on the list, the map
-- or a public page. data_class = 'synthetic' marks them as CI test data.
-- Idempotent. Never apply to production.

INSERT INTO events (
  id, brand_id, title, slug, status,
  location, start_date, timezone, starts_at, event_type_id,
  data_class, is_published, qr_verified
) VALUES
  ('bruno-go-live-no-code', 'root', 'Bruno fixture: ready, with no working code',
   'bruno-go-live-no-code', 'ready',
   'Eagles Hall', '2099-01-01', 'America/Chicago', '2099-01-02T00:00:00.000Z', 'etr-rec-bocce',
   'synthetic', 0, 0),
  ('bruno-go-live-bad-code', 'root', 'Bruno fixture: ready, with two codes that do not work',
   'bruno-go-live-bad-code', 'ready',
   'Eagles Hall', '2099-01-01', 'America/Chicago', '2099-01-02T00:00:00.000Z', 'etr-rec-bocce',
   'synthetic', 0, 0),
  ('bruno-go-live-archived-no-code', 'root', 'Bruno fixture: archived, with no working code',
   'bruno-go-live-archived-no-code', 'archived',
   'Eagles Hall', '2099-01-01', 'America/Chicago', '2099-01-02T00:00:00.000Z', 'etr-rec-bocce',
   'synthetic', 0, 0)
ON CONFLICT(id) DO UPDATE SET
  status = excluded.status,
  start_date = excluded.start_date,
  timezone = excluded.timezone,
  starts_at = excluded.starts_at,
  event_type_id = excluded.event_type_id,
  venue_canonical_id = NULL,
  event_correlation_id = NULL,
  qr_verified = 0,
  is_published = 0,
  listed_from = NULL,
  data_class = 'synthetic',
  updated_at = datetime('now');

DELETE FROM shortlink_click_daily
 WHERE code IN (SELECT code FROM shortlinks
                 WHERE event_id IN ('bruno-go-live-no-code', 'bruno-go-live-bad-code',
                                    'bruno-go-live-archived-no-code'));

DELETE FROM shortlinks
 WHERE event_id IN ('bruno-go-live-no-code', 'bruno-go-live-bad-code',
                    'bruno-go-live-archived-no-code');

UPDATE poster_deployments SET is_active = 0, updated_at = datetime('now')
 WHERE event_id IN ('bruno-go-live-no-code', 'bruno-go-live-bad-code',
                    'bruno-go-live-archived-no-code')
   AND is_active <> 0;

-- The two rows that do not work. 'bGLcode' is 7 characters: the resolver
-- answers 404 for it without reading the database. 'bGLhtp' has the right
-- shape and a target that is not https.
INSERT INTO shortlinks (code, event_id, target_url, kind, clicks, created_at) VALUES
  ('bGLcode', 'bruno-go-live-bad-code', NULL, 'public', 0, datetime('now')),
  ('bGLhtp', 'bruno-go-live-bad-code', 'http://example.org/give', 'donate', 0, datetime('now'))
ON CONFLICT(code) DO UPDATE SET
  event_id = excluded.event_id, target_url = excluded.target_url,
  kind = excluded.kind, clicks = 0;
