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

function message(state: WhereState): string {
  if (state.kind === 'unknown-zip') {
    return `We couldn't find zip ${escapeHtml(state.typed)}. Check it and try again.`;
  }
  if (state.kind === 'no-us-zip')
    return "We couldn't find a US zip where you are. Type one instead.";
  return '';
}

/** The zip form. The phone's location button is in the template, hidden until its script shows it. */
export function renderWhere(state: WhereState): string {
  const value =
    state.kind === 'zip'
      ? state.area.zip
      : state.kind === 'unknown-zip'
        ? (normalizeZip(state.typed) ?? '')
        : '';
  const msg = message(state);
  return `<form class="where-form" method="get" action="/" role="search" data-testid="where-form">
          <label for="where-zip" class="where-label">Your zip code</label>
          <div class="where-row">
            <input id="where-zip" name="zip" class="input" type="text" inputmode="numeric"
              pattern="[0-9]{5}(-[0-9]{4})?" maxlength="10" autocomplete="postal-code" required
              value="${escapeHtml(value)}"${msg ? ' aria-invalid="true" aria-describedby="where-msg"' : ''}
              data-testid="where-zip" />
            <button class="btn btn-primary" type="submit" data-testid="where-submit">Find events</button>
          </div>${msg ? `\n          <p class="where-msg" id="where-msg" role="alert" data-testid="where-msg">${msg}</p>` : ''}
        </form>`;
}

/** The area heading: the zip when there is one. */
export function renderAreaHeading(state: WhereState): string {
  if (state.kind !== 'zip') return 'Coming up';
  return `Near ${escapeHtml(state.area.zip)} <a class="where-change" href="/?change=1" data-testid="where-change">Change</a>`;
}

/** The area when nothing is near the zip. */
export function renderNearEmpty(zip: string): string {
  return `<div class="near-empty" data-testid="area-empty-near" role="status">
          <p><strong>Nothing near ${escapeHtml(zip)} yet.</strong></p>
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
