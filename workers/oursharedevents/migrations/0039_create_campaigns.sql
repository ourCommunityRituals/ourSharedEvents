-- Campaigns table: groups sponsor placements across events for enterprise comparison.
--
-- A campaign is a named marketing initiative a brand runs across one or more
-- events. Sponsors are linked to a campaign via sponsors.campaign_id (0040).
-- SharedReports surface campaign_summary at mid/premium depth so enterprise
-- sponsors can compare campaign performance across events in the batch endpoint.
--
-- brand_id scoping is required — campaign visibility must be tenant-isolated
-- (Invariant #9): a sponsor may only see campaigns belonging to their brand.

CREATE TABLE IF NOT EXISTS campaigns (
  id          TEXT PRIMARY KEY,
  brand_id    TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'active',  -- active | paused | completed
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_campaigns_brand_id ON campaigns(brand_id);
