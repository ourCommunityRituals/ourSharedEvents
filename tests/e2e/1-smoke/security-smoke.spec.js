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
const { isProductionUrl } = require('../../../config/production-hosts');

const BASE_URL = getBaseUrl().replace(/\/+$/, '');
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID || '';
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || '';
// ADR-021: one production check for every suite (any port, path or case).
const IS_PRODUCTION = isProductionUrl(BASE_URL);
const BRAND = 'root';
const TIMEOUT = 30000;

// Unique per run so assertions can't match a stale event from an earlier run.
const RUN = `secsmoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Events created by this run, deleted in afterAll. */
const createdIds = [];

const IS_LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(BASE_URL).hostname);

/**
 * Local stand-in for the CF Access edge. On staging the edge accepts the
 * service token and injects Cf-Access-Jwt-Assertion carrying a JWT with NO
 * email; the Worker sees that, and falls through to the Bearer check
 * (auth/admin.ts, OSE-889). `wrangler dev` has no edge, so without this the
 * local run would skip that branch entirely. This JWT is unsigned and
 * email-less on purpose: a local worker (no CF_ACCESS_TEAM_DOMAIN, no
 * WORKER_ENV) reads it unverified, exactly as staging reads the real one
 * after verification. Never sent to a non-local host.
 */
function localServiceTokenJwt() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ iat: now, exp: now + 3600, common_name: 'local-ci' })}.x`;
}

/** Edge headers only. Sent on every admin call so the request reaches the Worker. */
function edgeHeaders() {
  if (IS_LOCAL) return { 'Cf-Access-Jwt-Assertion': localServiceTokenJwt() };
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
  // ADR-021 (OSE-906): the production smoke tier is strictly read-only. The
  // test.skip(IS_PRODUCTION) on each writing describe is the first line; this is
  // the second, so a write test added without the skip fails here instead of
  // creating a row in production.
  if (IS_PRODUCTION) {
    throw new Error('ADR-021: production smoke is read-only; createEvent refused');
  }
  const res = await request.post(`${BASE_URL}/api/v2/admin/events`, {
    timeout: TIMEOUT,
    maxRedirects: 0,
    headers: adminHeaders(),
    data: {
      attendance_mode: 'in_person',
      location: 'Test Hall',
      brand_id: BRAND,
      status: 'active',
      is_published: true,
      start_date: futureDate(),
      ...fields,
    },
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

/**
 * Public HTML for an event, exactly as the server sent it (the response body,
 * not the rendered DOM). Loaded by the browser, not the `request` fixture: on
 * staging, Cloudflare Bot Management answers 403 to Playwright's Node HTTP
 * client for HTML pages whatever User-Agent it sends, and 200 to a real
 * browser navigation (measured 2026-10-01). Leaves `page` on the event.
 */
async function publicHtml(page, id) {
  const res = await page.goto(`${BASE_URL}/events/${id}`, { waitUntil: 'load', timeout: TIMEOUT });
  expect(res.status(), `public page /events/${id}`).toBe(200);
  return res.text();
}

/** Stored values, as the public read API returns them. */
async function publicItem(request, id) {
  const res = await request.get(`${BASE_URL}/api/v2/events/${id}`, { timeout: TIMEOUT });
  expect(res.status(), `GET /api/v2/events/${id}`).toBe(200);
  return (await res.json()).item;
}

/**
 * Rows titled `title` among the newest events, every status and brand (the CI key is unscoped).
 * A row a rejected create leaked would be the newest one, so the first page is
 * enough to prove "nothing was created".
 */
async function leakedRows(request, title) {
  const res = await request.get(`${BASE_URL}/api/v2/admin/events?limit=100`, {
    timeout: TIMEOUT,
    maxRedirects: 0,
    headers: adminHeaders(),
  });
  expect(res.status(), 'GET /api/v2/admin/events').toBe(200);
  const leaked = (await res.json()).items.filter((e) => e.title === title);
  createdIds.push(...leaked.map((e) => e.id)); // so afterAll still cleans up a leak
  return leaked.map((e) => e.id);
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
  // Production has no static admin key (ADR-012 R2), and every writing test
  // skips there, so the key is required only off production.
  if (!ADMIN_KEY && !IS_PRODUCTION) {
    throw new Error('ADMIN_KEY is not set; security smoke cannot authenticate');
  }
  // A local worker has no Access edge in front of it (the helper above sends a stand-in token),
  // so only a deployed non-production target needs the real service token.
  if (
    process.env.CI &&
    !IS_PRODUCTION &&
    !IS_LOCAL &&
    !(CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET)
  ) {
    throw new Error('CF_ACCESS_CLIENT_ID/SECRET not set; staging admin API is behind CF Access');
  }
});

// Copilot review on #747: on production every writing describe skips, so the
// run must prove it executed something. playwright.e2e-smoke.config.ts runs one
// worker, so this file-level counter sees the whole file.
let executed = 0;
test.beforeEach(() => {
  executed++;
});

test.afterAll(async ({ request }) => {
  expect(
    executed,
    'security smoke must execute at least one test (no all-skipped green)'
  ).toBeGreaterThan(0);
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

// Read-only, so it runs everywhere, production included (ADR-021 allows reads).
// Production admin is Cloudflare Access only (ADR-012 R2): no static header and
// no Bearer key may open an admin read. Staging must refuse a wrong value too.
test.describe('🔒 SECURITY: Admin reads refuse missing and static credentials', () => {
  for (const [label, headers] of [
    ['No credentials', {}],
    [
      'Wrong static credentials',
      {
        Authorization: 'Bearer WRONG_KEY_12345',
        'X-OCR-Internal': `not-a-real-secret-${RUN}`,
      },
    ],
  ]) {
    test(`${label}: admin read is refused`, async ({ request }) => {
      const res = await request.get(`${BASE_URL}/api/v2/admin/events`, {
        timeout: TIMEOUT,
        maxRedirects: 0,
        headers,
      });
      // 302 = the Access login redirect, 401/403 = the Worker or Access refusing.
      expect([302, 401, 403], `status ${res.status()}`).toContain(res.status());
      const json = await res.json().catch(() => null);
      expect(json && Array.isArray(json.items), 'no admin data in the response').toBeFalsy();
    });
  }
});

test.describe('🔒 SECURITY: Admin key validation', () => {
  // ADR-021: even a rejected-key POST is a write attempt; if auth regressed it
  // would create a row. Production also sits behind Access here (OSE-1353).
  test.skip(IS_PRODUCTION, 'Never writes to production; these run on staging and locally');
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
        data: {
          attendance_mode: 'in_person',
          location: 'Test Hall',
          title: `${RUN} must-not-exist`,
          brand_id: BRAND,
        },
      });
      const json = await res.json().catch(() => null);
      if (json && json.id) createdIds.push(json.id);

      // Exactly the Bearer-rejection 401 (requireAdmin's final UNAUTH). A 403
      // would be the CF Access email allowlist, which never looks at the key,
      // and an HTML/302 would be the edge (stale CF Access token).
      expect(res.status(), `status (body: ${JSON.stringify(json)})`).toBe(401);
      expect(json, 'Worker JSON error envelope').not.toBeNull();
      expect(json.code).toBe('UNAUTH');
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

    const html = await publicHtml(page, id);
    expect(html, 'raw <script> payload in public HTML').not.toContain(payload);
    expect(html, 'escaped payload in public HTML').toContain(htmlEscape(payload));

    await expect(page.locator('h1').first()).toContainText(payload);
    // Not a :has-text locator: Playwright's text matching skips <script> contents.
    // Executable scripts only: the page's schema.org JSON-LD block is a data
    // block that carries the title as a JSON string (checked just below).
    const injectedScripts = await page.evaluate(
      (marker) =>
        [...document.scripts].filter(
          (s) => s.type !== 'application/ld+json' && s.textContent.includes(marker)
        ).length,
      `${RUN}-xss`
    );
    expect(injectedScripts, 'injected <script> elements').toBe(0);
    // The JSON-LD block must hold the payload as plain data: it parses, has no
    // `<` that could close the block, and round-trips the title exactly. An
    // unescaped `</script>` would truncate it and fail the parse.
    const ldBlocks = await page.evaluate(() =>
      [...document.scripts]
        .filter((s) => s.type === 'application/ld+json')
        .map((s) => s.textContent)
    );
    expect(ldBlocks.length, 'one JSON-LD block').toBe(1);
    expect(ldBlocks[0], 'no < inside the JSON-LD block').not.toContain('<');
    expect(JSON.parse(ldBlocks[0]).name, 'JSON-LD name round-trips').toBe(payload);
  });

  test('HTML injection in event name is escaped', async ({ request, page }) => {
    const payload = `<img src=x data-run="${RUN}" onerror=alert("${RUN}-img")>`;
    const id = await createOk(request, { title: payload, description: payload });

    const html = await publicHtml(page, id);
    expect(html, 'raw <img onerror> payload in public HTML').not.toContain(`<img src=x data-run`);
    expect(html).toContain(htmlEscape(payload));

    await expect(page.locator('h1').first()).toContainText(payload);
    expect(await page.locator(`img[data-run="${RUN}"]`).count()).toBe(0);
  });

  test('SQL injection attempt is stored literally and the table survives', async ({
    request,
    page,
  }) => {
    const payload = `${RUN}'; DROP TABLE events; --`;
    const id = await createOk(request, { title: payload });

    // Parameterised insert: the quote is data, not syntax.
    expect((await publicItem(request, id)).title).toBe(payload);

    const list = await request.get(`${BASE_URL}/api/v2/events`, { timeout: TIMEOUT });
    expect(list.status()).toBe(200);

    const html = await publicHtml(page, id);
    expect(html).toContain(htmlEscape(payload));
  });
});

