-- Migration 0069: index the attendee map's lookup (OSE-1242, CCR H3)
--
-- `GET /api/v2/events/map` filters on (brand_id, h3_res7, status) and orders by
-- start_date. Migration 0037 added `h3_res7` to events and indexed nothing, so
-- every map request was a full scan of the table — on what is intended to be
-- the highest-traffic future surface.
--
-- The tenant-isolation invariant already makes this argument for the other
-- public list query (tests/e2e/0-architecture/tenant-isolation.invariant.spec.ts
-- asserts an index exists, "without this index, tenant-scoped public list
-- queries do full table scans"). The identical reasoning applies here and was
-- missed because that gate names one handler rather than describing the
-- property. Both are tracked in the CCR hold list.
--
-- Column order follows the query's selectivity: brand first (the tenant
-- boundary, and the highest-cardinality equality), then the corridor cell, then
-- status, with start_date last so the range scan and the ORDER BY are both
-- served by the same index rather than by a sort.

CREATE INDEX IF NOT EXISTS idx_events_brand_h3res7_status_start
  ON events(brand_id, h3_res7, status, start_date);
