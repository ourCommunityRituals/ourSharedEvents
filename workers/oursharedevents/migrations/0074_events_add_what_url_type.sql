-- Migration 0074: events add what_url_enabled + what_url_type (R3 typed external link)
--
-- Extends the #547 events.what_url (migration 0072) with an explicit ENABLE
-- flag + a destination TYPE, so the optional outbound link renders DELIBERATELY
-- (not merely because a URL is present) and carries a type-driven CTA label
-- (donation / league / workshop / substack / tickets / menu / website).
--
-- The typed link is the same primitive the poster's Donate / Sign-Up QR slots
-- reference (see the poster pass) — one typed-destination model for page + poster.
--
-- Backward-compatible: existing rows that already carry a what_url are backfilled
-- enabled=1 so #547 links keep rendering exactly as before; new events default
-- to OFF until the organizer turns the link on.

ALTER TABLE events ADD COLUMN what_url_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN what_url_type TEXT;

-- Preserve #547 behaviour for data created before the enable gate existed.
UPDATE events SET what_url_enabled = 1 WHERE what_url IS NOT NULL AND what_url != '';
