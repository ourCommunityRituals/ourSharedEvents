-- Migration 0063: sponsor_business — durable sponsor IDENTITY (OSE-799 A2, doctrine rule 7).
-- "A sponsor is not part of a night. Nights borrow sponsors." The shipped `sponsors`
-- table made a sponsor a CHILD of one event (event_id FK + idx_sponsors_event_id), so a
-- sponsor doing 13 nights was 13 unrelated rows with no identity — the learning loop
-- ("sponsors refine from what comes back") could not be computed even in principle.
--
-- This table is ONLY identity: who the sponsor is and where they are. It has NO contact
-- field, NO login, NO page (rule 7 — a sponsor is borrowed, not a tenant with a portal).
-- Three concerns are deliberately broken out for clear data management:
--   • identity      → sponsor_business  (this table)
--   • creative      → sponsor_asset     (0066; one row per format, mirrors sponsor_asset_draft)
--   • per-event join → sponsor_placement (0067; tier, source, polarity, locality_band, tokens)
--
-- sponsors = 0 rows in every environment at authoring time, so this restructure is FREE now
-- and a data migration with a customer attached after the first sponsor row.

CREATE TABLE IF NOT EXISTS sponsor_business (
  id            TEXT PRIMARY KEY,
  brand_id      TEXT NOT NULL,       -- #9 tenant isolation (was implicit via event before)
  name          TEXT NOT NULL,
  website_url   TEXT,
  business_type TEXT,
  -- Sponsor's own location → drives locality_band derivation at attachment time.
  lat           REAL,
  lon           REAL,
  h3_res9       TEXT,                -- NCR Node cell (res 9 ≈ 0.1 km²)
  h3_res7       TEXT,                -- NCR Corridor cell (res 7 ≈ 5 km²)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sponsor_business_brand ON sponsor_business(brand_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_business_h3_res7 ON sponsor_business(h3_res7);
