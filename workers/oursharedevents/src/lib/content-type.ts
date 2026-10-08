/**
 * Exact JSON content-type match.
 *
 * `value.includes('application/json')` accepts `text/plain; x=application/json`,
 * which a plain cross-site HTML form can send with no CORS preflight. This
 * accepts only the media type `application/json`, with an optional `charset`
 * parameter and nothing else. Media types and parameter names are
 * case-insensitive (RFC 9110 §8.3.1), so `APPLICATION/JSON` is accepted.
 */
export function isJsonContentType(value: string | null | undefined): boolean {
  if (!value) return false;
  const [type, ...params] = value.split(';');
  if (type.trim().toLowerCase() !== 'application/json') return false;
  return params.every((p) => /^\s*charset\s*=\s*("?)[\w.-]+\1\s*$/i.test(p));
}
