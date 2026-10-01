-- Migration 0090: anon_id_returns.pepper_epoch (OSE-1460 review).
--
-- anon_id_hash is SHA-256(anon_id | ANON_ID_HASH_PEPPER). When the pepper is
-- rotated, the same browser gets a new hash, so a window that mixes both peppers
-- counts one person twice: three real people seen on both sides would read as six
-- and pass the export's floor of five. pepper_epoch records a one-way fingerprint
-- of the pepper that wrote each row (lib/anon-id-hash.ts pepperEpoch), and the
-- returns export counts only rows of the current pepper. A rotation therefore
-- resets the return signal, as the hash module has always documented, instead of
-- inflating it.
--
-- Existing rows stay NULL: their pepper is unknown, so they are not counted.
-- The nightly materializer deletes rows of any pepper other than the current one
-- (NULL included): erasure re-derives only the current hash, so it could never
-- reach them. A rotation is a reset, not a second identity. That nightly purge is
-- bounded; the complete one is the RUNBOOK-DEPLOYMENT.md step run after this
-- migration and after every pepper rotation.

ALTER TABLE anon_id_returns ADD COLUMN pepper_epoch TEXT;
