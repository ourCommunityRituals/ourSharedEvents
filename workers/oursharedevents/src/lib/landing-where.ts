/**
 * The landing page's one question: where are you? (owner decision 2026-10-10)
 *
 * The box takes a town or city name first and a zip second (owner 2026-11-06:
 * this is the front door, and most people think of a town, not a zip). It sends
 * `?where=`. A name that is one place lists that place's events; a name that is
 * many places ("Springfield") lists every match, labelled by town and state, for
 * the person to choose from, and meanwhile the events of all of them; a 5-digit
 * zip is that zip (lib/place-search.ts). `?zip=` is still read: the phone's
 * location answers with it.
 *
 * A phone also gets "Use my location", which the person presses (or has already
 * allowed). The phone works out a rough box itself and sends only that, in a
 * form body to POST /near; the server turns it into the nearest zip and sends
 * the browser to /?zip=NNNNN. From then on the page works from the zip area
 * alone. Nothing is stored and nothing is logged by this code. (Cloudflare's
 * request logs record page addresses, which is why the rough box travels in the
 * body and only the zip appears in the address.)
 *
 * Pure functions returning strings, like landing-area.ts.
 */
import { escapeHtml } from './html-escape.js';
import { injectMarker } from './inject-marker.js';
import { findPlaces, PLACE_QUERY_MAX, type PlaceMatch } from './place-search.js';
import {
  findZipArea,
  normalizeZip,
  roughBoxCenter,
  nearestZipArea,
  type ZipArea,
} from './zip-areas.js';

export const WHERE_MARKER = '<!--OCR_WHERE-->';
export const AREA_HEADING_MARKER = '<!--OCR_AREA_HEADING-->';

/** What the address asked for. */
export type WhereState =
  | { kind: 'none' }
  | { kind: 'zip'; area: ZipArea }
  | { kind: 'place'; place: PlaceMatch }
  | { kind: 'choose'; typed: string; matches: PlaceMatch[] }
  | { kind: 'unknown-place'; typed: string }
  | { kind: 'unknown-zip'; typed: string }
  | { kind: 'no-us-zip' };

/**
 * What the box's `?where=` means: a place name first (one place, or many to
 * choose from), then a zip. Coordinates and other text are an unknown place:
 * findPlaces never reads text with a digit, and only a 5-digit zip is a zip.
 */
function readTyped(raw: string): WhereState {
  // The whole value is looked up, so a long one never becomes a place by losing
  // its tail. Only the echo is cut to fit the box; it is escaped where shown.
  const full = raw.trim();
  const typed = full.slice(0, PLACE_QUERY_MAX);
  const matches = findPlaces(full);
  if (matches.length === 1) return { kind: 'place', place: matches[0] };
  if (matches.length > 1) return { kind: 'choose', typed, matches };
  const area = findZipArea(full);
  if (area) return { kind: 'zip', area };
  if (normalizeZip(full)) return { kind: 'unknown-zip', typed };
  return { kind: 'unknown-place', typed };
}

/** Read `?where=`, else `?zip=` (and `?nozip=1`, set by /near), from a landing URL. */
export function readWhere(url: URL | null): WhereState {
  if (!url) return { kind: 'none' };
  if (url.searchParams.get('nozip') === '1') return { kind: 'no-us-zip' };
  const where = url.searchParams.get('where');
  if (where != null && where.trim() !== '') return readTyped(where);
  const raw = url.searchParams.get('zip');
  if (raw == null || raw.trim() === '') return { kind: 'none' };
  const area = findZipArea(raw);
  if (area) return { kind: 'zip', area };
  // Echo back at most what fits a zip box; it is escaped where it is shown.
  return { kind: 'unknown-zip', typed: raw.trim().slice(0, 10) };
}

function message(state: WhereState): string {
  if (state.kind === 'unknown-place') {
    return `We couldn't find a place called ${escapeHtml(state.typed)}. Check the spelling, or type a zip code.`;
  }
  if (state.kind === 'unknown-zip') {
    return `We couldn't find zip ${escapeHtml(state.typed)}. Check it and try again.`;
  }
  if (state.kind === 'no-us-zip')
    return "We couldn't find a US zip where you are. Type your town or zip instead.";
  return '';
}

/** What the box shows after a search: the place, the zip, or what was typed. */
function boxValue(state: WhereState): string {
  switch (state.kind) {
    case 'zip':
      return state.area.zip;
    case 'place':
      return state.place.label;
    case 'choose':
    case 'unknown-place':
      return state.typed;
    case 'unknown-zip':
      return normalizeZip(state.typed) ?? '';
    default:
      return '';
  }
}

