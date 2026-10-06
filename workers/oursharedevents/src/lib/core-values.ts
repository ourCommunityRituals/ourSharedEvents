/**
 * OSE-1560 — an event's core values at publish.
 *
 * A draft still needs only a title. An event cannot leave draft (or come back
 * from archived) without a start time and an event type. QR is already tied to
 * going live (`active ⟺ qr_verified`), and the map never blocks, so neither is
 * checked here.
 *
 * One function, two doors: `PUT /admin/events/:id` with `status`, and
 * verify-qr. Both call `coreValuesMissing` so the rule cannot drift.
 */

export type CoreValue = 'time' | 'event_type';

/** The states an event is "past draft" in; moving INTO one of these is a publish step. */
const PUBLISH_TARGETS = new Set(['ready', 'active']);
/** The states an event may be moved to a publish target FROM and still owe its core values. */
const NOT_YET_PUBLISHED = new Set(['draft', 'archived']);

export interface StoredCoreValues {
  starts_at: string | null;
  event_type_id: string | null;
}

/** What the same request is changing (a PUT body), if anything. */
export interface IncomingCoreValues {
  /** `start_time` key present: a non-empty string sets a time, null/'' clears it. */
  start_time?: unknown;
  event_type_id?: unknown;
}

/** True when moving `from` → `to` is a step that must satisfy the core values. */
export function isPublishStep(from: string, to: string): boolean {
  return NOT_YET_PUBLISHED.has(from) && PUBLISH_TARGETS.has(to);
}

function hasText(v: unknown): boolean {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * The core values still missing once the incoming fields (if any) are applied
 * over what is stored. A request that sets the time and the type AND moves the
 * status in one call is allowed: the check reads the result, not the old row.
 */
export function coreValuesMissing(
  stored: StoredCoreValues,
  incoming: IncomingCoreValues = {}
): CoreValue[] {
  const missing: CoreValue[] = [];

  const timeTouched = 'start_time' in incoming;
  const hasTime = timeTouched ? hasText(incoming.start_time) : hasText(stored.starts_at);
  if (!hasTime) missing.push('time');

  const typeTouched = 'event_type_id' in incoming;
  const hasType = typeTouched ? hasText(incoming.event_type_id) : hasText(stored.event_type_id);
  if (!hasType) missing.push('event_type');

  return missing;
}

/** Which door refused: `PUT /admin/events/:id` with `status`, or verify-qr. */
export type CoreValuesDoor = 'put_status' | 'verify_qr';

/**
 * One structured line per refused publish step (OSE-1644), so refusals can be
 * counted by which value was missing. It names the door, the move and the
 * missing values, and nothing about the event: no id, no title, no actor. The
 * key set is sealed by tests/core-values-refused-log.spec.ts.
 */
export function logCoreValuesRefused(
  door: CoreValuesDoor,
  from: string,
  to: string,
  missing: CoreValue[]
): void {
  console.log(
    JSON.stringify({
      type: 'LIFECYCLE',
      event: 'core_values_refused',
      door,
      from,
      to,
      missing_time: missing.includes('time'),
      missing_event_type: missing.includes('event_type'),
    })
  );
}

/** The 409 body both doors return. */
export function coreValuesRefusal(missing: CoreValue[], requestId?: string) {
  return {
    ok: false,
    status: 409,
    code: 'CORE_VALUES_MISSING',
    missing,
    error: `Add ${missing.map((m) => (m === 'event_type' ? 'an event type' : 'a start time')).join(' and ')} before this event goes further`,
    ...(requestId ? { requestId } : {}),
  };
}
