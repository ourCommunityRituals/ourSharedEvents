-- Migration 0066: sponsor_asset — a sponsor's durable CREATIVE (OSE-799 A2, doctrine rule 7).
-- Broken out of sponsor_business so identity and creative are managed as separate concerns.
-- Mirrors sponsor_asset_draft (0054): one row per canonical format, upsert-on-format. The
-- creative belongs to the durable business identity (a sponsor reuses the same assets across
-- events), NOT to a per-event placement.
--
-- #25 (sponsor_share_covenant, LIVE): assets are UNIFORM creative, never a purchasable slot.
-- There is deliberately NO tier / placement / share column here — money does not buy a
-- format, a size, or a position (that decision is why sponsor_asset_draft was built without
-- one; the promoted table keeps the same wall).
--
-- 'logo' is added to the format set alongside the four onboarding formats: the retired
-- `sponsors` table carried logo_url + the four format urls, and both are durable creative.

CREATE TABLE IF NOT EXISTS sponsor_asset (
  id                  TEXT PRIMARY KEY,
  sponsor_business_id TEXT NOT NULL,
  format              TEXT NOT NULL CHECK(format IN ('logo','poster','banner','vertical','square')),
  url                 TEXT,
  content_type        TEXT,
  focal_x             REAL,
  focal_y             REAL,
  crop_rect           TEXT,                     -- JSON {x,y,w,h}
  validated_at        TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (sponsor_business_id) REFERENCES sponsor_business(id),
  UNIQUE(sponsor_business_id, format)          -- one asset per format per business (upsert target)
);

CREATE INDEX IF NOT EXISTS idx_sponsor_asset_business ON sponsor_asset(sponsor_business_id);
