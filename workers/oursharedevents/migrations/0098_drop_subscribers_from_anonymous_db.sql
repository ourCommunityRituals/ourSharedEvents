-- Migration 0098: the email list leaves the anonymous database
--
-- Owner decision 2026-10-11 (OSE-1661): `subscribers` carries an email address
-- (email_hash + email_encrypted), and the main database is the anonymous side
-- of the two-database wall. Forms migration 0017 creates the same table in
-- FORMS_DB, and every reader and writer now uses that binding.
--
-- Data: read live on 2026-10-11, production held 0 rows and staging 1 test row
-- (created 2026-09-16). That one staging row is dropped with the table; a
-- migration cannot copy rows across databases.

DROP TABLE IF EXISTS subscribers;
