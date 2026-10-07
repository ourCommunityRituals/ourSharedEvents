-- Migration 0016: clear raw anonymous ids from the forms database
--
-- Until now the four form tables stored the raw value of the ose_anon cookie
-- (anon_<uuid>) beside named form data. The scan side of the main database
-- stores the same raw value, so a reader of both databases could join a named
-- registration or email signup to that browser's scan history.
--
-- From this release the form handlers store a per-event keyed id instead
-- (src/lib/event-anon-key.ts): a keyed hash of the anonymous id and the event
-- id, prefixed evk1_. It equals no value in the main database, differs from
-- event to event, and stays the same inside one event.
--
-- What "scrub" means here: CLEAR, not convert. The keyed id needs a secret
-- (FORMS_HASH_PEPPER) and a keyed hash, neither of which SQL has, so an existing
-- raw value cannot be turned into its keyed id by a migration. Each raw value
-- is set to NULL. The rows themselves, and every other column, are untouched.
--
-- Consequences, stated plainly:
--   - Rows written before this migration lose their id. Check-in keeps its
--     counts; only "which phone tapped last" is forgotten for those events.
--   - Erasure by email used these raw values to find a person's scan rows in
--     the main database. After this migration there is nothing left to find
--     them with, for old rows as for new ones.
--
-- Values that already start with evk1_ are kept, so the same four statements
-- can be run again by hand after the Worker is deployed. That matters once:
-- migrations are applied before the new Worker goes live, and a form submitted
-- in between is still written by the old Worker with a raw value.
--
-- The columns keep their names (anonymous_id, last_anonymous_id); only what
-- they hold changes.

UPDATE form_registrations
   SET anonymous_id = NULL
 WHERE anonymous_id IS NOT NULL
   AND substr(anonymous_id, 1, 5) <> 'evk1_';

UPDATE checkin_counts
   SET last_anonymous_id = NULL
 WHERE last_anonymous_id IS NOT NULL
   AND substr(last_anonymous_id, 1, 5) <> 'evk1_';

UPDATE form_surveys
   SET anonymous_id = NULL
 WHERE anonymous_id IS NOT NULL
   AND substr(anonymous_id, 1, 5) <> 'evk1_';

UPDATE email_signups
   SET anonymous_id = NULL
 WHERE anonymous_id IS NOT NULL
   AND substr(anonymous_id, 1, 5) <> 'evk1_';
