// ─── Landing area — server-rendered, CSS-only filterable ─────────────────────────
//
// OSE-1312 slice 2.
//
// The landing page is the SUPPLY side (someone thinking about hosting or
// sponsoring). Slice 1 shipped the two doors, the never-who panel, and a plain
// pointer to `/events`. Slice 2 embeds the real thing: an area view of what is
// happening nearby that a visitor can filter across five dimensions —
//
//   1. view     list | map            (default chosen by count; see LIST_MAX)
//   2. window   LANDING_WINDOWS — the SAME `when` values + labels as the /events
//               chips (lib/event-discovery, OSE-1362), default DEFAULT_WINDOW
//   3. type     one pill per event-type present, plus "All"  (niche discovery);
//               offered only when there are two or more types to choose between
//   4. modality All | online | in-person                    ("in reality");
//               offered only when the list holds both kinds
//
// OSE-1520: the old fifth group, "Kind" (All / OSE / Hybrid), is gone. Every OSE
// event is the anonymous pole and no event carries the hybrid composition, so it
// was a control whose only possible answer was "all of them". The tags stay on
// the cards (`product-ose`) for the day an event can be hybrid; the control
// returns with that backing, not before.
//
// WHY A RENDERER, NOT A TEMPLATE EDIT (same reasoning as event-list.ts): the
// filtering is CSS-only — hidden radios + `:checked ~` sibling rules — precisely
// so the page keeps the promise it prints: NO cookies, NO analytics, NO JS that
// records the viewer. That means the *tags a card carries* are the whole
// mechanism, and they are computed here, once, on the server. This is a pure
// function returning a string; every window / type / modality / empty case is a
// synchronous call, not a browser with a settled microtask queue.
//
// The five groups compose correctly without any per-combination logic: each
// group contributes `display:none` rules for cards it excludes, so a card is
// visible iff it survives *every* active filter. `display:none` is idempotent —
// order does not matter, and "All" simply contributes no rule.
//
// DATA BACKING (audited against the events table, 2026-09-13):
//   - window   : inWhenWindow() from lib/event-discovery — one definition for
//                /events and here (event-local calendar day; live = today).
//   - type     : `template_id` (readable slugs like `bar_night`), then
//                `event_type_id`; untyped → "Other".
//   - modality : DERIVED — in-person when the event has geo (`lat`/`lon`) or a
//                `venue`/`location`, else online. There is no modality column;
//                this heuristic is the agreed slice-2 backing (OSE-1312).
//   - product  : every OSE event is the ANONYMOUS pole → `product-ose`. The
//                `product-hybrid` facet is the seam for an event that also
//                carries the OW non-anonymous / profile-template composition
//                (the hybrid composition plane, ADR-009). OSE's events table has
//                no such field today, so the hybrid pill is present-but-inert
//                until that backing exists. Deliberate: the invariant boundary
//                is anon vs non-anon, and it is drawn here.
//
// FORWARD-LOOKING: wrapped (post_event) events are excluded from the area —
// this surface answers "what's coming together near me", and recaps already
// live on `/events` and the event page. `phase` is authoritative.

import { escapeHtml } from './html-escape.js';
import { injectMarker } from './inject-marker.js';
import {
  inWhenWindow,
  discoveryChipLabel,
  discoveryEmptyCopy,
  orderUpcomingFirst,
  type WhenOption,
} from './event-discovery.js';
import { renderEventCard } from './event-list.js';
import { renderAttendeeMap } from './attendee-map.js';
import { toPublicEvent } from './public-event-projection.js';
import { msg } from './i18n/catalog.js';
import { DEFAULT_LANG, type Lang } from './i18n/languages.js';

export interface LandingAreaItem {
  id?: unknown;
  name?: unknown;
  startDateISO?: unknown;
  venue?: unknown;
  location?: unknown;
  phase?: unknown;
  timezone?: unknown;
  lat?: unknown;
  lon?: unknown;
  template_id?: unknown;
  event_type_id?: unknown;
  h3_res7?: unknown;
  endDateISO?: unknown;
}

// ── Configured defaults (named, not hardcoded at the call site) ─────────────────

/**
 * The landing's window pills (OSE-1362): a subset of the /events `when` set, so
 * "Next 7 days" here is exactly "Next 7 days" there. Widest LAST.
 */
