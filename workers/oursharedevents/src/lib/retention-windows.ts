/**
 * Retention windows for identified form data, in days. One home for the numbers:
 * the form handler derives its expiry timestamps from them, and the admin
 * Settings page quotes them, so what the page says and what the code deletes
 * cannot drift apart. Changing one is a privacy decision, not a tuning knob.
 */

/**
 * A registration expires this long after it is made, or the day after its
 * event ends if that is later (registrationExpiresAt, OSE-826).
 */
export const REGISTRATION_TTL_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;
const EVENT_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * When a registration made at `now` for an event ending on `eventEnd` expires.
 *
 * Owner decision 2026-11-13 (OSE-826): the later of
 *   - REGISTRATION_TTL_DAYS after the person registers, and
 *   - the end of the day after the event ends (UTC), that is, midnight UTC
 *     two days after the event's date.
 * Before, only the first held, so a person who registered more than 90 days
 * ahead was deleted before the event and arrived unregistered.
 *
 * `eventEnd` is the event's `COALESCE(end_date, start_date)`: a `YYYY-MM-DD`
 * date, optionally followed by a time. With no date, or one that is not a real
 * calendar date, the 90 days alone apply, as before. The day after the event
 * matches the nightly contact clear, which keeps a name and email until the
 * event's date is older than yesterday.
 */
export function registrationExpiresAt(now: Date, eventEnd: string | null | undefined): string {
  const byTtl = now.getTime() + REGISTRATION_TTL_DAYS * DAY_MS;
  // null and undefined read as 'null' and 'undefined': not a date.
  const m = EVENT_DATE.exec(String(eventEnd));
  if (!m) return new Date(byTtl).toISOString();
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const eventDay = new Date(Date.UTC(y, mo - 1, d));
  // A date like 2026-02-30 rolls over in Date.UTC; it is not a real date. The
  // month alone tells: a month outside 01 to 12 never matches, and a day of 00,
  // or past the month's end (two digits, so at most 99), lands in another
  // month. The year needs no check: Date.UTC reads years 0 to 99 as 1900 to
  // 1999, long past, where the 90 days are later anyway.
  if (eventDay.getUTCMonth() !== mo - 1) {
    return new Date(byTtl).toISOString();
  }
  const afterEvent = eventDay.getTime() + 2 * DAY_MS;
  return new Date(Math.max(byTtl, afterEvent)).toISOString();
}

/** An email sign-up is deleted this long after it is made. */
export const EMAIL_RETENTION_DAYS = 30;

/**
 * A landing-page email-list row (`subscribers`, FORMS_DB) is deleted this long
 * after it is made, unless SUBSCRIBERS_RETENTION_DAYS sets a shorter or longer
 * window. Owner decision 2026-10-11: 90 days, like registrations; it was 365
 * while the table sat in the main DB.
 */
export const SUBSCRIBER_RETENTION_DAYS = 90;

/**
 * The longest any forms-database table may keep a person's data, in days
 * (owner decision 2026-10-11). tests/forms-retention-ceiling.spec.ts holds
 * every FORMS_DB table to it.
 */
export const FORMS_RETENTION_CEILING_DAYS = 90;
