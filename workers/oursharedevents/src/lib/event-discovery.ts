/**
 * Attendee discovery filters for /events — the attendee corner of the triangle.
 *
 * WHY. The public list was a flat, newest-first dump: no way to ask "what's on
 * tonight", "this weekend", or "the trivia thing at Eagles". A person on a
 * phone in a bar is not going to scroll fifty cards. Discovery is the whole
 * point of the surface, and discovery needs a question.
 *
 * WHAT. Two inputs, both read from the query string and both ALLOWLISTED /
 * CAPPED before they touch anything:
 *   - `when` ∈ WHEN_OPTIONS (default 'all'). Anything else → default.
 *   - `q`    free text, trimmed, capped at Q_MAX_LEN, matched case-insensitively
 *            against the card's name and venue ONLY. Never reaches SQL: the
 *            list is already the brand-scoped, active, published projection the
 *            DataProvider returns, and the filter runs over that in the Worker.
 *            It is reflected into the page exactly once, HTML-escaped, inside a
 *            `value` attribute.
 *
 * The filter bar is server-rendered like the list (marker-based, opt-in), so
 * the served HTML is the truth and a filtered URL is shareable: `/events?when=
 * weekend` is a link someone can text. No client fetch, no loading state.
 *
 * Dates are compared as the event's local calendar date (YYYY-MM-DD from
 * startDateISO) against "today" in the event's own timezone when it has one,
 * falling back to America/Chicago — the platform's home corridor — never the
 * Worker's UTC clock, which would make "today" wrong every evening.
 */

import { escapeHtml } from './html-escape';
import type { EventListItem } from './event-list';

export const WHEN_OPTIONS = ['all', 'today', 'weekend', 'week', 'month', 'past'] as const;
export type WhenOption = (typeof WHEN_OPTIONS)[number];
export const Q_MAX_LEN = 60;
const HOME_TZ = 'America/Chicago';

export interface DiscoveryFilters {
  when: WhenOption;
  q: string;
}

const WHEN_LABELS: Record<WhenOption, string> = {
  all: 'Everything',
  today: 'Today',
  weekend: 'This weekend',
  week: 'Next 7 days',
  month: 'This month',
  past: 'Recently wrapped',
};

/** Parse + sanitise the query string. Never throws; unknown → defaults. */
export function parseDiscoveryFilters(url: URL): DiscoveryFilters {
  const rawWhen = url.searchParams.get('when') ?? '';
  const when = (WHEN_OPTIONS as readonly string[]).includes(rawWhen)
    ? (rawWhen as WhenOption)
    : 'all';
  const rawQ = url.searchParams.get('q') ?? '';
  // Collapse whitespace, strip control chars, cap length.
  const q = rawQ
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Q_MAX_LEN);
  return { when, q };
}

/** YYYY-MM-DD of `now` in `tz` (falls back to HOME_TZ, then UTC). */
function localDate(now: Date, tz: string | null): string {
  for (const zone of [tz, HOME_TZ, 'UTC']) {
    if (!zone) continue;
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(now);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
      return `${get('year')}-${get('month')}-${get('day')}`;
    } catch {
      // unknown zone → next fallback
    }
  }
  return now.toISOString().slice(0, 10);
}

/** Calendar date of the event as YYYY-MM-DD, or null when it has none. */
function eventDate(item: EventListItem): string | null {
  const iso = typeof item.startDateISO === 'string' ? item.startDateISO : '';
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayOfWeek(ymd: string): number {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay(); // 0 = Sun
}

/**
 * Searchable, human-readable date tokens for an event — so a local who SEES
 * "Saturday, Oct 4" on the card and types "saturday" (or "october", "oct")
 * actually finds it, instead of the anti-anticipatory "nothing matches" on text
 * that is on the screen. The card date is the calendar date pinned to local
 * noon, so weekday/month derive from that same YYYY-MM-DD; full AND abbreviated
 * forms are both included.
 */
function dateSearchTokens(item: EventListItem): string {
  const ymd = eventDate(item);
  if (!ymd) return '';
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  try {
    const long = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(d);
    const short = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'short',
      month: 'short',
    }).format(d);
    return `${long} ${short}`;
  } catch {
    return '';
  }
}

/**
 * Apply the filters. Pure over the enriched list; `now` is injectable so the
 * "today / weekend" boundaries are testable.
 */
