-- Migration 0053: sponsor_business_draft — onboarding intake, resolver-invisible (#25), brand-scoped (#9).
-- OSE-724 (epic OSE-723, Sponsor Onboarding data-model set).
--
-- Net-new draft table holding a sponsor's onboarding intake BEFORE promotion.
-- Deliberately a SEPARATE table from `sponsors` so the resolver
-- (sponsor-resolver.ts — `SELECT ... FROM sponsors WHERE ... is_active = 1`)
-- can NEVER see a draft. This is STRUCTURAL, not status-flag, enforcement of
-- the share-of-voice covenant (Invariant #25): a draft has no row in the table
-- the resolver reads, so it cannot enter the rotation under any code path.
--
-- Invariant compliance:
--   #19 migration_monotonicity — highest live = 0052; 0053 = max+1. Matches
--       /^\d{4}_.*\.sql$/, unique prefix, strictly increasing, no DROP TABLE.
--   #25 sponsor_share_covenant — MUST NOT be in LOAD_BEARING_TABLES; MUST NOT
--       be referenced by sponsor-resolver.ts / sponsor-allocation.ts. Proven by
--       the runtime reachability spec sponsor-resolver-invisibility.invariant.spec.ts.
--   #9  tenant_isolation — brand_id NOT NULL, server-set from the signed invite
--       token only (never the client body). Enforced in the order-9 handler.
--   #3  uec_encoding — no hardcoded UEC/tier/hex.
--   ADR-001 — zero FK into FORMS_DB; migrations-forms/ untouched. MAIN DB only.
--
-- category_selections JSON carries bundle-vs-custom intent (#8) → #8 needs no
-- separate migration. DDL-only: the draft-capture handler is OSE-732 (order 9),
-- promotion is OSE-736 (order 13).

CREATE TABLE IF NOT EXISTS sponsor_business_draft (
  draft_token              TEXT PRIMARY KEY,
  brand_id                 TEXT NOT NULL,              -- #9 server-set from invite token, never client body
  event_id                 TEXT,
  campaign_id              TEXT,                       -- nullable, mirrors sponsors.campaign_id (0040)
  name                     TEXT NOT NULL,
  website_url              TEXT,
  logo_url                 TEXT,                       -- nullable, COALESCE fallback source at promotion
  address_raw              TEXT,
  lat                      REAL,                       -- server-geocoded only (#25 is_local derived)
  lon                      REAL,
  h3_res9                  TEXT,
  h3_res7                  TEXT,
  is_local_derived         INTEGER NOT NULL DEFAULT 0, -- geo-derived, never client toggle (supersedes OSE-335)
  is_local_review_flag     INTEGER NOT NULL DEFAULT 0,
  business_type            TEXT,
  category_selections      TEXT NOT NULL DEFAULT '[]', -- JSON [{category,mode:'whole'|'custom',excluded:[template_id],consent_flags}] (#8)
  covenant_acknowledged_at TEXT,
  promoted_sponsor_id      TEXT,                       -- set at promotion, NULL until then (double-promote guard, order 13)
  status                   TEXT NOT NULL DEFAULT 'draft',
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sponsor_business_draft_brand  ON sponsor_business_draft(brand_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_business_draft_event  ON sponsor_business_draft(event_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_business_draft_status ON sponsor_business_draft(status);