export const LANDING_WINDOWS = [
  'weekend',
  'week',
  'month',
  'next-90',
] as const satisfies readonly WhenOption[];
export type LandingWindow = (typeof LANDING_WINDOWS)[number];

/** Default window when the page loads — the widest. */
export const DEFAULT_WINDOW: LandingWindow = 'next-90';

/**
 * The landing's one threshold (owner, 2026-10-03). Counted over the widest
 * window, on the events this page actually lists.
 *
 *   fewer than this  → the page leads with the two doors (Create an event /
 *                      Create a sponsor) and the list opens first; the map view is a note
 *                      with the real count and a labelled example drawing.
 *   this many or more → the page leads with the map, which draws every
 *                      neighbourhood that holds an event; the doors move
 *                      underneath it.
 *
 * This number belongs to this page's display and nothing else. The shared
 * readiness number (CORRIDOR_READY_MIN_EVENTS = 5) and every privacy floor are
 * separate and unchanged.
 */
export const LIST_MAX = 10;

/** Where the whole area block goes. Template opts in by carrying it. */
export const LANDING_AREA_MARKER = '<!--OCR_LANDING_AREA-->';

export interface RenderedLandingArea {
  /** Full inner markup for the area section (radios + toggles + cards). */
  html: string;
  /** Distinct event-types present, by slug. Order is stable (by label). */
  types: { slug: string; label: string }[];
  /** Cards visible at the widest window — drives the default view. */
  windowCount: number;
  /** 'list' | 'map' — the view the area opens on. */
  defaultView: 'list' | 'map';
  /** True at LIST_MAX or more: the map leads the page and the doors go under it. */
  leadsWithMap: boolean;
}

// ── small helpers ────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function isFiniteNum(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v);
}

/** CSS-ident-safe slug: lowercase, non-[a-z0-9] → '-', collapsed, trimmed. */
function slugify(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'other';
}

