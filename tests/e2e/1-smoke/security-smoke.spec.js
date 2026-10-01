/**
 * SECURITY SMOKE — admin input validation, auth rejection, public-render escaping
 *
 * Runs in CI as "T3 Smoke (security)" (smoke-staging-sub matrix,
 * playwright.e2e-smoke.config.ts) against live staging.
 *
 * What it proves, end to end through the deployed Worker:
 *   - Hostile strings sent to the admin create-event API (XSS, HTML injection,
 *     SQL injection) are stored literally and rendered ESCAPED on the public
 *     event page (/events/:id). The browser never sees the raw markup.
 *   - Malformed input is refused (bad date → 400 INVALID_DATE, bad brand →
 *     400 INVALID_BRAND) and creates nothing; an over-long name is bounded.
 *   - A wrong or empty admin key is rejected by the Worker even when the
 *     request carries a valid CF Access service token.
 *
 * History: this file used to drive the GAS-era admin form (`?page=admin`,
 * `dialog.accept(ADMIN_KEY)`). That page no longer exists, so 8 of its 10
 * tests called `test.skip(true, ...)` on every run and the gate was green
 * while asserting almost nothing. The two that did run (`?page=NONEXISTENT`
 * and bare `/` are not 5xx) were removed: both are covered by the T3 IAC
 * section, tests/api/smoke/fail-fast-gates.spec.ts ("Landing (/) is not 5xx",
 * "MVP surfaces return HTML"). The Worker ignores `?page=`, so the first one
 * was the same request as the second.
 *
 * Auth: CF Access service token (CF_ACCESS_CLIENT_ID/SECRET) gets the request
 * past the edge. The Worker then treats the email-less service-token JWT as
 * non-human and requires its own secret, Bearer ADMIN_KEY (auth/admin.ts,
 * OSE-889). That's why a wrong Bearer behind a valid service token is a real
 * test of the Worker, not of the edge.
 *
 * Writes: every event this spec creates is deleted in afterAll. Production
 * is never written to (and has no ADMIN_KEY fallback anyway), so the write
 * tests skip there with an explicit reason. The auth-rejection tests write
 * nothing and run everywhere.
 *
 * Local run (born-red checks):
 *   BASE_URL=http://127.0.0.1:8790 ADMIN_KEY=<local key> \
 *     npx playwright test --config=playwright.e2e-smoke.config.ts tests/e2e/1-smoke/security-smoke.spec.js
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../../../config/environments');

const BASE_URL = getBaseUrl().replace(/\/+$/, '');
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID || '';
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || '';
const IS_PRODUCTION = /^https:\/\/(www\.)?oursharedevents\.com$/i.test(BASE_URL);
const BRAND = 'root';
const TIMEOUT = 30000;

// Unique per run so assertions can't match a stale event from an earlier run.
const RUN = `secsmoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Events created by this run, deleted in afterAll. */
const createdIds = [];

/** Edge headers only. Sent on every admin call so the request reaches the Worker. */
function edgeHeaders() {
  return CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET
    ? {
        'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID,
        'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET,
      }
    : {};
}

function adminHeaders() {
  return { ...edgeHeaders(), Authorization: `Bearer ${ADMIN_KEY}` };
}

/** A start date ~30 days out, so the public page renders the pre-event view. */
function futureDate() {
  return new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
}

/**
 * Create an event through the admin API. maxRedirects: 0 so a stale CF Access
 * token surfaces as a 302 to the login page instead of being followed to a
 * 200 HTML page.
 */
