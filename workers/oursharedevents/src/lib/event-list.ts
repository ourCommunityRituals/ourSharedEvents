// ─── Public event list — server-rendered ───────────────────────────────────────
//
// OSE-1243 (frontend remediation plan §3.1, step 5).
//
// `/events` used to ship a loading state and fetch its own content:
//
//     HTML → parse → JS → fetch /api/v2/events → render
//
// Two round trips before an attendee saw an event, on the one surface whose
// entire job is answering "is there anything to do around here?". The Worker
// already had the rows in hand when it served the shell. This module renders
// them into it.
//
// WHY A PURE FUNCTION, NOT A TEMPLATE EDIT: this is the seam the old client
// script had no equivalent of. Every empty / error / hostile-input case that
// previously needed a browser, a route interception and a settled microtask
// queue to exercise is now a synchronous call with a string return. The
// behaviour did not get simpler; the cost of proving it did.
//
// The markup is byte-compatible with what the client script emitted, including
// every `data-testid`, so the surface's existing selectors keep meaning what
// they meant.

import { escapeHtml } from './html-escape.js';
import { injectMarker } from './inject-marker.js';
import { formatDateOnly, zonedDatePart } from './event-datetime.js';
// Type-only the other way (event-discovery imports EventListItem), so no cycle.
import { orderUpcomingFirst } from './event-discovery.js';

export interface EventListItem {
  id?: unknown;
  name?: unknown;
  startDateISO?: unknown;
  venue?: unknown;
  phase?: unknown;
  timezone?: unknown;
}

export interface RenderedEventList {
  /** Markup for the `#events` container's children. Never empty. */
  html: string;
  /** Text for the sr-only `#events-count` live region. Empty when not applicable. */
  countText: string;
  /** Events not in `post_event`. Excluded wrapped events, per OSE-1201. */
  upcoming: number;
}

const EMPTY_HTML =
  '<p class="loading" data-testid="public-events-empty" role="status">No events scheduled.</p>';

const ERROR_HTML =
  '<p class="error" data-testid="public-error">Could not load events. Please try again.</p>';

/** The empty state, for callers that need it without a list (e.g. `ok: false`). */
export function renderEmptyEventList(): RenderedEventList {
  return { html: EMPTY_HTML, countText: '', upcoming: 0 };
}

/**
 * The error state. Served when the Worker could not read the events at all.
 *
 * Server-rendering makes this honest in a way the client version could not be:
 * previously a Worker that could not reach D1 still served a 200 with a
 * "Loading events…" paragraph, and the page only admitted failure after the
 * browser's own fetch also failed. The served HTML now says what happened.
 */
export function renderEventListError(): RenderedEventList {
  return { html: ERROR_HTML, countText: '', upcoming: 0 };
}

/**
 * Format an event's start date the way the surface displays it.
 *
 * TIMEZONE — this is a deliberate behaviour change, not a port artefact.
 * The client script called `toLocaleDateString` with no timeZone, so the date
 * was rendered in whatever zone the *reader's device* was set to. For an
 * evening event that is wrong across most of the Americas: a 2026-12-02T02:00Z
 * start is Monday the 1st in Chicago, and a reader in London saw Tuesday the
 * 2nd for the same gathering.
 *
 * An event happens in a place, and its date is the local date in that place.
 * The list projection already carries `timezone` (data-provider.ts fetchEvents),
 * so the event's own zone is used when it has one. Events without a zone fall
 * back to UTC — the same answer the server would give anyway, and one that no
 * longer varies by who is looking.
 */
function formatEventDate(iso: string, timezone: string | null): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  };
  // A date-only value ("YYYY-MM-DD") is a calendar day, not an instant. Read as
  // UTC midnight and rendered in the event's zone it rolled back a day for any
  // negative-offset zone (OSE-1363). Anchor + format in UTC via formatDateOnly so
  // the day always matches the value, whoever is looking.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return formatDateOnly(iso, opts);
  // A full instant DOES have a zone: take its local calendar day in the event's
  // own zone (UTC fallback for a missing/invalid zone), then format that day. A
  // bad instant yields '' from zonedDatePart → '' from formatDateOnly.
  return formatDateOnly(zonedDatePart(iso, timezone), opts);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

export interface EventCardOptions {
  /** OSE-1522: the consented sponsor's title, shown by the event title. */
  sponsorTitle?: string;
  /**
   * The landing page keeps its own test ids for the card, its name and its
   * date line (existing selectors); every other id is the same on both pages.
   */
  variant?: 'events' | 'landing';
  /** Extra classes the landing's CSS-only filters hang on the card. */
  extraClasses?: readonly string[];
  /** Shown in place of a venue when the event has none (the landing says "Online"). */
  venueFallback?: string;
}

/**
 * THE event card (OSE-1520): one component for /events and the landing, so a
 * card shows the same facts and the same button wherever it appears. Pure
 * string out; every value is escaped here, once.
 */
