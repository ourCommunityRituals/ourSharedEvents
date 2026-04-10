-- Migration 0018: Fix isPrimary schema bug (OSE-168)
--
-- The sponsors table was created with DEFAULT 'standard' but 'standard'
-- is not a valid tier. Valid tiers per sponsor.schema.json:
--   title, platinum, gold, silver, bronze, primary
--
-- 'primary' is the correct default (tier 6, lowest display priority,
-- used for sponsors without explicit tier selection).
--
-- SQLite does not support ALTER COLUMN, so we recreate the table
-- with the correct default and migrate existing data.

-- Step 1: Rename the old table
ALTER TABLE sponsors RENAME TO sponsors_old;

-- Step 2: Create the table with correct default and CHECK constraint
CREATE TABLE IF NOT EXISTS sponsors (
  id                TEXT PRIMARY KEY,
  event_id          TEXT NOT NULL,
  name              TEXT NOT NULL,
  logo_url          TEXT,
  website_url       TEXT,
  tier              TEXT NOT NULL DEFAULT 'primary'
                    CHECK (tier IN ('title', 'platinum', 'gold', 'silver', 'bronze', 'primary')),
  placement_formats TEXT DEFAULT '[]',
  click_token       TEXT UNIQUE,
  impression_token  TEXT UNIQUE,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES events(id)
);

-- Step 3: Migrate data, fixing any 'standard' tier values to 'primary'
INSERT INTO sponsors (id, event_id, name, logo_url, website_url, tier, placement_formats, click_token, impression_token, is_active, created_at, updated_at)
SELECT id, event_id, name, logo_url, website_url,
       CASE WHEN tier = 'standard' THEN 'primary' ELSE tier END,
       placement_formats, click_token, impression_token, is_active, created_at, updated_at
FROM sponsors_old;

-- Step 4: Drop the old table
DROP TABLE sponsors_old;

-- Step 5: Recreate indexes that referenced sponsors
CREATE INDEX IF NOT EXISTS idx_sponsors_event_id ON sponsors(event_id);
