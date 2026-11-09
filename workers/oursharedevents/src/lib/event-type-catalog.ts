/**
 * Event-type catalog — the Category → Type shape behind the Create Event
 * picker (OSE-1344: "Sports > Bocce").
 *
 * WHY THIS EXISTS. `events.event_type_id` has been in the schema since 0023
 * and nothing wrote it; the 47 seeded types (0024) carried their category only
 * as a UEC prefix. Migration 0076 made the category a column plus a lookup.
 * This module is the ONE place that turns those two tables into what a picker
 * renders, so the advanced form, the wizard, and any future attendee filter
 * agree on the grouping.
 *
 * ZERO-WASTE RULE. A type is never dropped by the grouping. If a registry row
 * has a category_code with no lookup row (a seed mistake, or a cluster added
 * before its category), it lands in a synthetic "Other" bucket at the END of
 * the list and is counted in `orphans`. The spec asserts `orphans === 0` on
 * the migrated schema — that is the ticket's acceptance criterion — while the
 * API stays useful the day someone gets it wrong.
 *
 * Pure — no D1, no fetch.
 */

export interface EventTypeCategoryRow {
  category_code: string;
  display_name: string;
  display_order: number;
  is_active?: number;
}

export interface EventTypeRow {
  id: string;
  uec_code: string;
  name: string;
  description: string | null;
  category_code: string | null;
  legal_clearance_tier?: number;
  is_active?: number;
}

export interface CatalogType {
  id: string;
  uec_code: string;
  name: string;
  description: string | null;
}

export interface CatalogCategory {
  code: string;
  name: string;
  types: CatalogType[];
}

export interface EventTypeCatalog {
  categories: CatalogCategory[];
  /** Active types whose category_code matched no active category row. */
  orphans: number;
}

export const OTHER_CATEGORY_CODE = 'OTHER';
export const OTHER_CATEGORY_NAME = 'Other';

/** `event_type_registry.id` shape (0024 seed: `etr-rec-bocce`). Bounded, no whitespace. */
export const EVENT_TYPE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isEventTypeIdShape(v: unknown): v is string {
  return typeof v === 'string' && EVENT_TYPE_ID_RE.test(v);
}

/**
 * Group registry rows under their categories. Categories keep their
 * display_order (then code); types are alphabetical by name inside a category
 * so "Bocce" is findable without knowing its UEC code. Empty categories are
 * omitted — a heading with nothing to pick is noise.
 */
export function buildEventTypeCatalog(
  categories: EventTypeCategoryRow[],
  types: EventTypeRow[]
): EventTypeCatalog {
  const byCode = new Map<string, CatalogCategory>();
  const ordered = categories
    // filter() returns a new array, so the sort never touches the caller's rows.
    .filter((c) => c.is_active === undefined || c.is_active === 1)
    .sort(
      (a, b) => a.display_order - b.display_order || a.category_code.localeCompare(b.category_code)
    );
  for (const c of ordered) {
    byCode.set(c.category_code, { code: c.category_code, name: c.display_name, types: [] });
  }

  const other: CatalogCategory = {
    code: OTHER_CATEGORY_CODE,
    name: OTHER_CATEGORY_NAME,
    types: [],
  };
  let orphans = 0;
  for (const t of types) {
    if (t.is_active !== undefined && t.is_active !== 1) continue;
    const entry: CatalogType = {
      id: t.id,
      uec_code: t.uec_code,
      name: t.name,
      description: t.description ?? null,
    };
    const cat = t.category_code ? byCode.get(t.category_code) : undefined;
    if (cat) cat.types.push(entry);
    else {
      orphans++;
      other.types.push(entry);
    }
  }

  const out: CatalogCategory[] = [];
  for (const c of byCode.values()) {
    if (c.types.length === 0) continue;
    c.types.sort((a, b) => a.name.localeCompare(b.name));
    out.push(c);
  }
  if (other.types.length > 0) {
    other.types.sort((a, b) => a.name.localeCompare(b.name));
    out.push(other);
  }
  return { categories: out, orphans };
}

/** The category an event type sits under, as the landing's Type row names it. */
export interface TypeCategory {
  code: string;
  name: string;
  /** Position in the catalog: categories keep display_order, "Other" is last. */
  order: number;
}

/**
 * Event type id → its category, from the same grouping the picker shows, so a
 * filter by category (the landing's Type row, owner 2026-11-09) and the Create
 * Event picker cannot disagree. An orphan type maps to the "Other" bucket.
 */
export function categoryByTypeId(catalog: EventTypeCatalog): Map<string, TypeCategory> {
  const out = new Map<string, TypeCategory>();
  catalog.categories.forEach((c, order) => {
    for (const t of c.types) out.set(t.id, { code: c.code, name: c.name, order });
  });
  return out;
}
