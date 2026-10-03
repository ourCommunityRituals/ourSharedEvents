// ─── Event navigation — every screen of an event, one tap from the others ─────
//
// The event page, the poster and the TV display each had their own header and
// no way between them (design critique, 2026-10-02). This is the one nav they
// share: All events · Event page · Poster · TV display.
//
// Public links only. The poster and the display serve LIVE events (their
// routes refuse a draft), so those two links appear only when the event is
// live; a draft preview keeps the single "All events" link it always had.
// Organizer-only screens (live view, report) are linked from admin, never here.

import { escapeHtml } from './html-escape.js';

export type EventScreen = 'event' | 'poster' | 'display';

// 44px targets (mobile-workability gate); the accent token of the event page.
const LINK_STYLE =
  'color:var(--ose-accent);text-decoration:none;font-weight:600;display:inline-flex;align-items:center;min-height:44px';
const CURRENT_STYLE =
  'color:inherit;font-weight:700;display:inline-flex;align-items:center;min-height:44px';

export interface EventNavOptions {
  /** Live events link to the poster and the TV display. */
  live: boolean;
  /** data-testid of the "All events" link (kept stable per page phase). */
  allEventsTestId?: string;
}

/** Paths of an event's public screens, keyed by screen. */
export function eventScreenPaths(eventId: string): Record<EventScreen, string> {
  const id = encodeURIComponent(eventId);
  return {
    event: `/events/${id}`,
    poster: `/poster?event=${id}&kind=digital`,
    display: `/display?event=${id}`,
  };
}

/** The shared event nav, as an HTML string. Pure: same input, same string. */
export function renderEventNav(
  eventId: string,
  current: EventScreen,
  opts: EventNavOptions
): string {
  const paths = eventScreenPaths(eventId);
  const items: { screen: EventScreen; label: string }[] = [
    { screen: 'event', label: 'Event page' },
  ];
  if (opts.live) {
    items.push({ screen: 'poster', label: 'Poster' }, { screen: 'display', label: 'TV display' });
  }
  const links = items
    .map(({ screen, label }) =>
      screen === current
        ? `<span aria-current="page" data-testid="event-nav-${screen}" style="${CURRENT_STYLE}">${label}</span>`
        : `<a href="${escapeHtml(paths[screen])}" data-testid="event-nav-${screen}" style="${LINK_STYLE}">${label}</a>`
    )
    .join('');
  const allEvents = `<a href="/events" data-testid="${escapeHtml(opts.allEventsTestId ?? 'event-nav-events')}" style="${LINK_STYLE}">&larr; All events</a>`;
  // With nothing else to go to, the nav is the single link it always was.
  const rest = opts.live ? links : '';
  return `<nav aria-label="Site" data-testid="event-nav" style="display:flex;flex-wrap:wrap;gap:0 1.25rem;margin:0 0 0.5rem">${allEvents}${rest}</nav>`;
}
