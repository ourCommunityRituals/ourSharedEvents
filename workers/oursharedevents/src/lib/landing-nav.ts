// ─── The landing's top menu: which link is the page being read ────────────────
//
// The landing and the map's own address (/map) are one shell, and its top menu
// offers both ways on: Events and Map (owner, 2026-11-17; OSE-1990). On /map
// the Map link says it is this page, to a screen reader (`aria-current`) and
// to the eye (the template gives that link weight, so colour is not the only
// signal). On the landing neither link is the page, and the shell is returned
// as it came.
//
// Two links do not fit beside the name on a phone, so the template lets the
// menu wrap: beside the name where there is room, on a row of its own under it
// where there is not.
//
// Called on the shell before anything from a visitor is written into it, so
// the one match is the template's own link.

import type { WherePage } from './landing-where';

/** The Map link's own mark in `templates/landing.html`. */
const NAV_MAP = 'data-testid="nav-map"';

/** The shell with the Map link marked as the current page, on /map only. */
export function markLandingNav(html: string, page: WherePage = '/'): string {
  if (page !== '/map') return html;
  return html.replace(NAV_MAP, `${NAV_MAP} aria-current="page"`);
}
