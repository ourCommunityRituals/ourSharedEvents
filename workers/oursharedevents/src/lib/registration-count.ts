/**
 * Which registrations a published count counts: confirmed, and not past their
 * retention date (OSE-1656).
 *
 * One definition, used by every count of an event's registrations: the forms
 * list total, `/stats`, the event dashboard, the portfolio strip and the public
 * recap. Each of those is floored on its own (`lib/count-floor.ts`), and two
 * figures for the same event with different filters can be subtracted: with 8
 * rows of which 6 are counted, a reader of "8" and "6" learns that 2 are not
 * (expired and waiting for the nightly purge, or not confirmed). A group of 2
 * is under the floor. With one definition there is nothing to subtract.
 *
 * A fixed SQL fragment, with no input in it. It goes into a WHERE clause on
 * `form_registrations`.
 */
export const COUNTED_REGISTRATION_SQL =
  "status = 'confirmed' AND (expires_at IS NULL OR expires_at > datetime('now'))";

/**
 * The count for one event: one `?`, the event id; one column, `cnt`. Whole, so
 * a handler passes it to `.prepare()` as it is and builds no SQL of its own
 * (the forms handler may not interpolate into a statement:
 * `tests/red-team/api-authz.spec.ts`, `form-security-deep.spec.ts`).
 */
export const COUNT_EVENT_REGISTRATIONS_SQL = `SELECT COUNT(*) AS cnt FROM form_registrations WHERE event_id = ? AND ${COUNTED_REGISTRATION_SQL}`;
