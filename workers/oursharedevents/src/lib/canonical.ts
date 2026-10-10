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

/**
 * Names that already mean a screen under /events/<id>/ (OSE-1684), so an
 * event whose slug is one of them keeps the plain /events/<id> address. The
 * form screens are listed now so a later move under /events/<id>/ cannot
 * collide with an event called "Register".
 */
export const EVENT_SCREEN_SEGMENTS: readonly string[] = [
  'tv',
  'poster',
  'register',
  'checkin',
  'survey',
  'updates',
  'calendar',
];

const READABLE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The slug if it can stand in an address, else null. */
export function readableSlug(slug: unknown): string | null {
  if (typeof slug !== 'string' || slug.length === 0 || slug.length > 100) return null;
  if (!READABLE_SLUG.test(slug) || EVENT_SCREEN_SEGMENTS.includes(slug)) return null;
  return slug;
}

/**
 * The canonical event page address (owner decision 2026-10-09, OSE-1684):
 * /events/<id>/<readable-name>. The id decides the event; the name is
 * decoration, so a wrong or old one forwards here and a guessed one finds
 * nothing. Without a usable slug it is /events/<id>, which always works too.
 */
export function eventPagePath(eventId: string, slug?: string | null): string {
  const readable = readableSlug(slug);
  return readable ? `/events/${eventId}/${readable}` : `/events/${eventId}`;
}

/**
 * An event's form screens under its own address (OSE-1684): sign up, check in,
 * feedback and "keep me posted". `updates` is the email signup.
 */
export const EVENT_FORM_SCREENS = {
  register: 'register',
  checkin: 'checkin',
  survey: 'survey',
  updates: 'email-signup',
} as const;
export type EventFormScreen = keyof typeof EVENT_FORM_SCREENS;

/** The form screen for a `?type=` value (the /forms/ vocabulary), or null. */
export function formScreenFor(type: string | null | undefined): EventFormScreen | null {
  switch (type) {
    case 'register':
    case 'checkin':
    case 'survey':
      return type;
    case 'email':
    case 'email-signup':
      return 'updates';
    default:
      return null;
  }
}

/**
 * The address the platform writes for an event's form: /events/<id>/<screen>,
 * with `?deployment=` when a poster deployment is known. `/forms/<id>?type=`
 * keeps answering for printed and saved links. An unknown type is the
 * registration form, as on /forms/.
 */
export function eventFormPath(
  eventId: string,
  type: string | null | undefined,
  deploymentId?: string | null
): string {
  const screen = formScreenFor(type) ?? 'register';
  const base = `/events/${encodeURIComponent(eventId)}/${screen}`;
  return deploymentId ? `${base}?deployment=${encodeURIComponent(deploymentId)}` : base;
}

/** The one place the tag is spelled; `href` is a complete absolute URL. */
export function canonicalLinkTagFor(href: string): string {
  return `<link rel="canonical" href="${escapeHtml(href)}" />`;
}

export function canonicalLinkTag(origin: string, path: string): string {
  return canonicalLinkTagFor(origin + path);
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
