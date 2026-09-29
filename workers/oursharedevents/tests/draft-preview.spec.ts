/**
 * OSE-1355 — Draft preview: an organizer sees the public pre-event page for a
 * draft (or ready) event BEFORE Go live, through the real renderer, without it
 * becoming public, shareable, indexable, or counted.
 *
 * Route: GET /api/v2/admin/events/:id/preview (HTML). Admin-only three ways:
 * Cloudflare Access fronts /api/v2/admin/* at the edge, requireAdmin owns the
 * 401, and guardAdminObjectScope 404s an id outside the caller's brands.
 *
 * Decisions pinned here:
 *   - draft / ready → 200, real renderPreEventHtml + "Preview — not live" banner;
 *   - active        → 303 to /events/:id (the public page IS the preview);
 *   - archived      → 404 (nothing to preview until it is reopened);
 *   - RSVP + share are inert; nothing is written (no scan/click/impression/
 *     shortlink row, no lifecycle change);
 *   - Go live walks the SAME state-machine doors as the admin cockpit
 *     (PUT status draft→ready, then POST /verify-qr) and never flips
 *     is_published — listing stays the host's call.
 *
 * Exercises the REAL request path (route()), because the auth + object-scope
 * contract is ordering in the router, not a property of the handler.
 *
 * @born-red OSE-1355 | method: route()-level request against draft/ready/active/archived seeds + row-count diff, red on origin/main (no banner, no noindex, live RSVP/share, draft-only list action, active/archived rendered as pre-event) | date: 2026-09-29
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { route, type RouterEnv } from '../src/router';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const routerEnv = env as unknown as RouterEnv;
const BRAND = 'brand-ose1355';
const OTHER_BRAND = 'brand-ose1355-other';
const ADMIN = 'preview-a@example.com'; // @example.com clears ALLOWED_ADMIN_DOMAINS
const TITLE = 'Harbor Bocce Draft Night';

async function applyMigrations(): Promise<void> {
  const stmts: string[] = JSON.parse((env as unknown as TestEnv).TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such column')
      ) {
        continue;
      }
      throw e;
    }
  }
}

async function seed(
  id: string,
  status: 'draft' | 'ready' | 'active' | 'archived',
  opts: { brand?: string; published?: 0 | 1; title?: string } = {}
): Promise<void> {
  await env.DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  await env.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, is_published, location,
                         start_date, end_date, timezone, what_short, who_host,
                         why_purpose, how_details, where_address, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'Eagles Bowl', '2026-12-02T02:00:00.000Z',
             '2026-12-02T04:00:00.000Z', 'America/Chicago', 'Rolling on the green.',
             'Harbor County Bocce', 'Neighbours meet neighbours.', 'Bring a team of four.',
             '100 Red Arrow Hwy, Sawyer MI', '2026-09-01 00:00:00', '2026-09-01 00:00:00')`
  )
    .bind(id, opts.brand ?? BRAND, opts.title ?? TITLE, id, status, opts.published ?? 1)
    .run();
}

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function asAdmin(email = ADMIN): Record<string, string> {
  const now = Math.floor(Date.now() / 1000);
  return {
    'Cf-Access-Jwt-Assertion': `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
      email,
      iat: now - 10,
      exp: now + 3600,
    })}.sig`,
  };
}

async function call(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown
): Promise<Response> {
  const init: RequestInit = { method, headers: { ...headers }, redirect: 'manual' };
  if (body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const ctx = createExecutionContext();
  const res = await route(new Request(`https://ose.test${path}`, init), routerEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const preview = (id: string, headers: Record<string, string> = asAdmin()) =>
  call('GET', `/api/v2/admin/events/${id}/preview`, headers);

/**
 * Every table a public visit, share or scan could write to (the OSE-798 split
 * scan path, the return ledger, shortlinks + their click counter, sponsor
 * impressions). Snapshotted in full — not just COUNT(*) — so an UPDATE (a click
 * counter bump) is caught as surely as an INSERT.
 */
const WRITE_TABLES = [
  'scan_placement_events',
  'scan_node_returns',
  'scan_aggregates',
  'anon_id_returns',
  'shortlinks',
  'sponsor_impressions',
];

