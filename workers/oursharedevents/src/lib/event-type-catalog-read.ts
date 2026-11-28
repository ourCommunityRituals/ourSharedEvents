/**
 * Read the event-type catalog from D1 (OSE-1344). The registry tables are
 * shared and hold no tenant data, so the admin picker
 * (GET /api/v2/admin/event-types) and the public landing's category row read
 * them the same way, through this one query pair. Grouping stays in the pure
 * lib/event-type-catalog.ts.
 *
 * BUCKETS (migration 0126, owner 2026-11-28). The catalog's groups are the 9
 * plain buckets (event_type_bucket), not the 15 categories. Each type's
 * bucket_code is read as the catalog's `category_code`, so the grouping, the
 * landing row and the picker need no second shape. The 15 categories stay in
 * the database for the dashboard, exports and reports, which read them directly.
 *
 * CLEARANCE. A type above the clearance ceiling (lib/template-clearance.ts) is
 * left out, so a type that can need a licence (Bingo, Parade) is never offered
 * before the ceiling rises.
 */
import {
  buildEventTypeCatalog,
  type EventTypeCatalog,
  type EventTypeCategoryRow,
  type EventTypeRow,
} from './event-type-catalog.js';
import { LAUNCH_MAX_CLEARANCE_TIER } from './template-clearance.js';

/** No database (a test env, a binding not set): an empty catalog, never a throw. */
export async function readEventTypeCatalog(
  db: D1Database | undefined | null,
  maxTier: number = LAUNCH_MAX_CLEARANCE_TIER
): Promise<EventTypeCatalog> {
  if (!db) return { categories: [], orphans: 0 };
  const [cats, types] = await Promise.all([
    db
      .prepare(
        `SELECT bucket_code AS category_code, display_name, short_name, display_order, is_active
           FROM event_type_bucket
          WHERE is_active = 1`
      )
      .all<EventTypeCategoryRow>(),
    db
      .prepare(
        `SELECT id, uec_code, name, description, bucket_code AS category_code, legal_clearance_tier, is_active
           FROM event_type_registry
          WHERE is_active = 1 AND legal_clearance_tier <= ?`
      )
      .bind(maxTier)
      .all<EventTypeRow>(),
  ]);
  // Stryker disable next-line ArrayDeclaration: equivalent — a junk category row with no type under it is dropped by the grouping, the same as no row
  const categoryRows = cats.results ?? [];
  return buildEventTypeCatalog(categoryRows, types.results ?? []);
}