async function createEvent(request, fields) {
  const res = await request.post(`${BASE_URL}/api/v2/admin/events`, {
    timeout: TIMEOUT,
    maxRedirects: 0,
    headers: adminHeaders(),
    data: { brand_id: BRAND, status: 'active', start_date: futureDate(), ...fields },
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // Non-JSON (edge challenge page). The status assertion in the test reports it.
  }
  if (json && json.id) createdIds.push(json.id);
  return { res, json };
}

/** Create, assert 201, and return the id. */
async function createOk(request, fields) {
  const { res, json } = await createEvent(request, fields);
  expect(res.status(), `create should be 201 (got ${res.status()}: ${JSON.stringify(json)})`).toBe(
    201
  );
  expect(json.id).toMatch(/^evt_/);
  return json.id;
}

/** Public HTML for an event, as the server sent it (no client rendering involved). */
async function publicHtml(request, id) {
  const res = await request.get(`${BASE_URL}/events/${id}`, { timeout: TIMEOUT });
  expect(res.status(), `public page /events/${id}`).toBe(200);
  return res.text();
}

/** Stored values, as the public read API returns them. */
async function publicItem(request, id) {
  const res = await request.get(`${BASE_URL}/api/v2/events/${id}`, { timeout: TIMEOUT });
  expect(res.status(), `GET /api/v2/events/${id}`).toBe(200);
  return (await res.json()).item;
}

function htmlEscape(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

test.beforeAll(() => {
  // A missing key would make every write test fail with a vague 401. Say why.
  if (!ADMIN_KEY) throw new Error('ADMIN_KEY is not set; security smoke cannot authenticate');
  if (process.env.CI && !IS_PRODUCTION && !(CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET)) {
    throw new Error('CF_ACCESS_CLIENT_ID/SECRET not set; staging admin API is behind CF Access');
  }
});

test.afterAll(async ({ request }) => {
  const failures = [];
  for (const id of createdIds) {
    const res = await request.delete(`${BASE_URL}/api/v2/admin/events/${id}`, {
      timeout: TIMEOUT,
      maxRedirects: 0,
      headers: adminHeaders(),
    });
    if (res.status() !== 200 && res.status() !== 404) failures.push(`${id}: ${res.status()}`);
  }
  console.log(
    `[security-smoke] cleanup: deleted ${createdIds.length - failures.length}/${createdIds.length}`
  );
  expect(failures, 'every event this spec created must be deleted').toEqual([]);
});

test.describe('🔒 SECURITY: Admin key validation', () => {
  // Same edge headers as a real admin call, so the Worker (not CF Access) decides.
  for (const [label, authorization] of [
    ['Invalid admin key is rejected', 'Bearer WRONG_KEY_12345'],
    ['Empty admin key is rejected', 'Bearer '],
  ]) {
    test(label, async ({ request }) => {
      const res = await request.post(`${BASE_URL}/api/v2/admin/events`, {
        timeout: TIMEOUT,
        maxRedirects: 0,
        headers: { ...edgeHeaders(), Authorization: authorization },
        data: { title: `${RUN} must-not-exist`, brand_id: BRAND },
      });
      const json = await res.json().catch(() => null);
      if (json && json.id) createdIds.push(json.id);

      expect([401, 403], `status (body: ${JSON.stringify(json)})`).toContain(res.status());
      // JSON with ok:false means the Worker refused it. An HTML/302 here would
      // be the edge, i.e. the CF Access token is stale, which is a different failure.
      expect(json, 'Worker JSON error envelope').not.toBeNull();
      expect(json.ok).toBe(false);
      expect(json.id).toBeUndefined();
    });
  }
});

test.describe('🔒 SECURITY: Injection is escaped on the public page', () => {
  test.skip(IS_PRODUCTION, 'Never writes to production; these run on staging and locally');

  test('XSS attempt in event name is escaped', async ({ request, page }) => {
    const payload = `<script>alert("${RUN}-xss")</script>`;
    const id = await createOk(request, { title: payload, description: payload });

    // Stored literally: escaping is the renderer's job, not the database's.
    expect((await publicItem(request, id)).title).toBe(payload);

    const html = await publicHtml(request, id);
    expect(html, 'raw <script> payload in public HTML').not.toContain(payload);
    expect(html, 'escaped payload in public HTML').toContain(htmlEscape(payload));

    const dialogs = [];
    page.on('dialog', async (d) => {
      dialogs.push(d.message());
      await d.dismiss();
    });
    await page.goto(`${BASE_URL}/events/${id}`, { waitUntil: 'load', timeout: TIMEOUT });
    await expect(page.locator('h1').first()).toContainText(payload);
    expect(await page.locator(`script:has-text("${RUN}-xss")`).count()).toBe(0);
    expect(dialogs).toEqual([]);
  });

  test('HTML injection in event name is escaped', async ({ request, page }) => {
    const payload = `<img src=x data-run="${RUN}" onerror=alert("${RUN}-img")>`;
    const id = await createOk(request, { title: payload, description: payload });

    const html = await publicHtml(request, id);
    expect(html, 'raw <img onerror> payload in public HTML').not.toContain(`<img src=x data-run`);
    expect(html).toContain(htmlEscape(payload));

    const dialogs = [];
    page.on('dialog', async (d) => {
      dialogs.push(d.message());
      await d.dismiss();
    });
    await page.goto(`${BASE_URL}/events/${id}`, { waitUntil: 'load', timeout: TIMEOUT });
    await expect(page.locator('h1').first()).toContainText(payload);
    expect(await page.locator(`img[data-run="${RUN}"]`).count()).toBe(0);
    expect(dialogs).toEqual([]);
  });

  test('SQL injection attempt is stored literally and the table survives', async ({ request }) => {
    const payload = `${RUN}'; DROP TABLE events; --`;
    const id = await createOk(request, { title: payload });

    // Parameterised insert: the quote is data, not syntax.
    expect((await publicItem(request, id)).title).toBe(payload);

    const list = await request.get(`${BASE_URL}/api/v2/events`, { timeout: TIMEOUT });
    expect(list.status()).toBe(200);
    expect((await list.json()).ok).toBe(true);

    const html = await publicHtml(request, id);
    expect(html).toContain(htmlEscape(payload));
  });
});

test.describe('🔒 SECURITY: Invalid inputs', () => {
  test.skip(IS_PRODUCTION, 'Never writes to production; these run on staging and locally');

  test('Malformed date is rejected', async ({ request }) => {
    const { res, json } = await createEvent(request, {
      title: `${RUN} bad-date`,
      start_date: 'NOT-A-DATE',
    });
    expect(res.status()).toBe(400);
    expect(json.code).toBe('INVALID_DATE');
    expect(json.id).toBeUndefined();
  });

  test('Invalid brand ID is rejected', async ({ request }) => {
    const { res, json } = await createEvent(request, {
      title: `${RUN} bad-brand`,
      brand_id: 'INVALID_BRAND_999',
    });
    expect(res.status()).toBe(400);
    expect(json.code).toBe('INVALID_BRAND');
    expect(json.id).toBeUndefined();
  });

  test('Extremely long event name is bounded', async ({ request }) => {
    const longName = `${RUN}-` + 'A'.repeat(10000);
    const id = await createOk(request, { title: longName });

    // handleCreateEvent caps title at 200 chars.
    const stored = (await publicItem(request, id)).title;
    expect(stored.length).toBe(200);
    expect(longName.startsWith(stored)).toBe(true);

    const html = await publicHtml(request, id);
    expect(html).toContain(stored);
    expect(html).not.toContain(longName.slice(0, 201));
  });
});