export function renderEventCard(e: EventListItem, opts: EventCardOptions = {}): string {
  const landing = opts.variant === 'landing';
  const safeId = escapeHtml(str(e.id));
  // OSE-871 (P-1): ONE canonical name per value. The API emits
  // name/startDateISO/venue; no `|| e.title` dual-reads here.
  const rawName = str(e.name);
  const safeName = escapeHtml(rawName) || (landing ? 'Untitled event' : '');
  const encodedName = encodeURIComponent(rawName);
  const isoRaw = str(e.startDateISO);
  const dateStr = isoRaw ? escapeHtml(formatEventDate(isoRaw, str(e.timezone) || null)) : '';
  const venueStr = e.venue ? escapeHtml(str(e.venue)) : escapeHtml(opts.venueFallback ?? '');
  const datePart = dateStr ? `<span data-testid="public-event-date">${dateStr}</span>` : '';
  const venuePart = venueStr
    ? `${datePart ? ' &middot; ' : ''}<span data-testid="public-event-venue">${venueStr}</span>`
    : '';
  const phase = escapeHtml(str(e.phase));
  const wrapped = e.phase === 'post_event';
  const eventHref = `/events/${safeId}`;
  // A wrapped event links to its recap, never to a registration form.
  const cta = wrapped
    ? `<a class="cta cta-secondary" href="${eventHref}" data-testid="public-event-cta" data-cta="recap" aria-label="See how ${safeName} went">See how it went</a>`
    : `<a class="cta" href="/forms/${safeId}?type=register&amp;event=${encodedName}" data-testid="public-event-cta" data-cta="register" aria-label="Register for ${safeName}">Register</a>`;
  const wrappedTag = wrapped
    ? ' <span class="tag-wrapped" data-testid="public-event-wrapped">Wrapped</span>'
    : '';
  const sponsorLine = opts.sponsorTitle
    ? `<p class="meta" data-testid="public-event-sponsor">Supported by ${escapeHtml(opts.sponsorTitle)}</p>`
    : '';
  const classes = ['event-card', ...(opts.extraClasses ?? [])].join(' ');
  return `
          <article class="${classes}" data-testid="${landing ? 'area-card' : 'public-event-card'}" data-event-id="${safeId}" data-phase="${phase}">
            <a class="event-card-link" href="${eventHref}" data-testid="public-event-card-link" aria-label="Open ${safeName} public page"></a>
            <div class="event-info" data-testid="public-event-info">
              <h3 data-testid="${landing ? 'area-card-name' : 'public-event-name'}">${safeName}${wrappedTag}</h3>
              <p class="meta" data-testid="${landing ? 'area-card-meta' : 'public-event-meta'}">${datePart}${venuePart}</p>
              ${sponsorLine}
            </div>
            ${cta}
          </article>`;
}

export interface EventListOptions {
  /**
   * Put wrapped events under their own heading (default). The wrapped filter
   * turns it off: the page heading already says so.
   */
  wrappedHeading?: boolean;
}

/**
 * Render the public event list.
 *
 * Accepts the same shape `GET /api/v2/events` emits (post-`enrichWithPhase`),
 * so the server-rendered page and the JSON API cannot describe different
 * events. An empty or non-array input renders the empty state rather than
 * throwing — a discovery surface that 500s because there is nothing to
 * discover is the worst possible answer to the question it exists to answer.
 *
 * ORDER (OSE-1520): upcoming first, soonest first, undated last; wrapped events
 * after them under their own heading, most recent first. The page used to lead
 * with a wrapped May event under a heading that said "Upcoming".
 */
export function renderEventList(
  items: readonly EventListItem[] | null | undefined,
  /** OSE-1522: event id → the consented sponsor's title, shown by the event title. */
  sponsorTitles?: ReadonlyMap<string, string>,
  opts: EventListOptions = {}
): RenderedEventList {
  if (!Array.isArray(items) || items.length === 0) return renderEmptyEventList();

  const ordered = orderUpcomingFirst(items);
  // OSE-1201: the list said "Upcoming" and offered Register on an event whose
  // own page said it was a wrap. `phase` is authoritative; the count reads it.
  const upcoming = ordered.upcoming.length;
  const countText = `${upcoming} upcoming event${upcoming === 1 ? '' : 's'}`;

  const card = (e: EventListItem) =>
    renderEventCard(e, { sponsorTitle: sponsorTitles?.get(str(e.id)) });
  let html = ordered.upcoming.map(card).join('');
  if (ordered.wrapped.length > 0) {
    if (opts.wrappedHeading !== false) {
      if (upcoming === 0) {
        html +=
          '<p class="empty" data-testid="public-events-none-upcoming">Nothing coming up yet.</p>';
      }
      html +=
        '<h2 class="events-subheading" data-testid="public-events-wrapped-heading">Wrapped</h2>';
    }
    html += ordered.wrapped.map(card).join('');
  }

  return { html, countText, upcoming };
}

// ─── The stylesheet (one copy, both pages) ─────────────────────────────────────

/** Where the shared card + filter-chip stylesheet goes (inside a `<style>`). */
export const EVENT_CARD_CSS_MARKER = '/*OCR_EVENT_CARD_CSS*/';

