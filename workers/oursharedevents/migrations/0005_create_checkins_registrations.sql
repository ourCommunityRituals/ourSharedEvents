-- Migration 0005: Create checkins and registrations tables
-- source_placement_id on registrations enables ROI per placement.

CREATE TABLE IF NOT EXISTS checkins (
  id                    TEXT PRIMARY KEY,
  event_id              TEXT NOT NULL,
  poster_deployment_id  TEXT,
  attendee_name         TEXT,
  attendee_email_hash   TEXT,
  checked_in_bucket     TEXT NOT NULL,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (poster_deployment_id) REFERENCES poster_deployments(id)
);

CREATE TABLE IF NOT EXISTS registrations (
  id                    TEXT PRIMARY KEY,
  event_id              TEXT NOT NULL,
  source_placement_id   TEXT,
  attendee_name         TEXT,
  attendee_email_hash   TEXT,
  registration_bucket   TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'confirmed',
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (source_placement_id) REFERENCES poster_deployments(id)
);
