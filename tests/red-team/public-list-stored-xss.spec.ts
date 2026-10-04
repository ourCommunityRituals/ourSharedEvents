/**
 * RED TEAM — Stored XSS surfacing on the SERVER-RENDERED public event list
 *
 * WHY THIS IS A NEW TEST AND NOT A DUPLICATE OF INJ-006.
 *
 * INJ-006 plants a payload and reads it back through a JSON admin endpoint,
 * asserting the JSON does not carry unescaped HTML. That was the whole story
 * while /events was client-rendered: the payload travelled as JSON and the
 * browser escaped it on arrival with textContent.
 *
 * OSE-1243 server-rendered the list. The payload now travels as HTML that the
 * Worker concatenated, to an ANONYMOUS reader on a PUBLIC page — no login, no
 * admin surface, no interaction. The blast radius changed from "an operator
 * looking at a JSON blob" to "every visitor". A JSON-shaped assertion cannot
 * see that, so this suite reads the served HTML.
 *
 * Test IDs:
 *   RT-PUB-001  event title payload does not become an element in served HTML
 *   RT-PUB-002  event title payload does not become an event-handler attribute
 *   RT-PUB-003  the CTA href stays same-origin under a hostile title
 *   RT-PUB-004  the served page ships no unexpected inline script bodies
 *   RT-PUB-005  the CSP on the served page still forbids inline execution
 *
 * Environment variables:
 *   BASE_URL        — target (default: https://stg.oursharedevents.com)
 *   ADMIN_KEY       — Bearer token, needed to PLANT the payload
 *   X_OCR_INTERNAL  — internal auth secret (alternative)
 *
 * Tests that need to plant a payload skip without admin auth. RT-PUB-004 and
 * RT-PUB-005 read the public page only and always run.
 *
 * NOTE: CI does not currently execute tests/red-team/ — no workflow references
 * the directory. Tracked in OSE-1244. Run manually:
 *   npx playwright test --config=playwright.red-team.config.ts
 */

import { test, expect, type APIRequestContext } from '@playwright/test';

const BASE_URL = process.env.BASE_URL?.replace(/\/$/, '') ?? 'https://stg.oursharedevents.com';
const ADMIN_KEY = process.env.ADMIN_KEY ?? '';
const X_OCR_INTERNAL = process.env.X_OCR_INTERNAL ?? '';
const HAS_ADMIN = Boolean(ADMIN_KEY || X_OCR_INTERNAL);

function adminHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ADMIN_KEY) h.Authorization = `Bearer ${ADMIN_KEY}`;
  if (X_OCR_INTERNAL) h['X-OCR-Internal'] = X_OCR_INTERNAL;
  return h;
}

/** Create an event whose title is hostile. Returns its id, or null if refused. */
async function plantEvent(request: APIRequestContext, title: string): Promise<string | null> {
  const res = await request.post(`${BASE_URL}/api/v2/admin/events`, {
    headers: adminHeaders(),
    data: {
      title,
      // Far enough out that the event is unambiguously pre_event, so the card
      // renders the Register CTA — the variant that interpolates the title
      // into BOTH an href query param and an aria-label.
      start_date: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
      status: 'active',
      // OSE-1560: off the map by default; the payload has to be on the public list to be tested.
      is_published: true,
      location: title,
    },
  });
  if (!res.ok()) return null;
  const body = await res.json().catch(() => null);
  return body?.item?.id ?? body?.id ?? null;
}

async function deleteEvent(request: APIRequestContext, id: string): Promise<void> {
  await request
    .delete(`${BASE_URL}/api/v2/admin/events/${encodeURIComponent(id)}`, {
      headers: adminHeaders(),
    })
    .catch(() => undefined);
}

const PAYLOAD_TAG = `<script>alert('rt-pub')</script>`;
const PAYLOAD_ATTR = `" onmouseover="alert('rt-pub')`;
const PAYLOAD_URL = `" href="https://evil.test/`;

