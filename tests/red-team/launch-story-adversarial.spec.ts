/**
 * RED TEAM — Launch Story Adversarial (PR #645 / OSE-1365)
 *
 * Adversarial coverage for the launch-story surfaces added in PR #645:
 * public event routing + unpublished protection (OSE-1354), Add to calendar
 * (OSE-1358), admin draft preview (OSE-1355), poster deployment shortlink
 * slots (OSE-1357), and the sponsor public-read cache regression found and
 * fixed while stabilizing T4b (OSE-1364/beda846).
 *
 * These tests target the DEPLOYED environment (staging by default), same as
 * every other spec in tests/red-team/. Tests that need admin auth to PLANT a
 * fixture skip cleanly without credentials; tests that only probe read
 * surfaces always run.
 *
 * Environment variables:
 *   BASE_URL        — override target (default: https://stg.oursharedevents.com)
 *   ADMIN_KEY       — valid ****** (used to plant/clean fixtures)
 *   X_OCR_INTERNAL  — internal auth secret (alternative to ADMIN_KEY)
 *   SMOKE_EVENT_ID  — a real, published, active staging event ID (used for
 *                     read-only positive controls when set)
 *
 * Test IDs:
 *   RT-LNCH-001  draft event public page → 404, no field leakage in body
 *   RT-LNCH-002  draft event calendar.ics → 404, same as an unknown id
 *   RT-LNCH-003  calendar.ics body never carries the internal event id
 *   RT-LNCH-004  calendar.ics body never carries a /q/ scan-tracking URL
 *   RT-LNCH-005  calendar.ics has no Set-Cookie and no tracking query params
 *   RT-LNCH-006  repeated calendar.ics GETs are idempotent (no mint-on-GET)
 *   RT-LNCH-007  admin preview without auth → never 200, never the toolbar
 *   RT-LNCH-008  admin preview with a fabricated Bearer token → never 200
 *   RT-LNCH-009  admin preview unauthenticated: real vs fabricated id are
 *                indistinguishable (no existence side-channel)
 *   RT-LNCH-010  poster-deployments create ignores a client-supplied `slots`
 *   RT-LNCH-011  poster-deployments never accept/store a client qr_token
 *   RT-LNCH-012  poster-deployments list slot URLs always resolve to our /s/
 *                origin, never an attacker-influenced target
 *   RT-LNCH-013  public sponsor reads carry Cache-Control: no-store
 *   RT-LNCH-014  public sponsor reads carry no ETag / Last-Modified
 *                (no conditional-cache replay vector)
 *   RT-LNCH-015  public sponsor reads ignore a spoofed If-None-Match /
 *                If-Modified-Since (never a 304 that could hide an update)
 */

import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test';

const BASE_URL = process.env.BASE_URL?.replace(/\/$/, '') ?? 'https://stg.oursharedevents.com';
const ADMIN_KEY = process.env.ADMIN_KEY ?? '';
const X_OCR_INTERNAL = process.env.X_OCR_INTERNAL ?? '';
const HAS_ADMIN = Boolean(ADMIN_KEY || X_OCR_INTERNAL);
const SMOKE_EVENT_ID = process.env.SMOKE_EVENT_ID ?? '';

function adminHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ADMIN_KEY) h.Authorization = `Bearer ${ADMIN_KEY}`;
  if (X_OCR_INTERNAL) h['X-OCR-Internal'] = X_OCR_INTERNAL;
  return h;
}

const leakPatterns: Array<[RegExp, string]> = [
  [/TypeError:/i, 'JavaScript TypeError'],
  [/D1_ERROR/i, 'D1 database error code'],
  [/sqlite_/i, 'SQLite internals'],
  [/SELECT\s+.*FROM/i, 'SQL SELECT statement'],
  [/wrangler/i, 'Wrangler/toolchain name'],
];

async function assertNoInternalLeakage(res: APIResponse): Promise<void> {
  const body = await res.text().catch(() => '');
  for (const [pattern, label] of leakPatterns) {
    expect(pattern.test(body), `Response leaks "${label}". Snippet: ${body.slice(0, 300)}`).toBe(
      false
    );
  }
}

