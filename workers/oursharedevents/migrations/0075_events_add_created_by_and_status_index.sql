-- Migration 0075: events.created_by + status-aware admin list index
--
-- WHY. Once an organizer creates an event they need to COME BACK to it: see the
-- events that are theirs, see which are still drafts, and manage them. Until now
-- the admin list was brand-scoped only — there was no way to answer "which of
-- these did I make?" because the row never recorded who made it. The audit log
-- knows (CREATE_EVENT rows carry the actor), but a list cannot join through the
-- audit log on every page load.
--
-- created_by carries the SERVER-VERIFIED admin actor id at creation time — the
-- CF Access email, or 'key:admin' / 'key:ocr-internal' for automation. It is the
-- same identity vocabulary admin_audit_log.actor (0026) and
-- admin_brand_memberships.email (0050) already store in this DB, so it adds no
-- new class of data to the anonymous surface. It is an OPERATOR identity, never
-- an attendee one; the two-DB line (DB = anonymous public surface, FORMS_DB =
-- identified attendees) is untouched. It is never rendered on any public surface.
--
-- Nullable: rows created before this migration have no recorded creator and
-- stay visible under the brand scope exactly as before ("only mine" simply
-- excludes them — a filter, never a permission).
--
-- The composite index serves the admin list's new ?status= filter and the
-- nightly stale-draft sweep (status = 'draft' AND updated_at < cutoff), both of
-- which would otherwise scan the table.

ALTER TABLE events ADD COLUMN created_by TEXT;

CREATE INDEX IF NOT EXISTS idx_events_status_updated
  ON events(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_events_created_by
  ON events(created_by);
