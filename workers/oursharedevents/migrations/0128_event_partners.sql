-- Migration 0128: partner links between groups on one event (owner 2026-11-28).
--
-- WHY. Owner, 2026-11-28: partnerships "between categories, sponsors, and
-- events across hyperlocal areas, eventually across public and private
-- relationships". A restaurant row backs an art walk, a chamber runs one walk
-- across two neighborhoods, a park district co-hosts with private groups.
-- Until now a partner from another brand could only be a copied sponsor row
-- inside the event's own brand: two copies, no link, no shared report.
--
-- WHAT. One row links one event to one other brand. The event's organizer
-- invites (organizer_accepted = 1); a member of the partner brand accepts or
-- declines (partner_accepted). Only when both are 1 does the event page name
-- the partner, and only then can the partner brand read the event's floored
-- total (lib/event-partners.ts, handlers/event-partners.ts). Either side can
-- end it by setting its own flag to 0.
--
-- `kind` is 'co_host' or 'partner'. A public body (a village, a park district,
-- a library) is always a co-host, never a sponsor: is_public_body = 1 forces
-- kind = 'co_host' (CHECK below), and the page says "public body".
--
-- `partner_name` is the name the event page shows, set by the organizer and
-- shown only after the partner accepts it. A group's name, never a person.
--
-- Invariant compliance:
--   #1  — no person column; a brand and a group's display name only.
--   #9  — tenant isolation: a partner reads one floored total, only while both
--         sides accept; the platform brand and the public brand are never a
--         partner (CHECK below).
--   #19 — > 0127, unique prefix, append-only, no table drop.
--   ADR-001 — MAIN DB only.

CREATE TABLE IF NOT EXISTS event_partners (
  id                 TEXT    PRIMARY KEY,
  event_id           TEXT    NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  partner_brand_id   TEXT    NOT NULL,
  partner_name       TEXT    NOT NULL CHECK (length(partner_name) BETWEEN 1 AND 80),
  kind               TEXT    NOT NULL DEFAULT 'partner' CHECK (kind IN ('co_host', 'partner')),
  is_public_body     INTEGER NOT NULL DEFAULT 0 CHECK (is_public_body IN (0, 1)),
  organizer_accepted INTEGER NOT NULL DEFAULT 1 CHECK (organizer_accepted IN (0, 1)),
  partner_accepted   INTEGER CHECK (partner_accepted IS NULL OR partner_accepted IN (0, 1)),
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, partner_brand_id),
  CHECK (partner_brand_id NOT IN ('ose-platform', 'root')),
  CHECK (is_public_body = 0 OR kind = 'co_host')
);

CREATE INDEX IF NOT EXISTS idx_event_partners_partner ON event_partners (partner_brand_id);
