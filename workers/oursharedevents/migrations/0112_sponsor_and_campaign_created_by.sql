-- Migration 0112: sponsor_business.created_by and campaigns.created_by
-- (OSE-1561; OSE ADR-022, decision 2a; owner decision 2026-11-18).
--
-- WHY. "No brand" is stored as the platform's public brand, `root` (ADR-022).
-- Every organizer without a brand of their own shares it, so inside `root` the
-- brand alone cannot keep two organizers apart. There the boundary is the person
-- who created the row. `events` has recorded that since 0075. A sponsor and a
-- campaign did not, so one `root` organizer could list and rename another's.
--
--   created_by   the SERVER-VERIFIED admin actor at creation: the Cloudflare
--                Access email, or `key:admin` / `key:ocr-internal` / `svc:…` for
--                automation. The same identity vocabulary as events.created_by
--                (0075) and admin_audit_log.actor (0026). Never taken from a
--                request body. An operator identity, never an attendee one, and
--                never shown on a public surface.
--
-- EXISTING ROWS HAVE NO CREATOR, AND THIS FILE DOES NOT INVENT ONE. Every row
-- that exists when this runs reads created_by NULL. What NULL means:
--   * In a brand of its own (anything but `root`): nothing changes. The brand is
--     still the boundary and this column is not consulted.
--   * In `root`: the row is reachable by the `root` brand owner and by the
--     automation key where an environment turns it on (staging), and by nobody
--     else. A NULL never equals a caller, so it matches no organizer. It is not
--     handed to whoever asks first.
-- No backfill is run. If a creator must be restored for a row, the audit log
-- holds who created each sponsor (`CREATE_SPONSOR`); that is a reviewed,
-- per-row owner step, not something a migration guesses.
--
-- THE OWNER RULE IS NOT IN THIS FILE. SQLite cannot say "only the creator may
-- read this row". The rule is the bound predicate built by
-- src/lib/admin-owner-scope.ts and applied by the router guard
-- (src/lib/admin-object-scope.ts) and the list handlers.
--
-- Additive only: two nullable columns and two indexes. No row is written or
-- rewritten. Forward-only.
--
-- Rollback: revert the Worker and leave the columns. The older Worker does not
-- read them. See ROLLBACK_PLAN.md, 0112.

ALTER TABLE sponsor_business ADD COLUMN created_by TEXT;

ALTER TABLE campaigns ADD COLUMN created_by TEXT;

CREATE INDEX IF NOT EXISTS idx_sponsor_business_created_by
  ON sponsor_business(created_by);

CREATE INDEX IF NOT EXISTS idx_campaigns_created_by
  ON campaigns(created_by);
