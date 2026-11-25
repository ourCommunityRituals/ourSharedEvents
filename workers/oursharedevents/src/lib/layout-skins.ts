/**
 * Layout skins: one way to arrange the parts of a page (OSE-2232, OSE-2226).
 *
 * The owner (2026-11-25): "make sure there is configurable room to move around
 * the elements to present interchangeable, unique report skins for every event
 * sharedReport if decided ... 1) Priority is the sharedReport 2) think how this
 * can also be applied to the poster layout too."
 *
 * THE SHAPE. A surface (the SharedReport, the host's vote screen) is cut into
 * named regions. A layout says, for one event and one surface:
 *
 *   - order    every region, each once, in the order they appear;
 *   - wide     the regions that run the full width when there are two columns;
 *   - columns  1 (one stack) or 2 (a grid on a wide screen; one stack on a phone);
 *   - skin     the ready-made layout it started from, or "custom" once moved.
 *
 * A skin is a named, ready-made layout. The organizer picks one and may move
 * parts from there. The layout lives in the event's settings
 * (`settings.layouts.<surface>`, lib/event-settings.ts), so no migration.
 *
 * WHAT A SKIN NEVER DOES.
 *   - Recolor. Colors come from the design tokens only (AGENTS.md invariant 8).
 *     A skin arranges; the brand and the theme still paint.
 *   - Hide. Every region is in `order`, so a part the reader may see is never
 *     dropped by a skin. What a reader may see is still decided where it was
 *     (the report's depth filter, lib/report-depth.ts).
 *   - Carry a count, a name or a link. Only region names from the lists below.
 *
 * READING ORDER. The page moves its regions in the DOM, not with CSS `order`,
 * so what is read aloud and where focus goes follow what is seen
 * (WCAG 1.3.2, 2.4.3). `LAYOUT_CLIENT_JS` below is the one mover every surface
 * uses.
 *
 * The poster can take the same shape later (docs/design/OSE-layout-skins.md).
 */

/** The surfaces that take a layout. Additions are decisions. */
export const LAYOUT_SURFACES = ['report', 'vote_screen'] as const;
export type LayoutSurface = (typeof LAYOUT_SURFACES)[number];

/**
 * Each surface's regions, in their standard order. The SharedReport's header
 * (the event's title and date) is not a region: it always comes first.
 */
export const SURFACE_REGIONS: { readonly [S in LayoutSurface]: readonly string[] } = {
  report: ['stats', 'map', 'sponsors', 'classes', 'posters', 'trend', 'locked'],
  vote_screen: ['line', 'code'],
};

/** The words an organizer reads for each region. */
export const REGION_WORDS: { readonly [S in LayoutSurface]: Readonly<Record<string, string>> } = {
  report: {
    stats: 'Scans',
    map: 'Corridor map',
    sponsors: 'Sponsor displays',
    classes: 'Local and paid sponsors',
    posters: 'Poster attribution',
    trend: 'Scan trend',
    locked: 'More on the next report',
  },
  vote_screen: {
    line: 'The words "Scan to vote"',
    code: 'The vote code',
  },
};

export type LayoutColumns = 1 | 2;

export interface SurfaceLayout {
  skin: string;
  columns: LayoutColumns;
  order: string[];
  wide: string[];
}

/** The name a layout carries once the organizer has moved something. */
export const CUSTOM_SKIN = 'custom';

interface Skin {
  words: string;
  columns: LayoutColumns;
  order: readonly string[];
  wide: readonly string[];
}

/** The ready-made skins, per surface. The first is the standard one. */
export const SKINS: { readonly [S in LayoutSurface]: Readonly<Record<string, Skin>> } = {
  report: {
    standard: {
      words: 'Standard: one column, as it has always read',
      columns: 1,
      order: SURFACE_REGIONS.report,
      wide: [],
    },
    map_first: {
      words: 'Map first: the corridor map leads',
      columns: 2,
      order: ['map', 'stats', 'sponsors', 'classes', 'posters', 'trend', 'locked'],
      wide: ['map', 'posters', 'trend', 'locked'],
    },
    sponsors_first: {
      words: 'Sponsors first: sponsor displays lead',
      columns: 2,
      order: ['sponsors', 'classes', 'stats', 'map', 'posters', 'trend', 'locked'],
      wide: ['sponsors', 'map', 'posters', 'locked'],
    },
    side_by_side: {
      words: 'Side by side: two columns on a wide screen',
      columns: 2,
      order: SURFACE_REGIONS.report,
      wide: ['map', 'locked'],
    },
  },
  vote_screen: {
    standard: {
      words: 'Standard: words above the code',
      columns: 1,
      order: ['line', 'code'],
      wide: [],
    },
    code_first: {
      words: 'Code above the words',
      columns: 1,
      order: ['code', 'line'],
      wide: [],
    },
    side_by_side: {
      words: 'Side by side, for a wide TV',
      columns: 2,
      order: ['code', 'line'],
      wide: [],
    },
  },
};