async function snapshot(): Promise<Record<string, string>> {
  const present = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${WRITE_TABLES.map(() => '?').join(',')})`
  )
    .bind(...WRITE_TABLES)
    .all<{ name: string }>();
  const names = (present.results ?? []).map((r) => r.name).sort();
  // Guard the guard: if the schema drifts so these tables vanish, fail loudly
  // rather than comparing two empty snapshots.
  expect(names.length).toBeGreaterThanOrEqual(4);
  const out: Record<string, string> = {};
  for (const t of names) {
    const rows = await env.DB.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all();
    out[t] = JSON.stringify(rows.results ?? []);
  }
  return out;
}

beforeAll(async () => {
  await applyMigrations();
  (routerEnv as { ADMIN_BRAND_MEMBERSHIP?: string }).ADMIN_BRAND_MEMBERSHIP = JSON.stringify({
    [ADMIN]: [BRAND],
  });
});

describe('OSE-1355 — who can open a preview', () => {
  test('no admin identity → 401 JSON, and the page is never rendered', async () => {
    await seed('evt_dp_auth', 'draft');
    const res = await preview('evt_dp_auth', {});
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain(TITLE);
  });

  test('a browser with no session gets the sign-in page (401 HTML), not the draft', async () => {
    await seed('evt_dp_auth_html', 'draft');
    const res = await preview('evt_dp_auth_html', { Accept: 'text/html' });
    expect(res.status).toBe(401);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const html = await res.text();
    expect(html).not.toContain(TITLE);
    expect(html).not.toContain('admin-draft-preview-toolbar');
  });

  test('an unknown id → 404', async () => {
    const res = await preview('evt_dp_does_not_exist');
    expect(res.status).toBe(404);
  });

  test("another brand's draft → 404 via object scope (never 403, never rendered)", async () => {
    await seed('evt_dp_other_brand', 'draft', { brand: OTHER_BRAND, title: 'Other Brand Secret' });
    const res = await preview('evt_dp_other_brand');
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain('Other Brand Secret');
    expect(text).not.toContain('admin-draft-preview-toolbar');
  });
});

describe('OSE-1355 — a draft renders the real pre-event page, marked as a preview', () => {
  test('200, real renderer content, "Preview — not live" banner, Go live', async () => {
    await seed('evt_dp_draft', 'draft');
    const res = await preview('evt_dp_draft');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const html = await res.text();
    // The real public renderer (renderPreEventHtml), not a second template.
    expect(html).toContain('data-surface="ose-public"');
    expect(html).toContain('data-testid="event-title"');
    expect(html).toContain(TITLE);
    expect(html).toContain('data-testid="event-what"');
    expect(html).toContain('Rolling on the green.');
    expect(html).toContain('data-testid="event-where"');
    // The preview banner.
    expect(html).toContain('data-testid="admin-draft-preview-toolbar"');
    expect(html).toContain('Preview — not live');
    expect(html).toMatch(
      /data-testid="admin-preview-go-live"[^>]*data-event-id="evt_dp_draft"[^>]*data-status="draft"/
    );
  });

  test('never cached, never indexed: no-store + X-Robots-Tag + meta robots', async () => {
    await seed('evt_dp_headers', 'draft');
    const res = await preview('evt_dp_headers');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Robots-Tag')).toMatch(/noindex/);
    expect(await res.text()).toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  test('RSVP and share are inert: no form link, no share URL, no share script', async () => {
    await seed('evt_dp_inert', 'draft');
    const html = await (await preview('evt_dp_inert')).text();
    // RSVP is shown (it is what the public will see) but goes nowhere.
    const rsvp = html.match(/<[a-z]+ [^>]*data-testid="event-rsvp"[^>]*>/)?.[0] ?? '';
    expect(rsvp).toContain('data-preview-inert="true"');
    expect(rsvp).toContain('aria-disabled="true"');
    expect(rsvp).not.toContain('href=');
    expect(html).not.toContain('/forms/evt_dp_inert');
    // Share: disabled button, no URL to share, no Web Share / clipboard script.
    const share = html.match(/<button [^>]*data-testid="share-btn"[^>]*>/)?.[0] ?? '';
    expect(share).toContain('disabled');
    expect(share).not.toContain('data-share-url');
    expect(html).not.toContain('navigator.share');
    // No shortlink mint or form submit is reachable from the page.
    expect(html).not.toContain('/s/');
    expect(html).not.toMatch(/<form[\s>]/);
  });

  test('CSP stays nonce-based: every inline script carries the header nonce, no on* handlers', async () => {
    await seed('evt_dp_csp', 'draft');
    const res = await preview('evt_dp_csp');
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    const html = await res.text();
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) expect(s).toContain(`nonce="${nonce}"`);
    expect(html).not.toMatch(/\son(click|load|submit)=/i);
  });

  test('a ready event previews too, and its Go live skips the draft→ready step', async () => {
    await seed('evt_dp_ready', 'ready');
    const res = await preview('evt_dp_ready');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Preview — not live');
    expect(html).toMatch(/data-testid="admin-preview-go-live"[^>]*data-status="ready"/);
  });
});

describe('OSE-1355 — events that are not drafts', () => {
  test('active → 303 to the real public page (it is public; that page is the preview)', async () => {
    await seed('evt_dp_active', 'active');
    const res = await preview('evt_dp_active');
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/events/evt_dp_active');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  test('archived → 404, no preview rendered', async () => {
    await seed('evt_dp_archived', 'archived');
    const res = await preview('evt_dp_archived');
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).not.toContain('admin-draft-preview-toolbar');
    expect(res.headers.get('X-Robots-Tag')).toMatch(/noindex/);
  });
});

describe('OSE-1355 — a preview writes nothing and publishes nothing', () => {
  test('no scan / click / impression / shortlink rows, no lifecycle change', async () => {
    await seed('evt_dp_nowrite', 'draft', { published: 0 });
    const before = await snapshot();
    const eventBefore = await env.DB.prepare(
      'SELECT status, is_published, qr_verified, updated_at FROM events WHERE id = ?'
    )
      .bind('evt_dp_nowrite')
      .first();
    for (let i = 0; i < 3; i++) expect((await preview('evt_dp_nowrite')).status).toBe(200);
    expect(await snapshot()).toEqual(before);
    const eventAfter = await env.DB.prepare(
      'SELECT status, is_published, qr_verified, updated_at FROM events WHERE id = ?'
    )
      .bind('evt_dp_nowrite')
      .first();
    expect(eventAfter).toEqual(eventBefore);
  });

  test('the public /events/:id still does NOT serve the draft (before or after a preview)', async () => {
    await seed('evt_dp_public', 'draft');
    expect((await call('GET', '/events/evt_dp_public')).status).toBe(404);
    await preview('evt_dp_public');
    const res = await call('GET', '/events/evt_dp_public');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(TITLE);
  });

  test('the draft never appears in the public events list', async () => {
    await seed('evt_dp_listing', 'draft', { title: 'Listing Leak Canary' });
    await preview('evt_dp_listing');
    const res = await call('GET', '/api/v2/events');
    expect(await res.text()).not.toContain('evt_dp_listing');
  });
});

describe('OSE-1355 — Go live from the preview uses the existing state-machine doors', () => {
  test('the Go live script calls PUT {status:"ready"} then POST /verify-qr, never is_published', async () => {
    await seed('evt_dp_script', 'draft');
    const html = await (await preview('evt_dp_script')).text();
    const script = (html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/g) ?? []).find((s) =>
      s.includes('adminPreviewGoLive')
    );
    expect(script).toBeTruthy();
    expect(script).toContain("'/api/v2/admin/events/'+encodeURIComponent(id)");
    expect(script).toContain("call(base,'PUT',{status:'ready'})");
    expect(script).toContain("call(base+'/verify-qr','POST')");
    expect(script).toContain("window.location.href='/events/'+encodeURIComponent(id)");
    expect(script).not.toContain('is_published');
  });

  test('those two calls take a draft live, and the preview then hands off to the public page', async () => {
    const id = 'evt_dp_golive';
    await seed(id, 'draft');
    const put = await call('PUT', `/api/v2/admin/events/${id}`, asAdmin(), { status: 'ready' });
    expect(put.status).toBe(200);
    const verify = await call('POST', `/api/v2/admin/events/${id}/verify-qr`, asAdmin());
    expect(verify.status).toBe(200);
    const row = await env.DB.prepare(
      'SELECT status, qr_verified, is_published FROM events WHERE id = ?'
    )
      .bind(id)
      .first<{ status: string; qr_verified: number; is_published: number }>();
    expect(row).toEqual({ status: 'active', qr_verified: 1, is_published: 1 });
    expect((await call('GET', `/events/${id}`)).status).toBe(200);
    const after = await preview(id);
    expect(after.status).toBe(303);
    expect(after.headers.get('Location')).toBe(`/events/${id}`);
  });

  test('an unlisted draft is told it stays unlisted instead of being sent to a 404', async () => {
    await seed('evt_dp_unlisted', 'draft', { published: 0 });
    const html = await (await preview('evt_dp_unlisted')).text();
    expect(html).toMatch(/data-testid="admin-preview-go-live"[^>]*data-listed="0"/);
    expect(html).toContain('Live, but unlisted');
  });
});

describe('OSE-1355 — the admin list offers Preview only for draft and ready', () => {
  test('the served admin page gates the Preview link on draft || ready', async () => {
    const res = await call('GET', '/admin', asAdmin());
    expect(res.status).toBe(200);
    const html = await res.text();
    const line = html.split('\n').find((l) => l.includes('data-testid="event-preview-link"')) ?? '';
    expect(line).toMatch(/var preview = e\.status === 'draft' \|\| e\.status === 'ready' \?/);
    expect(line).not.toMatch(/'active'|'archived'/);
    expect(line).toContain('href="/api/v2/admin/events/\' + safeId + \'/preview"');
  });
});
