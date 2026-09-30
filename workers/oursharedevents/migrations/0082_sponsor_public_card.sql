-- Migration 0082: the sponsor's public card (OSE-1316 / OSE-1317 follow-up)
--
-- A sponsor is valid with only a business name. Some sponsors deliberately show
-- a simple card instead of a logo and website: a title, where to find them, and
-- how to reach them. Every column here is optional and PUBLIC by the sponsor's
-- own choice: it is business information the sponsor enters to be found, shown
-- on the public sponsor card (GET /sponsors/:id) and the public event page.
--
--   display_name   the public title. NULL means "use the business name".
--   address_line   free-text location as the sponsor wants it shown
--                  ("10255 S Western Ave, Chicago" or just "Beverly"). It is
--                  NOT the matching location: lat/lon -> h3 stays private and is
--                  never published, and the two are not cross-checked.
--   contact_phone  optional business phone, rendered as a tel: link.
--   contact_email  optional business email, rendered as a mailto: link.
--
-- Invariant #8 (decided 2026-09-30, CCR PR #699): these are BUSINESS details a
-- sponsor enters to be found, not attendee data — nothing here identifies an
-- attendee, so the anonymous-DB boundary (Invariant #1) is unchanged. Their
-- retention rule is "while on show": the card renders only for a sponsor on an
-- active event, and deactivating a sponsor clears address_line, contact_phone
-- and contact_email (handleAdminDeleteSponsor). display_name is identity and
-- stays with the name. The form hint says "a neighbourhood is fine", so a
-- home-based sponsor never has to publish a street address.
--
-- Nullable + additive; no backfill, no rebuild, no DROP.

ALTER TABLE sponsor_business ADD COLUMN display_name TEXT;
ALTER TABLE sponsor_business ADD COLUMN address_line TEXT;
ALTER TABLE sponsor_business ADD COLUMN contact_phone TEXT;
ALTER TABLE sponsor_business ADD COLUMN contact_email TEXT;