/** The standard skin's name for a surface (the first listed). */
export function standardSkin(surface: LayoutSurface): string {
  return Object.keys(SKINS[surface])[0]!;
}

/** A skin's layout, as a fresh object. */
export function skinLayout(surface: LayoutSurface, name: string): SurfaceLayout | null {
  if (!Object.prototype.hasOwnProperty.call(SKINS[surface], name)) return null;
  const s = SKINS[surface][name]!;
  // wide in the surface's own order, as checkLayout keeps it.
  const wide = SURFACE_REGIONS[surface].filter((r) => s.wide.includes(r));
  return { skin: name, columns: s.columns, order: [...s.order], wide };
}

/** The layout a surface takes when nothing is saved. */
export function defaultLayout(surface: LayoutSurface): SurfaceLayout {
  return skinLayout(surface, standardSkin(surface))!;
}

export function isLayoutSurface(v: unknown): v is LayoutSurface {
  return typeof v === 'string' && (LAYOUT_SURFACES as readonly string[]).includes(v);
}

/**
 * Check one surface's layout. Returns the clean layout, or the words that say
 * what is wrong. Strict: every region once in `order`, `wide` a subset with no
 * repeats, `columns` 1 or 2, `skin` a known skin or "custom".
 */
export function checkLayout(
  surface: LayoutSurface,
  v: unknown
): { ok: true; value: SurfaceLayout } | { ok: false; error: string } {
  const at = `settings.layouts.${surface}`;
  const regions = SURFACE_REGIONS[surface];
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return { ok: false, error: `${at} must be an object` };
  }
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!LAYOUT_KEYS.includes(k)) return { ok: false, error: `${at}.${k} ${notALayoutKey(k)}` };
  }
  const skins = Object.keys(SKINS[surface]);
  if (typeof o.skin !== 'string' || (o.skin !== CUSTOM_SKIN && !skins.includes(o.skin))) {
    return {
      ok: false,
      error: `${at}.skin must be one of ${[...skins, CUSTOM_SKIN].join(', ')}`,
    };
  }
  if (o.columns !== 1 && o.columns !== 2) {
    return { ok: false, error: `${at}.columns must be 1 or 2` };
  }
  const order = o.order;
  if (
    !Array.isArray(order) ||
    order.length !== regions.length ||
    new Set(order).size !== order.length ||
    !order.every((r) => typeof r === 'string' && regions.includes(r))
  ) {
    return {
      ok: false,
      error: `${at}.order must list each of ${regions.join(', ')} once`,
    };
  }
  const wide = o.wide;
  if (
    !Array.isArray(wide) ||
    new Set(wide).size !== wide.length ||
    !wide.every((r) => typeof r === 'string' && regions.includes(r))
  ) {
    return {
      ok: false,
      error: `${at}.wide must list some of ${regions.join(', ')}, each at most once`,
    };
  }
  const value: SurfaceLayout = {
    skin: o.skin,
    columns: o.columns,
    order: [...(order as string[])],
    // Kept in the surface's own order, so two saves of the same choice match.
    wide: regions.filter((r) => (wide as string[]).includes(r)),
  };
  // A layout that names a ready-made skin is that skin exactly. Once anything
  // is moved it is "custom", so a file never claims a skin it does not match.
  if (value.skin !== CUSTOM_SKIN) {
    const named = skinLayout(surface, value.skin)!;
    if (
      named.columns !== value.columns ||
      named.order.join() !== value.order.join() ||
      named.wide.join() !== value.wide.join()
    ) {
      return {
        ok: false,
        error: `${at} differs from the ${value.skin} skin; set skin to ${CUSTOM_SKIN} to keep these changes`,
      };
    }
  }
  return { ok: true, value };
}

