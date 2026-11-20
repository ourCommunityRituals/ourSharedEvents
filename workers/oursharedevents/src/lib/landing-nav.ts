// ─── The top menu: Events and Map, which link is the page being read ──────────
//
// The landing, the map's own address (/map) and /events share one top menu, and
// it offers both ways on: Events and Map (owner, 2026-11-17; OSE-1990). On /map
// the Map link, and on /events the Events link, says it is this page, to a
// screen reader (`aria-current`) and to the eye (the template gives that link
// weight, so colour is not the only signal). On the landing neither link is the
// page, and the shell is returned as it came.
//
// A search carries between the three (OSE-2165): the menu's two links take the
// place the page resolved, `?where=<town label>` or `?zip=<zip>`, so a person who
// typed a town and then taps Map gets that town's map. The query comes from
// `carriedPlaceQuery` (lib/landing-where.ts), never from the text a visitor typed.
//
// Two links do not fit beside the name on a phone, so the template lets the
// menu wrap: beside the name where there is room, on a row of its own under it
// where there is not.
//
// Called on the shell before anything from a visitor is written into it, so
// the one match is the template's own link.

import type { WherePage } from './landing-where';

/** The two links' own marks in the templates. */
const NAV_EVENTS = 'data-testid="nav-events"';
const NAV_MAP = 'data-testid="nav-map"';
/**
 * Each link's `href`, which sits just before its mark. Built from the marks
 * above so the testid naming lint reads only real ids in this file.
 */
const NAV_HREF = new RegExp(`href="([^"]*)"( (?:${NAV_EVENTS}|${NAV_MAP}))`, 'g');

/** The pages that carry the menu. */
export type NavPage = WherePage | '/events';

/**
 * The shell with the menu's links carrying `query` (an encoded `?where=` or
 * `?zip=` from `carriedPlaceQuery`, or empty), and the current page's link
 * marked, on /map and /events only.
 */
export function markLandingNav(html: string, page: NavPage = '/', query = ''): string {
  let out = html;
  if (query)
    out = out.replace(
      NAV_HREF,
      (_m, href: string, mark: string) => `href="${href}${query}"${mark}`
    );
  if (page === '/map') out = out.replace(NAV_MAP, `${NAV_MAP} aria-current="page"`);
  if (page === '/events') out = out.replace(NAV_EVENTS, `${NAV_EVENTS} aria-current="page"`);
  return out;
}
