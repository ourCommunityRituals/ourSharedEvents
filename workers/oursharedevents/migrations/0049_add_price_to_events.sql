-- OSE-655 / "HOW MUCH" — event price dimension.
--
-- DISPLAY METADATA ONLY. These columns describe the event's OWN price
-- (organizer <-> attendee); they are NOT platform billing. Invariant #6
-- inert_monetization_hooks holds because nothing charges/debits/processes a
-- payment against them — they are read and rendered as a label, never a
-- payment primitive.
--
--   price_cents  0 = free, N = fixed price in cents, NULL = unset
--   price_model  'free' | 'fixed' | 'sliding' | 'donation' | 'varies'
--   price_note   optional free-text qualifier for sliding/varies ("$5-15 suggested")
--
-- Additive columns (no default backfill needed): existing rows read NULL/unset
-- and simply render no "How much" card until an organizer authors a value.

ALTER TABLE events ADD COLUMN price_cents INTEGER;
ALTER TABLE events ADD COLUMN price_model TEXT;
ALTER TABLE events ADD COLUMN price_note TEXT;