/** The keys a layout holds. */
export const LAYOUT_KEYS: readonly string[] = ['skin', 'columns', 'order', 'wide'];

/**
 * Why a key is not taken, in words. Shared with the ourWKRP skin editor
 * (ourWKRP#139), so both refuse the same keys the same way.
 */
export function notALayoutKey(key: string): string {
  if (/colou?r|theme|font|size|hex|background/i.test(key)) {
    return 'is not taken: colors, fonts and sizes come from the design system, which keeps contrast readable';
  }
  if (/count|votes?|floor|total|number/i.test(key)) {
    return 'is not taken: a skin carries no numbers; counts keep the count floor, whatever the look';
  }
  return 'is not part of a layout';
}

/** A stored layout, or null when it does not read cleanly (the default then holds). */
export function readLayout(surface: LayoutSurface, v: unknown): SurfaceLayout | null {
  const r = checkLayout(surface, v);
  return r.ok ? r.value : null;
}

/**
 * The one mover (browser side). `OSE_applyLayout(container, layout, regions)`
 * moves the container's direct children marked `data-region` into the
 * layout's order, marks the wide ones, and sets the column count. A child the
 * layout does not name keeps its place after the named ones; a name that is
 * not an allowed region is ignored. A missing or bad layout changes nothing.
 * It is a string so each page gets the same code (no copy in a template).
 */
export const LAYOUT_CLIENT_JS = `
window.OSE_applyLayout = function (container, layout, regions) {
  if (!container || !layout || typeof layout !== 'object') return false;
  var allowed = Array.isArray(regions) ? regions : [];
  var order = Array.isArray(layout.order) ? layout.order : [];
  var wide = Array.isArray(layout.wide) ? layout.wide : [];
  var byName = {};
  Array.prototype.forEach.call(container.children, function (el) {
    var n = el.getAttribute('data-region');
    if (n && allowed.indexOf(n) !== -1 && !byName[n]) byName[n] = el;
  });
  var rest = Array.prototype.filter.call(container.children, function (el) {
    var n = el.getAttribute('data-region');
    return n && byName[n] === el && order.indexOf(n) === -1;
  });
  order.forEach(function (n) {
    if (allowed.indexOf(n) !== -1 && byName[n]) container.appendChild(byName[n]);
  });
  rest.forEach(function (el) { container.appendChild(el); });
  Object.keys(byName).forEach(function (n) {
    if (wide.indexOf(n) !== -1) byName[n].setAttribute('data-wide', '1');
    else byName[n].removeAttribute('data-wide');
  });
  container.setAttribute('data-layout-columns', layout.columns === 2 ? '2' : '1');
  container.setAttribute('data-layout-skin', /^[a-z_]{1,32}$/.test(String(layout.skin)) ? String(layout.skin) : 'custom');
  return true;
};
`;

/**
 * The grid the mover's attributes select. Two columns only from 720px; a phone
 * always reads one stack. A child that is not a region (the report's header)
 * runs the full width. No color here: spacing and grid only.
 */
export const LAYOUT_CSS = `
[data-layout-columns="2"]{display:grid;grid-template-columns:minmax(0,1fr);gap:1rem;align-items:start}
@media (min-width:720px){
  [data-layout-columns="2"]{grid-template-columns:repeat(2,minmax(0,1fr))}
  [data-layout-columns="2"]>*:not([data-region]),[data-layout-columns="2"]>[data-wide="1"]{grid-column:1/-1}
}
`;

/** Where a static page takes the mover, its grid and its region list. */
export const LAYOUT_SKINS_MARKER = '<!-- OSE_LAYOUT_SKINS -->';

/** The head block for a page: the grid CSS, the mover and the surface's regions. */
export function layoutSkinsHead(surface: LayoutSurface): string {
  return (
    `<style>${LAYOUT_CSS}</style>\n` +
    `<script>${LAYOUT_CLIENT_JS}window.OSE_LAYOUT_REGIONS = ${JSON.stringify(SURFACE_REGIONS[surface])};</script>`
  );
}
