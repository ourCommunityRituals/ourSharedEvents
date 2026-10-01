-- Covenant / sponsor-journey fixture reset (OSE-944).
--
-- The OSE-INV5 covenant block seeds 4 sponsors on test-event-001 each run and
-- cleans them up afterward — but a `--bail` failure skips that cleanup, so orphan
-- sponsors accumulate on the shared fixture. The sponsor-journey E2E did the same
-- (its Step 10 DELETE was a no-op until OSE-985 fixed the adminFetch arg). Left
-- unchecked this drowns the 4 fresh covenant ids in the public read (observed
-- 2026-08-24: 234 orphan sponsors + ~60k sponsor_impressions on ocr-db-staging →
-- covenant read returned "0/4 fixtures present" and T2 Contract failed).
--
-- This step resets the SYNTHETIC test sponsors to a clean slate before every
-- Newman run so the covenant assert is deterministic regardless of prior failures.
-- Scoped by the fixed test-sponsor NAME patterns so a real sponsor is never touched.
-- Child -> parent FK order (impressions/asset/placement reference sponsor_business).

DELETE FROM sponsor_impressions WHERE sponsor_id IN (
  SELECT id FROM sponsor_business
  WHERE name LIKE 'Covenant %' OR name LIKE 'Journey Sponsor %'
     OR name LIKE 'Tier Upgrade %' OR name LIKE 'Cross Surface %'
);

DELETE FROM sponsor_asset WHERE sponsor_business_id IN (
  SELECT id FROM sponsor_business
  WHERE name LIKE 'Covenant %' OR name LIKE 'Journey Sponsor %'
     OR name LIKE 'Tier Upgrade %' OR name LIKE 'Cross Surface %'
);

DELETE FROM sponsor_placement WHERE sponsor_business_id IN (
  SELECT id FROM sponsor_business
  WHERE name LIKE 'Covenant %' OR name LIKE 'Journey Sponsor %'
     OR name LIKE 'Tier Upgrade %' OR name LIKE 'Cross Surface %'
);

DELETE FROM sponsor_business
  WHERE name LIKE 'Covenant %' OR name LIKE 'Journey Sponsor %'
     OR name LIKE 'Tier Upgrade %' OR name LIKE 'Cross Surface %';
