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