// Colours are tokens only (both themes). Targets are 44px+, the input is 16px+.
// `font: inherit` on the search box and button: form controls do not inherit the
// page font by default, which is why they rendered in Arial. The button stacks
// under the text at phone width instead of squeezing the title.
export const EVENT_CARD_CSS = `
      #events, .view-list { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; }
      .event-card { min-height: var(--tap-min); position: relative; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.75rem 1rem; background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: var(--radius-sm); padding: 1.25rem 1.5rem; transition: background 0.15s; }
      .event-card:hover { background: var(--surface-hover); }
      .event-card-link { position: absolute; inset: 0; z-index: 1; border-radius: var(--radius-sm); }
      .event-card-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
      .event-card .event-info { position: relative; z-index: 2; pointer-events: none; flex: 1 1 12rem; min-width: 0; }
      .event-card h3 { overflow-wrap: anywhere; font-size: 1rem; font-weight: 600; margin: 0 0 0.35rem; color: var(--text); }
      .event-card .meta { font-size: 0.95rem; color: var(--text-muted); margin: 0; }
      .event-card .cta { position: relative; z-index: 3; display: inline-flex; align-items: center; justify-content: center; padding: 0.5rem 1.25rem; min-height: var(--tap-min); background: var(--accent); color: var(--on-accent); border-radius: var(--radius-sm); font-size: 1rem; font-weight: 600; text-decoration: none; white-space: nowrap; flex-shrink: 0; }
      .event-card .cta:hover { background: var(--accent-hover); }
      .event-card .cta:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      .event-card .cta-secondary { background: transparent; color: var(--accent); box-shadow: inset 0 0 0 2px var(--accent); }
      @media (max-width: 480px) {
        .event-card .event-info { flex-basis: 100%; }
        .event-card .cta { flex: 1 1 100%; }
      }
      .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
      .tag-wrapped { display: inline-block; margin-left: 0.5rem; padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.8rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; vertical-align: middle; background: var(--bg); color: var(--text-muted); }
      .events-subheading { font-size: 1.1rem; font-weight: 600; color: var(--text-muted); margin: 0.75rem 0 0; }
      .empty { background: var(--surface); border: 1px dashed var(--border); border-radius: var(--radius-sm); padding: 1.5rem 1rem; text-align: center; color: var(--text-muted); font-size: 1rem; }
      .empty a { color: var(--accent); font-weight: 600; }
      .disc-search { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0 0 0.75rem; }
      .disc-q { flex: 1 1 8rem; min-width: 0; min-height: 48px; font: inherit; padding: 0.5rem 0.9rem; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); color: var(--text); }
      .disc-go { min-height: 48px; padding: 0 1.1rem; border: none; border-radius: 999px; background: var(--accent); color: var(--on-accent); font: inherit; font-weight: 700; cursor: pointer; }
      .disc-chips { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0 0 0.5rem; padding: 0; border: 0; min-inline-size: 0; }
      .disc-chip, .disc-clear { flex: 0 1 auto; display: inline-flex; align-items: center; min-height: 44px; padding: 0 0.95rem; border-radius: 999px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text-muted); font-size: 0.95rem; font-weight: 600; text-decoration: none; cursor: pointer; }
      .disc-chip.active { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
      .disc-chip.active::before { content: '\\2713'; margin-right: 0.35rem; }
      .disc-clear { color: var(--text); text-decoration: underline; }
      .disc-label { font-size: 0.85rem; font-weight: 600; color: var(--text-muted); padding: 0; margin: 0 0.25rem 0 0; align-self: center; }
      .disc-summary { font-size: 0.95rem; color: var(--text-muted); margin: 0 0 0.75rem; }`;

/** Place the shared stylesheet at its marker. A template without the marker is untouched. */
export function injectEventCardCss(html: string): string {
  return html.includes(EVENT_CARD_CSS_MARKER)
    ? injectMarker(html, EVENT_CARD_CSS_MARKER, EVENT_CARD_CSS)
    : html;
}

// ─── Injection ─────────────────────────────────────────────────────────────────

/** Where the list goes. Template opts in by carrying it. */
export const EVENT_LIST_MARKER = '<!--OCR_EVENT_LIST-->';
/** Where the sr-only count goes. */
export const EVENT_COUNT_MARKER = '<!--OCR_EVENT_COUNT-->';

/**
 * Place a rendered list into a surface's shell.
 *
 * Marker-based and opt-in, matching `injectLegalFooter`: a template without the
 * markers comes back byte-identical, so this cannot silently alter a surface
 * that never asked for a list. Both markers are replaced independently — a
 * template may carry the list without the count.
 */
export function injectEventList(html: string, list: RenderedEventList): string {
  let out = html;
  if (out.includes(EVENT_LIST_MARKER)) out = injectMarker(out, EVENT_LIST_MARKER, list.html);
  if (out.includes(EVENT_COUNT_MARKER))
    out = injectMarker(out, EVENT_COUNT_MARKER, escapeHtml(list.countText));
  return out;
}
