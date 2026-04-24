-- OSE-212 / SEC-6 — Admin audit log
-- Tracks admin mutations and denied access attempts for security traceability.
-- Append-only; no soft-delete; no FK constraints (events/sponsors may be deleted).

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  action        TEXT NOT NULL,
  actor         TEXT,
  resource_type TEXT,
  resource_id   TEXT,
  request_id    TEXT NOT NULL,
  outcome       TEXT NOT NULL CHECK (outcome IN ('success', 'denied')),
  ip            TEXT,
  details       TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor      ON admin_audit_log (actor);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_resource   ON admin_audit_log (resource_type, resource_id);
