/**
 * Tier-1 smoke manifest types.
 *
 * One engine (tier1.spec.ts) + one manifest per app = smoke coverage for every
 * page. Adding a page to CI is adding ONE entry here, not writing a spec.
 *
 * Flags are capability-based so the suite runs green against today's code and
 * tightens automatically as consolidation lands (e.g. flip `sharedSheet: true`
 * on a page when it migrates to /ui.css — the stricter assertions switch on).
 */

export interface RouteSpec {
  /** Path to request. Use {id}-style placeholders resolved from fixtures. */
  path: string;
  /** Human name for the report. */
  name: string;
  /** Expected HTTP status (default 200). e.g. 401 for admin sign-in. */
  status?: number;
  /** A data-testid (preferred) or CSS selector that proves the page rendered. */
  anchor: string;
  /**
   * Auth mode: 'none' | 'admin'. 'admin' routes are skipped unless the runner
   * provides credentials (OSE: extraHTTPHeaders in its ui-smoke config).
   */
  auth?: 'none' | 'admin';
  /**
   * Gated: when visited WITHOUT auth/role, the page must still render a
   * humane gate — an .empty-state (post-@ocr/ui) or the legacy denied element —
   * never a blank screen or bare JSON.
   */
  gate?: boolean;
  /** Page has migrated to the shared stylesheet: assert exactly one /ui.css
   *  link and no large inline <style>. Leave false until migration. */
  sharedSheet?: boolean;
  /** Minimum tap-target height for interactive elements (px).
   *  OSE floor is 44 (OSE-292); WKRP standard is 48. */
  minTap?: number;
  /** Requires a fixture id (e.g. a seeded event or DJ). Skipped unless the
   *  named env var is present. */
  fixtureEnv?: string;
  /** Skip the no-horizontal-scroll check (e.g. print-oriented poster). */
  allowHScroll?: boolean;
}

export interface AppManifest {
  app: 'ose' | 'wkrp';
  /** Default minimum tap size for the app; per-route minTap overrides. */
  minTap: number;
  routes: RouteSpec[];
}

/** Resolve {placeholder} segments from environment fixtures. */
export function resolvePath(route: RouteSpec): string | null {
  if (!route.fixtureEnv) return route.path;
  const id = process.env[route.fixtureEnv];
  if (!id) return null; // caller skips
  return route.path.replace(/\{[^}]+\}/, encodeURIComponent(id));
}
