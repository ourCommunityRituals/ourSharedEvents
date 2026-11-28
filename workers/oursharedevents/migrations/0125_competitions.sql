-- Migration 0125: competitions — leagues, seasons and their matches
-- (OSE-525, phase 1 of the leagues design approved by the owner 2026-11-27:
-- OCR-docs docs/proposals/PROPOSAL_leagues-tournaments-referees.md, section 5.1).
--
-- A competition is a thing a brand runs beside its events: a league, a season,
-- a time-boxed ladder or a one-off tournament. Phase 1 plays it as one
-- round-robin stage. Every match (a fixture) sits on an ordinary OSE event, so
-- the night keeps its poster, codes, sponsors and report.
--
--   competitions         the brand's competition: name, sport, format, status,
--                        dates and the scoring ruleset. brand_id and created_by
--                        are the brand wall (lib/admin-object-scope.ts), as for
--                        campaigns.
--   competition_stages   the stages run in order. Phase 1 makes one
--                        round_robin stage per competition. The kind list lives
--                        in src/lib/competitions.ts, not in a CHECK, so later
--                        stage kinds (brackets, pools) need no table rebuild.
--   competition_entries  a team slot. Its id has the team-id shape of OSE
--                        ADR-040 (grp_ and hex), so a team-night vote and a
--                        league entry can be one team. It holds the public
--                        label the team chose and nothing else about it.
--   fixtures             one match: its round, the two entries, the event night
--                        it is played on, the court or table label, its status.
--   fixture_results      the score of a played fixture and its state.
--
-- NEVER WHO. No table here holds a name of a person, a roster, a captain, a
-- contact or an account. A label is the team's public name (owner, D3 and
-- OSE-524) and is refused when it looks like an email address or a phone
-- number. Any captain contact that must exist stays in FORMS_DB, never here.
-- `entered_by` is a role ('host' now, 'referee' later), never an actor id: the
-- admin audit log already records who wrote what.
--
-- SCORES ARE NOT COUNTS OF PEOPLE, so the under-5 floor does not apply to them
-- (design section 5.1). Standings are computed from the results on every read,
-- never stored.
--
-- evidence_key (reserved, nothing writes it yet): a later step lets a referee
-- attach a photo of the scoreboard as the record of a score (OCR-docs design
-- section 7). The photo itself goes to R2; this is its key. It is seen by the
-- brand's organizers and referees only: never in a public answer, never sent to
-- another product. It is kept for the competition's season plus 90 days, then
-- deleted (owner, D9, 2026-11-27); the score itself is kept.
--
-- source says where a competition's matches and scores come from, and it has
-- exactly one: 'native' (the host enters them here) or 'mirrored' (a later job
-- copies a league's existing sheet in, one way, OSE-2240). A mirrored
-- competition refuses the host's writes, so the two never fight. A mirror never
-- brings a player's name in: only team labels and scores.
--
-- slot_time is the match's start on its night, as HH:MM in the event's own
-- zone (half-hour slots are usual). slot_label is the court or table.
--
-- Additive only: five new tables and their indexes. No existing row changes.
--
-- Rollback: revert the Worker and leave the tables. The older Worker reads
-- none of them. See ROLLBACK_PLAN.md, 0125.

CREATE TABLE IF NOT EXISTS competitions (
  id          TEXT    PRIMARY KEY CHECK (id GLOB 'cmp_*' AND length(id) = 36 AND substr(id, 5) NOT GLOB '*[^0-9a-f]*'),
  brand_id    TEXT    NOT NULL,
  created_by  TEXT,
  name        TEXT    NOT NULL,
  sport       TEXT,
  format      TEXT    NOT NULL CHECK (format IN ('league', 'seasonal', 'temporal', 'one_off')),
  status      TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'finished')),
  starts_on   TEXT,
  ends_on     TEXT,
  ruleset     TEXT    NOT NULL DEFAULT 'win_loss',
  source      TEXT    NOT NULL DEFAULT 'native' CHECK (source IN ('native', 'mirrored')),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_competitions_brand ON competitions(brand_id, status);

CREATE TABLE IF NOT EXISTS competition_stages (
  id              TEXT    PRIMARY KEY,
  competition_id  TEXT    NOT NULL REFERENCES competitions(id),
  kind            TEXT    NOT NULL,
  sort            INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (competition_id, sort)
);

CREATE TABLE IF NOT EXISTS competition_entries (
  id              TEXT    PRIMARY KEY CHECK (id GLOB 'grp_*' AND length(id) BETWEEN 12 AND 68 AND substr(id, 5) NOT GLOB '*[^0-9a-f-]*'),
  competition_id  TEXT    NOT NULL REFERENCES competitions(id),
  label           TEXT    NOT NULL COLLATE NOCASE,
  seed            INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (competition_id, label)
);

CREATE INDEX IF NOT EXISTS idx_competition_entries_competition ON competition_entries(competition_id);

CREATE TABLE IF NOT EXISTS fixtures (
  id              TEXT    PRIMARY KEY,
  competition_id  TEXT    NOT NULL REFERENCES competitions(id),
  stage_id        TEXT    NOT NULL REFERENCES competition_stages(id),
  event_id        TEXT    REFERENCES events(id),
  round           INTEGER NOT NULL CHECK (round >= 1),
  slot_label      TEXT,
  slot_time       TEXT    CHECK (slot_time IS NULL OR (length(slot_time) = 5 AND slot_time GLOB '[0-2][0-9]:[0-5][0-9]')),
  entry_a         TEXT    NOT NULL REFERENCES competition_entries(id),
  entry_b         TEXT    NOT NULL REFERENCES competition_entries(id),
  status          TEXT    NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'played', 'postponed')),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (entry_a <> entry_b)
);

CREATE INDEX IF NOT EXISTS idx_fixtures_competition ON fixtures(competition_id, round);
CREATE INDEX IF NOT EXISTS idx_fixtures_event ON fixtures(event_id);

CREATE TABLE IF NOT EXISTS fixture_results (
  fixture_id    TEXT    PRIMARY KEY REFERENCES fixtures(id),
  score_a       INTEGER NOT NULL CHECK (score_a >= 0 AND score_a <= 999),
  score_b       INTEGER NOT NULL CHECK (score_b >= 0 AND score_b <= 999),
  state         TEXT    NOT NULL DEFAULT 'confirmed' CHECK (state IN ('provisional', 'confirmed', 'disputed', 'final')),
  entered_by    TEXT    NOT NULL DEFAULT 'host' CHECK (entered_by IN ('host', 'referee')),
  evidence_key  TEXT,
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