/** Human label from a raw type id: `bar_night` → `Bar Night`. */
function titleCase(raw: string): string {
  return raw
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

// The label of a named type is the type id made readable (`bar_night` is "Bar
// Night"), as typed; type names per language are OSE-1764. "Other" is ours.
function typeOf(item: LandingAreaItem, lang: Lang): { slug: string; label: string } {
  const raw = str(item.template_id) || str(item.event_type_id);
  if (!raw) return { slug: 'type-other', label: msg(lang, 'area.otherType') };
  return { slug: `type-${slugify(raw)}`, label: titleCase(raw) };
}

function modalityOf(item: LandingAreaItem): 'online' | 'inperson' {
  const hasGeo = isFiniteNum(item.lat) && isFiniteNum(item.lon);
  const hasPlace = str(item.venue).trim() !== '' || str(item.location).trim() !== '';
  return hasGeo || hasPlace ? 'inperson' : 'online';
}

/**
 * Window classes (`when-<value>`), one per LANDING_WINDOWS value the event falls
 * in — decided by the shared inWhenWindow, never by a landing-local rule. An
 * event outside every window carries none and is hidden until it comes into range.
 */
function windowClasses(e: LandingAreaItem, now: Date): string[] {
  return LANDING_WINDOWS.filter((w) => inWhenWindow(e, w, now)).map((w) => `when-${w}`);
}

// ── empty state ────────────────────────────────────────────────────────────────

function emptyHtml(lang: Lang): string {
  return `<div class="empty-state" data-testid="area-empty" role="status">
          <p><strong>${msg(lang, 'area.emptyHeading')}</strong></p>
          <p>${msg(lang, 'area.emptyNote')}</p>
          <p><a class="door" href="/admin" data-testid="area-empty-create">${msg(lang, 'area.create')}</a></p>
        </div>`;
}

/** The empty area, for callers that have no events (or a read error). */
export function renderEmptyLandingArea(lang: Lang = DEFAULT_LANG): RenderedLandingArea {
  return {
    html: emptyHtml(lang),
    types: [],
    windowCount: 0,
    defaultView: 'list',
    leadsWithMap: false,
  };
}

// ── main ─────────────────────────────────────────────────────────────────────

/**
 * Render the landing area.
 *
 * Accepts the same shape the DataProvider list emits post-`enrichWithPhase`
 * (so the landing area and `GET /api/v2/events` describe the same events), plus
 * `template_id` / `event_type_id` / `lat` / `lon` / `location` for tagging.
 *
 * @param opts.now  injectable clock for deterministic window tests.
 */
export function renderLandingArea(
  items: readonly LandingAreaItem[] | null | undefined,
  opts?: {
    now?: number;
    latched?: ReadonlySet<string>;
    areaLatched?: boolean;
    /** OSE-1522: event id → the consented sponsor's title, shown by the event title. */
    sponsorTitles?: ReadonlyMap<string, string>;
    /** The page's language (OSE-1762). */
    lang?: Lang;
  }
): RenderedLandingArea {
  const lang = opts?.lang ?? DEFAULT_LANG;
  if (!Array.isArray(items) || items.length === 0) return renderEmptyLandingArea(lang);

  const now = new Date(opts?.now ?? Date.now());

  // Forward-looking: wrapped events belong on /events + the event page, not on
  // the "what's coming together" surface. phase is authoritative.
  // Upcoming first, soonest first, undated last (OSE-1520), as on /events.
  const live = orderUpcomingFirst(items.filter((e) => str(e.phase) !== 'post_event')).upcoming;
  if (live.length === 0) return renderEmptyLandingArea(lang);

  const typeMap = new Map<string, string>(); // slug → label
  const modalities = new Set<string>();
  let windowCount = 0;
  // Windows that hold at least one listed event. The rest get a message.
  const filledWindows = new Set<string>();

  // The same card /events renders (OSE-1520): date, venue, state-aware button,
  // and the consented sponsor by the title (OSE-1522). The tags the CSS-only
  // filters hang on ride along as extra classes.
  const cards = live
    .map((e) => {
      const windows = windowClasses(e, now);
      if (windows.includes(`when-${DEFAULT_WINDOW}`)) windowCount += 1;
      for (const w of windows) filledWindows.add(w);

      const { slug: typeSlug, label: typeLabel } = typeOf(e, lang);
      typeMap.set(typeSlug, typeLabel);
      const modality = modalityOf(e);
      modalities.add(modality);

      return renderEventCard(
        { ...e, venue: str(e.venue) || str(e.location) },
        {
          variant: 'landing',
          extraClasses: [...windows, typeSlug, 'product-ose', `modality-${modality}`],
          sponsorTitle: opts?.sponsorTitles?.get(str(e.id)),
          venueFallback: modality === 'online' ? msg(lang, 'area.online') : '',
          lang,
        }
      );
    })
    .join('');

  const types = [...typeMap.entries()]
    .map(([slug, label]) => ({ slug, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Once the area has been recorded at LIST_MAX (nightly, lib/corridor-latch) it
  // keeps leading with the map while it has anything to show.
  const areaLatched = opts?.areaLatched === true && windowCount > 0;
  const leadsWithMap = windowCount >= LIST_MAX || areaLatched;
  const defaultView: 'list' | 'map' = leadsWithMap ? 'map' : 'list';

  // The map is drawn from the same `live` set as the cards, at corridor (res-7)
  // precision only, and gated on how many events it would actually show.
  // Fed through the public event projection (the allowlist behind
  // GET /api/v2/events), so a location-precision policy (OSE-1245) that narrows
  // what the public sees narrows the map with it.
  const mapHtml = renderAttendeeMap(
    live.map((e) => toPublicEvent(e as Record<string, unknown>)),
    {
      now: now.getTime(),
      latched: opts?.latched,
      area: { count: windowCount, min: LIST_MAX, latched: areaLatched },
      sponsorTitles: opts?.sponsorTitles,
      lang,
    }
  ).html;

  const html = buildAreaMarkup({
    cards,
    types,
    defaultView,
    mapHtml,
    mixedModality: modalities.size > 1,
    emptyWindows: LANDING_WINDOWS.filter((w) => !filledWindows.has(`when-${w}`)),
    lang,
  });
  return { html, types, windowCount, defaultView, leadsWithMap };
}

// ── markup assembly ──────────────────────────────────────────────────────────
//
// All radios are emitted as siblings that PRECEDE `.toggles` and `.area`, so the
// `#id:checked ~ .toggles label` / `~ .area .event-card` rules resolve. The
// rules are emitted here, from the same lists that emit the radios (inline style
// elements; CSP allows style-src 'unsafe-inline'), so a pill can never exist
// without its selected look, its focus ring and its hide rule.
//
// The pills are the shared filter chips (`.disc-chip`, lib/event-list's
// stylesheet), the same control /events renders as links.

function radio(id: string, group: string, checked: boolean): string {
  return `<input type="radio" name="${group}" id="${id}" class="toggle-radio"${checked ? ' checked' : ''} />`;
}

function pill(id: string, text: string): string {
  return `<label class="disc-chip" for="${id}">${text}</label>`;
}

/**
 * The selected chip look, plus a keyboard focus ring. The radios sit before
 * `.toggles`, not next to their labels, so `:focus-visible + label` can never
 * match; the ring is a general-sibling rule per radio id instead.
 */
function chipRules(id: string): string {
  const label = `.toggles label[for='${id}']`;
  return (
    `#${id}:checked ~ ${label}{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}` +
    `#${id}:checked ~ ${label}::before{content:'\\2713';margin-right:.35rem}` +
    `#${id}:focus-visible ~ ${label}{outline:3px solid var(--accent);outline-offset:2px}`
  );
}

function buildAreaMarkup(args: {
  cards: string;
  types: { slug: string; label: string }[];
  defaultView: 'list' | 'map';
  mapHtml: string;
  /** Both online and in-person events are listed, so the Where choice can differ. */
  mixedModality: boolean;
  /** Windows with no listed event: each gets a message instead of a blank list. */
  emptyWindows: readonly LandingWindow[];
  lang: Lang;
}): string {
  const { cards, types, defaultView, mapHtml, mixedModality, emptyWindows, lang } = args;
  const listChecked = defaultView === 'list';
  // A refinement is offered only when it can change what is shown.
  const showTypes = types.length > 1;

  // ── radios (all groups, before .toggles / .area) ──
  const viewRadios =
    radio('view-list', 'view', listChecked) + radio('view-map', 'view', !listChecked);
  const winRadios = LANDING_WINDOWS.map((w) => radio(`win-${w}`, 'win', w === DEFAULT_WINDOW)).join(
    ''
  );
  const typeRadios = showTypes
    ? radio('type-all', 'type', true) + types.map((t) => radio(t.slug, 'type', false)).join('')
    : '';
  const modRadios = mixedModality
    ? radio('mod-all', 'mod', true) +
      radio('mod-online', 'mod', false) +
      radio('mod-inperson', 'mod', false)
    : '';

  // ── generated rules: selected look + focus ring + (for filters) the hide rule ──
  const rules: string[] = [];
  for (const id of ['view-list', 'view-map']) rules.push(chipRules(id));
  for (const w of LANDING_WINDOWS) {
    rules.push(
      chipRules(`win-${w}`) + `#win-${w}:checked ~ .area .event-card:not(.when-${w}){display:none}`
    );
  }
  // An empty window's message is written by the server and shown by the same
  // radio that hides the cards, so the choice still never leaves the device.
  if (emptyWindows.length) rules.push('.area-window-empty{display:none}');
  for (const w of emptyWindows) {
    rules.push(`#win-${w}:checked ~ .area .win-empty-${w}{display:block}`);
  }
  if (mixedModality) {
    rules.push(chipRules('mod-all'));
    rules.push(
      chipRules('mod-online') +
        '#mod-online:checked ~ .area .event-card:not(.modality-online){display:none}'
    );
    rules.push(
      chipRules('mod-inperson') +
        '#mod-inperson:checked ~ .area .event-card:not(.modality-inperson){display:none}'
    );
  }
  const winStyle = `<style data-testid="area-window-css">\n${rules.join('\n')}\n</style>`;
  // Type pills are dynamic, so their rules are too.
  const typeCss = showTypes
    ? [
        chipRules('type-all'),
        ...types.map(
          (t) =>
            chipRules(t.slug) +
            `#${t.slug}:checked ~ .area .event-card:not(.${t.slug}){display:none}`
        ),
      ].join('\n')
    : '';
  const typeStyle = showTypes ? `<style data-testid="area-type-css">\n${typeCss}\n</style>` : '';

  // ── toggle bar (labels) ──
  // View and When say what they are to assistive tech; Type and Where are the
  // refinements, so they carry a visible label (the old bar had four groups,
  // two of them unlabelled, such as "All / OSE / Hybrid").
  const typePills = showTypes
    ? `<fieldset class="disc-chips" data-testid="toggle-type"><legend class="disc-label">${msg(lang, 'area.type')}</legend>${pill('type-all', msg(lang, 'area.allTypes'))}${types
        .map((t) => pill(t.slug, escapeHtml(t.label)))
        .join('')}</fieldset>`
    : '';
  const modPills = mixedModality
    ? `<fieldset class="disc-chips" data-testid="toggle-modality"><legend class="disc-label">${msg(lang, 'area.where')}</legend>${pill('mod-all', msg(lang, 'area.all'))}${pill('mod-online', msg(lang, 'area.online'))}${pill('mod-inperson', msg(lang, 'area.inPerson'))}</fieldset>`
    : '';

  const toggles = `<div class="toggles" data-testid="area-toggles">
          <fieldset class="disc-chips" data-testid="toggle-view"><legend class="sr-only">${msg(lang, 'area.view')}</legend>${pill('view-list', msg(lang, 'area.list'))}${pill('view-map', msg(lang, 'area.map'))}</fieldset>
          <fieldset class="disc-chips" data-testid="toggle-window"><legend class="sr-only">${msg(lang, 'disc.when')}</legend>${LANDING_WINDOWS.map((w) => pill(`win-${w}`, discoveryChipLabel(w, lang))).join('')}</fieldset>
          ${typePills}
          ${modPills}
        </div>`;

  // OSE-1354: the map view never hides the cards. The map (lib/attendee-map) sits
  // ABOVE the same list, so every listed event stays one tap from its page.
  // The /events sentence and its link to a wider range (lib/event-discovery), one
  // per empty window, so the two pages cannot word the same dead end differently.
  const emptyMessages = emptyWindows
    .map(
      (w) =>
        `<p class="empty-state area-window-empty win-empty-${w}" data-testid="area-window-empty-${w}" role="status">${discoveryEmptyCopy({ when: w, q: '' }, lang)}</p>`
    )
    .join('');

  const area = `<div class="area" data-testid="area">
          <div class="view-map" data-testid="area-map">
            ${mapHtml}
          </div>
          <div class="view-list" data-testid="area-list">${emptyMessages}${cards}
          </div>
        </div>`;

  return `${viewRadios}${winRadios}${typeRadios}${modRadios}
        ${winStyle}${typeStyle}
        ${toggles}
        ${area}`;
}

// ── injection ────────────────────────────────────────────────────────────────

/**
 * Place a rendered area into the landing shell. Marker-based and opt-in, like
 * injectEventList / injectLegalFooter: a template without the marker comes back
 * byte-identical.
 */
export function injectLandingArea(
  html: string,
  area: RenderedLandingArea,
  opts?: { areaFirst?: boolean }
): string {
  if (!html.includes(LANDING_AREA_MARKER)) return html;
  // A zip search answers with its results first (owner 2026-10-10).
  const view = opts?.areaFirst ? 'map' : area.defaultView;
  return injectMarker(orderLandingSections(html, view), LANDING_AREA_MARKER, area.html);
}

const DOORS_START = '<!--OCR_DOORS_START-->';
const DOORS_END = '<!--OCR_DOORS_END-->';
const AFTER_AREA = '<!--OCR_AFTER_AREA-->';

/**
 * Which leads the landing page (PO, 2026-10-03). Fewer than LIST_MAX events:
 * the two create doors lead and the area follows, because the page's job is to
 * get the first gatherings made. At LIST_MAX or more the area's default view is
 * the map, and the map leads; the doors move directly beneath it. One rule, one
 * threshold: this reads the same `defaultView` the list/map toggle uses.
 * Markers are always removed; a template without them is returned unchanged.
 */
export function orderLandingSections(html: string, defaultView: 'list' | 'map'): string {
  const a = html.indexOf(DOORS_START);
  const b = html.indexOf(DOORS_END);
  const c = html.indexOf(AFTER_AREA);
  if (a < 0 || b < a || c < b) return html;
  const doors = html.slice(a + DOORS_START.length, b);
  const before = html.slice(0, a);
  const middle = html.slice(b + DOORS_END.length, c);
  const after = html.slice(c + AFTER_AREA.length);
  return defaultView === 'map' ? before + middle + doors + after : before + doors + middle + after;
}
