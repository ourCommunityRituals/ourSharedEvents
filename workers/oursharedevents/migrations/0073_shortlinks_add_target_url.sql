-- Migration 0073: shortlinks add target_url + kind
--
-- Poster pass Rb — extend the shortlink ROUTING layer to carry an admin-set
-- external destination + a destination category, so a poster can surface
-- per-destination typed slots (public / donate / sign-up) that each route and
-- count clicks independently.
--
-- Two-primitive model (fundamental): /q/ = tracking, /s/ = routing. This
-- migration is routing-only. Anonymity unchanged — the shortlink still records
-- the click COUNTER + last_clicked_at only (no IP / anon_id / cookie / Referer);
-- target_url is a fixed, admin-set destination, never a per-click datum.
--
-- Open-redirect safety: target_url MUST be validated https:// at CREATION
-- (see lib/shortlinks.ts isValidHttpsTarget), never taken from a request param
-- at resolve time. The resolver additionally re-checks the https scheme
-- defensively before redirecting.

-- Admin-set external destination. NULL = route to the event public page
-- (/events/:id), preserving pre-migration behaviour for every existing row.
ALTER TABLE shortlinks ADD COLUMN target_url TEXT;

-- Destination category for per-destination click-out attribution on reports:
-- 'public' (default / event page), 'donate', 'signup', or a future slug.
-- NULL / '' is read as 'public'.
ALTER TABLE shortlinks ADD COLUMN kind TEXT;

-- Per-destination click-out reads group by (event_id, kind).
CREATE INDEX IF NOT EXISTS idx_shortlinks_event_kind
  ON shortlinks(event_id, kind);
