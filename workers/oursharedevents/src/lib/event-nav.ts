// ─── Event navigation — every screen of an event, one tap from the others ─────
//
// The event page, the poster and the TV display each had their own header and
// no way between them (design critique, 2026-10-02). This is the one nav the
// public pages share: All events · Event page · Poster.
//
// Public links only. The poster serves LIVE events (its route refuses a
// draft), so its link appears only when the event is live; a draft preview
// keeps the single "All events" link it always had.
// The TV display is an organizer link (owner, 2026-10-09, OSE-1684): an
// attendee has no use for it, and every phone that opens it counts as a TV
// showing of the sponsors. Admin links it (TV card, wizard, live view);
// eventScreenPaths still names its address for them. Organizer-only screens
// are linked from admin, never here.

import { escapeHtml } from './html-escape.js';
import { msg } from './i18n/catalog';
import { DEFAULT_LANG, type Lang } from './i18n/languages';
import { withLangPrefix } from './i18n/path-prefix';

export type EventScreen = 'event' | 'poster' | 'display';

// 44px targets (mobile-workability gate); the accent token of the event page.
const LINK_STYLE =
  'color:var(--ose-accent);text-decoration:none;font-weight:600;display:inline-flex;align-items:center;min-height:44px';
const CURRENT_STYLE =
  'color:inherit;font-weight:700;display:inline-flex;align-items:center;min-height:44px';

export interface EventNavOptions {
  /** Live events link to the poster. */
  live: boolean;
  /** data-testid of the "All events" link (kept stable per page phase). */
  allEventsTestId?: string;
  /** The page language; the poster and TV pages are English and leave it unset. */
  lang?: Lang;
}

/** Paths of an event's public screens, keyed by screen. */
export function eventScreenPaths(eventId: string): Record<EventScreen, string> {
  const id = encodeURIComponent(eventId);
  return {
    event: `/events/${id}`,
    poster: `/events/${id}/poster?kind=digital`,
    display: `/events/${id}/tv`,
  };
}

/** The shared event nav, as an HTML string. Pure: same input, same string. */
export function renderEventNav(
  eventId: string,
  current: EventScreen,
  opts: EventNavOptions
): string {
  const paths = eventScreenPaths(eventId);
  const lang = opts.lang ?? DEFAULT_LANG;
  const items: { screen: EventScreen; label: string }[] = [
    { screen: 'event', label: msg(lang, 'nav.eventPage') },
  ];
  if (opts.live) {
    items.push({ screen: 'poster', label: msg(lang, 'nav.poster') });
  }
  const links = items
    .map(({ screen, label }) =>
      screen === current
        ? `<span aria-current="page" data-testid="event-nav-${screen}" style="${CURRENT_STYLE}">${label}</span>`
        : `<a href="${escapeHtml(paths[screen])}" data-testid="event-nav-${screen}" style="${LINK_STYLE}">${label}</a>`
    )
    .join('');
  const allEvents = `<a href="${withLangPrefix(lang, '/events')}" data-testid="${escapeHtml(opts.allEventsTestId ?? 'event-nav-events')}" style="${LINK_STYLE}">${msg(lang, 'nav.allEvents')}</a>`;
  // With nothing else to go to, the nav is the single link it always was.
  const rest = opts.live ? links : '';
  return `<nav aria-label="${msg(lang, 'nav.site')}" data-testid="event-nav" style="display:flex;flex-wrap:wrap;gap:0 1.25rem;margin:0 0 0.5rem">${allEvents}${rest}</nav>`;
}
