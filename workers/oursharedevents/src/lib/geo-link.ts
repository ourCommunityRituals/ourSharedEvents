/**
 * OSE-660 — Directions links (human wayfinding; maps != H3).
 *
 * Builds the links that open a maps app at the venue, from REAL COORDINATES or
 * the ADDRESS. They NEVER carry an H3 cell — H3 is the analytical substrate
 * (aggregation, math), never the wayfinding link (feet). Two representations
 * of "where", a wall between them.
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

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

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
  const urls = directionsUrls(lat, lon, venueName, addr);
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
