/**
 * Read the event-type catalog from D1 (OSE-1344). The two registry tables are
 * shared and hold no tenant data, so the admin picker
 * (GET /api/v2/admin/event-types) and the public landing's category row read
 * them the same way, through this one query pair. Grouping stays in the pure
 * lib/event-type-catalog.ts.
 */
import {
  buildEventTypeCatalog,
  type EventTypeCatalog,
  type EventTypeCategoryRow,
  type EventTypeRow,
} from './event-type-catalog.js';

/** No database (a test env, a binding not set): an empty catalog, never a throw. */
export async function readEventTypeCatalog(
  db: D1Database | undefined | null
): Promise<EventTypeCatalog> {
  if (!db) return { categories: [], orphans: 0 };
  const [cats, types] = await Promise.all([
    db
      .prepare(
        `SELECT category_code, display_name, display_order, is_active
           FROM event_type_category_registry
          WHERE is_active = 1`
      )
      .all<EventTypeCategoryRow>(),
    db
      .prepare(
        `SELECT id, uec_code, name, description, category_code, legal_clearance_tier, is_active
           FROM event_type_registry
          WHERE is_active = 1`
      )
      .all<EventTypeRow>(),
  ]);
  // Stryker disable next-line ArrayDeclaration: equivalent — a junk category row with no type under it is dropped by the grouping, the same as no row
  const categoryRows = cats.results ?? [];
  return buildEventTypeCatalog(categoryRows, types.results ?? []);
}
