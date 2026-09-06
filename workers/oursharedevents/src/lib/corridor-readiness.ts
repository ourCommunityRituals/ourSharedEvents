// ─── Corridor readiness — the customer surface's own gate ──────────────────────
//
// Ratified 2026-09-05, OCR_VISION.md §6.2b, CCR Loop 10.
//
//   The customer card leads when the FORWARD WINDOW IT WOULD OPEN ON holds at
//   least CORRIDOR_READY_MIN_EVENTS events in the reader's corridor.
//
// UNIT / GRAIN / DIRECTION, stated here because the last constant that governed
// this decision carried none of them and a governance artifact was ratified on
// a false reading of it (see CORRIDOR_BASELINE_MIN_SAMPLE in ./shared-report.ts
// and CCR Loop 9):
//
//   unit       events — countable, and supplied by the corner the
//              below-threshold page is actively recruiting
//   grain      the reader's corridor (H3 res7), whole — NOT a time-of-week cell
//   direction  FORWARD — now through +CORRIDOR_WINDOW_DAYS
//   purpose    which front-door card leads, and nothing else
//
// WHY THIS SHAPE AND NOT A DENSITY BASELINE. The property that matters is not
// the number, it is that THE THING COUNTED IS THE THING SHOWN. A trailing gate
// governing a forward surface can promote the customer card to first position
// on an empty map — the exact "reads as abandoned" failure §6.2b exists to
// prevent, arriving through the mechanism meant to prevent it. This gate cannot
// do that, by construction.
//
// It is also non-circular. A gate denominated in ATTENDEES could never be
// climbed out of: no map means fewer attendees means the map never opens. A
// reader looking at the below-threshold page can add an event; they cannot
// conjure attendees for a map that is not being shown to them.

/**
 * How far ahead the customer surface looks — both for what it DISPLAYS and for
 * what it COUNTS. These are deliberately the same number: the moment they
 * diverge, the gate stops being a question about what the reader will see.
 */
export const CORRIDOR_WINDOW_DAYS = 90;

/**
 * Events required in the forward window before the customer card leads.
 *
 * 5, ratified by the owner. Deliberately low: the below-threshold state is an
 * honest invitation, not a punishment, so the bar to leave it should be
 * reachable by one committed organiser over a season rather than a wall that
 * keeps a corridor asking for supply after it has supply. If it proves too low
 * the failure is visible and cheap — a thin map — and it is one number to move.
 */
export const CORRIDOR_READY_MIN_EVENTS = 5;

/** The phases a reader can still act on. `post_event` is not among them. */
const ATTENDABLE_PHASES = new Set(['pre_event', 'event']);

export interface WindowedEvent {
  startDateISO?: unknown;
  endDateISO?: unknown;
  phase?: unknown;
}

/**
 * Is this event inside the forward window the customer surface shows?
 *
 * Two independent conditions, and BOTH are required:
 *
 *   1. its phase is attendable — a wrapped event is never on the map, however
 *      recently it happened (owner spec, OSE-1242)
 *   2. its start is not beyond the horizon
 *
 * Phase is authoritative for the past edge rather than a date comparison,
 * because `computeEventPhase` already accounts for end_date and status — a
 * multi-day event that started yesterday is still `event`, and a date-only
 * check would drop it from the map while it is literally happening.
 */
export function isInForwardWindow(
  event: WindowedEvent,
  now: Date = new Date(),
  windowDays: number = CORRIDOR_WINDOW_DAYS
): boolean {
  if (typeof event.phase !== 'string' || !ATTENDABLE_PHASES.has(event.phase)) return false;

  const raw = event.startDateISO;
  // No start date means it cannot be placed in time. It is not shown: a pin a
  // reader cannot plan around is worse than no pin.
  if (typeof raw !== 'string' || raw === '') return false;
  const start = new Date(raw);
  if (Number.isNaN(start.getTime())) return false;

  const horizon = new Date(now.getTime() + windowDays * 86_400_000);
  return start.getTime() <= horizon.getTime();
}

/** The events a corridor's customer surface would actually show. */
export function eventsInWindow<T extends WindowedEvent>(
  events: readonly T[] | null | undefined,
  now: Date = new Date(),
  windowDays: number = CORRIDOR_WINDOW_DAYS
): T[] {
  if (!Array.isArray(events)) return [];
  return events.filter((e) => isInForwardWindow(e, now, windowDays));
}

/**
 * Has this corridor cleared the readiness bar?
 *
 * Takes the events, not a count, so the caller cannot pass a number derived
 * from a different window than the one the surface displays — which is exactly
 * the class of mistake this module exists to prevent.
 *
 * NOTE ON LATCHING: §6.2b requires that readiness, once cleared, STAYS cleared —
 * a rolling window would otherwise reorder a reader's front door between one
 * visit and the next. This function answers only "is the bar met right now".
 * The latch is persistent state and belongs to the caller that owns it; do not
 * approximate it by widening the window here.
 */
export function isCorridorReady<T extends WindowedEvent>(
  events: readonly T[] | null | undefined,
  now: Date = new Date(),
  minEvents: number = CORRIDOR_READY_MIN_EVENTS
): boolean {
  return eventsInWindow(events, now).length >= minEvents;
}
