-- Migration 0095: clear raw cookie values from scan_node_returns (OSE-1659).
--
-- scan_node_returns.anonymous_id held the raw `ose_anon` cookie value, next to a
-- user-agent hash, an hour bucket and the event id. The scan path now stores a
-- keyed scan id instead (`snk1_` + HMAC; src/lib/scan-node-key.ts), and the
-- write stores NULL for anything else. This clears the raw values already stored.
--
-- SQL cannot compute the keyed id (it needs the ANON_ID_HASH_PEPPER secret), so
-- an old row loses its id rather than being re-keyed. The row and its other
-- columns stay, so scan totals are unchanged. Distinct-browser counts for those
-- rows fall back to the user-agent hash, and those browsers cannot be matched
-- as returning visitors. Read 2026-10-09: staging has 112 such rows (scanned
-- 2026-10-02 to 2026-10-08), production has none.
--
-- Idempotent: a second run finds no raw value. Anything that is not a keyed id
-- is cleared, not just `anon_` values, so no other cookie-derived value survives.

UPDATE scan_node_returns SET anonymous_id = NULL
 WHERE anonymous_id IS NOT NULL
   AND NOT (anonymous_id GLOB 'snk1_*' AND length(anonymous_id) = 69);
