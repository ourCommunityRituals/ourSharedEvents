/**
 * Retention windows for identified form data, in days. One home for the numbers:
 * the form handler derives its expiry timestamps from them, and the admin
 * Settings page quotes them, so what the page says and what the code deletes
 * cannot drift apart. Changing one is a privacy decision, not a tuning knob.
 */

/** A registration expires this long after it is made (the poster says the same). */
export const REGISTRATION_TTL_DAYS = 90;

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
