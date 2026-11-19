/**
 * OSE-660 — Directions links (human wayfinding; maps != H3).
 *
 * Builds the links that open a maps app at the venue, from COORDINATES or the
 * ADDRESS. They NEVER carry an H3 cell id — H3 is the analytical substrate
 * (aggregation, math), never the wayfinding link (feet). Two representations
 * of "where", a wall between them.
 *
 * OSE-2196 (owner 2026-11-19): on a public surface the coordinates are the
 * event's res-9 cell point, never its stored lat and lon. Event surfaces call
 * eventDirections / renderEventGeoLink, which take the event's cells and not
 * its point.
 *
 * Owner 2026-10-11: Google Maps and Apple Maps are both offered, as the event's
 * calendar already offers Google Calendar and an .ics file (Apple, Outlook). This replaces the single `geo:` link, which an
 * iPhone does not open, and its Apple-only fallback.
 *
 * Link-out only: plain `<a>`s, never an embedded map / iframe / tracker, and
 * `rel="noopener noreferrer"` so the maps host gets no referrer from the
 * anonymous surface. Nothing is sent to either company unless the visitor taps
 * a link. With coordinates both links point at them; without, they search the
 * address (else the venue name). Renders nothing when neither exists.
 */

import { eventCellPoint, type EventCells } from './cell-point';

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** What an event's directions are built from. Its stored lat and lon are not here. */
export interface EventPlace extends EventCells {
  location?: string | null;
  where_address?: string | null;
}

/**
 * OSE-2196 (owner 2026-11-19, "it should resolve to the H3"): an event's
 * directions on every public surface. The one point handed to Google or Apple
 * Maps is the event's res-9 cell point (lib/cell-point.ts), else its res-7 area
 * point; never its stored lat and lon. With no cell at all, both search the
 * street address, else the venue name (searching the address is kept only for
 * an event with no cell; it is ours for the owner to confirm, not a ruling).
 * Callers offer these only for a routable event (domain/event-state.ts).
 */
/**
 * The same choice as one search text, for a page that builds its own link from
 * a fixed start (the poster, whose escaping gate allows only that): the res-9
 * cell point as "lat,lon", else the street address, else the venue name.
 */
export function eventDirectionsQuery(e: EventPlace): string | null {
  const p = eventCellPoint(e);
  if (p) return `${p.lat},${p.lon}`;
  const text = (e.where_address || e.location || '').trim();
  return text || null;
}

export function eventDirections(e: EventPlace): { google: string; apple: string } | null {
  const p = eventCellPoint(e);
  return directionsUrls(
    p?.lat ?? null,
    p?.lon ?? null,
    e.location ?? null,
    e.where_address ?? null
  );
}

export function directionsUrls(
  lat: number | null,
  lon: number | null,
  venueName: string | null,
  addr: string | null
): { google: string; apple: string } | null {
  if (lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon)) {
    const label = encodeURIComponent(venueName || addr || '');
    return {
      google: `https://www.google.com/maps/search/?api=1&query=${lat}%2C${lon}`,
      apple: `https://maps.apple.com/?ll=${lat},${lon}${label ? `&q=${label}` : ''}`,
    };
  }
  const text = (addr || venueName || '').trim();
  if (!text) return null;
  const q = encodeURIComponent(text);
  return {
    google: `https://www.google.com/maps/search/?api=1&query=${q}`,
    apple: `https://maps.apple.com/?q=${q}`,
  };
}

/**
 * One "Directions" button that opens the two choices, built like the event
 * page's "Add to calendar" control (a CSP-safe <details>, no script) and
 * styled by the same classes, so the two read as one pattern. Owner
 * 2026-10-11: one button, two choices, on the event page and the poster.
 */
export function renderGeoLink(
  lat: number | null,
  lon: number | null,
  venueName: string | null,
  addr: string | null,
  label: string,
  testid = 'geo-link'
): string {
  return renderDirectionsMenu(directionsUrls(lat, lon, venueName, addr), label, testid);
}

/** The Directions menu for an event, from eventDirections (its cell, never its stored point). */
export function renderEventGeoLink(e: EventPlace, label: string, testid = 'geo-link'): string {
  return renderDirectionsMenu(eventDirections(e), label, testid);
}

function renderDirectionsMenu(
  urls: { google: string; apple: string } | null,
  label: string,
  testid: string
): string {
  if (!urls) return '';
  const link = (href: string, name: string, which: string) =>
    `<a class="ose-calendar-option" data-testid="${testid}-${which}" href="${attr(href)}" target="_blank" rel="noopener noreferrer">${name}</a>`;
  return `<details class="ose-calendar-menu ose-directions-menu" data-testid="${testid}">
    <summary class="ose-calendar-link ose-calendar-summary" data-testid="${testid}-summary">${label}</summary>
    <div class="ose-calendar-options" role="group" aria-label="${label}">
      ${link(urls.google, 'Google Maps', 'google')}
      ${link(urls.apple, 'Apple Maps', 'apple')}
    </div>
  </details>`;
}
