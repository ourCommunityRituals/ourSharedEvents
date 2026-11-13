/**
 * Launch Story Smoke — public/admin/poster launch contracts (PR #645).
 *
 * This T4 slice exists so the launch stories are visible in the CI pyramid instead
 * of only being protected by lower-level Worker specs. It is intentionally narrow:
 * one public discovery/event-page smoke and one admin draft-preview → go-live
 * smoke. Deep shape assertions live in the T0 launch-contracts shard.
 */

import { test, expect } from '@playwright/test';

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

    await page.goto(`${BASE_URL}/events`, { waitUntil: 'domcontentloaded' });
    // OSE-1684: the card links to the readable address /events/<id>/<slug>.
    // createEvent's slug is lowercase words and dashes, so it is used as is.
    const readablePath = `/events/${publicEventId}/launch-smoke-public-${RUN_ID}`;
    const cardLink = page.locator(`[data-testid="public-event-card-link"][href="${readablePath}"]`);
    await expect(cardLink, 'public event card links to its public event page').toHaveCount(1);

    const eventPage = await page.goto(`${BASE_URL}${readablePath}`, {
      waitUntil: 'domcontentloaded',
    });
    const eventPageStatus = eventPage?.status();
    expect(
      [200, 403],
      'public event page is reachable by the Worker OR blocked by the staging WAF edge'
    ).toContain(eventPageStatus);
    if (eventPageStatus === 200) {
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
    }
  });

  test('admin draft preview uses the public renderer and can go live to the public page', async ({
    page,
    request,
  }) => {
    draftEventId = await createEvent(request, 'draft', false, 'draft');

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
    const liveStatus = live?.status();
    expect(
      [200, 403],
      'go-live public page is reachable by the Worker OR blocked by the staging WAF edge'
    ).toContain(liveStatus);
    if (liveStatus === 200) {
      await expect(page.locator('[data-testid="event-title"]')).toContainText('Launch Smoke draft');
    }
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
