/**
 * OSE-660 — Universal geo link (human wayfinding; maps != H3).
 *
 * Builds the link that opens the visitor's native maps app to the venue from
 * REAL COORDINATES / ADDRESS. It NEVER carries an H3 cell — H3 is the
 * analytical substrate (aggregation, math), never the wayfinding link (feet).
 * Two representations of "where", a wall between them.
 *
 * Link-out only: an `<a>`, never an embedded map / iframe / tracker, and
 * `rel="noopener noreferrer"` so the maps host gets no referrer on the
 * anonymous surface. Degrades to an address search when no coordinates are
 * stored; renders nothing (no broken `<a>`) when neither exists.
 *
 * geo: URI scheme — iOS opens Apple Maps, Android opens the default maps app.
 */
export function renderGeoLink(
  lat: number | null,
  lon: number | null,
  venueName: string | null,
  addr: string | null,
  label: string,
  testid = 'geo-link'
): string {
  if (lat !== null && lon !== null) {
    const qLabel = encodeURIComponent(venueName || addr || '');
    const href = `geo:${lat},${lon}?q=${lat},${lon}${qLabel ? `(${qLabel})` : ''}`;
    return `<a class="ose-geo-link" data-testid="${testid}" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  }
  const q = encodeURIComponent(addr || venueName || '');
  if (q) {
    return `<a class="ose-geo-link" data-testid="${testid}" href="https://maps.apple.com/?q=${q}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  }
  return '';
}
