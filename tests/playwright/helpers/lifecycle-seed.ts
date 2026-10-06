/**
 * One listed event in each lifecycle phase, for the phone audit.
 *
 * A phone is the first screen for the event page, the poster and the
 * SharedReport, through the pre-event, event and post-event flows (PO,
 * 2026-10-06). The audit measured one event page at a fixed id, and accepted
 * the not-found screen when that id was not seeded. This seeds a real event
 * before, during and after, plus a signed SharedReport link, through the admin
 * API only: no row is written behind the Worker.
 *
 * Every id is checked before it is handed over. The audit measures whatever
 * page comes back, and a not-found page measures fine.
 */
import type { APIRequestContext } from '@playwright/test';

export type AuditPhase = 'pre_event' | 'event' | 'post_event';

export interface SeededLifecycle {
  pre: string;
  live: string;
  post: string;
  /** `/sharedReport?eventId=…&token=…` for the post-event event. */
  reportPath: string;
}

const ZONE = 'America/Chicago';

/** The calendar day in the event's zone, `daysOut` days from now (YYYY-MM-DD). */
function zoneDay(daysOut: number): string {
  const at = new Date(Date.now() + daysOut * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

async function ok<T>(res: Awaited<ReturnType<APIRequestContext['get']>>, what: string): Promise<T> {
  if (!res.ok()) throw new Error(`${what} failed: ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

/**
 * Create an event and take it live, dated so the Worker puts it in `phase`.
 * The day is the event zone's own day and the start is midnight, so "today" is
 * the event phase at any hour the audit runs. A past event carries an end date:
 * without one the Worker keeps an active event in the event phase for good.
 */
async function createEventInPhase(
  request: APIRequestContext,
  bearer: string,
  title: string,
  phase: AuditPhase
): Promise<string> {
  const headers = { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' };
  const day = zoneDay(phase === 'pre_event' ? 30 : phase === 'event' ? 0 : -7);

  const catalog = await ok<{ categories: { types: { id: string }[] }[] }>(
    await request.get('/api/v2/admin/event-types', { headers }),
    'event types'
  );
  const eventTypeId = catalog.categories[0]?.types[0]?.id;

  const ev = await ok<{ id: string }>(
    await request.post('/api/v2/admin/events', {
      headers,
      data: {
        title,
        start_date: day,
        end_date: day,
        start_time: '00:00',
        timezone: ZONE,
        location: 'Eagles Hall',
        description: 'Seeded for the phone audit.',
        event_type_id: eventTypeId,
        is_published: true,
      },
    }),
    `create ${phase} event`
  );
  for (const status of ['ready', 'active']) {
    await ok(
      await request.put(`/api/v2/admin/events/${encodeURIComponent(ev.id)}`, {
        headers,
        data: { status },
      }),
      `${phase} event -> ${status}`
    );
  }

  const read = await ok<{ item?: { phase?: string } }>(
    await request.get(`/api/v2/events/${encodeURIComponent(ev.id)}`),
    `read ${phase} event`
  );
  if (read.item?.phase !== phase) {
    throw new Error(`seeded ${phase} event ${ev.id} is in phase "${read.item?.phase}"`);
  }
  const page = await request.get(`/events/${encodeURIComponent(ev.id)}`);
  if (page.status() !== 200) {
    throw new Error(`event page for the ${phase} event returned ${page.status()}`);
  }
  return ev.id;
}

export async function seedLifecycle(
  request: APIRequestContext,
  bearer: string
): Promise<SeededLifecycle> {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const pre = await createEventInPhase(request, bearer, `Audit before ${suffix}`, 'pre_event');
  const live = await createEventInPhase(request, bearer, `Audit during ${suffix}`, 'event');
  const post = await createEventInPhase(request, bearer, `Audit after ${suffix}`, 'post_event');

  const poster = await request.get(`/poster?event=${encodeURIComponent(pre)}`);
  if (poster.status() !== 200) throw new Error(`poster for ${pre} returned ${poster.status()}`);

  const headers = { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' };
  // Shared reports are a plan feature and off by default; the report journeys
  // switch it on the same way. With it off the signed link answers 403.
  await ok(
    await request.put('/api/v2/admin/flags/analytics.shared-report', {
      headers,
      data: { enabled: true },
    }),
    'switch shared reports on'
  );
  const minted = await ok<{ token?: string; url?: string }>(
    await request.post(`/api/v2/admin/events/${encodeURIComponent(post)}/shared-report/mint-link`, {
      headers,
      data: { role: 'admin', ttl_days: 7 },
    }),
    'mint SharedReport link'
  );
  const token =
    minted.token ?? (minted.url ? new URL(minted.url, 'http://x').searchParams.get('token') : '');
  if (!token) throw new Error('minted SharedReport link carried no token');
  const reportPath = `/sharedReport?eventId=${encodeURIComponent(post)}&token=${encodeURIComponent(token)}`;
  const report = await request.get(reportPath);
  if (report.status() !== 200) throw new Error(`signed SharedReport returned ${report.status()}`);

  return { pre, live, post, reportPath };
}
