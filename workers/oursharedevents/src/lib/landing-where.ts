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
import { fmt, msg } from './i18n/catalog.js';
import { DEFAULT_LANG, isLang, type Lang } from './i18n/languages.js';
import { withLangPrefix } from './i18n/path-prefix.js';

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

function message(state: WhereState, lang: Lang): string {
  if (state.kind === 'unknown-place') {
    return fmt(lang, 'where.unknownPlace', { place: escapeHtml(state.typed) });
  }
  if (state.kind === 'unknown-zip') {
    return fmt(lang, 'where.unknownZip', { zip: escapeHtml(state.typed) });
  }
  if (state.kind === 'no-us-zip') return msg(lang, 'where.noUsZip');
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
 * Each link stays in the page's language (OSE-1762).
 */
function renderChoices(typed: string, matches: readonly PlaceMatch[], lang: Lang): string {
  const home = withLangPrefix(lang, '/');
  const items = matches
    .map(
      (m) =>
        `<a class="filter-chip" href="${home}?where=${escapeHtml(encodeURIComponent(m.label))}" data-testid="where-choice">${escapeHtml(m.label)}</a>`
    )
    .join('');
  const line = fmt(lang, 'where.choose', { count: matches.length, place: escapeHtml(typed) });
  return `
        <div data-testid="where-choices">
          <p id="where-choose" role="status">${line}</p>
          <div class="source-list" role="group" aria-labelledby="where-choose">${items}</div>
        </div>`;
}

/** GeoNames and its licence are names, the same in every language. */
const GEONAMES_LINK = '<a href="https://www.geonames.org/">GeoNames</a>';
const LICENSE_LINK = '<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>';

/**
 * The box: a town or city name first, a zip second. The phone's location button
 * is in the template, hidden until its script shows it. Town names come from
 * GeoNames (CC BY 4.0), credited under the box.
 */
export function renderWhere(state: WhereState, lang: Lang = DEFAULT_LANG): string {
  const value = boxValue(state);
  const note = message(state, lang);
  const choices = state.kind === 'choose' ? renderChoices(state.typed, state.matches, lang) : '';
  const credit = fmt(lang, 'where.credit', { geonames: GEONAMES_LINK, license: LICENSE_LINK });
  return `<form class="where-form" method="get" action="${withLangPrefix(lang, '/')}" role="search" data-testid="where-form">
          <label for="where-input" class="where-label">${msg(lang, 'where.label')}</label>
          <div class="where-row">
            <input id="where-input" name="where" class="input" type="text"
              maxlength="${PLACE_QUERY_MAX}" autocomplete="address-level2" required
              value="${escapeHtml(value)}"${note ? ' aria-invalid="true" aria-describedby="where-msg"' : ''}
              data-testid="where-input" />
            <button class="btn btn-primary" type="submit" data-testid="where-submit">${msg(lang, 'where.submit')}</button>
          </div>${note ? `\n          <p class="where-msg" id="where-msg" role="alert" data-testid="where-msg">${note}</p>` : ''}
        </form>${choices}
        <p class="list-sub" data-testid="where-credit">${credit}</p>`;
}

/** The area heading: the zip or place searched, when there is one. */
export function renderAreaHeading(state: WhereState, lang: Lang = DEFAULT_LANG): string {
  const change = `<a class="where-change" href="${withLangPrefix(lang, '/')}?change=1" data-testid="where-change">${msg(lang, 'where.change')}</a>`;
  if (state.kind === 'zip') {
    return `${fmt(lang, 'where.near', { where: escapeHtml(state.area.zip) })} ${change}`;
  }
  if (state.kind === 'place') {
    return `${fmt(lang, 'where.near', { where: escapeHtml(state.place.label) })} ${change}`;
  }
  if (state.kind === 'choose') {
    return `${fmt(lang, 'where.everyPlace', { place: escapeHtml(state.typed) })} ${change}`;
  }
  return msg(lang, 'where.comingUp');
}

/** The area when nothing is near the zip. */
export function renderNearEmpty(zip: string, lang: Lang = DEFAULT_LANG): string {
  return emptyArea(fmt(lang, 'where.nothingNear', { zip: escapeHtml(zip) }), lang);
}

/** The area when nothing is in the place searched. */
export function renderPlaceEmpty(label: string, lang: Lang = DEFAULT_LANG): string {
  return emptyArea(fmt(lang, 'where.nothingIn', { place: escapeHtml(label) }), lang);
}

/** The area when nothing is in any of the places a name means. */
export function renderAnyPlaceEmpty(typed: string, lang: Lang = DEFAULT_LANG): string {
  return emptyArea(fmt(lang, 'where.nothingInAny', { place: escapeHtml(typed) }), lang);
}

function emptyArea(line: string, lang: Lang): string {
  return `<div class="near-empty" data-testid="area-empty-near" role="status">
          <p><strong>${line}</strong></p>
          <p><a href="${withLangPrefix(lang, '/events')}" data-testid="area-empty-all">${msg(lang, 'disc.seeAll')}</a> &middot; <a href="/admin?start=event" data-testid="area-empty-create">${msg(lang, 'where.createOne')}</a></p>
        </div>`;
}

export function injectWhere(html: string, state: WhereState, lang: Lang = DEFAULT_LANG): string {
  return injectMarker(
    injectMarker(html, WHERE_MARKER, renderWhere(state, lang)),
    AREA_HEADING_MARKER,
    renderAreaHeading(state, lang)
  );
}

/**
 * The phone's location form posts to /near, which answers with the landing for
 * the zip. On a page in another language the form says which, so the answer is
 * in it too (OSE-1762). The English form is as it was: no field, the English
 * landing. Sent in the form body with the box, used for the redirect, kept nowhere.
 */
const NEAR_FORM_FIELD = '<input type="hidden" name="g" />';

export function injectNearLang(html: string, lang: Lang): string {
  if (lang === DEFAULT_LANG || !html.includes(NEAR_FORM_FIELD)) return html;
  return html.replace(
    NEAR_FORM_FIELD,
    `${NEAR_FORM_FIELD}\n          <input type="hidden" name="lang" value="${lang}" />`
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
  // The page's language, when the form came from a page in another one. Only a
  // listed language is taken; anything else is the default.
  let lang: Lang = DEFAULT_LANG;
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (type === 'application/x-www-form-urlencoded') {
    try {
      const form = await request.formData();
      g = form.get('g');
      const asked = form.get('lang');
      if (isLang(asked)) lang = asked;
    } catch {
      g = null;
    }
  }
  const center = roughBoxCenter(g);
  if (!center) {
    return Response.json({ ok: false, error: 'INVALID_AREA' }, { status: 400, headers: noStore });
  }
  const area = nearestZipArea(center.lat, center.lon);
  const home = withLangPrefix(lang, '/');
  const to = area ? `${home}?zip=${area.zip}` : `${home}?nozip=1`;
  return new Response(null, { status: 303, headers: { Location: to, ...noStore } });
}
