-- Migration 0110: events.campaign_id — an event can be in one campaign
-- (OSE-1552 scope 1; OSE ADR-030).
--
-- A campaign (0039) is a brand's title and status. Until now only a sponsor
-- placement could be in one (sponsor_placement.campaign_id, 0067). An event can
-- now be in one too:
--   campaign_id   the campaign this event belongs to, or NULL. One column, so an
--                 event is in at most one campaign.
--
-- THE BRAND RULE IS NOT IN THIS FILE. SQLite cannot say "the campaign's brand
-- equals this row's brand" in a column constraint. The rule lives in the one
-- statement that sets the column (addEventToCampaign in src/lib/campaigns.ts),
-- which proves the brand match in its own WHERE, and every read joins
-- `campaigns` on the brand match. Gate:
-- tests/e2e/0-architecture/campaign-brand-and-consent.invariant.spec.ts.
--
-- This column and sponsor_placement.campaign_id are independent. Neither is
-- copied to the other, here or in the Worker. Which one wins when they differ
-- is an open owner decision (OSE-1552 scope 4).
--
-- Nothing public reads this column. The public event projection is unchanged.
--
-- Additive only: one nullable column and one index. No row is written or
-- rewritten; every existing event reads campaign_id NULL. SQLite accepts
-- REFERENCES on an added column whose default is NULL, as 0034
-- (events.series_id) and 0109 did.
--
-- Rollback: revert the Worker and leave the column. The older Worker does not
-- read it. See ROLLBACK_PLAN.md, 0110.

ALTER TABLE events ADD COLUMN campaign_id TEXT REFERENCES campaigns(id);

CREATE INDEX IF NOT EXISTS idx_events_campaign_id ON events(campaign_id);
