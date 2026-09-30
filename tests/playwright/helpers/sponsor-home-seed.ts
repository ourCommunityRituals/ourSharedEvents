/**
 * Seed a sponsor with one placement on a LIVE event, and mint that sponsor's
 * home link — through the admin API only, the same doors an organizer uses:
 *
 *   POST /api/v2/admin/events                      → draft event
 *   PUT  /api/v2/admin/events/:id {status:ready}   → the state machine's edges,
 *   PUT  /api/v2/admin/events/:id {status:active}    never a jump (409 otherwise)
 *   POST /api/v2/admin/sponsors {event_id,tier}    → sponsor + organizer placement
 *   POST /api/v2/admin/sponsors/:id/home-link      → /sponsor?t=… (signed, 30d)
 *
 * No SQL, no fixtures: the local worker behind playwright.mobile.config.ts has
 * migrations applied and nothing else, so anything a spec needs it creates here.
 * Every name carries a run-unique suffix, so two seeds never collide and a
 * spec can assert on its own sponsor by name.
 */
import type { APIRequestContext } from '@playwright/test';

export interface SeededSponsorHome {
  eventId: string;
  eventTitle: string;
  sponsorId: string;
  sponsorName: string;
  placementId: string;
  /** Absolute URL as minted (origin of the request). */
  url: string;
  /** The `t` value alone. */
  token: string;
}

async function ok<T>(
  res: Awaited<ReturnType<APIRequestContext['post']>>,
  what: string
): Promise<T> {
  if (!res.ok()) throw new Error(`${what} failed: ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

/**
 * Create an event and walk it draft → ready → active through the admin API.
 * The default start (a month out) keeps it in pre_event: "Coming up" on the
 * sponsor page, sponsor strip on the public page, and discoverable by sponsors.
 */
export async function createLiveEvent(
  request: APIRequestContext,
  bearer: string,
  title: string,
  daysOut = 30,
  where?: { lat: number; lon: number }
): Promise<{ id: string }> {
  const headers = { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' };
  const start = new Date(Date.now() + daysOut * 86_400_000).toISOString().slice(0, 10);
  const ev = await ok<{ id: string }>(
    await request.post('/api/v2/admin/events', {
      headers,
      data: { title, start_date: start, location: 'Eagles Hall', ...(where ?? {}) },
    }),
    'create event'
  );
  for (const status of ['ready', 'active']) {
    await ok(
      await request.put(`/api/v2/admin/events/${encodeURIComponent(ev.id)}`, {
        headers,
        data: { status },
      }),
      `event -> ${status}`
    );
  }
  return ev;
}

export async function seedSponsorHome(
  request: APIRequestContext,
  bearer: string,
  label = 'E2E'
): Promise<SeededSponsorHome> {
  const headers = { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' };
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const eventTitle = `${label} sponsor night ${suffix}`;
  const sponsorName = `${label} Corner Bakery ${suffix}`;

  const ev = await createLiveEvent(request, bearer, eventTitle);

  const sp = await ok<{ id: string; placement_id: string | null }>(
    await request.post('/api/v2/admin/sponsors', {
      headers,
      data: { name: sponsorName, tier: 'gold', event_id: ev.id },
    }),
    'create sponsor'
  );
  if (!sp.placement_id) throw new Error('create sponsor returned no placement_id');

  const link = await ok<{ url: string }>(
    await request.post(`/api/v2/admin/sponsors/${encodeURIComponent(sp.id)}/home-link`, {
      headers,
      data: {},
    }),
    'mint sponsor home link'
  );
  const token = new URL(link.url).searchParams.get('t') ?? '';
  if (!token) throw new Error(`minted link carried no token: ${link.url}`);

  return {
    eventId: ev.id,
    eventTitle,
    sponsorId: sp.id,
    sponsorName,
    placementId: sp.placement_id,
    url: link.url,
    token,
  };
}

/**
 * A sponsor that is ON SHOW — for the public card (GET /sponsors/:id, migration
 * 0083), which renders only a sponsor with an active, accepted placement.
 * Accepts through the sponsor's own respond endpoint with its minted token —
 * the same door a real sponsor uses — so no row is written behind the API.
 */
export async function seedSponsorCard(
  request: APIRequestContext,
  bearer: string,
  label = 'Card'
): Promise<SeededSponsorHome> {
  const seeded = await seedSponsorHome(request, bearer, label);
  await ok(
    await request.post(
      `/api/v2/sponsor/placements/${encodeURIComponent(seeded.placementId)}/respond`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: { token: seeded.token, accepted: true },
      }
    ),
    'sponsor accepts placement'
  );
  // The audit measures whatever page comes back, and a 404 would measure fine —
  // so prove it is the card before handing the id over.
  const card = await request.get(`/sponsors/${encodeURIComponent(seeded.sponsorId)}`);
  if (card.status() !== 200) {
    throw new Error(`sponsor card for ${seeded.sponsorId} returned ${card.status()}, not the card`);
  }
  return seeded;
}
