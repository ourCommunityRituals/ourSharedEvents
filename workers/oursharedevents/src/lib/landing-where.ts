/**
 * The landing page's one question: where are you? (owner decision 2026-10-10)
 *
 * A computer gets a zip box. A phone also gets "Use my location", which the
 * person presses (or has already allowed). The phone works out a rough box
 * itself and sends only that, in a form body to POST /near; the server turns it
 * into the nearest zip and sends the browser to /?zip=NNNNN. From then on the
 * page works from the zip area alone. Nothing is stored and nothing is logged
 * by this code. (Cloudflare's request logs record page addresses, which is why
 * the rough box travels in the body and only the zip appears in the address.)
 *
 * Pure functions returning strings, like landing-area.ts.
 */
import { escapeHtml } from './html-escape.js';
import { injectMarker } from './inject-marker.js';
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
  | { kind: 'unknown-zip'; typed: string }
  | { kind: 'no-us-zip' };

/** Read `?zip=` (and `?nozip=1`, set by /near) from a landing URL. */
export function readWhere(url: URL | null): WhereState {
  if (!url) return { kind: 'none' };
  if (url.searchParams.get('nozip') === '1') return { kind: 'no-us-zip' };
  const raw = url.searchParams.get('zip');
  if (raw == null || raw.trim() === '') return { kind: 'none' };
  const area = findZipArea(raw);
  if (area) return { kind: 'zip', area };
  // Echo back at most what fits a zip box; it is escaped where it is shown.
  return { kind: 'unknown-zip', typed: raw.trim().slice(0, 10) };
}

function message(state: WhereState, lang: Lang): string {
  if (state.kind === 'unknown-zip') {
    return fmt(lang, 'where.unknownZip', { zip: escapeHtml(state.typed) });
  }
  if (state.kind === 'no-us-zip') return msg(lang, 'where.noUsZip');
  return '';
}

/** The zip form. The phone's location button is in the template, hidden until its script shows it. */
export function renderWhere(state: WhereState, lang: Lang = DEFAULT_LANG): string {
  const value =
    state.kind === 'zip'
      ? state.area.zip
      : state.kind === 'unknown-zip'
        ? (normalizeZip(state.typed) ?? '')
        : '';
  const note = message(state, lang);
  return `<form class="where-form" method="get" action="${withLangPrefix(lang, '/')}" role="search" data-testid="where-form">
          <label for="where-zip" class="where-label">${msg(lang, 'where.label')}</label>
          <div class="where-row">
            <input id="where-zip" name="zip" class="input" type="text" inputmode="numeric"
              pattern="[0-9]{5}(-[0-9]{4})?" maxlength="10" autocomplete="postal-code" required
              value="${escapeHtml(value)}"${note ? ' aria-invalid="true" aria-describedby="where-msg"' : ''}
              data-testid="where-zip" />
            <button class="btn btn-primary" type="submit" data-testid="where-submit">${msg(lang, 'where.submit')}</button>
          </div>${note ? `\n          <p class="where-msg" id="where-msg" role="alert" data-testid="where-msg">${note}</p>` : ''}
        </form>`;
}

/** The area heading: the zip when there is one. */
export function renderAreaHeading(state: WhereState, lang: Lang = DEFAULT_LANG): string {
  if (state.kind !== 'zip') return msg(lang, 'where.comingUp');
  const near = fmt(lang, 'where.near', { zip: escapeHtml(state.area.zip) });
  return `${near} <a class="where-change" href="${withLangPrefix(lang, '/')}?change=1" data-testid="where-change">${msg(lang, 'where.change')}</a>`;
}

/** The area when nothing is near the zip. */
export function renderNearEmpty(zip: string, lang: Lang = DEFAULT_LANG): string {
  return `<div class="near-empty" data-testid="area-empty-near" role="status">
          <p><strong>${fmt(lang, 'where.nothingNear', { zip: escapeHtml(zip) })}</strong></p>
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
