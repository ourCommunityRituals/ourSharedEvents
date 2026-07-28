-- Links a sponsor placement to a campaign for cross-event comparison.
-- campaign_id is nullable: sponsors without an explicit campaign are uncategorized
-- and appear in SharedReport sponsor_impressions with campaign_id = null.

ALTER TABLE sponsors ADD COLUMN campaign_id TEXT REFERENCES campaigns(id);

CREATE INDEX IF NOT EXISTS idx_sponsors_campaign_id ON sponsors(campaign_id);
