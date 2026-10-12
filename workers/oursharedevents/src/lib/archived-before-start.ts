// An archived event whose start has not come yet never happened: the organizer
// took it down before its day. The phase resolver (domain/event-phase) puts
// every archived event in post_event, which is right for the page's shape (no
// RSVP, no check-in) but not for its words: the recap would read "Happened"
// with a date still to come.
//
// "Has its start come?" is asked with the same rule every surface uses
// (eventPhaseOf, which reads starts_at for a timed event and local midnight in
// the event's zone for a date-only one), by asking what phase the event would
// be in if it were still live. An event with no usable start date is never
// counted as called off: there is no date to say it was before.

import { eventPhaseOf } from './event-enrich';

export function archivedBeforeStart(
  row: {
    status?: unknown;
    start_date?: unknown;
    end_date?: unknown;
    starts_at?: unknown;
    timezone?: unknown;
  },
  now?: Date
): boolean {
  const status = typeof row.status === 'string' ? row.status.toLowerCase().trim() : '';
  if (status !== 'archived') return false;
  return eventPhaseOf({ ...row, status: 'active' }, now) === 'pre_event';
}
