/**
 * What the Worker may write to its log when a request fails with an error
 * nobody caught.
 *
 * Workers Logs are on, so the line is kept by a third party. A request URL can
 * be a credential in itself: `/sponsor?t=…` and `/sharedReport?…&token=…` are
 * signed links, and `/api/v2/sponsors/draft/<token>/asset/…` carries its token
 * in the path. So the line never carries the URL, its query string, or a path
 * segment that is not a fixed word.
 *
 * It carries three things instead:
 *   - `op`: the route pattern (`GET /sponsor`, `PUT /api/v2/admin/events/:x`),
 *     the same label the OPERATION_COST line uses, so the two join;
 *   - `errorClass`: the error's constructor name (`TypeError`), or the type of a
 *     thrown value that is not an Error;
 *   - `error`: for an error from the database, its label and nothing else
 *     (`Error D1_ERROR SQLITE_CONSTRAINT`, lib/error-label.ts): the D1 client
 *     writes a response body and a bound value into its messages, so the
 *     message can quote a row. For any other error, what it said, with every
 *     piece of the request URL removed. An error is free text and can repeat
 *     the URL it failed on (`fetch failed: https://…?t=…`); those pieces are
 *     replaced, the rest stays.
 *
 * Limits: an error is taken to be from the database when its message carries a
 * D1 or SQLite code, which every error the D1 client throws does. In any other
 * message only the URL is removed. A message that repeats a request header or
 * body value is not rewritten, and a message that repeats only a fragment of a
 * URL piece (a JSON parse error quoting the first characters) keeps that fragment.
 */

import { normalizeOperation } from './cost-metric';
import { errorClassOf, errorCodes, errorLabel } from './error-label';

export interface UnhandledErrorSummary {
  op: string;
  errorClass: string;
  error: string;
}

const REDACTED = '[redacted]';

/**
 * Shorter URL pieces are not credentials and removing them would only damage
 * the message (`/events/12` must not blank every "12" in the text).
 */
const MIN_PIECE_LENGTH = 8;

function decoded(piece: string): string {
  try {
    return decodeURIComponent(piece);
  } catch {
    return piece;
  }
}

/** Every piece of the URL that may not be written out, longest first. */
function urlPieces(rawUrl: string): string[] {
  const pieces = new Set<string>([rawUrl]);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return [...pieces];
  }
  pieces.add(url.href);
  pieces.add(url.pathname + url.search);
  pieces.add(url.search);
  pieces.add(url.search.slice(1));
  for (const pair of url.search.slice(1).split('&')) {
    const eq = pair.indexOf('=');
    const value = eq === -1 ? '' : pair.slice(eq + 1);
    pieces.add(value);
    pieces.add(decoded(value.replace(/\+/g, ' ')));
  }
  // A path segment the route pattern masks is an id, a slug or a token.
  let anyMasked = false;
  for (const seg of url.pathname.split('/')) {
    if (seg.length === 0 || normalizeOperation('GET', `/${seg}`) !== 'GET /:x') continue;
    anyMasked = true;
    pieces.add(seg);
    pieces.add(decoded(seg));
  }
  if (anyMasked) pieces.add(url.pathname);
  return [...pieces]
    .filter((p) => p.length >= MIN_PIECE_LENGTH)
    .sort((a, b) => b.length - a.length);
}

/** Never throws: it runs inside the catch that reports the failure. */
export function summarizeUnhandledError(err: unknown, request: Request): UnhandledErrorSummary {
  let op = 'OTHER /:x';
  let errorClass = 'Error';
  let error = '[unreadable]';
  try {
    op = normalizeOperation(request.method, new URL(request.url).pathname);
    errorClass = errorClassOf(err);
    if (errorCodes(err).length > 0) {
      error = errorLabel(err);
    } else {
      let text = err instanceof Error ? err.message : String(err);
      for (const piece of urlPieces(request.url)) {
        text = text.split(piece).join(REDACTED);
      }
      error = text;
    }
  } catch {
    // keep the defaults: the 500 must still be answered
  }
  return { op, errorClass, error };
}
