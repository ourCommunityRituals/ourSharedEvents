-- Migration 0042: Security metrics and alerts tables
--
-- security_metrics: one row per day per environment; written by the Worker
--   scheduled handler after the daily cron run.
--
-- security_alerts: append-only alert log; one row per anomaly event.
--   resolved_at is NULL until an operator closes the alert via admin API.
--
-- Both tables are in the main DB (DB binding) because they are operational
-- infrastructure, not PII-bearing form data.

CREATE TABLE IF NOT EXISTS security_metrics (
  id               TEXT    NOT NULL PRIMARY KEY,          -- UUID
  date             TEXT    NOT NULL,                      -- ISO date YYYY-MM-DD
  env              TEXT    NOT NULL DEFAULT 'unknown',    -- staging | production
  auth_failures    INTEGER NOT NULL DEFAULT 0,
  rate_limit_triggers INTEGER NOT NULL DEFAULT 0,
  error_5xx        INTEGER NOT NULL DEFAULT 0,
  error_4xx        INTEGER NOT NULL DEFAULT 0,
  total_requests   INTEGER NOT NULL DEFAULT 0,
  anomaly_flags    TEXT    NOT NULL DEFAULT '[]',         -- JSON array of flag strings
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One snapshot per day per environment
CREATE UNIQUE INDEX IF NOT EXISTS idx_security_metrics_date_env
  ON security_metrics (date, env);

CREATE INDEX IF NOT EXISTS idx_security_metrics_date
  ON security_metrics (date DESC);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS security_alerts (
  id           TEXT    NOT NULL PRIMARY KEY,          -- UUID
  type         TEXT    NOT NULL,                      -- auth_failures | rate_limit | error_rate | secret_leak | ...
  severity     TEXT    NOT NULL,                      -- LOW | MEDIUM | HIGH | CRITICAL
  message      TEXT    NOT NULL,
  details      TEXT    NOT NULL DEFAULT '{}',         -- JSON blob (counts, thresholds, samples)
  env          TEXT    NOT NULL DEFAULT 'unknown',
  resolved_at  TEXT,                                  -- NULL = open alert
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_security_alerts_type
  ON security_alerts (type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_alerts_severity
  ON security_alerts (severity, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_alerts_open
  ON security_alerts (resolved_at, created_at DESC)
  WHERE resolved_at IS NULL;
