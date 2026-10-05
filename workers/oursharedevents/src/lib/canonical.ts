/**
 * `<link rel="canonical">` for the indexable public pages: event pages, /events,
 * / and /privacy.
 *
 * One address per page. The path is fixed by the caller, never read from the
 * request, so a query string (?when=, ?q=, tracking params), a trailing slash or
 * an old address (/home, /welcome, ...) all name the same canonical page.
 *
 * Origin: production always names https://oursharedevents.com, because the zone
 * also routes www.oursharedevents.com and a canonical built from the request
 * would name whichever host was asked. Every other environment names the host it
 * was asked on (staging is `Disallow: /` already, so its canonical never competes
 * with production's). With no request and no production env, there is no tag.
 *
 * Not for admin previews (noindex), token pages (/sponsor, /sharedReport, forms)
 * or error pages.
 */

import { escapeHtml } from './html-escape.js';

export const PRODUCTION_ORIGIN = 'https://oursharedevents.com';

export interface CanonicalEnv {
  WORKER_ENV?: string;
}

export const CANONICAL_PATH = {
  landing: '/',
  events: '/events',
  privacy: '/privacy',
} as const;

export function canonicalOrigin(
  request: Request | undefined,
  env: CanonicalEnv | undefined
): string | null {
  if (env?.WORKER_ENV === 'production') return PRODUCTION_ORIGIN;
  return request ? new URL(request.url).origin : null;
}

/** The canonical event page address. */
export function eventPagePath(eventId: string): string {
  return `/events/${eventId}`;
}

export function canonicalLinkTag(origin: string, path: string): string {
  return `<link rel="canonical" href="${escapeHtml(origin + path)}" />`;
}

/**
 * Put the canonical link at the end of `<head>`. A page that already carries one
 * is returned unchanged (never two), and so is a document with no `</head>`.
 */
export function injectCanonical(
  htmlText: string,
  request: Request | undefined,
  env: CanonicalEnv | undefined,
  path: string
): string {
  const origin = canonicalOrigin(request, env);
  if (!origin) return htmlText;
  if (/<link[^>]+rel=["']canonical["']/i.test(htmlText)) return htmlText;
  const at = htmlText.search(/<\/head>/i);
  if (at < 0) return htmlText;
  return `${htmlText.slice(0, at)}  ${canonicalLinkTag(origin, path)}\n${htmlText.slice(at)}`;
}
