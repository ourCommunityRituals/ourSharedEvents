-- Migration 0017: the landing-page email list moves into the forms database
--
-- Owner decision 2026-10-11 (OSE-1661): `subscribers` holds an email address
-- (peppered email_hash + AES-GCM email_encrypted), so it belongs with the other
-- identified-person tables here, not in the anonymous main database where
-- migrations 0008/0028/0071 put it. Main migration 0098 drops the old table.
--
-- Same columns as the main table after 0071, so the subscribe path, the admin
-- list, erasure and retention keep working unchanged apart from the binding.
--
-- Rows are not copied: a migration cannot read another database. On 2026-10-11
-- the main table held 0 rows in production and 1 test row in staging
-- (created 2026-09-16), which is not carried over.

CREATE TABLE IF NOT EXISTS subscribers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email_hash      TEXT NOT NULL UNIQUE,
  email_encrypted TEXT NOT NULL,
  ip_hash         TEXT,
  source          TEXT NOT NULL DEFAULT 'landing',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
