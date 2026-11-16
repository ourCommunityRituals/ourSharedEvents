/**
 * Launch Story Smoke — public/admin/poster launch contracts (PR #645).
 *
 * This T4 slice exists so the launch stories are visible in the CI pyramid instead
 * of only being protected by lower-level Worker specs. It is intentionally narrow:
 * one public discovery/event-page smoke and one admin draft-preview → go-live
 * smoke. Deep shape assertions live in the T0 launch-contracts shard.
 */

import { test, expect } from '@playwright/test';
import { edgeChallenged, edgeHeaders, noteEdgeChallenge } from '../../../scripts/ci/edge-read.mjs';
import { noteIfEdgeAnswered, passStgEdge } from '../helpers/stg-edge';

const BASE_URL = process.env.BASE_URL || 'https://stg.oursharedevents.com';
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.X_OCR_INTERNAL || '';
const X_OCR_INTERNAL = process.env.X_OCR_INTERNAL || '';
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID || '';
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || '';
const REQUIRE_PRECONDITIONS = process.env.PW_REQUIRE_PRECONDITIONS === '1';
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function precondition(unmet: boolean, message: string): void {
  if (unmet && REQUIRE_PRECONDITIONS) {
    throw new Error(`precondition unmet in a blocking job: ${message}`);
  }
  test.skip(unmet, message);
}

function adminHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ADMIN_KEY}`,
  };
  if (X_OCR_INTERNAL) headers['X-OCR-Internal'] = X_OCR_INTERNAL;
  if (CF_ACCESS_CLIENT_ID) headers['CF-Access-Client-Id'] = CF_ACCESS_CLIENT_ID;
  if (CF_ACCESS_CLIENT_SECRET) headers['CF-Access-Client-Secret'] = CF_ACCESS_CLIENT_SECRET;
  return headers;
}

async function adminFetch(
  request: any,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  opts: { allowHtml?: boolean } = {}
) {
  const resp = await request.fetch(`${BASE_URL}${path}`, {
    method,
    headers: adminHeaders(),
    data: body,
    timeout: 30_000,
  });
  const contentType = resp.headers()['content-type'] || '';
  if (contentType.includes('text/html') && !opts.allowHtml) {
    throw new Error(
      `CF Access returned HTML for ${method} ${path}; launch smoke did not reach the Worker`
    );
  }
  return resp;
}

async function createEvent(
  request: any,
  status: 'draft' | 'active',
  isPublished: boolean,
  suffix: string
): Promise<string> {
  const resp = await adminFetch(request, 'POST', '/api/v2/admin/events', {
    brand_id: 'root',
    attendance_mode: 'in_person',
    title: `Launch Smoke ${suffix} ${RUN_ID}`,
    slug: `launch-smoke-${suffix}-${RUN_ID}`,
    status,
    is_published: isPublished,
    description: `Temporary launch-story smoke event ${suffix}.`,
    location: 'Launch Smoke Hall',
    start_date: '2099-02-01',
    end_date: '2099-02-02',
    timezone: 'America/Chicago',
  });
  expect(resp.status(), `create ${suffix} event`).toBe(201);
  const json = await resp.json();
  expect(json.id).toBeTruthy();
  return json.id;
}

/** OSE-1560: leaving draft needs an event type; read one from the live catalog. */
async function anyEventTypeId(request: any): Promise<string> {
  const resp = await adminFetch(request, 'GET', '/api/v2/admin/event-types');
  expect(resp.status(), 'event type catalog').toBe(200);
  const json = await resp.json();
  const id = json.categories?.[0]?.types?.[0]?.id;
  expect(id, 'catalog has a type').toBeTruthy();
  return id;
}

async function createPosterDeployment(
  request: any,
  eventId: string,
  suffix: string
): Promise<{ id: string; qrToken: string }> {
  const resp = await adminFetch(
    request,
    'POST',
    `/api/v2/admin/events/${encodeURIComponent(eventId)}/poster-deployments`,
    {
      placement_label: `Launch Smoke Poster ${suffix} ${RUN_ID}`,
      location_desc: 'Launch smoke verification',
      is_active: true,
    }
  );
  expect(resp.status(), 'create poster deployment').toBe(201);
  const json = await resp.json();
  expect(json.id).toBeTruthy();
  expect(json.qr_token).toBeTruthy();
  return { id: json.id, qrToken: json.qr_token };
}

async function deleteEvent(request: any, eventId: string | null): Promise<void> {
  if (!eventId) return;
  try {
    await adminFetch(request, 'DELETE', `/api/v2/admin/events/${encodeURIComponent(eventId)}`);
  } catch {
    // Cleanup is best-effort; slugs are per-run unique and dates are 2099.
  }
}

async function deletePosterDeployment(request: any, deploymentId: string | null): Promise<void> {
  if (!deploymentId) return;
  try {
    await adminFetch(
      request,
      'DELETE',
      `/api/v2/admin/poster-deployments/${encodeURIComponent(deploymentId)}`
    );
  } catch {
    // Cleanup is best-effort; this smoke spec only reads redirect behaviour.
  }
}

test.describe('Launch story smoke — PR #645 public/admin surfaces', () => {
  let publicEventId: string | null = null;
  let draftEventId: string | null = null;
  let posterDeploymentId: string | null = null;

  test.beforeAll(() => {
    precondition(!ADMIN_KEY, 'ADMIN_KEY or X_OCR_INTERNAL is required');
  });

  test.afterEach(async ({ request }) => {
    await deletePosterDeployment(request, posterDeploymentId);
    await deleteEvent(request, publicEventId);
    await deleteEvent(request, draftEventId);
    posterDeploymentId = null;
    publicEventId = null;
    draftEventId = null;
  });

  test('public list card opens the event page with Share and Add to calendar actions', async ({
    page,
    request,
  }) => {
    publicEventId = await createEvent(request, 'active', true, 'public');

    // From a GitHub runner the stg edge can challenge a read of /events/<id>…
    // unless it carries X-OCR-CI, and a page navigation sends none by itself. So
    // the page sends it, to the site's own origin only (OSE-2022).
    await passStgEdge(page);
    await page.goto(`${BASE_URL}/events`, { waitUntil: 'domcontentloaded' });
    // OSE-1684: the card links to the readable address /events/<id>/<slug>.
    // createEvent's slug is lowercase words and dashes, so it is used as is.
    const readablePath = `/events/${publicEventId}/launch-smoke-public-${RUN_ID}`;
    const cardLink = page.locator(`[data-testid="public-event-card-link"][href="${readablePath}"]`);
    await expect(cardLink, 'public event card links to its public event page').toHaveCount(1);

    const eventPage = await page.goto(`${BASE_URL}${readablePath}`, {
      waitUntil: 'domcontentloaded',
    });
    // An answer from the edge is not the Worker's, and not a silent pass: it is a
    // GitHub warning and a summary line, and it fails the test when
    // CALENDAR_EDGE_STRICT is 1 (tests/e2e/helpers/stg-edge.ts). Any other answer
    // is the Worker's own, and only 200 will do: a 403 the Worker wrote fails.
    const challenged = await noteIfEdgeAnswered(eventPage, readablePath);
    if (challenged) {
      test.info().annotations.push({ type: 'edge-challenge', description: challenged });
      return;
    }
    expect(eventPage?.status(), `the Worker answers ${readablePath}`).toBe(200);
    await expect(page.locator('[data-testid="event-actions"]')).toBeVisible();
    await expect(page.locator('[data-testid="share-btn"]')).toBeVisible();
    // OSE-1358 made "Add to calendar" a <details> menu: open it, then the
    // .ics download is the option that carries the calendar href.
    await expect(page.locator('[data-testid="add-to-calendar"]')).toBeVisible();
    await page.locator('[data-testid="add-to-calendar-summary"]').click();
    await expect(
      page.locator(
        `[data-testid="add-to-calendar-ics"][href="/events/${publicEventId}/calendar.ics"]`
      )
    ).toBeVisible();
    // OSE-2045: a listed event also offers its brand's feed, online
    // calendars first, then Apple, then the .ics address.
    await page.locator('[data-testid="subscribe-calendar-summary"]').click();
    const subscribeOptions = page.locator(
      '[data-testid="subscribe-calendar"] a[data-testid^="subscribe-calendar-"]'
    );
    await expect(subscribeOptions).toHaveCount(4);
    expect(
      await subscribeOptions.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
    ).toEqual([
      'subscribe-calendar-google',
      'subscribe-calendar-outlook',
      'subscribe-calendar-apple',
      'subscribe-calendar-ics',
    ]);
    await expect(page.locator('[data-testid="subscribe-calendar-ics"]')).toHaveAttribute(
      'href',
      `${BASE_URL}/brands/root/calendar.ics`
    );
    // Say so in the log: without this line a run that reached the page and a
    // run the edge blocked print the same thing (found reading run 43563260636).
    console.log(`OSE-2045: Subscribe menu checked on the event page ${readablePath}`);
  });

  test('admin draft preview uses the public renderer and can go live to the public page', async ({
    page,
    request,
  }) => {
    draftEventId = await createEvent(request, 'draft', false, 'draft');
    await passStgEdge(page);

    const preview = await adminFetch(
      request,
      'GET',
      `/api/v2/admin/events/${encodeURIComponent(draftEventId)}/preview`,
      undefined,
      { allowHtml: true }
    );
    expect(preview.status(), 'draft preview route').toBe(200);
    const previewHtml = await preview.text();
    expect(previewHtml).toContain('data-testid="admin-draft-preview-toolbar"');
    expect(previewHtml).toContain('data-testid="admin-preview-go-live"');
    expect(previewHtml).toContain('data-testid="event-title"');

    const draftPublic = await page.goto(`${BASE_URL}/events/${draftEventId}`, {
      waitUntil: 'domcontentloaded',
    });
    expect(draftPublic?.status(), 'draft is not public before go-live').toBe(404);
    expect(page.url()).toContain(`/events/${draftEventId}`);
    expect(await page.locator('body').textContent()).toContain("couldn't find");

    const ready = await adminFetch(
      request,
      'PUT',
      `/api/v2/admin/events/${encodeURIComponent(draftEventId)}`,
      {
        status: 'ready',
        is_published: true,
        start_time: '18:00',
        event_type_id: await anyEventTypeId(request),
      }
    );
    expect(ready.status(), 'preview go-live publishes readiness').toBe(200);
    const verify = await adminFetch(
      request,
      'POST',
      `/api/v2/admin/events/${encodeURIComponent(draftEventId)}/verify-qr`
    );
    expect(verify.status(), 'preview go-live verifies QR and activates').toBe(200);

    const live = await page.goto(`${BASE_URL}/events/${draftEventId}`, {
      waitUntil: 'domcontentloaded',
    });
    // The same rule as the public list card test: the edge's answer is noted,
    // never passed over, and the Worker's own answer must be 200.
    const livePath = `/events/${draftEventId}`;
    const challenged = await noteIfEdgeAnswered(live, livePath);
    if (challenged) {
      test.info().annotations.push({ type: 'edge-challenge', description: challenged });
      return;
    }
    expect(live?.status(), `the Worker answers ${livePath} after go-live`).toBe(200);
    await expect(page.locator('[data-testid="event-title"]')).toContainText('Launch Smoke draft');
  });

  // OSE-2013: the brand calendar feed on the deployed Worker. The same four
  // checks as the workers-pool spec (tests/brand-calendar-feed.spec.ts), on real
  // rows: the public event is in its brand's feed, the draft is not, another
  // brand's feed never carries it, and no cookie is set.
  test('brand calendar feed lists the public event, not the draft, not for another brand (OSE-2013)', async ({
    request,
  }) => {
    publicEventId = await createEvent(request, 'active', true, 'feed-public');
    draftEventId = await createEvent(request, 'draft', false, 'feed-draft');

    // The Cloudflare edge can challenge a non-browser read before the Worker
    // runs (403 with cf-mitigated, OSE-939). The read sends X-OCR-CI, which the
    // stg skip rule lets through. A challenge is still not a pass: it is written
    // as a GitHub warning and a summary line, and with CALENDAR_EDGE_STRICT=1 it
    // fails the test (scripts/ci/edge-read.mjs, OSE-2022).
    // These two reads pass edgeHeaders() themselves, so the header went out
    // exactly when the token is set; the note is told so.
    const sentByRead = { headerSent: Boolean(edgeHeaders()['X-OCR-CI']) };
    const feedPath = '/brands/root/calendar.ics';
    const feed = await request.get(`${BASE_URL}${feedPath}`, {
      maxRedirects: 0,
      headers: edgeHeaders(),
    });
    if (edgeChallenged(feed.status(), feed.headers())) {
      test.info().annotations.push({
        type: 'edge-challenge',
        description: noteEdgeChallenge(feedPath, process.env, sentByRead),
      });
      return;
    }
    expect(feed.status(), 'the root brand feed').toBe(200);
    expect(feed.headers()['content-type']).toContain('text/calendar');
    expect(feed.headers()['set-cookie'], 'no cookie on the feed').toBeUndefined();

    // Folded lines joined again (RFC 5545 §3.1).
    const body = (await feed.text()).replace(/\r\n /g, '');
    expect(body.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);

    // The public event has an entry, and its link is its event page.
    expect(body).toContain(`UID:ose-event-${publicEventId}@oursharedevents.com`);
    expect(body).toContain(
      `URL:${BASE_URL}/events/${publicEventId}/launch-smoke-feed-public-${RUN_ID}`
    );
    expect(body).toContain(`SUMMARY:Launch Smoke feed-public ${RUN_ID}`);

    // The draft is left out: not its id, not its title.
    expect(body).not.toContain(draftEventId);
    expect(body).not.toContain(`Launch Smoke feed-draft ${RUN_ID}`);

    // Every entry carries only the eight public properties, and every link is an
    // event page on this host.
    let inEvent = false;
    for (const line of body.split('\r\n')) {
      if (line === 'BEGIN:VEVENT') inEvent = true;
      else if (line === 'END:VEVENT') inEvent = false;
      else if (inEvent) {
        expect(line).toMatch(/^(UID|DTSTAMP|DTSTART|DTEND|SUMMARY|DESCRIPTION|LOCATION|URL)[;:]/);
        if (line.startsWith('URL:')) expect(line.startsWith(`URL:${BASE_URL}/events/`)).toBe(true);
      }
    }

    // Another brand's feed never carries this brand's event. A brand nobody has
    // is a 404; if it existed, its feed still must not hold the root event.
    const otherPath = `/brands/launch-smoke-other-${RUN_ID}/calendar.ics`;
    const other = await request.get(`${BASE_URL}${otherPath}`, {
      maxRedirects: 0,
      headers: edgeHeaders(),
    });
    if (edgeChallenged(other.status(), other.headers())) {
      noteEdgeChallenge(otherPath, process.env, sentByRead);
      return;
    }
    expect(other.status(), 'a brand with nothing public').toBe(404);
    expect(other.headers()['set-cookie'], 'no cookie on the refusal').toBeUndefined();
    expect(await other.text()).not.toContain(publicEventId);
  });

  // OSE-1656: a withheld count reads "Fewer than 5" on the deployed pages, and an
  // event's registrations have one count. A new event has no registrations, so
  // every figure here is withheld for real: nothing is mocked. The grid of cases
  // is in the Worker specs (withheld-count-words.spec.ts,
  // registration-count-one-definition.spec.ts); this reads the deployed Worker.
  test('a new event: withheld counts are one figure, and the Live view says "Fewer than 5", never "Held"', async ({
    request,
  }) => {
    draftEventId = await createEvent(request, 'draft', false, 'withheld');

    const stats = await adminFetch(request, 'GET', `/api/v2/admin/events/${draftEventId}/stats`);
    expect(stats.status(), 'event stats').toBe(200);
    const list = await adminFetch(
      request,
      'GET',
      `/api/v2/admin/events/${draftEventId}/forms/registrations`
    );
    expect(list.status(), 'registrations list').toBe(200);
    const withheld = { count: null, suppressed: true, floor: 5 };
    const statsJson = await stats.json();
    const listJson = await list.json();
    expect(statsJson.stats.registrations).toEqual(withheld);
    // OSE-2087 (owner, 2026-11-16): the rows follow the count. A new event's
    // roster and its export are withheld lists: no row, and no next page.
    expect(listJson.items).toEqual([]);
    expect(listJson.next_cursor).toBeNull();
    const exported = await adminFetch(
      request,
      'GET',
      `/api/v2/admin/events/${draftEventId}/forms/export?type=registrations`
    );
    expect(exported.status(), 'registrations export').toBe(200);
    expect(await exported.json()).toMatchObject({ ok: true, items: [], ...withheld });
    expect({
      count: listJson.count,
      suppressed: listJson.suppressed,
      floor: listJson.floor,
    }).toEqual(statsJson.stats.registrations);

    const live = await adminFetch(
      request,
      'GET',
      `/api/v2/admin/events/${draftEventId}/live`,
      undefined,
      { allowHtml: true }
    );
    expect(live.status(), 'live view').toBe(200);
    const html = await live.text();
    expect(html, 'the Worker served the Live view, not a sign-in page').toContain(
      'data-testid="live-main"'
    );
    // The one source of the words is on the page, and the old word is not.
    expect(html).toContain('function oseFewerThan(floor, tail, lower)');
    expect(html).toContain('"Fewer than {floor}"');
    expect(html).not.toMatch(/['">]Held['"<]/);
  });

  test('poster scan route replays to /events/:id with type and deployment context (OSE-1359)', async ({
    request,
  }) => {
    publicEventId = await createEvent(request, 'active', true, 'scan-route');
    const deployment = await createPosterDeployment(request, publicEventId, 'scan-route');
    posterDeploymentId = deployment.id;

    const res = await request.get(
      `${BASE_URL}/q/${encodeURIComponent(deployment.qrToken)}?type=checkin`,
      { maxRedirects: 0 }
    );
    expect(
      [302, 403],
      'scan route is handled by Worker OR blocked by the staging WAF edge'
    ).toContain(res.status());
    if (res.status() === 302) {
      const location = res.headers()['location'] ?? '';
      expect(location, 'good token must deep-link to the event page, not fallback /').toContain(
        `/events/${publicEventId}`
      );
      expect(location).toContain('type=checkin');
      expect(location).toContain(`deployment=${deployment.id}`);
    }
  });
});
