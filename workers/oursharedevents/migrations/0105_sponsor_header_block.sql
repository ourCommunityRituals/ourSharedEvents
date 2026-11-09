-- Migration 0105: the sponsor's header block on the digital poster (OSE-1826)
--
-- Owner 2026-11-09: "Sponsored by" becomes a small label and each sponsor gets a
-- real header block: a full-width header image and a short line of text, both
-- from the sponsor's own settings. This is the space hyperlocal, first-tier
-- sponsors pay for. Like the 0083 card fields, both are optional and PUBLIC by
-- the sponsor's choice: business promotion, nothing about an attendee.
--
--   header_image_url  the sponsor's header image, an http(s) address on a public
--                     host (validated like the logos, max 500). It is never put
--                     in a page as an external src: surfaces load it through the
--                     same-origin logo proxy (GET /api/v2/sponsors/:id/logo
--                     ?slot=header), which serves it only for a sponsor on show
--                     (two-sided consent) and caches it at the edge.
--   header_text       one or two lines of plain text (max 140), whitespace
--                     collapsed, rendered as text.
--
-- Tier-blind (Invariant #5, WALL-3b): every sponsor gets the same block at every
-- tier. Deactivating a sponsor clears both, like the card's location and
-- contact (handleAdminDeleteSponsor).
--
-- Nullable + additive on sponsor_business; no backfill, no rebuild, no DROP.

ALTER TABLE sponsor_business ADD COLUMN header_image_url TEXT;
ALTER TABLE sponsor_business ADD COLUMN header_text TEXT;