async function plantEvent(
  request: APIRequestContext,
  overrides: Record<string, unknown>
): Promise<string | null> {
  const res = await request.post(`${BASE_URL}/api/v2/admin/events`, {
    headers: adminHeaders(),
    data: {
      attendance_mode: 'in_person',
      title: `RT-LNCH ${Date.now()}`,
      brand_id: 'root',
      status: 'draft',
      is_published: false,
      start_date: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
      location: 'Red team fixture',
      ...overrides,
    },
  });
  if (!res.ok()) return null;
  const body = await res.json().catch(() => null);
  return body?.id ?? body?.item?.id ?? null;
}

async function deleteEvent(request: APIRequestContext, id: string | null): Promise<void> {
  if (!id) return;
  await request
    .delete(`${BASE_URL}/api/v2/admin/events/${encodeURIComponent(id)}`, {
      headers: adminHeaders(),
    })
    .catch(() => undefined);
}

// ─── RT-LNCH-001/002 — draft/unpublished event enumeration ──────────────────

test.describe('RT-LNCH-001/002 — draft events never surface on public read routes', () => {
  test.skip(!HAS_ADMIN, 'Admin auth not set — cannot plant a draft fixture');

  test('RT-LNCH-001 — draft event public page is 404 and leaks no fields', async ({ request }) => {
    const id = await plantEvent(request, {
      title: `RT-LNCH-DRAFT-${Date.now()}`,
      location: 'Secret Draft Venue',
    });
    test.skip(!id, 'Could not plant a draft event — admin endpoint refused');
    try {
      const res = await request.get(`${BASE_URL}/events/${id}`);
      expect(res.status(), 'draft event must 404 on the public page').toBe(404);
      const body = await res.text();
      expect(body, 'draft location must not leak into the 404 body').not.toContain(
        'Secret Draft Venue'
      );
      await assertNoInternalLeakage(res);
    } finally {
      await deleteEvent(request, id);
    }
  });

  test('RT-LNCH-002 — draft event calendar.ics is 404, same as an unknown id', async ({
    request,
  }) => {
    const id = await plantEvent(request, { title: `RT-LNCH-DRAFT-ICS-${Date.now()}` });
    test.skip(!id, 'Could not plant a draft event — admin endpoint refused');
    try {
      const draftRes = await request.get(`${BASE_URL}/events/${id}/calendar.ics`);
      const unknownRes = await request.get(
        `${BASE_URL}/events/evt_rt_lnch_unknown_002/calendar.ics`
      );
      // Both must be blocked (404 worker, or 403 WAF edge block — same
      // unified contract the rest of the suite uses for unknown ids). The
      // key adversarial property: a draft id must never behave differently
      // from an id that does not exist at all.
      expect([404, 403]).toContain(draftRes.status());
      expect([404, 403]).toContain(unknownRes.status());
      expect(
        draftRes.status(),
        'a draft event must not be distinguishable from an unknown event on this route'
      ).toBe(unknownRes.status());
    } finally {
      await deleteEvent(request, id);
    }
  });
});

// ─── RT-LNCH-003/004/005/006 — calendar.ics leakage + idempotency ───────────

