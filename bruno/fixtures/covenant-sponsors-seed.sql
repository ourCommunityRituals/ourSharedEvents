-- OSE-INV5 Local Sponsor Covenant — deterministic fixture seed (CCR-PR567 Stage-2).
--
-- WHY A FIXTURE, NOT AN API SEED.
-- The covenant Bruno block used to seed 4 sponsors via POST /api/v2/admin/sponsors
-- and then ACCEPT each (mint sponsor-home link -> POST /respond) so they pass the
-- ADR-019 strict-consent render gate (sponsor_placement.sponsor_accepted = 1).
-- Bruno CLI, however, only executes a subset of a multi-request folder's
-- after-response scripts on staging (the collection-hook shared-scope quirk), so
-- the seeds' bru.setCollectionVar() calls silently never ran -> ids/tokens never
-- captured -> mints 404, responds 401, assert 0/4. Three staging rounds could not
-- work around it. The invariant itself is already unit-tested (tier-equity-sort
-- '#25 covenant twin'); this fixture makes the STAGING integration proof
-- deterministic by seeding the 4 canonical sponsors ALREADY ACCEPTED, so the Bruno
-- side is a pure ASSERT (no seed/mint/respond, no cross-request var capture).
--
-- Applied by CI after covenant-sponsors-reset.sql, before the Bruno contract run:
--   npx wrangler d1 execute DB --env staging --remote \
--     --file ../../bruno/fixtures/covenant-sponsors-seed.sql
--
-- Names match 'Covenant %' so covenant-sponsors-reset.sql still cleans them; ids are
-- fixed so the assert can reference them directly. Idempotent: delete-by-id then
-- insert (FK child -> parent order on delete, parent -> child on insert).
--
-- LOCALITY IS ON THE PLACEMENT. is_local is derived from sponsor_placement.locality_band
-- (0067: locality_band REPLACES sponsors.is_local, geo-derived at attachment). Local
-- sponsors sit in test-event-001's res7 corridor cell (872664575ffffff, set by
-- covenant-event-geo.sql); non-locals do not. locality_band encodes that here.
--
-- CONSENT IS EXPLICIT. sponsor_accepted = 1 on every placement — the whole point of
-- the covenant assert under strict consent (ADR-019). organizer_accepted = 1 too
-- (COALESCE would default it permissive, but being explicit documents two-sided intent).

-- ── idempotency: clear any prior fixed-id rows (child -> parent) ──
DELETE FROM sponsor_impressions WHERE sponsor_id IN
  ('sb_cov_local_bronze','sb_cov_local_platinum','sb_cov_nonlocal_bronze','sb_cov_nonlocal_title');
DELETE FROM sponsor_asset WHERE sponsor_business_id IN
  ('sb_cov_local_bronze','sb_cov_local_platinum','sb_cov_nonlocal_bronze','sb_cov_nonlocal_title');
DELETE FROM sponsor_placement WHERE id IN
  ('spl_cov_local_bronze','spl_cov_local_platinum','spl_cov_nonlocal_bronze','spl_cov_nonlocal_title');
DELETE FROM sponsor_business WHERE id IN
  ('sb_cov_local_bronze','sb_cov_local_platinum','sb_cov_nonlocal_bronze','sb_cov_nonlocal_title');

-- ── identity (sponsor_business): brand 'root' matches test-event-001 (migration 0013) ──
-- Locals carry the event's res7 cell; non-locals carry a different / null cell.
INSERT INTO sponsor_business (id, brand_id, name, website_url, lat, lon, h3_res7, is_active) VALUES
  ('sb_cov_local_bronze',    'root', 'Covenant Local Bronze',    'https://example.com/local-bronze',    41.6903,  -87.6768,  '872664575ffffff', 1),
  ('sb_cov_local_platinum',  'root', 'Covenant Local Platinum',  'https://example.com/local-platinum',  41.6975,  -87.682,   '872664575ffffff', 1),
  ('sb_cov_nonlocal_bronze', 'root', 'Covenant NonLocal Bronze', 'https://example.com/nonlocal-bronze', 40.7128,  -74.006,   NULL,              1),
  ('sb_cov_nonlocal_title',  'root', 'Covenant NonLocal Title',  'https://example.com/nonlocal-title',  34.0522,  -118.2437, NULL,              1);

-- ── per-event attachment (sponsor_placement) on test-event-001, ACCEPTED ──
-- locality_band: locals = 1, non-locals = 0 (drives the is_local the resolver returns).
-- tier is rotation-weight only (#25): title/platinum buy no size/slot/position/locality.
INSERT INTO sponsor_placement (id, sponsor_business_id, event_id, tier, source, locality_band, is_active, sponsor_accepted, organizer_accepted) VALUES
  ('spl_cov_local_bronze',    'sb_cov_local_bronze',    'test-event-001', 'bronze',   'organizer', 1, 1, 1, 1),
  ('spl_cov_local_platinum',  'sb_cov_local_platinum',  'test-event-001', 'platinum', 'organizer', 1, 1, 1, 1),
  ('spl_cov_nonlocal_bronze', 'sb_cov_nonlocal_bronze', 'test-event-001', 'bronze',   'organizer', 0, 1, 1, 1),
  ('spl_cov_nonlocal_title',  'sb_cov_nonlocal_title',  'test-event-001', 'title',    'organizer', 0, 1, 1, 1);
