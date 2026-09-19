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
//   2. window   7 | 30 | 90 days      (default DEFAULT_WINDOW, configured)
//   3. type     one pill per event-type present, plus "All"  (niche discovery)
//   4. product  All | OSE | OSE+OW hybrid                    (anon / non-anon pole)
//   5. modality All | online | in-person                    ("in reality")
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
//   - window   : derived from `startDateISO` (+ phase for live events).
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
}

// ── Configured defaults (named, not hardcoded at the call site) ─────────────────

/** Default time window when the page loads. One of 7 | 30 | 90. */
export const DEFAULT_WINDOW: 7 | 30 | 90 = 90;

/**
 * The list/map crossover. Fewer than this many events (at the widest window) →
 * the list is the friendlier default; at or above it, the map is. Evaluated once
 * over the widest window, exactly as the spec requires.
 */
export const LIST_MAX = 10;

/** Where the whole area block goes. Template opts in by carrying it. */
export const LANDING_AREA_MARKER = '<!--OCR_LANDING_AREA-->';

const DAY_MS = 86_400_000;

export interface RenderedLandingArea {
  /** Full inner markup for the area section (radios + toggles + cards). */
  html: string;
  /** Distinct event-types present, by slug. Order is stable (by label). */
  types: { slug: string; label: string }[];
  /** Cards visible at the widest window — drives the default view. */
  windowCount: number;
  /** 'list' | 'map' — the default view for this count. */
  defaultView: 'list' | 'map';
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

function typeOf(item: LandingAreaItem): { slug: string; label: string } {
  const raw = str(item.template_id) || str(item.event_type_id);
  if (!raw) return { slug: 'type-other', label: 'Other' };
  return { slug: `type-${slugify(raw)}`, label: titleCase(raw) };
}

function modalityOf(item: LandingAreaItem): 'online' | 'inperson' {
  const hasGeo = isFiniteNum(item.lat) && isFiniteNum(item.lon);
  const hasPlace = str(item.venue).trim() !== '' || str(item.location).trim() !== '';
  return hasGeo || hasPlace ? 'inperson' : 'online';
}

/**
 * Nested window classes. A live event (phase 'event') is happening now, so it
 * sits in every window. A pre-event is placed by days-until-start; anything more
 * than 90 days out — or already past without being wrapped — carries no window
 * class and is hidden until the window it belongs to comes into range.
 */
function windowClasses(phase: string, startISO: string, now: number): string[] {
  if (phase === 'event') return ['within-7', 'within-30', 'within-90'];
  const t = Date.parse(startISO);
  if (Number.isNaN(t)) return [];
  const days = (t - now) / DAY_MS;
  if (days < 0) return [];
  const cls: string[] = [];
  if (days <= 7) cls.push('within-7');
  if (days <= 30) cls.push('within-30');
  if (days <= 90) cls.push('within-90');
  return cls;
}

// ── empty state ────────────────────────────────────────────────────────────────

const EMPTY_HTML = `<div class="empty-state" data-testid="area-empty" role="status">
          <p><strong>Nothing on the map yet.</strong></p>
          <p>Be the first &mdash; start a gathering and it shows up here.</p>
          <p><a class="door" href="/admin" data-testid="area-empty-create">Create an event &rarr;</a></p>
        </div>`;

/** The empty area, for callers that have no events (or a read error). */
export function renderEmptyLandingArea(): RenderedLandingArea {
  return { html: EMPTY_HTML, types: [], windowCount: 0, defaultView: 'list' };
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
  opts?: { now?: number }
): RenderedLandingArea {
  if (!Array.isArray(items) || items.length === 0) return renderEmptyLandingArea();

  const now = opts?.now ?? Date.now();

  // Forward-looking: wrapped events belong on /events + the event page, not on
  // the "what's coming together" surface. phase is authoritative.
  const live = items.filter((e) => str(e.phase) !== 'post_event');
  if (live.length === 0) return renderEmptyLandingArea();

  const typeMap = new Map<string, string>(); // slug → label
  let windowCount = 0;

  const cards = live
    .map((e) => {
      const phase = str(e.phase);
      const windows = windowClasses(phase, str(e.startDateISO), now);
      if (windows.includes('within-90')) windowCount += 1;

      const { slug: typeSlug, label: typeLabel } = typeOf(e);
      typeMap.set(typeSlug, typeLabel);
      const modality = modalityOf(e);

      const classes = [
        'event-card',
        ...windows,
        typeSlug,
        'product-ose',
        `modality-${modality}`,
      ].join(' ');

      const safeId = escapeHtml(str(e.id));
      const safeName = escapeHtml(str(e.name)) || 'Untitled event';
      const venue = str(e.venue) || str(e.location);
      const meta = venue ? escapeHtml(venue) : modality === 'online' ? 'Online' : '';
      const metaPart = meta ? `<p class="event-meta" data-testid="area-card-meta">${meta}</p>` : '';

      return `
          <a class="${classes}" href="/events/${safeId}" data-testid="area-card" data-event-id="${safeId}" data-phase="${escapeHtml(phase)}">
            <p class="event-name" data-testid="area-card-name">${safeName}</p>
            ${metaPart}
          </a>`;
    })
    .join('');

  const types = [...typeMap.entries()]
    .map(([slug, label]) => ({ slug, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const defaultView: 'list' | 'map' = windowCount >= LIST_MAX ? 'map' : 'list';

  const html = buildAreaMarkup({ cards, types, defaultView });
  return { html, types, windowCount, defaultView };
}

// ── markup assembly ──────────────────────────────────────────────────────────
//
// All radios are emitted as siblings that PRECEDE `.toggles` and `.area`, so the
// head stylesheet's `#id:checked ~ .toggles label` / `~ .area .event-card` rules
// resolve. Type radios are dynamic, so their selected-pill + hide rules are
// emitted here as an inline <style> (CSP allows style-src 'unsafe-inline').

function radio(id: string, group: string, checked: boolean): string {
  return `<input type="radio" name="${group}" id="${id}" class="toggle-radio"${checked ? ' checked' : ''} />`;
}

function pill(id: string, text: string): string {
  return `<label for="${id}">${text}</label>`;
}

function buildAreaMarkup(args: {
  cards: string;
  types: { slug: string; label: string }[];
  defaultView: 'list' | 'map';
}): string {
  const { cards, types, defaultView } = args;
  const listChecked = defaultView === 'list';

  // ── radios (all groups, before .toggles / .area) ──
  const viewRadios =
    radio('view-list', 'view', listChecked) + radio('view-map', 'view', !listChecked);
  const winRadios =
    radio('win-7', 'win', DEFAULT_WINDOW === 7) +
    radio('win-30', 'win', DEFAULT_WINDOW === 30) +
    radio('win-90', 'win', DEFAULT_WINDOW === 90);
  const typeRadios =
    radio('type-all', 'type', true) + types.map((t) => radio(t.slug, 'type', false)).join('');
  const modRadios =
    radio('mod-all', 'mod', true) +
    radio('mod-online', 'mod', false) +
    radio('mod-inperson', 'mod', false);
  const prodRadios =
    radio('prod-all', 'prod', true) +
    radio('prod-ose', 'prod', false) +
    radio('prod-hybrid', 'prod', false);

  // ── dynamic type CSS (selected pill + hide non-matching) ──
  const typeCss = types
    .map(
      (t) =>
        `#${t.slug}:checked ~ .toggles label[for='${t.slug}']{background:var(--accent);color:var(--on-accent);font-weight:600}` +
        `#${t.slug}:checked ~ .area .event-card:not(.${t.slug}){display:none}`
    )
    .join('\n');
  const typeStyle = types.length ? `<style data-testid="area-type-css">\n${typeCss}\n</style>` : '';

  // ── toggle bar (labels) ──
  const typePills = types.length
    ? `<fieldset class="toggle-group" data-testid="toggle-type"><legend>Event type</legend>${pill('type-all', 'All types')}${types
        .map((t) => pill(t.slug, escapeHtml(t.label)))
        .join('')}</fieldset>`
    : '';

  const toggles = `<div class="toggles" data-testid="area-toggles">
          <fieldset class="toggle-group" data-testid="toggle-view"><legend>View</legend>${pill('view-list', 'List')}${pill('view-map', 'Map')}</fieldset>
          <fieldset class="toggle-group" data-testid="toggle-window"><legend>When</legend>${pill('win-7', '7 days')}${pill('win-30', '30 days')}${pill('win-90', '90 days')}</fieldset>
          ${typePills}
          <fieldset class="toggle-group" data-testid="toggle-modality"><legend>Where</legend>${pill('mod-all', 'All')}${pill('mod-online', 'Online')}${pill('mod-inperson', 'In person')}</fieldset>
          <fieldset class="toggle-group" data-testid="toggle-product"><legend>Kind</legend>${pill('prod-all', 'All')}${pill('prod-ose', 'OSE')}${pill('prod-hybrid', 'Hybrid')}</fieldset>
        </div>`;

  const area = `<div class="area" data-testid="area">
          <div class="view-list" data-testid="area-list">${cards}
          </div>
          <div class="view-map" data-testid="area-map">
            <div class="map-placeholder">A neighborhood map lands here &mdash; for now, browse the list.</div>
          </div>
        </div>`;

  return `${viewRadios}${winRadios}${typeRadios}${modRadios}${prodRadios}
        ${typeStyle}
        ${toggles}
        ${area}`;
}

// ── injection ────────────────────────────────────────────────────────────────

/**
 * Place a rendered area into the landing shell. Marker-based and opt-in, like
 * injectEventList / injectLegalFooter: a template without the marker comes back
 * byte-identical.
 */
export function injectLandingArea(html: string, area: RenderedLandingArea): string {
  if (!html.includes(LANDING_AREA_MARKER)) return html;
  return injectMarker(html, LANDING_AREA_MARKER, area.html);
}
