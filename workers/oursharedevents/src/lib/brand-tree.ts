/**
 * Brands that contain brands (Part of OSE-1553, OSE-1532).
 *
 * Owner, 2026-11-23: a company's ventures each run their own events as
 * separate brands, and the parent company reaches all of them. The tree is the
 * `brand_parents` table (migration 0118): one row per brand that has a parent.
 *
 * THE RULE. A member of a brand reaches that brand and every brand below it.
 * Membership flows DOWN only: a venture's members never reach the parent or a
 * sibling venture. Nothing else widens: roles are not inherited, and the
 * automation actors (key:, svc:) are never expanded.
 *
 * FAIL CLOSED. If the tree cannot be read, a member keeps exactly the brands
 * they are a member of (never more). The platform brand and the public brand
 * are never in the tree (the table refuses them, and this module drops them
 * again), so a tree row can never hand anyone platform data or every free
 * organizer's events. The walk stops at MAX_BRAND_DEPTH levels and at
 * MAX_REACHABLE_BRANDS brands, so a bad row (a loop, a runaway tree) cannot
 * make a scope unbounded.
 */
import { PLATFORM_BRAND_ID, PUBLIC_BRAND_ID } from './admin-brand-scope';

/** How many levels below a member's brand the reach goes. */
export const MAX_BRAND_DEPTH = 4;

/** The most brands one member can reach through the tree. */
export const MAX_REACHABLE_BRANDS = 50;

const IN_CHUNK = 90;

function reserved(b: string): boolean {
  return b === PLATFORM_BRAND_ID || b === PUBLIC_BRAND_ID;
}

/**
 * The given brands plus every brand below them, in the order found (the given
 * brands first). On any read error, the given brands unchanged.
 */
export async function withDescendants(
  db: D1Database | undefined,
  brandIds: readonly string[]
): Promise<string[]> {
  const out: string[] = Array.from(new Set(brandIds));
  if (!db || out.length === 0) return out;
  const seen = new Set(out);
  let frontier = out.filter((b) => !reserved(b));
  try {
    for (let depth = 0; depth < MAX_BRAND_DEPTH && frontier.length > 0; depth++) {
      // D1 refuses a statement over 100 bound values: ask in chunks.
      const rows: Array<{ brand_id: string }> = [];
      for (let i = 0; i < frontier.length; i += IN_CHUNK) {
        const ids = frontier.slice(i, i + IN_CHUNK);
        const rs = await db
          .prepare(
            `SELECT brand_id FROM brand_parents WHERE parent_brand_id IN (${ids
              .map(() => '?')
              .join(', ')}) ORDER BY brand_id`
          )
          .bind(...ids)
          .all<{ brand_id: string }>();
        rows.push(...(rs.results ?? []));
      }
      const next: string[] = [];
      for (const r of rows) {
        const b = r.brand_id;
        if (typeof b !== 'string' || b.length === 0 || reserved(b) || seen.has(b)) continue;
        if (seen.size >= MAX_REACHABLE_BRANDS) return out;
        seen.add(b);
        out.push(b);
        next.push(b);
      }
      frontier = next;
    }
  } catch {
    // Tree unreadable (table absent, D1 error): exactly the member's own brands.
    return Array.from(new Set(brandIds));
  }
  return out;
}
