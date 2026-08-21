-- Migration 0067: sponsor_placement — the attachment join (OSE-799 A2, doctrine rule 7).
-- "Sponsor attachment — the join is the object." A placement borrows a sponsor_business
-- (0065) onto one event. This is where the per-event, purchasable-frequency-only economics
-- live: tier, source, polarity, locality_band, tracking tokens.
--
-- #25 (sponsor_share_covenant, LIVE): money buys frequency-share and report depth only —
-- never size, slot, position, or is_local status. So there is deliberately NO
-- placement_formats column here (buying a named slot is the #25 violation the resolver
-- already retired). locality_band REPLACES sponsors.is_local — geo-derived at attachment
-- time from sponsor_business.h3_res7 vs the event's h3_res7, never client-set (closes the
-- is_local capture stories OSE-334 / OSE-335 as obsolete: nothing to capture).
--
-- sponsors + all children = 0 rows in every environment, so the FK repoints below recreate
-- cleanly with no data to move.

CREATE TABLE IF NOT EXISTS sponsor_placement (
  id                   TEXT PRIMARY KEY,
  sponsor_business_id  TEXT NOT NULL,
  event_id             TEXT NOT NULL,
  tier                 TEXT NOT NULL DEFAULT 'standard',  -- per-event rotation weight only (#25)
  campaign_id          TEXT,
  source               TEXT NOT NULL DEFAULT 'organizer', -- 'organizer' | 'corridor_covenant' | 'platform_seed'
  polarity             INTEGER NOT NULL DEFAULT 1,        -- engagement tone (reserved)
  locality_band        INTEGER NOT NULL DEFAULT 0,        -- 0 = non-local, 1 = local (h3_res7 match). Replaces is_local.
  click_token          TEXT UNIQUE,
  display_token        TEXT UNIQUE,        -- honest lexicon (OSE-801): a display is a render fact, not an "impression"
  is_active            INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (sponsor_business_id) REFERENCES sponsor_business(id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  UNIQUE(sponsor_business_id, event_id)               -- one placement per sponsor per event
);
CREATE INDEX IF NOT EXISTS idx_sponsor_placement_event ON sponsor_placement(event_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_placement_business ON sponsor_placement(sponsor_business_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_placement_locality ON sponsor_placement(locality_band);

-- ── Repoint child tables off the retired `sponsors` table onto sponsor_business ──
-- SQLite cannot ALTER a FOREIGN KEY, so recreate (0 rows → no data migration).

-- sponsor_event_types: a business's type preferences persist across events (DoD).
DROP INDEX IF EXISTS idx_sponsor_event_types_sponsor;
DROP INDEX IF EXISTS idx_sponsor_event_types_template;
DROP TABLE IF EXISTS sponsor_event_types;
CREATE TABLE sponsor_event_types (
  id          TEXT PRIMARY KEY,
  sponsor_id  TEXT NOT NULL,   -- FK → sponsor_business(id) (was sponsors)
  template_id TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (sponsor_id) REFERENCES sponsor_business(id),
  FOREIGN KEY (template_id) REFERENCES event_templates(id),
  UNIQUE(sponsor_id, template_id)
);
CREATE INDEX IF NOT EXISTS idx_sponsor_event_types_sponsor ON sponsor_event_types(sponsor_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_event_types_template ON sponsor_event_types(template_id);

-- sponsor_areas: geo service areas belong to the durable business identity.
DROP INDEX IF EXISTS idx_sponsor_areas_sponsor;
DROP INDEX IF EXISTS idx_sponsor_areas_zip;
DROP TABLE IF EXISTS sponsor_areas;
CREATE TABLE sponsor_areas (
  id           TEXT PRIMARY KEY,
  sponsor_id   TEXT NOT NULL,   -- FK → sponsor_business(id) (was sponsors)
  zip_code     TEXT,
  lat          REAL,
  lon          REAL,
  radius_miles REAL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (sponsor_id) REFERENCES sponsor_business(id)
);
CREATE INDEX IF NOT EXISTS idx_sponsor_areas_sponsor ON sponsor_areas(sponsor_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_areas_zip ON sponsor_areas(zip_code);

-- sponsor_impressions: repoint sponsor_id off `sponsors` onto sponsor_business.
-- FK-REPOINT ONLY — this recreation preserves the EXACT original shape (0022 + 0048:
-- id, sponsor_id, event_id, surface, placement, event_type, created_at, h3_res7 = 8 cols,
-- same 3 indexes). It changes nothing but the FK target, so the OSE-931 lexicon exemption
-- (rename sponsor_impressions → sponsor_displays end to end) stays a single future ticket.
DROP INDEX IF EXISTS idx_sponsor_impressions_sponsor;
DROP INDEX IF EXISTS idx_sponsor_impressions_event;
DROP INDEX IF EXISTS idx_sponsor_impressions_h3_res7;
DROP TABLE IF EXISTS sponsor_impressions;
CREATE TABLE sponsor_impressions (
  id         TEXT PRIMARY KEY,
  sponsor_id TEXT NOT NULL,   -- FK → sponsor_business(id) (was sponsors)
  event_id   TEXT NOT NULL,
  surface    TEXT NOT NULL,
  placement  TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'impression',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  h3_res7    TEXT,
  FOREIGN KEY (sponsor_id) REFERENCES sponsor_business(id),
  FOREIGN KEY (event_id) REFERENCES events(id)
);
CREATE INDEX IF NOT EXISTS idx_sponsor_impressions_sponsor ON sponsor_impressions(sponsor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sponsor_impressions_event ON sponsor_impressions(event_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_impressions_h3_res7
  ON sponsor_impressions(h3_res7)
  WHERE h3_res7 IS NOT NULL;

-- Retire the combined `sponsors` table (identity + attachment coupled to one event).
DROP INDEX IF EXISTS idx_sponsors_event_id;
DROP INDEX IF EXISTS idx_sponsors_is_local;
DROP INDEX IF EXISTS idx_sponsors_campaign_id;
DROP TABLE IF EXISTS sponsors;
