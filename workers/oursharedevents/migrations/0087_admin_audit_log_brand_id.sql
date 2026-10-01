-- Migration 0087: admin_audit_log.brand_id (AUD-3 Phase B, OSE-1447).
--
-- Each audit row records the tenant its target belongs to, so a brand owner can
-- read their own brand's history (GET /api/v2/admin/audit-log?scope=brand)
-- without seeing any other tenant's. NULL means platform-only: platform actions
-- (subscribers, erase, global flags, scope refusals, retention jobs) and any row
-- whose target cannot be resolved. A brand-scoped read never returns NULL rows,
-- so an unresolvable row fails closed.
--
-- The writer resolves the brand at insert time (lib/audit-log.ts,
-- AUDIT_BRAND_RESOLVE_SQL). The backfill below applies the same mapping to rows
-- written before this migration.
--
-- Append-only (TL-042): the backfill only fills the NEW column, and only where it
-- is still NULL. It never changes a value that was recorded, never deletes a row,
-- and re-running it is a no-op. A target deleted before this migration ran stays
-- NULL (platform-only).
--
-- Count check after apply (resolved vs platform-only):
--   SELECT brand_id IS NOT NULL AS resolved, COUNT(*) FROM admin_audit_log GROUP BY 1;

ALTER TABLE admin_audit_log ADD COLUMN brand_id TEXT;

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_brand_created
  ON admin_audit_log (brand_id, created_at DESC);

-- Event-addressed rows: the resource id is the event id.
UPDATE admin_audit_log
   SET brand_id = (SELECT e.brand_id FROM events e WHERE e.id = admin_audit_log.resource_id)
 WHERE brand_id IS NULL
   AND resource_type IN ('event', 'forms', 'forms-export', 'shared-report');

-- Per-event flag rows: the resource id is "<eventId>/<flagKey>". A global flag
-- key carries no "/" and stays NULL (platform-only).
UPDATE admin_audit_log
   SET brand_id = (
         SELECT e.brand_id FROM events e
          WHERE e.id = substr(admin_audit_log.resource_id, 1, instr(admin_audit_log.resource_id, '/') - 1)
       )
 WHERE brand_id IS NULL
   AND resource_type = 'flag'
   AND instr(resource_id, '/') > 1;

-- Sponsor rows: the resource id is the sponsor_business id.
UPDATE admin_audit_log
   SET brand_id = (SELECT sb.brand_id FROM sponsor_business sb WHERE sb.id = admin_audit_log.resource_id)
 WHERE brand_id IS NULL
   AND resource_type = 'sponsor';

-- Placement rows belong to the event's tenant (the organizer who answers them).
UPDATE admin_audit_log
   SET brand_id = (
         SELECT e.brand_id FROM sponsor_placement sp JOIN events e ON e.id = sp.event_id
          WHERE sp.id = admin_audit_log.resource_id
       )
 WHERE brand_id IS NULL
   AND resource_type = 'sponsor_placement';

-- Sponsor-draft eligibility rows already carry the draft's brand as resource id.
UPDATE admin_audit_log
   SET brand_id = resource_id
 WHERE brand_id IS NULL
   AND resource_type = 'sponsor_draft'
   AND resource_id IS NOT NULL
   AND resource_id <> '';
