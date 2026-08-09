-- OSE-666 / B2 — admin identity → brand + role membership (Invariant #9 + #24).
--
-- The audited source of truth that backs resolveAdminBrandScope, replacing the
-- interim ADMIN_BRAND_MEMBERSHIP env map. Each row grants an operator (by their
-- CF Access email) a role within one brand. Brand scope on the admin surface is
-- derived from these rows server-side — never from a client-supplied brand_id.
--
-- role vocabulary (for OSE-671 role lens): brand_owner | organizer |
-- sponsor_manager | staff. Defaults to 'organizer' (least-surprise operational
-- role) — never brand_owner by default (fail-safe: no accidental escalation).

CREATE TABLE IF NOT EXISTS admin_brand_memberships (
  email      TEXT NOT NULL,
  brand_id   TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'organizer',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (email, brand_id)
);

-- Scope resolution looks up all rows for an email; index the lookup key.
CREATE INDEX IF NOT EXISTS idx_admin_brand_memberships_email
  ON admin_brand_memberships (email);