test.describe('RT-LNCH-003/004/005/006 — calendar.ics never leaks internals or mutates on GET', () => {
  test.skip(!SMOKE_EVENT_ID, 'SMOKE_EVENT_ID not set — need a real published event to probe');

  test('RT-LNCH-003/004/005 — ICS body carries no internal id, no /q/ URL, no cookie/tracking', async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/events/${SMOKE_EVENT_ID}/calendar.ics`);
    // A published event with no minted public shortlink yet is a documented
    // 409, not a leak; only assert the body contract on a genuine 200.
    test.skip(
      res.status() !== 200,
      `calendar.ics returned ${res.status()}, not 200 — skipping body checks`
    );

    const body = await res.text();
    expect(body, 'ICS body must not carry the internal event id').not.toContain(SMOKE_EVENT_ID);
    expect(body, 'ICS body must not carry a /q/ scan-tracking URL').not.toContain('/q/');
    expect(body, 'ICS body must not carry utm_ tracking params').not.toMatch(/utm_/i);
    expect(res.headers()['set-cookie'], 'calendar.ics must never set a cookie').toBeUndefined();
    await assertNoInternalLeakage(res);
  });

  test('RT-LNCH-006 — repeated GETs return the same UID (no mint-on-GET)', async ({ request }) => {
    const first = await request.get(`${BASE_URL}/events/${SMOKE_EVENT_ID}/calendar.ics`);
    test.skip(first.status() !== 200, 'no minted public shortlink yet — nothing to compare');
    const second = await request.get(`${BASE_URL}/events/${SMOKE_EVENT_ID}/calendar.ics`);
    expect(second.status()).toBe(200);

    const uidOf = (text: string): string | null => text.match(/^UID:(.*)$/m)?.[1] ?? null;
    const firstUid = uidOf(await first.text());
    const secondUid = uidOf(await second.text());
    expect(firstUid, 'ICS response must carry a UID line').not.toBeNull();
    expect(
      secondUid,
      'a second GET must reuse the same shortlink/UID — a GET must never mint a new artifact'
    ).toBe(firstUid);
  });
});

// ─── RT-LNCH-007/008/009 — admin draft preview auth bypass ──────────────────

test.describe('RT-LNCH-007/008/009 — admin draft preview never leaks without real credentials', () => {
  const targetId = SMOKE_EVENT_ID || 'evt_rt_lnch_preview_probe';

  test('RT-LNCH-007 — preview without any auth header is never 200 / never the toolbar', async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/v2/admin/events/${targetId}/preview`, {
      maxRedirects: 0,
    });
    const status = res.status();
    expect(status, 'unauthenticated preview must not return 200').not.toBe(200);
    expect(status, 'unauthenticated preview must not 500').not.toBe(500);
    const isGated =
      status === 401 || status === 403 || status === 404 || (status >= 300 && status < 400);
    expect(isGated, `expected an auth-gated response, got ${status}`).toBe(true);
    const body = await res.text().catch(() => '');
    expect(body).not.toContain('data-testid="admin-draft-preview-toolbar"');
    expect(body).not.toContain('data-testid="admin-preview-go-live"');
  });

  test('RT-LNCH-008 — preview with a fabricated Bearer token is never 200', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/v2/admin/events/${targetId}/preview`, {
      headers: { Authorization: 'Bearer not-a-real-admin-key' },
      maxRedirects: 0,
    });
    expect(res.status()).not.toBe(200);
    const body = await res.text().catch(() => '');
    expect(body).not.toContain('data-testid="admin-draft-preview-toolbar"');
  });

  test('RT-LNCH-009 — unauthenticated preview: a real id and a fabricated id are indistinguishable', async ({
    request,
  }) => {
    test.skip(!SMOKE_EVENT_ID, 'SMOKE_EVENT_ID not set — cannot compare against a real id');
    const real = await request.get(`${BASE_URL}/api/v2/admin/events/${SMOKE_EVENT_ID}/preview`, {
      maxRedirects: 0,
    });
    const fake = await request.get(
      `${BASE_URL}/api/v2/admin/events/evt_rt_lnch_does_not_exist/preview`,
      { maxRedirects: 0 }
    );
    // The auth gate must run BEFORE any DB lookup, so an unauthenticated
    // caller gets the identical status for a real id and a fabricated one —
    // proving existence cannot be inferred from this route without creds.
    expect(
      real.status(),
      'a real event id must not get a different unauthenticated status than a fabricated one'
    ).toBe(fake.status());
  });
});

// ─── RT-LNCH-010/011/012 — poster deployment slot integrity ─────────────────

test.describe('RT-LNCH-010/011/012 — poster deployment slots stay server-derived', () => {
  test.skip(!HAS_ADMIN, 'Admin auth not set — cannot plant a poster deployment fixture');

  test('RT-LNCH-010/011 — create ignores a client-supplied slots array and qr_token', async ({
    request,
  }) => {
    const eventId = await plantEvent(request, { title: `RT-LNCH-POSTER-${Date.now()}` });
    test.skip(!eventId, 'Could not plant an event — admin endpoint refused');
    let deploymentId: string | null = null;
    try {
      const createRes = await request.post(
        `${BASE_URL}/api/v2/admin/events/${eventId}/poster-deployments`,
        {
          headers: adminHeaders(),
          data: {
            placement_label: 'RT-LNCH probe',
            qr_token: 'qrt_attacker_supplied',
            slots: [
              {
                kind: 'public',
                label: 'Forged',
                code: 'FORGED',
                url: 'https://evil.example.com/s/FORGED',
                qr: 'data:image/svg+xml,<svg onload=alert(1)>',
              },
            ],
          },
        }
      );
      expect([200, 201]).toContain(createRes.status());
      const created = await createRes.json();
      deploymentId = created.id ?? null;
      expect(created.qr_token, 'qr_token must always be server-generated').not.toBe(
        'qrt_attacker_supplied'
      );

      const listRes = await request.get(
        `${BASE_URL}/api/v2/admin/events/${eventId}/poster-deployments`,
        { headers: adminHeaders() }
      );
      expect(listRes.status()).toBe(200);
      const listBody = await listRes.json();
      const row = (listBody.items ?? []).find((r: { id: string }) => r.id === deploymentId);
      expect(row, 'created deployment must appear in the list').toBeTruthy();
      const slots = row?.slots ?? [];
      const forged = slots.find((s: { code: string }) => s.code === 'FORGED');
      expect(
        forged,
        'a client-supplied slots array must never be echoed back — slots are server-derived only'
      ).toBeUndefined();
    } finally {
      if (deploymentId) {
        await request
          .delete(`${BASE_URL}/api/v2/admin/poster-deployments/${deploymentId}`, {
            headers: adminHeaders(),
          })
          .catch(() => undefined);
      }
      await deleteEvent(request, eventId);
    }
  });

  test('RT-LNCH-012 — every slot URL resolves to our own /s/ origin', async ({ request }) => {
    test.skip(
      !SMOKE_EVENT_ID,
      'SMOKE_EVENT_ID not set — need a real event to read deployments for'
    );
    const res = await request.get(
      `${BASE_URL}/api/v2/admin/events/${SMOKE_EVENT_ID}/poster-deployments`,
      { headers: adminHeaders() }
    );
    test.skip(!HAS_ADMIN || res.status() !== 200, 'no authenticated read available in this run');
    const body = await res.json();
    const ourOrigin = new URL(BASE_URL).origin;
    for (const item of body.items ?? []) {
      for (const slot of item.slots ?? []) {
        const slotOrigin = new URL(slot.url, BASE_URL).origin;
        expect(slotOrigin, `slot url pointed off-origin: ${slot.url}`).toBe(ourOrigin);
        expect(slot.url, 'slot url must route through /s/').toMatch(/\/s\/[A-Za-z0-9]+$/);
      }
    }
  });
});

// ─── RT-LNCH-013/014/015 — public sponsor read cache hardening (OSE-1364) ───

test.describe('RT-LNCH-013/014/015 — public sponsor reads resist cache poisoning/replay', () => {
  test.skip(
    !SMOKE_EVENT_ID,
    'SMOKE_EVENT_ID not set — need a real event to probe sponsor reads for'
  );

  for (const path of ['sponsors', 'sponsor-bundle']) {
    test(`RT-LNCH-013 — GET /api/v2/events/:id/${path} carries Cache-Control: no-store`, async ({
      request,
    }) => {
      const res = await request.get(`${BASE_URL}/api/v2/events/${SMOKE_EVENT_ID}/${path}`);
      expect(res.status()).toBe(200);
      expect(res.headers()['cache-control']).toBe('no-store');
    });

    test(`RT-LNCH-014 — GET /api/v2/events/:id/${path} carries no ETag/Last-Modified`, async ({
      request,
    }) => {
      const res = await request.get(`${BASE_URL}/api/v2/events/${SMOKE_EVENT_ID}/${path}`);
      expect(res.status()).toBe(200);
      expect(
        res.headers()['etag'],
        'an ETag would enable a conditional-cache replay of a stale sponsor list'
      ).toBeUndefined();
      expect(res.headers()['last-modified']).toBeUndefined();
    });

    test(`RT-LNCH-015 — GET /api/v2/events/:id/${path} ignores a spoofed conditional-cache header`, async ({
      request,
    }) => {
      const res = await request.get(`${BASE_URL}/api/v2/events/${SMOKE_EVENT_ID}/${path}`, {
        headers: {
          'If-None-Match': '"attacker-forged-etag"',
          'If-Modified-Since': 'Mon, 01 Jan 2035 00:00:00 GMT',
        },
      });
      expect(
        res.status(),
        'the server must never honor a conditional-cache header on this endpoint with a 304 — that would let a stale sponsor list survive a real update'
      ).toBe(200);
    });
  }
});