test.describe('🔒 SECURITY: Invalid inputs', () => {
  test.skip(IS_PRODUCTION, 'Never writes to production; these run on staging and locally');

  test('Malformed date is rejected', async ({ request }) => {
    const title = `${RUN} bad-date`;
    const { res, json } = await createEvent(request, {
      title,
      start_date: 'NOT-A-DATE',
    });
    expect(res.status()).toBe(400);
    expect(json.code).toBe('INVALID_DATE');
    expect(await leakedRows(request, title), 'rejected create must persist nothing').toEqual([]);
  });

  test('Invalid brand ID is rejected', async ({ request }) => {
    const title = `${RUN} bad-brand`;
    const { res, json } = await createEvent(request, {
      title,
      brand_id: 'INVALID_BRAND_999',
    });
    expect(res.status()).toBe(400);
    expect(json.code).toBe('INVALID_BRAND');
    expect(await leakedRows(request, title), 'rejected create must persist nothing').toEqual([]);
  });

  test('Extremely long event name is bounded', async ({ request, page }) => {
    const longName = `${RUN}-` + 'A'.repeat(10000);
    const id = await createOk(request, { title: longName });

    // handleCreateEvent caps title at 200 chars.
    const stored = (await publicItem(request, id)).title;
    expect(stored.length).toBe(200);
    expect(longName.startsWith(stored)).toBe(true);

    const html = await publicHtml(page, id);
    expect(html).toContain(stored);
    expect(html).not.toContain(longName.slice(0, 201));
  });
});
