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
import { injectMarker } from './inject-marker';
import { zonedDatePart } from './event-datetime';
import type { EventListItem } from './event-list';

export const WHEN_OPTIONS = [
  'all',
  'today',
  'weekend',
  'week',
  'month',
  'next-month',
  'next-90',
  'past',
] as const;
export type WhenOption = (typeof WHEN_OPTIONS)[number];
export const Q_MAX_LEN = 60;
const HOME_TZ = 'America/Chicago';

export interface DiscoveryFilters {
  when: WhenOption;
  q: string;
}

/**
 * OSE-1372: ONE table per `when` value drives the chip, the count line and the
 * empty state, so the three cannot disagree (staging showed the Everything chip
 * beside "0 this month" and "Nothing else this month yet."). `span` is the
 * phrase that finishes "N events …" and "Nothing … yet."; '' for the undated
 * default.
 */
const WHEN_COPY: Record<WhenOption, { chip: string; span: string; empty: string }> = {
  all: { chip: 'Everything', span: '', empty: 'Nothing scheduled right now. Check back soon.' },
  today: {
    chip: 'Today',
    span: 'today',
    empty: 'Nothing on today. Try this weekend or the next 7 days.',
  },
  weekend: { chip: 'This weekend', span: 'this weekend', empty: 'Nothing this weekend yet.' },
  week: {
    chip: 'Next 7 days',
    span: 'in the next 7 days',
    empty: 'Nothing in the next 7 days yet.',
  },
  month: { chip: 'This month', span: 'this month', empty: 'Nothing this month yet.' },
  'next-month': { chip: 'Next month', span: 'next month', empty: 'Nothing next month yet.' },
  'next-90': {
    chip: 'Next 90 days',
    span: 'in the next 90 days',
    empty: 'Nothing in the next 90 days yet.',
  },
  past: {
    chip: 'Recently wrapped',
    span: 'recently wrapped',
    empty: 'Nothing has wrapped recently.',
  },
};

/** The count line for a `when` value: "3 events this month", "1 event", "0 events next month". */
export function discoveryCountLabel(when: WhenOption, n: number): string {
  const span = WHEN_COPY[when].span;
  return `${n} ${n === 1 ? 'event' : 'events'}${span ? ` ${span}` : ''}`;
}

/** The chip label for a `when` value. */
export function discoveryChipLabel(when: WhenOption): string {
  return WHEN_COPY[when].chip;
}

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

/**
 * Calendar date of the event as YYYY-MM-DD, or null when it has none. A
 * date-only value IS the calendar day; a full instant is read in the event's
 * own zone (UTC fallback) — the same day the card prints (event-list.ts), so a
 * window never files an evening event under the next UTC day.
 */
function eventDate(item: WhenItem): string | null {
  const iso = typeof item.startDateISO === 'string' ? item.startDateISO : '';
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const tz = typeof item.timezone === 'string' && item.timezone ? item.timezone : null;
  return zonedDatePart(iso, tz) || null;
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM of the calendar month after `ymd`. */
function nextMonth(ymd: string): string {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
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

/** The fields a `when` window reads. Both /events cards and landing cards carry them. */
export interface WhenItem {
  startDateISO?: unknown;
  phase?: unknown;
  timezone?: unknown;
}

/** Days in the `next-90` window: today through today+90, event-local (OSE-1362). */
export const NEXT_90_DAYS = 90;

/**
 * THE definition of a `when` window (OSE-1362). /events chips AND the landing
 * "Happening near you" list/map both call this, so a label means the same
 * window on every surface. Pure; `now` is injectable.
 *
 * 'all' = everything listed, wrapped included (they link to their recap). A
 * dated window is forward-looking, so wrapped events drop out; 'past' is only
 * them. A LIVE event (phase 'event') that started before today is happening
 * today, so it is dated today — a multi-day event does not vanish mid-run.
 */
export function inWhenWindow(e: WhenItem, when: WhenOption, now: Date = new Date()): boolean {
  const wrapped = e.phase === 'post_event';
  if (when === 'all') return true;
  if (when === 'past') return wrapped;
  if (wrapped) return false;

  const tz = typeof e.timezone === 'string' && e.timezone ? e.timezone : null;
  const today = localDate(now, tz);
  let ed = eventDate(e);
  // An undated event is "upcoming" but cannot answer a dated question.
  if (!ed) return false;
  if (e.phase === 'event' && ed < today) ed = today;
  switch (when) {
    case 'today':
      return ed === today;
    case 'week':
      return ed >= today && ed <= addDays(today, 7);
    case 'month':
      return ed.slice(0, 7) === today.slice(0, 7);
    case 'next-month':
      // Next calendar month in the event's zone (late-month browsing had no
      // forward window at all).
      return ed.slice(0, 7) === nextMonth(today);
    case 'next-90':
      return ed >= today && ed <= addDays(today, NEXT_90_DAYS);
    case 'weekend': {
      // Next Fri–Sun window that has not fully passed (today if it is the weekend).
      const dow = dayOfWeek(today);
      const toFri = dow === 5 ? 0 : dow === 6 ? -1 : dow === 0 ? -2 : 5 - dow;
      const fri = addDays(today, toFri);
      const sun = addDays(fri, 2);
      return ed >= (fri < today ? today : fri) && ed <= sun;
    }
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
    if (!inWhenWindow(e, f.when, now)) return false;

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
    return `<a class="disc-chip${active ? ' active' : ''}" href="/events?when=${w}${qParam}" data-testid="disc-when-${w}"${active ? ' aria-current="true"' : ''}>${WHEN_COPY[w].chip}</a>`;
  }).join('');
  const clear =
    f.q || f.when !== 'all'
      ? `<a class="disc-clear" href="/events" data-testid="disc-clear">Clear</a>`
      : '';
  const summary = f.q
    ? `${resultCount} match${resultCount === 1 ? '' : 'es'} for &ldquo;${qEsc}&rdquo;`
    : discoveryCountLabel(f.when, resultCount);
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
  return WHEN_COPY[f.when].empty;
}

export function injectDiscoveryFilters(html: string, bar: string): string {
  return html.includes(EVENT_FILTERS_MARKER) ? injectMarker(html, EVENT_FILTERS_MARKER, bar) : html;
}
