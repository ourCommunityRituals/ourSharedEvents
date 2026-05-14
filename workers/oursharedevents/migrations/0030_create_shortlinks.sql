-- Migration 0030: shortlinks table
--
-- OSE-240 / BE-25 — shareable event links for the 6-week pre-event window.
-- ose.link/abc123 (or oursharedevents.com/s/abc123 until ose.link is
-- CNAME'd) is the coordination artifact that propagates by SMS / iMessage /
-- Slack / Facebook in the lead-up to a Pulse 1 event.
--
-- AC corrections from the original spec (Co-Arch ground-truth 2026-05-14):
--   1. event_id is TEXT REFERENCES events(id), not INTEGER. events.id is
--      a `TEXT PRIMARY KEY` of the shape evt_<uuid> (handlers/events.ts
--      handleCreateEvent line 357). FK type-affinity invariant gate
--      (PR #154) enforces this; INTEGER would fail CI.
--   2. Slot 0030, not 0025 (taken by 0025_event_state_machine.sql).
--   3. No pool-contract.ts changes. The original "BIGQUERY_DATASETS
--      streaming schema" step has no target in that file; shortlinks
--      will be added to REQUIRED_TAGS only when a BigQuery consumer
--      actually needs them.
--
-- Anonymity-principle compliance (reinforced 2026-05-14):
--   Click logging tracks the COUNTER + last_clicked_at TIMESTAMP only.
--   No IP, no anon_id, no session cookie, no Referer. The /s/:code
--   handler must increment the counter and 302-redirect with no PII
--   collection in the path. This file does not declare any column that
--   could carry per-attendee identity.

CREATE TABLE IF NOT EXISTS shortlinks (
  -- 6-char base62 code. Collision-resistant: 62^6 = 56.8 billion combinations.
  -- TEXT PRIMARY KEY so the lookup is the same constant-time hit as any
  -- other PK index in this schema.
  code             TEXT PRIMARY KEY,

  -- Owning event. TEXT to match events.id (evt_<uuid>). FK type-affinity
  -- invariant gate validates this on every CI run.
  event_id         TEXT NOT NULL REFERENCES events(id),

  -- Creation timestamp (ISO-8601 string). Stored in UTC.
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),

  -- Click counter. Incremented per /s/:code resolution. Anonymous: the
  -- count is the only datum collected. No IP, no anon_id, no session.
  clicks           INTEGER NOT NULL DEFAULT 0,

  -- Last click timestamp (ISO-8601, UTC) or NULL if never clicked. Useful
  -- for admin "is this link being shared?" signal without revealing who
  -- clicked when.
  last_clicked_at  TEXT
);

-- Lookup by event_id is the second-most-common access pattern (admin
-- "show me the shortlink for event X" + future bulk reports).
CREATE INDEX IF NOT EXISTS idx_shortlinks_event_id
  ON shortlinks(event_id);

-- Sorting by created_at supports admin pagination if we ever need to
-- list shortlinks across all events (Sprint 2+).
CREATE INDEX IF NOT EXISTS idx_shortlinks_created_at
  ON shortlinks(created_at);
