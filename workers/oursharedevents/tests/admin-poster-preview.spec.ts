/**
 * Admin-only poster preview (2026-10-02). An organizer who is not a designer
 * sees the real poster for a draft before publishing, through
 * GET /api/v2/admin/events/:id/poster-preview (HTML) and its data call
 * GET /api/v2/admin/events/:id/poster-bundle. The public poster-bundle keeps
 * refusing drafts; nothing becomes public by previewing.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { rateLimitKvKey } from '../src/lib/rate-limit';
import { PUBLIC_READ_MAX } from '../src/lib/public-read-limit';
import { EDGE_WINDOW_SECONDS } from '../src/lib/edge-rate-limit';

const BRAND = 'poster-preview-brand';
const OTHER_BRAND = 'poster-preview-other';
const ADMIN_EMAIL = 'poster-preview-admin@ose.test';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  // The poster bundle reads per-event feature flags from FORMS_DB too.
  const runs: Array<[D1Database, string[]]> = [
    [tenv.DB, JSON.parse(tenv.TEST_MIGRATION_STATEMENTS)],
    [tenv.FORMS_DB, JSON.parse(tenv.TEST_FORMS_MIGRATION_STATEMENTS)],
  ];
  for (const [db, stmts] of runs)
    for (const stmt of stmts) {
      try {
        await db.prepare(stmt).run();
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

async function seed(id: string, status: string, brand = BRAND): Promise<void> {
  const db = (env as unknown as TestEnv).DB;
  await db.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  await db
    .prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, is_published, qr_verified, location,
                           start_date, timezone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, 'Eagles Hall', '2026-12-02', 'America/Chicago',
               datetime('now'), datetime('now'))`
    )
    .bind(id, brand, 'Poster Preview Night', id, status, status === 'active' ? 1 : 0)
    .run();
}

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function jwtFor(email: string): string {
  const now = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ email, iat: now - 10, exp: now + 3600 })}.sig`;
}
// A signed-in person is a browser on the admin site (admin write guard).
const admin = { 'Cf-Access-Jwt-Assertion': jwtFor(ADMIN_EMAIL), 'Sec-Fetch-Site': 'same-origin' };
const page = (id: string) => `https://t.test/api/v2/admin/events/${id}/poster-preview`;
const bundle = (id: string) => `https://t.test/api/v2/admin/events/${id}/poster-bundle`;

beforeAll(async () => {
  await applyMigrations();
  const tenv = env as unknown as TestEnv & {
    ADMIN_BRAND_MEMBERSHIP?: string;
    ALLOWED_ADMIN_EMAILS?: string;
  };
  tenv.ADMIN_BRAND_MEMBERSHIP = JSON.stringify({ [ADMIN_EMAIL]: [BRAND] });
  tenv.ALLOWED_ADMIN_EMAILS = ADMIN_EMAIL;
});

describe('admin poster preview: who can open it', () => {
  test('no admin session: both routes refuse', async () => {
    await seed('evt_pp_auth', 'draft');
    expect((await SELF.fetch(page('evt_pp_auth'))).status).toBe(401);
    expect((await SELF.fetch(bundle('evt_pp_auth'))).status).toBe(401);
  });

  test("another brand's draft is not found, not previewed", async () => {
    await seed('evt_pp_other', 'draft', OTHER_BRAND);
    expect((await SELF.fetch(page('evt_pp_other'), { headers: admin })).status).toBe(404);
    expect((await SELF.fetch(bundle('evt_pp_other'), { headers: admin })).status).toBe(404);
  });
});

describe('admin poster preview: a draft', () => {
  test('renders the real poster in preview mode, never cached or indexed', async () => {
    await seed('evt_pp_draft', 'draft');
    const res = await SELF.fetch(page('evt_pp_draft'), { headers: admin });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    const html = await res.text();
    expect(html).toContain('data-preview-event="evt_pp_draft"');
    expect(html).toContain('data-testid="admin-draft-preview-toolbar"');
    expect(html).toContain('data-live-url="/events/evt_pp_draft/poster"');
    // The bar never prints; a test print carries a DRAFT mark instead
    // (OSE-1508), hidden on screen and shown only on paper.
    expect(html).toMatch(/@media print\{\.admin-preview-toolbar\{display:none\}/);
    expect(html).toContain('data-testid="poster-draft-mark"');
    expect(html).toContain('DRAFT \u2014 not live yet');
    expect(html).toMatch(/\.draft-mark\{display:none\}/);
    // Fixed, so it overlays the sheet instead of taking room: it can never push
    // the one-page poster onto a second sheet (verified by a Chromium PDF).
    expect(html).toMatch(/@media print\{[^}]*\}\.draft-mark\{display:block;position:fixed/);
    // Every script carries the response's nonce, exactly once.
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    const scripts = html.match(/<script\b[^>]*>/gi) ?? [];
    expect(scripts.length).toBeGreaterThan(1);
    for (const tag of scripts) {
      expect(tag.match(/nonce=/g)?.length, tag).toBe(1);
      expect(tag).toContain(`nonce="${nonce}"`);
    }
  });

  test('the admin bundle serves the draft; the public bundle still refuses it', async () => {
    await seed('evt_pp_bundle', 'draft');
    const res = await SELF.fetch(bundle('evt_pp_bundle'), { headers: admin });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const data = (await res.json()) as { ok: boolean; event: { title?: string; name?: string } };
    expect(data.ok).toBe(true);
    expect(data.event.title ?? data.event.name).toBe('Poster Preview Night');
    const pub = await SELF.fetch(`https://t.test/api/v2/events/evt_pp_bundle/poster-bundle`);
    expect(pub.status).toBe(403);
  });

  test('previewing mints no shortlinks; codes point straight at the event', async () => {
    const id = 'evt_pp_nomint';
    await seed(id, 'draft');
    const db = (env as unknown as TestEnv).DB;
    await db.prepare('DELETE FROM shortlinks WHERE event_id = ?').bind(id).run();
    const res = await SELF.fetch(bundle(id), { headers: admin });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      slots: Array<{ kind: string; code: string | null; url: string }>;
    };
    expect(data.slots[0]).toMatchObject({
      kind: 'public',
      code: null,
      url: `https://t.test/events/${id}`,
    });
    await SELF.fetch(page(id), { headers: admin });
    const n = await db
      .prepare('SELECT COUNT(*) AS n FROM shortlinks WHERE event_id = ?')
      .bind(id)
      .first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  test('previewing changes nothing about the event', async () => {
    await seed('evt_pp_nochange', 'draft');
    await SELF.fetch(page('evt_pp_nochange'), { headers: admin });
    await SELF.fetch(bundle('evt_pp_nochange'), { headers: admin });
    const row = await (env as unknown as TestEnv).DB.prepare(
      'SELECT status, is_published FROM events WHERE id = ?'
    )
      .bind('evt_pp_nochange')
      .first();
    expect(row).toEqual({ status: 'draft', is_published: 1 });
  });
});

describe('opening a preview leaves no audit trail; a change does', () => {
  test('poster and page previews write no admin_audit_log row', async () => {
    const id = 'evt_pp_audit';
    await seed(id, 'draft');
    const db = (env as unknown as TestEnv).DB;
    await db.prepare('DELETE FROM admin_audit_log WHERE resource_id = ?').bind(id).run();
    await SELF.fetch(page(id), { headers: admin });
    await SELF.fetch(bundle(id), { headers: admin });
    await SELF.fetch(`https://t.test/api/v2/admin/events/${id}/preview`, { headers: admin });
    // Control: one real change. Audit rows are written after the response
    // (waitUntil), so wait for THIS row; then any row a preview wrote earlier
    // would already be there too.
    const put = await SELF.fetch(`https://t.test/api/v2/admin/events/${id}`, {
      method: 'PUT',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { displayDwellSeconds: 30 } }),
    });
    expect(put.status).toBe(200);
    let rows: Array<{ action: string }> = [];
    for (let i = 0; i < 50 && rows.length === 0; i++) {
      rows = (
        await db
          .prepare('SELECT action FROM admin_audit_log WHERE resource_id = ? ORDER BY id')
          .bind(id)
          .all<{ action: string }>()
      ).results;
      if (rows.length === 0) await new Promise((r) => setTimeout(r, 20));
    }
    expect(rows.map((r) => r.action)).toEqual(['UPDATE_EVENT']);
  });
});

describe('admin poster preview: other states', () => {
  test('the real poster carries no DRAFT mark', async () => {
    const html = await (await SELF.fetch('https://t.test/poster?event=evt_pp_draft')).text();
    expect(html).not.toContain('poster-draft-mark');
  });

  test('a live event goes to its real poster', async () => {
    await seed('evt_pp_live', 'active');
    const res = await SELF.fetch(page('evt_pp_live'), { headers: admin, redirect: 'manual' });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/events/evt_pp_live/poster');
  });

  test('the admin bundle is rate-limited per caller (it draws QR images every call)', async () => {
    await seed('evt_pp_limit', 'draft');
    const ip = '203.0.113.77';
    const headers = { ...admin, 'CF-Connecting-IP': ip };
    expect((await SELF.fetch(bundle('evt_pp_limit'), { headers })).status).toBe(200);
    // Spend the rest of this caller's minute.
    const E = env as unknown as {
      RATE_LIMIT_KV: KVNamespace;
      RATE_LIMIT_KEY_PEPPER?: string;
    };
    const key = await rateLimitKvKey(
      `publicread:admin-poster-bundle:${ip}`,
      E.RATE_LIMIT_KEY_PEPPER
    );
    await E.RATE_LIMIT_KV.put(
      key,
      JSON.stringify({ count: PUBLIC_READ_MAX, resetAt: Date.now() + 60_000, max: PUBLIC_READ_MAX })
    );
    const limited = await SELF.fetch(bundle('evt_pp_limit'), { headers });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe(String(EDGE_WINDOW_SECONDS));
    // Another caller is unaffected.
    const other = await SELF.fetch(bundle('evt_pp_limit'), {
      headers: { ...admin, 'CF-Connecting-IP': '203.0.113.78' },
    });
    expect(other.status).toBe(200);
  });

  test('an archived event has nothing to preview', async () => {
    await seed('evt_pp_arch', 'archived');
    expect((await SELF.fetch(page('evt_pp_arch'), { headers: admin })).status).toBe(404);
    expect((await SELF.fetch(bundle('evt_pp_arch'), { headers: admin })).status).toBe(403);
  });
});
