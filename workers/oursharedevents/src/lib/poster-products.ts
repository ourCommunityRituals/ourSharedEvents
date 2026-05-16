/**
 * OSE-310 — Poster Family registry.
 *
 * The `/poster` route + its path aliases (`/posters`, `/flyers`,
 * `/tabletop`, `/tent`, `/signage`) all serve the same POSTER_HTML
 * today, but conceptually represent a FAMILY of physical poster
 * product formats. Per DESIGN-7 (V2 backlog), at least the 4×6
 * tent-card format is planned alongside the existing 8.5×11 letter.
 *
 * This registry establishes the architectural slot so future format
 * work (DESIGN-7 tent4x6 + any future stickers/coasters/banners)
 * lands as a small additive PR rather than a routing/handler lift.
 *
 * ## Design choices (founder-authorized 2026-05-16)
 *
 * - **Static const** (not a DB table). Same shape as the existing
 *   `FORM_TYPES` const in `poster-bundle.ts`. Defer the DB-table
 *   decision to whenever admin-editable formats become a real need.
 * - **Path-aliased lookup** (not query param). The router already
 *   wires /posters /flyers /tabletop /tent /signage to the poster
 *   handler — the foundation honors that pattern instead of
 *   introducing a parallel ?format= scheme.
 * - **Data-attribute hand-off**. The handler attaches
 *   `data-poster-format="<code>"` to the rendered body so future
 *   format-specific CSS can target via `[data-poster-format=...]`
 *   selectors without touching the routing layer.
 *
 * ## Phase 1 (this module + handler wiring)
 *
 * Only the `letter` format is fully implemented (the existing
 * POSTER_HTML 8.5×11 layout). All other paths still render the
 * letter format for now, but carry their own data-poster-format
 * attribute so the Phase 2 work (DESIGN-7 tent4x6) can ship a
 * format-specific @page CSS block without touching this file.
 */

export interface PosterProduct {
  /** Stable machine code for the format. Used in data-poster-format
   *  attribute + future @page CSS selectors. Kebab-case. */
  code: string;
  /** Human-readable label. Used in future admin UIs + page titles. */
  label: string;
  /** Path aliases that map to this format. The first entry is the
   *  canonical path. ALL aliases must be registered in router.ts. */
  paths: readonly string[];
  /** Physical page width in inches (informational; future @page
   *  CSS will use these for `@page { size: WxH in; }`). */
  pageWidthIn: number;
  /** Physical page height in inches. */
  pageHeightIn: number;
  /** Whether the format has its own @page CSS block. When false,
   *  the format falls back to the letter @page rules. Phase 1:
   *  only letter implemented. */
  hasOwnPrintCss: boolean;
}

/**
 * The poster family registry. Order matters for any future
 * iteration UI — keep `letter` first as the canonical default.
 *
 * Path aliases come from router.ts where all paths fan into
 * `handlePosterPage`. Any new alias added to the router MUST be
 * registered here too so the data-poster-format attribute can be
 * derived consistently.
 */
export const POSTER_PRODUCTS: readonly PosterProduct[] = [
  {
    code: 'letter',
    label: 'Standard Poster (8.5×11)',
    paths: ['/poster', '/posters'],
    pageWidthIn: 8.5,
    pageHeightIn: 11,
    hasOwnPrintCss: true,
  },
  {
    // DESIGN-7 V2 backlog — tent card format. Phase 2 will implement
    // the @page CSS sized for 4×6 + layout adjustments (smaller QR
    // grid, no sponsor strip likely). For Phase 1 this entry exists
    // so /tabletop and /tent render with the right data-poster-format
    // attribute, but the visible output is currently the letter
    // layout (backwards-compatible — no visible change for users).
    code: 'tent4x6',
    label: 'Tabletop Tent Card (4×6)',
    paths: ['/tabletop', '/tent'],
    pageWidthIn: 4,
    pageHeightIn: 6,
    hasOwnPrintCss: false,
  },
  {
    // Future-slot for flyer-format work. Per the existing router.ts
    // wiring, /flyers already maps to handlePosterPage; this entry
    // establishes the registry slot. Visual implementation deferred
    // until a story scopes flyer dimensions + layout.
    code: 'flyer',
    label: 'Flyer',
    paths: ['/flyers'],
    pageWidthIn: 5.5,
    pageHeightIn: 8.5,
    hasOwnPrintCss: false,
  },
  {
    // Future-slot for signage-format work. Same reasoning as flyer.
    // Signage dimensions vary widely (counter card, window cling,
    // sandwich board) — a follow-on story will narrow this to a
    // specific physical product before any @page CSS lands.
    code: 'signage',
    label: 'Signage',
    paths: ['/signage'],
    pageWidthIn: 11,
    pageHeightIn: 17,
    hasOwnPrintCss: false,
  },
];

/** The canonical default format when path matching is ambiguous. */
export const DEFAULT_POSTER_CODE = 'letter';

/**
 * Look up a poster product by request pathname. Returns the letter
 * format as a fallback for any unregistered path (keeps behavior
 * backwards-compatible if the router ever fans an extra path into
 * `handlePosterPage` before this registry catches up).
 */
export function posterProductForPath(pathname: string): PosterProduct {
  const normalized = pathname.replace(/\/+$/, ''); // strip trailing slash
  for (const product of POSTER_PRODUCTS) {
    if (product.paths.includes(normalized)) {
      return product;
    }
  }
  // Fallback: letter format. The handler should also accept a 404
  // path if the router never sent it here — but if it DID arrive,
  // best to render something rather than throw.
  return POSTER_PRODUCTS.find((p) => p.code === DEFAULT_POSTER_CODE) ?? POSTER_PRODUCTS[0];
}

/**
 * All paths registered to the poster family. Useful for router-side
 * assertions / regression tests that ensure router and registry
 * stay in sync.
 */
export function allPosterPaths(): string[] {
  return POSTER_PRODUCTS.flatMap((p) => p.paths);
}
