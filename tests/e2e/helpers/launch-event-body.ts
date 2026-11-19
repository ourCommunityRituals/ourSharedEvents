/**
 * OSE-2152 — the body a launch-smoke create sends.
 *
 * Creating an event past draft owes a start time and an event type
 * (OSE-2036, 409 CORE_VALUES_MISSING). A draft owes neither. The builder
 * refuses to make a non-draft body without an event type, so a spec that
 * forgets one fails here, loudly, instead of as a bare 409 on staging.
 */

export interface LaunchEventBodyInput {
  status: 'draft' | 'active';
  isPublished: boolean;
  suffix: string;
  runId: string;
  /** Required unless status is 'draft'. */
  eventTypeId?: string;
}

export function launchEventBody(input: LaunchEventBodyInput): Record<string, unknown> {
  const { status, isPublished, suffix, runId, eventTypeId } = input;
  if (status !== 'draft' && !eventTypeId) {
    throw new Error(
      `launch smoke create "${suffix}" is ${status}: it needs an event_type_id (OSE-2036, CORE_VALUES_MISSING)`
    );
  }
  return {
    brand_id: 'root',
    attendance_mode: 'in_person',
    title: `Launch Smoke ${suffix} ${runId}`,
    slug: `launch-smoke-${suffix}-${runId}`,
    status,
    is_published: isPublished,
    description: `Temporary launch-story smoke event ${suffix}.`,
    location: 'Launch Smoke Hall',
    start_date: '2099-02-01',
    start_time: '18:00',
    end_date: '2099-02-02',
    timezone: 'America/Chicago',
    ...(eventTypeId ? { event_type_id: eventTypeId } : {}),
  };
}
