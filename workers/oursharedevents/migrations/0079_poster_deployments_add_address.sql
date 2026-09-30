-- Migration 0079: poster_deployments.address (OSE-1357 part 1)
--
-- The admin poster card now places a poster by ADDRESS instead of asking the
-- organizer for latitude/longitude. The browser geocodes the address once, at
-- creation (POST /api/v2/admin/geocode), and creates the deployment with the
-- returned coordinates; the server tags h3_res9/h3_res7 exactly as before.
--
-- This column keeps what the organizer sees on the card: the geocoder's
-- formatted_address, or the typed address when geocoding is unavailable (the
-- save is never blocked). It is the address of a PLACE a poster hangs — never
-- of a person — and it is admin-only: the public surfaces and the scan path do
-- not read it. Nullable + additive; existing rows keep NULL.

ALTER TABLE poster_deployments ADD COLUMN address TEXT;