export function applyDiscoveryFilters(
  items: readonly EventListItem[],
  f: DiscoveryFilters,
  now: Date = new Date()
): EventListItem[] {
  const needle = f.q.toLowerCase();
  return items.filter((e) => {
    const wrapped = e.phase === 'post_event';
    // 'all' is the page's existing contract: every event the API lists,
    // wrapped ones included (they link to their recap). A dated window is
    // forward-looking, so wrapped events drop out of it; 'past' is only them.
    if (f.when === 'past') {
      if (!wrapped) return false;
    } else if (f.when !== 'all' && wrapped) {
      return false;
    }

    if (f.when !== 'all' && f.when !== 'past') {
      const tz = typeof e.timezone === 'string' && e.timezone ? e.timezone : null;
      const today = localDate(now, tz);
      const ed = eventDate(e);
      // An undated event is "upcoming" but cannot answer a dated question.
      if (!ed) return false;
      if (f.when === 'today' && ed !== today) return false;
      if (f.when === 'week' && (ed < today || ed > addDays(today, 7))) return false;
      if (f.when === 'month' && ed.slice(0, 7) !== today.slice(0, 7)) return false;
      if (f.when === 'weekend') {
        // Next Fri–Sun window that has not fully passed (today if it is the weekend).
        const dow = dayOfWeek(today);
        const toFri = dow === 5 ? 0 : dow === 6 ? -1 : dow === 0 ? -2 : 5 - dow;
        const fri = addDays(today, toFri);
        const sun = addDays(fri, 2);
        if (ed < (fri < today ? today : fri) || ed > sun) return false;
      }
    }

    if (needle) {
      const hay = [
        typeof e.name === 'string' ? e.name : '',
        typeof e.venue === 'string' ? e.venue : '',
        dateSearchTokens(e),
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

/** Where the filter bar goes. Template opts in by carrying it. */
export const EVENT_FILTERS_MARKER = '<!--OCR_EVENT_FILTERS-->';

/**
 * Server-render the filter bar. A plain GET form (works with JS off, and the
 * nonce CSP has nothing to allow) plus one chip per `when`, as links that
 * preserve `q`. The active chip carries aria-current so it is announced.
 */
export function renderDiscoveryFilters(f: DiscoveryFilters, resultCount: number): string {
  const qEsc = escapeHtml(f.q);
  const qParam = f.q ? `&amp;q=${encodeURIComponent(f.q)}` : '';
  const chips = WHEN_OPTIONS.map((w) => {
    const active = w === f.when;
    return `<a class="disc-chip${active ? ' active' : ''}" href="/events?when=${w}${qParam}" data-testid="disc-when-${w}"${active ? ' aria-current="true"' : ''}>${WHEN_LABELS[w]}</a>`;
  }).join('');
  const clear =
    f.q || f.when !== 'all'
      ? `<a class="disc-clear" href="/events" data-testid="disc-clear">Clear</a>`
      : '';
  const summary = f.q
    ? `${resultCount} match${resultCount === 1 ? '' : 'es'} for &ldquo;${qEsc}&rdquo;`
    : `${resultCount} ${WHEN_LABELS[f.when].toLowerCase()}`;
  return `
        <form class="disc-search" method="get" action="/events" role="search" data-testid="disc-search">
          <input type="hidden" name="when" value="${escapeHtml(f.when)}" />
          <label class="sr-only" for="disc-q">Search events by name or venue</label>
          <input id="disc-q" class="disc-q" type="search" name="q" value="${qEsc}" maxlength="${Q_MAX_LEN}" placeholder="Search by name or venue" autocomplete="off" data-testid="disc-q" />
          <button type="submit" class="disc-go" data-testid="disc-go">Search</button>
        </form>
        <nav class="disc-chips" aria-label="When" data-testid="disc-chips">${chips}${clear}</nav>
        <p class="disc-summary" data-testid="disc-summary">${summary}</p>`;
}

/** Empty-state copy that names the question that had no answer. */
export function discoveryEmptyCopy(f: DiscoveryFilters): string {
  if (f.q)
    return `Nothing matches &ldquo;${escapeHtml(f.q)}&rdquo;. Try a shorter word, or clear the search.`;
  switch (f.when) {
    case 'today':
      return 'Nothing on today. Try this weekend or the next 7 days.';
    case 'weekend':
      return 'Nothing on this weekend yet.';
    case 'week':
      return 'Nothing in the next 7 days yet.';
    case 'month':
      return 'Nothing else this month yet.';
    case 'past':
      return 'Nothing has wrapped recently.';
    default:
      return 'No events yet. Check back soon.';
  }
}

export function injectDiscoveryFilters(html: string, bar: string): string {
  return html.includes(EVENT_FILTERS_MARKER) ? html.replace(EVENT_FILTERS_MARKER, bar) : html;
}