/**
 * Every place a name means, each a link that narrows the search to it. All of
 * them, in state order: the person chooses; the page never picks one. Styled
 * by /ui.css only (`source-list` wraps, `filter-chip` is a 44px target): the
 * landing carries no stylesheet of its own for this (spine design check).
 */
function renderChoices(typed: string, matches: readonly PlaceMatch[]): string {
  const items = matches
    .map(
      (m) =>
        `<a class="filter-chip" href="/?where=${escapeHtml(encodeURIComponent(m.label))}" data-testid="where-choice">${escapeHtml(m.label)}</a>`
    )
    .join('');
  return `
        <div data-testid="where-choices">
          <p id="where-choose" role="status">${matches.length} places are called ${escapeHtml(typed)}. Pick yours:</p>
          <div class="source-list" role="group" aria-labelledby="where-choose">${items}</div>
        </div>`;
}

/**
 * The box: a town or city name first, a zip second. The phone's location button
 * is in the template, hidden until its script shows it. Town names come from
 * GeoNames (CC BY 4.0), credited under the box.
 */
export function renderWhere(state: WhereState): string {
  const value = boxValue(state);
  const msg = message(state);
  const choices = state.kind === 'choose' ? renderChoices(state.typed, state.matches) : '';
  return `<form class="where-form" method="get" action="/" role="search" data-testid="where-form">
          <label for="where-input" class="where-label">Town or zip code</label>
          <div class="where-row">
            <input id="where-input" name="where" class="input" type="text"
              maxlength="${PLACE_QUERY_MAX}" autocomplete="address-level2" required
              value="${escapeHtml(value)}"${msg ? ' aria-invalid="true" aria-describedby="where-msg"' : ''}
              data-testid="where-input" />
            <button class="btn btn-primary" type="submit" data-testid="where-submit">Find events</button>
          </div>${msg ? `\n          <p class="where-msg" id="where-msg" role="alert" data-testid="where-msg">${msg}</p>` : ''}
        </form>${choices}
        <p class="list-sub" data-testid="where-credit">Town names from <a href="https://www.geonames.org/">GeoNames</a> (<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>).</p>`;
}

const CHANGE = '<a class="where-change" href="/?change=1" data-testid="where-change">Change</a>';

/** The area heading: the zip or place searched, when there is one. */
export function renderAreaHeading(state: WhereState): string {
  if (state.kind === 'zip') return `Near ${escapeHtml(state.area.zip)} ${CHANGE}`;
  if (state.kind === 'place') return `Near ${escapeHtml(state.place.label)} ${CHANGE}`;
  if (state.kind === 'choose') return `In every place called ${escapeHtml(state.typed)} ${CHANGE}`;
  return 'Coming up';
}

/** The area when nothing is near the zip. */
export function renderNearEmpty(zip: string): string {
  return `<div class="near-empty" data-testid="area-empty-near" role="status">
          <p><strong>Nothing near ${escapeHtml(zip)} yet.</strong></p>
          <p><a href="/events" data-testid="area-empty-all">See all events</a> &middot; <a href="/admin?start=event" data-testid="area-empty-create">Create one</a></p>
        </div>`;
}

/** The area when nothing is in the place (or places) searched. */
export function renderPlaceEmpty(placeWords: string): string {
  return `<div class="near-empty" data-testid="area-empty-near" role="status">
          <p><strong>Nothing in ${escapeHtml(placeWords)} yet.</strong></p>
          <p><a href="/events" data-testid="area-empty-all">See all events</a> &middot; <a href="/admin?start=event" data-testid="area-empty-create">Create one</a></p>
        </div>`;
}

export function injectWhere(html: string, state: WhereState): string {
  return injectMarker(
    injectMarker(html, WHERE_MARKER, renderWhere(state)),
    AREA_HEADING_MARKER,
    renderAreaHeading(state)
  );
}

/**
 * POST /near: a phone's rough box (a 5-character geohash, about 5 km across)
 * becomes the nearest zip. Only the zip leaves this function. The box is read
 * from a form body, never from the address, and is not stored or logged.
 */
export async function handleNear(request: Request): Promise<Response> {
  const noStore = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
  if (request.method !== 'POST') {
    return new Response(null, { status: 303, headers: { Location: '/', ...noStore } });
  }
  let g: unknown = null;
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (type === 'application/x-www-form-urlencoded') {
    try {
      g = (await request.formData()).get('g');
    } catch {
      g = null;
    }
  }
  const center = roughBoxCenter(g);
  if (!center) {
    return Response.json({ ok: false, error: 'INVALID_AREA' }, { status: 400, headers: noStore });
  }
  const area = nearestZipArea(center.lat, center.lon);
  const to = area ? `/?zip=${area.zip}` : '/?nozip=1';
  return new Response(null, { status: 303, headers: { Location: to, ...noStore } });
}
