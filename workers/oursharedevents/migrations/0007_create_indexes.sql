-- Migration 0007: Create production indexes
-- Must run last — all tables must exist before indexes are created.
-- Composite indexes optimize the most frequent query patterns.

-- Events: lookup by brand and status (dashboard filtering)
CREATE INDEX IF NOT EXISTS idx_events_brand_status
  ON events(brand_id, status);

-- Events: lookup by slug (public URL resolution)
CREATE INDEX IF NOT EXISTS idx_events_slug
  ON events(slug);

-- Sponsors: lookup by event
CREATE INDEX IF NOT EXISTS idx_sponsors_event_id
  ON sponsors(event_id);

-- Poster deployments: lookup by event
CREATE INDEX IF NOT EXISTS idx_poster_deployments_event_id
  ON poster_deployments(event_id);

-- Poster deployments: lookup by QR token (scan entry point)
CREATE INDEX IF NOT EXISTS idx_poster_deployments_qr_token
  ON poster_deployments(qr_token);

-- Scans: lookup by event and time bucket (analytics queries)
CREATE INDEX IF NOT EXISTS idx_scans_event_bucket
  ON scans(event_id, scan_bucket);

-- Scans: lookup by poster deployment (per-placement analytics)
CREATE INDEX IF NOT EXISTS idx_scans_poster_deployment
  ON scans(poster_deployment_id);

-- Checkins: lookup by event
CREATE INDEX IF NOT EXISTS idx_checkins_event_id
  ON checkins(event_id);

-- Registrations: lookup by event
CREATE INDEX IF NOT EXISTS idx_registrations_event_id
  ON registrations(event_id);

-- Registrations: lookup by source placement (ROI tracking)
CREATE INDEX IF NOT EXISTS idx_registrations_source_placement
  ON registrations(source_placement_id);

-- Scan aggregates: lookup by event and date (dashboard charts)
CREATE INDEX IF NOT EXISTS idx_scan_aggregates_event_date
  ON scan_aggregates(event_id, bucket_date);
