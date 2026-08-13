-- Migration 0061: sponsor eligibility columns on sponsor_business_draft (#8 realized, OSE-744 / P1).
-- Adds the eligibility state the promotion seam reads to decide paid/free/402.
--
-- These three columns are the ONLY inputs the eligibility gate persists. They are
-- deliberately PII-FREE (source enum + grant reference + boolean) so they stay
-- OUT of the PII-retention cron scope (runFormDataLifecycle) and satisfy the #24
-- audit / #8 bounded-PII invariants. free_tier_eligible is SERVER-SET only (the
-- draft-capture handler / an admin community-benefit grant); a client body value
-- is ignored (enforced by the order-9 handler + born-red TL-B).
--
-- Invariant compliance:
--   #19 migration_monotonicity: > 0060, matches /^\d{4}_.*\.sql$/, append-only,
--       no destructive table drop. Metadata-only ADD COLUMN (nullable / defaulted),
--       zero backfill, zero row rewrite. NOT count-gated (no new table/index).
--   #25 sponsor_share_covenant: eligibility is a boolean admit/deny only. NO
--       tier/placement/share/weight column is added, so price/tier can never reach
--       allocateShares() through this table.
--   #8 / #24: eligibility_evidence carries source-enum + grant-ref + timestamp
--       ONLY, never email/name/ip/anon_id.

ALTER TABLE sponsor_business_draft ADD COLUMN free_tier_eligible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sponsor_business_draft ADD COLUMN eligibility_source TEXT;
ALTER TABLE sponsor_business_draft ADD COLUMN eligibility_evidence TEXT;
