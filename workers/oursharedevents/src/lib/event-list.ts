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

/**
 * Render the public event list.
 *
 * Accepts the same shape `GET /api/v2/events` emits (post-`enrichWithPhase`),
 * so the server-rendered page and the JSON API cannot describe different
 * events. An empty or non-array input renders the empty state rather than
 * throwing — a discovery surface that 500s because there is nothing to
 * discover is the worst possible answer to the question it exists to answer.
 */
export function renderEventList(
  items: readonly EventListItem[] | null | undefined
): RenderedEventList {
  if (!Array.isArray(items) || items.length === 0) return renderEmptyEventList();

  // OSE-1201: the list said "Upcoming" and offered Register on an event whose
  // own page said it was a wrap. `phase` is authoritative; the count reads it.
  const upcoming = items.filter((e) => e.phase !== 'post_event').length;
  const countText = `${upcoming} upcoming event${upcoming === 1 ? '' : 's'}`;

  const html = items
    .map((e) => {
      const safeId = escapeHtml(str(e.id));
      // OSE-871 (P-1): ONE canonical name per value. The API emits
      // name/startDateISO/venue; no `|| e.title` dual-reads here.
      const rawName = str(e.name);
      const safeName = escapeHtml(rawName);
      const encodedName = encodeURIComponent(rawName);
      const isoRaw = str(e.startDateISO);
      const dateStr = isoRaw ? escapeHtml(formatEventDate(isoRaw, str(e.timezone) || null)) : '';
      const venueStr = e.venue ? escapeHtml(str(e.venue)) : '';
      const datePart = dateStr ? `<span data-testid="public-event-date">${dateStr}</span>` : '';
      const venuePart = venueStr
        ? ` &middot; <span data-testid="public-event-venue">${venueStr}</span>`
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
      return `
          <article class="event-card" data-testid="public-event-card" data-event-id="${safeId}" data-phase="${phase}">
            <a class="event-card-link" href="${eventHref}" data-testid="public-event-card-link" aria-label="Open ${safeName} public page"></a>
            <div class="event-info" data-testid="public-event-info">
              <h3 data-testid="public-event-name">${safeName}${wrappedTag}</h3>
              <p class="meta" data-testid="public-event-meta">${datePart}${venuePart}</p>
            </div>
            ${cta}
          </article>`;
    })
    .join('');

  return { html, countText, upcoming };
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