test.describe('RT-PUB — stored XSS on the server-rendered public list', () => {
  test.skip(!HAS_ADMIN, 'Admin auth not set — cannot plant a payload (set ADMIN_KEY)');

  test('RT-PUB-001 — a script payload in the title is not an element in served HTML', async ({
    request,
    page,
  }) => {
    const unique = `${PAYLOAD_TAG}-${Date.now()}`;
    const id = await plantEvent(request, unique);
    test.skip(!id, 'Could not create an event — admin endpoint refused');
    try {
      await page.goto(`${BASE_URL}/events`, { waitUntil: 'networkidle' });
      // Count scripts the PAGE legitimately ships, then assert the payload
      // added none. Asserting "zero scripts" would be wrong — the sponsor
      // banner is a real inline script.
      const injected = await page.evaluate(
        () =>
          [...document.querySelectorAll('script')].filter((s) => s.textContent?.includes('rt-pub'))
            .length
      );
      expect(injected, 'payload became an executing script element').toBe(0);
      // And it must be present as TEXT — proving it round-tripped and was
      // escaped, rather than silently dropped, which would prove nothing.
      expect(await page.content()).toContain('rt-pub');
    } finally {
      if (id) await deleteEvent(request, id);
    }
  });

  test('RT-PUB-002 — an attribute-breaking title adds no event handler', async ({
    request,
    page,
  }) => {
    const id = await plantEvent(request, `${PAYLOAD_ATTR}-${Date.now()}`);
    test.skip(!id, 'Could not create an event — admin endpoint refused');
    try {
      await page.goto(`${BASE_URL}/events`, { waitUntil: 'networkidle' });
      const handlers = await page.evaluate(() =>
        [...document.querySelectorAll('*')].flatMap((n) =>
          n.getAttributeNames().filter((a) => a.toLowerCase().startsWith('on'))
        )
      );
      expect(handlers, 'payload introduced an inline event handler').toEqual([]);
    } finally {
      if (id) await deleteEvent(request, id);
    }
  });

  test('RT-PUB-003 — every CTA href stays on our origin under a hostile title', async ({
    request,
    page,
  }) => {
    const id = await plantEvent(request, `${PAYLOAD_URL}-${Date.now()}`);
    test.skip(!id, 'Could not create an event — admin endpoint refused');
    try {
      await page.goto(`${BASE_URL}/events`, { waitUntil: 'networkidle' });
      const origins = await page.evaluate(() =>
        [...document.querySelectorAll('[data-testid="public-event-cta"]')].map(
          (a) => new URL((a as HTMLAnchorElement).href, location.href).origin
        )
      );
      const expected = new URL(BASE_URL).origin;
      for (const o of origins) expect(o, 'a CTA pointed off-origin').toBe(expected);
    } finally {
      if (id) await deleteEvent(request, id);
    }
  });
});

test.describe('RT-PUB — the served page defends itself regardless of content', () => {
  test('RT-PUB-004 — no inline script body references event data', async ({ page }) => {
    // Server-rendering means event fields land in HTML. They must never land
    // inside a <script> body, where HTML escaping does not protect them.
    await page.goto(`${BASE_URL}/events`, { waitUntil: 'networkidle' });
    const names = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="public-event-name"]')].map(
        (n) => n.textContent?.trim() ?? ''
      )
    );
    test.skip(names.length === 0, 'No events on target — nothing to check');
    const scriptText = await page.evaluate(() =>
      [...document.querySelectorAll('script')].map((s) => s.textContent ?? '').join('\n')
    );
    for (const name of names) {
      if (name.length < 8) continue; // too short to be a meaningful match
      expect(scriptText, `event name leaked into a script body: ${name}`).not.toContain(name);
    }
  });

  test('RT-PUB-005 — CSP forbids unsafe-inline for scripts', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/events`);
    const csp = res.headers()['content-security-policy'] ?? '';
    expect(csp, 'no CSP on the public list').toBeTruthy();
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
    expect(scriptSrc).toContain('nonce-');
    expect(scriptSrc).not.toContain('unsafe-inline');
  });
});
