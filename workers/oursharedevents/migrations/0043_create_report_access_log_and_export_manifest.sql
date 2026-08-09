-- Migration 0043: report_access_log + export_manifest (OSE-557 / OSE-556)
--
-- report_access_log: aggregate daily counts of SharedReport endpoint access,
--   keyed by (date, event_id, role, outcome). Satisfies OSE-557 "Report access
--   logging" acceptance criterion. Aggregate grain — no PII, no IP, no
--   sub-window timestamps. Upsert pattern via ON CONFLICT unique index.
--
-- export_manifest: per-run audit record for every D1 → OCR boundary crossing
--   (forms CSV export, BigQuery backup, R2 file upload). Satisfies OSE-556
--   acceptance criterion. Append-only; no FK constraints.

-- ── report_access_log ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS report_access_log (
  id           TEXT    NOT NULL PRIMARY KEY,   -- UUID (stable after first insert)
  date         TEXT    NOT NULL,               -- ISO date YYYY-MM-DD
  event_id     TEXT    NOT NULL,
  role         TEXT    NOT NULL,               -- bar_owner | local_admin | admin | service
  outcome      TEXT    NOT NULL CHECK (outcome IN ('granted', 'denied')),
  access_count INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One aggregate row per (date, event_id, role, outcome) — upsert target
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_access_log_key
  ON report_access_log (date, event_id, role, outcome);

CREATE INDEX IF NOT EXISTS idx_report_access_log_event
  ON report_access_log (event_id, date DESC);

-- ── export_manifest ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS export_manifest (
  id            TEXT    NOT NULL PRIMARY KEY,
  export_type   TEXT    NOT NULL               -- BIGQUERY | UPLOAD_FILE (forms CSV export is ephemeral — tracked in admin_audit_log only)
                CHECK (export_type IN ('BIGQUERY', 'UPLOAD_FILE')),
  event_id      TEXT    NOT NULL,
  actor         TEXT,                          -- admin identity (email | 'key:admin' | null)
  request_id    TEXT    NOT NULL,
  rows_exported INTEGER,                       -- NULL for UPLOAD_FILE
  file_key      TEXT,                          -- R2 object key for UPLOAD_FILE, NULL otherwise
  outcome       TEXT    NOT NULL CHECK (outcome IN ('success', 'failed')),
  details       TEXT,                          -- JSON blob (error, row counts, table names)
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_export_manifest_event
  ON export_manifest (event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_export_manifest_type
  ON export_manifest (export_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_export_manifest_actor
  ON export_manifest (actor, created_at DESC);
