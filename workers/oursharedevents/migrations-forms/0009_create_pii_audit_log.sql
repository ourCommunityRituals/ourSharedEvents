-- Migration 0009: Create PII destruction audit log
-- ADMIN-7: Persistent record of all PII scrub/delete actions.
-- Required for GDPR Art. 30 (records of processing) and CCPA compliance.
-- Each lifecycle run writes one row per phase with counts.

CREATE TABLE IF NOT EXISTS pii_audit_log (
  id            TEXT PRIMARY KEY,
  phase         TEXT NOT NULL,               -- 'registrations_delete' | 'surveys_scrub' | 'email_signups_delete'
  triggered_by  TEXT NOT NULL DEFAULT 'scheduled', -- 'scheduled' | 'manual' | 'retention_policy'
  records_affected INTEGER NOT NULL DEFAULT 0,
  errors        INTEGER NOT NULL DEFAULT 0,
  event_id      TEXT,                        -- NULL for global runs, set for per-event manual runs
  details       TEXT,                        -- JSON: additional context
  executed_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pii_audit_log_phase
  ON pii_audit_log(phase, executed_at);

CREATE INDEX IF NOT EXISTS idx_pii_audit_log_event
  ON pii_audit_log(event_id, executed_at);
