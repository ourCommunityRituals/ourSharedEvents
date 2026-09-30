-- Migration 0081: sponsor_business.tier + a second logo format (OSE-1316 / OSE-1317)
--
-- 1. sponsor_business.tier
--    Tier was stored only on sponsor_placement (per event), so a sponsor could not
--    exist without an event. Create Sponsor now requires a tier and makes the
--    event optional: the tier belongs to the business (it decides which pool the
--    sponsor sits in), and a placement copies it when an event is attached.
--    Nullable + additive. Backfilled from each business's most recent placement,
--    the same rule the template pool query already used to pick a tier.
--
-- 2. sponsor_asset format 'logo_compact'
--    The header logo (wide, top-of-page slot) and the sidebar logo (square or
--    compact, side rail) are two separate images. 'logo' stays the header logo
--    so every existing reader keeps working, and 'logo_compact' is the sidebar
--    logo. SQLite cannot change a CHECK in place, so the table is rebuilt with
--    the wider CHECK and every row is copied across unchanged. Nothing references
--    sponsor_asset by foreign key, and it is not a load-bearing table.
--    Both logos stay optional. A sponsor with no logo renders its name.

ALTER TABLE sponsor_business ADD COLUMN tier TEXT;

UPDATE sponsor_business
   SET tier = (SELECT sp.tier FROM sponsor_placement sp
                WHERE sp.sponsor_business_id = sponsor_business.id
                ORDER BY sp.created_at DESC, sp.id DESC LIMIT 1)
 WHERE tier IS NULL;

CREATE TABLE sponsor_asset_new (
  id                  TEXT PRIMARY KEY,
  sponsor_business_id TEXT NOT NULL,
  format              TEXT NOT NULL CHECK(format IN ('logo','logo_compact','poster','banner','vertical','square')),
  url                 TEXT,
  content_type        TEXT,
  focal_x             REAL,
  focal_y             REAL,
  crop_rect           TEXT,
  validated_at        TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (sponsor_business_id) REFERENCES sponsor_business(id),
  UNIQUE(sponsor_business_id, format)
);

INSERT INTO sponsor_asset_new
  (id, sponsor_business_id, format, url, content_type, focal_x, focal_y, crop_rect,
   validated_at, created_at, updated_at)
SELECT id, sponsor_business_id, format, url, content_type, focal_x, focal_y, crop_rect,
       validated_at, created_at, updated_at
  FROM sponsor_asset;

DROP TABLE sponsor_asset;

ALTER TABLE sponsor_asset_new RENAME TO sponsor_asset;

CREATE INDEX IF NOT EXISTS idx_sponsor_asset_business ON sponsor_asset(sponsor_business_id);
