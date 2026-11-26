/**
 * Paid add-ons a brand has been given (OSE-2232, migration 0121).
 *
 * The owner (2026-11-25): the standard look is free for everyone; other skins
 * are sold. So a brand may save or show a layout other than the standard skin
 * only while its 'skins' add-on is on. No row means off, and a read that fails
 * reads as off (fail closed): the page then shows the standard skin, which
 * every brand has.
 */

import {
  LAYOUT_SURFACES,
  defaultLayout,
  type LayoutSurface,
  type SurfaceLayout,
} from './layout-skins';

export const ADDONS = ['skins'] as const;
export type Addon = (typeof ADDONS)[number];

export const ADDON_REQUIRED_WORDS = 'Custom looks are an add-on. Ask us to turn them on.';

export function isAddon(v: unknown): v is Addon {
  return typeof v === 'string' && (ADDONS as readonly string[]).includes(v);
}

/** Is the add-on on for this brand? Any failure reads as off. */
export async function hasAddon(
  db: D1Database,
  brandId: string | null | undefined,
  addon: Addon
): Promise<boolean> {
  if (!brandId) return false;
  try {
    const row = await db
      .prepare(`SELECT 1 AS on_ FROM brand_addons WHERE brand_id = ? AND addon = ?`)
      .bind(brandId, addon)
      .first<{ on_: number }>();
    return !!row;
  } catch {
    return false;
  }
}

/** Is this layout the free one (exactly the standard skin)? */
export function isStandardLayout(surface: LayoutSurface, layout: SurfaceLayout): boolean {
  const std = defaultLayout(surface);
  return (
    layout.skin === std.skin &&
    layout.columns === std.columns &&
    layout.order.join(',') === std.order.join(',') &&
    layout.wide.join(',') === std.wide.join(',')
  );
}

/** The surfaces in a set of layouts that need the add-on. */
export function surfacesNeedingAddon(
  layouts: Partial<Record<LayoutSurface, SurfaceLayout | null>> | undefined
): LayoutSurface[] {
  if (!layouts) return [];
  return LAYOUT_SURFACES.filter((s) => {
    const l = layouts[s];
    return !!l && !isStandardLayout(s, l);
  });
}

/** What a page shows: the event's layout while the add-on is on, else the standard skin. */
export function entitledLayout(
  surface: LayoutSurface,
  layout: SurfaceLayout,
  entitled: boolean
): SurfaceLayout {
  return entitled ? layout : defaultLayout(surface);
}
