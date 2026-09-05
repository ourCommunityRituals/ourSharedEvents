-- Migration 0070: events.is_published — the "listed" half of the clearance lattice
--
-- OSE-1245. OCR_VISION.md §6.2b already said the surface "shows what is CLEARED
-- and LISTED across the clearance lattice." Clearance got an implementation
-- (legal_clearance_tier, migration 0023). Listing never did — everything was
-- listed, implicitly, because nobody had been asked.
--
-- WHAT THIS IS FOR. It is not a privacy setting. It is a PUBLICATION ACT, and
-- the difference decides the product:
--
--   A Beverly historical home is a home 364 days a year and a venue on
--   house-walk day. A static "is this residential?" classification cannot say
--   that. A per-event published bit can, because it lives on the EVENT, not on
--   the address.
--
-- So the same column that lets someone keep their home off the map is the
-- column that lets them put it ON the map for one day — an art walk, a house
-- walk, an open-run through the neighbourhood, a historical-homes tour. The
-- protective reading and the generative reading are the same bit. The
-- generative one is why people will actually use it.
--
-- SEMANTICS: BINARY, AND THE HOST HOLDS IT.
--   0 = does not appear on any public surface at all. Not the map, not the
--       list. Not "listed without an address" — absent. Owner decision
--       2026-09-05: "they control whether they appear on the map."
--   1 = appears, with everything a public listing carries.
--
-- There is deliberately NO third "listed but located coarsely" state. It was
-- considered and rejected as speculative machinery; a house-concert series that
-- wants discovery-without-address can be revisited when someone asks for it.
--
-- WHY THE DEFAULT IS 1, WHICH IS THE UNCOMFORTABLE PART.
-- Defaulting existing rows to 0 would empty the live public site. Defaulting to
-- 1 preserves behaviour and is honest about what this migration does and does
-- not achieve: it creates the CAPABILITY to unpublish. It does not retroactively
-- protect anyone who has already listed their home.
--
-- That is why the create flow must present the choice rather than inherit this
-- default (tracked on OSE-1245). A column nobody is asked about is a column
-- nobody uses, and the exposure persists for every host who is never prompted.
--
-- Indexed together with the map's lookup: every public read now filters on it,
-- so it belongs in the same composite rather than in an index of its own.

ALTER TABLE events ADD COLUMN is_published INTEGER NOT NULL DEFAULT 1
  CHECK (is_published IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_events_published_brand_h3res7_start
  ON events(is_published, brand_id, h3_res7, start_date);
