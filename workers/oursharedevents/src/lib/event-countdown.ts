/**
 * Pre-event countdown on the public event page ("Starts in 5 hours").
 *
 * The labelled date line (`event-when`, in the EVENT's zone with its
 * abbreviation) stays the authority on when the event is. This is a short,
 * human-relative line under it, shown only before the event starts:
 *
 *  - Timed event (`starts_at`): "Starts in 20 minutes", "Starts in 5 hours",
 *    then whole calendar days in the event's zone ("Starts tomorrow",
 *    "Starts in 3 days"). Under a minute: "Starting now".
 *  - Date-only event: whole calendar days in the event's zone, never hours —
 *    a date-only event has no start time to count down to.
 *  - Past, today (date-only), no usable date, or more than
 *    COUNTDOWN_MAX_DAYS away: null, and the page shows no countdown.
 *
 * Day counts compare local calendar dates in the zone (not elapsed ms / 24h),
 * so a DST change between now and the start never moves the count by a day.
 *
 * The server text is correct at render time, so the page works without
 * JavaScript. COUNTDOWN_CLIENT_SCRIPT re-computes the same text in the browser
 * once on load and then every minute. It never changes the page's phase: when
 * the start arrives it reads "Starting now" (timed) or "Starts today"
 * (date-only) and stays there until the page is loaded again. The node spec
 * checks the browser text against countdownText at the same instants.
 */

import { escapeHtml } from './html-escape';
import { isValidIanaTimezone, PLATFORM_HOME_TZ, zonedDatePart } from './event-datetime';

/** Beyond this many days the date line says enough; no countdown is shown. */
export const COUNTDOWN_MAX_DAYS = 30;

const DAY_MS = 86_400_000;
const DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}(?=$|[T ])/;

export interface CountdownRow {
  start_date: string | null;
  starts_at?: string | null;
  timezone: string | null;
}

interface CountdownTarget {
  /** Canonical UTC instant of a timed event, else null. */
  startsAt: string | null;
  /** Local calendar day ("YYYY-MM-DD") of a date-only event, else null. */
  startDay: string | null;
  /** The zone the days are counted in. */
  zone: string;
}

/** Day number (days since the epoch) of a "YYYY-MM-DD" calendar date. */
function dayNumber(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** Day number of the local calendar date of `instant` in `zone`. */
function localDayNumber(instant: Date, zone: string): number {
  return dayNumber(zonedDatePart(instant.toISOString(), zone));
}

function daysText(days: number): string {
  return days === 1 ? 'Starts tomorrow' : `Starts in ${days} days`;
}

function countdownTarget(row: CountdownRow): CountdownTarget | null {
  // Same split as phaseTimesFor: an unreadable starts_at means a date-only event.
  if (row.starts_at && !Number.isNaN(new Date(row.starts_at).getTime())) {
    // The date line falls back to UTC for a timed event with no usable zone.
    const zone = isValidIanaTimezone(row.timezone) ? (row.timezone as string) : 'UTC';
    return { startsAt: new Date(row.starts_at).toISOString(), startDay: null, zone };
  }
  const day = row.start_date ? DATE_PREFIX_RE.exec(row.start_date.trim())?.[0] : undefined;
  if (!day || Number.isNaN(dayNumber(day))) return null;
  // A date-only event's day is read in PLATFORM_HOME_TZ when it has no usable zone.
  const zone = isValidIanaTimezone(row.timezone) ? (row.timezone as string) : PLATFORM_HOME_TZ;
  return { startsAt: null, startDay: day, zone };
}

function textFor(target: CountdownTarget, now: Date): string | null {
  if (target.startsAt) {
    const start = new Date(target.startsAt);
    const ms = start.getTime() - now.getTime();
    if (ms <= 0) return null;
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 1) return 'Starting now';
    if (minutes < 60) return `Starts in ${minutes} minute${minutes === 1 ? '' : 's'}`;
    const hours = Math.floor(minutes / 60);
    const days = localDayNumber(start, target.zone) - localDayNumber(now, target.zone);
    // A 25-hour fall-back day can put 24h+ on the same calendar day: keep hours.
    if (hours < 24 || days < 1) return `Starts in ${hours} hour${hours === 1 ? '' : 's'}`;
    return days > COUNTDOWN_MAX_DAYS ? null : daysText(days);
  }
  const days = dayNumber(target.startDay as string) - localDayNumber(now, target.zone);
  if (days < 1 || days > COUNTDOWN_MAX_DAYS) return null;
  return daysText(days);
}

/**
 * The countdown line for an event at `now`, or null when none is shown.
 * Pure: Intl + Date only.
 */
export function countdownText(row: CountdownRow, now: Date = new Date()): string | null {
  const target = countdownTarget(row);
  return target ? textFor(target, now) : null;
}

/**
 * Runs in the browser. Reads the countdown element's data attributes and
 * rewrites its text once on load and then every minute. It mirrors textFor
 * above, except that at or after the start it says "Starting now" (timed) or
 * "Starts today" (date-only) instead of removing the line, and it never
 * reloads the page or switches it to the live view. ES5, no handlers in markup.
 */
export const COUNTDOWN_CLIENT_SCRIPT = `(function(){var el=document.querySelector('[data-testid="event-countdown"]');if(!el)return;var at=el.getAttribute('data-starts-at'),day=el.getAttribute('data-start-day'),tz=el.getAttribute('data-tz')||'UTC',D=864e5,MAX=${COUNTDOWN_MAX_DAYS};function ymd(s){var p=s.split('-');return Date.UTC(+p[0],+p[1]-1,+p[2])/D;}function local(ms){var m={};new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms)).forEach(function(x){m[x.type]=x.value;});return ymd(m.year+'-'+m.month+'-'+m.day);}function days(n){return n===1?'Starts tomorrow':'Starts in '+n+' days';}function text(){var now=Date.now(),n;if(at){var start=Date.parse(at),ms=start-now;if(!(ms>=60000))return 'Starting now';var min=Math.floor(ms/60000);if(min<60)return 'Starts in '+min+(min===1?' minute':' minutes');var h=Math.floor(min/60);n=local(start)-local(now);if(h<24||n<1)return 'Starts in '+h+(h===1?' hour':' hours');return n>MAX?null:days(n);}if(!day)return null;n=ymd(day)-local(now);if(n<1)return 'Starts today';return n>MAX?null:days(n);}function tick(){try{var t=text();if(t&&el.textContent!==t)el.textContent=t;}catch(e){}}tick();setInterval(tick,60000);})();`;

/**
 * The countdown element and its script for the pre-event `event-when` line, or
 * empty strings when no countdown is shown. The element goes inside the when
 * line; the script goes after it. `aria-live="off"`: a screen reader is not
 * told every minute.
 */
export function renderEventCountdown(
  row: CountdownRow,
  nonce: string,
  now: Date = new Date()
): { html: string; script: string } {
  const target = countdownTarget(row);
  const text = target ? textFor(target, now) : null;
  if (!target || !text) return { html: '', script: '' };
  const when = target.startsAt
    ? `data-starts-at="${escapeHtml(target.startsAt)}"`
    : `data-start-day="${escapeHtml(target.startDay)}"`;
  return {
    html: `<small class="sub-line" data-testid="event-countdown" aria-live="off" ${when} data-tz="${escapeHtml(target.zone)}">${escapeHtml(text)}</small>`,
    script: `<script nonce="${escapeHtml(nonce)}">${COUNTDOWN_CLIENT_SCRIPT}</script>`,
  };
}
