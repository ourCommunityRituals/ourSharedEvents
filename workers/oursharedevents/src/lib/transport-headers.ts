/**
 * Transport headers every response carries (OSE-2118).
 *
 * The page handlers set these with their CSP, but JSON, redirects and error
 * answers did not, and the zone's edge HSTS setting is off, so a client whose
 * first contact was an API URL got no HSTS policy. The fetch seam in index.ts
 * calls applyTransportHeaders on every response. A value a handler already set
 * is left alone.
 *
 * No `preload`: every subdomain must serve HTTPS before that is safe.
 */
export const TRANSPORT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
});

export function applyTransportHeaders(headers: Headers): void {
  for (const [name, value] of Object.entries(TRANSPORT_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
}
