/**
 * Admin-only poster preview (2026-10-02). An organizer who is not a designer
 * sees the real poster for a draft before publishing, through
 * GET /api/v2/admin/events/:id/poster-preview (HTML) and its data call
 * GET /api/v2/admin/events/:id/poster-bundle. The public poster-bundle keeps
 * refusing drafts; nothing becomes public by previewing.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

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
const admin = { 'Cf-Access-Jwt-Assertion': jwtFor(ADMIN_EMAIL) };
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
    expect(html).toContain('data-live-url="/poster?event=evt_pp_draft"');
    // The bar never prints, so a test print looks like the real poster.
    expect(html).toMatch(/@media print\{\.admin-preview-toolbar\{display:none\}\}/);
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

describe('admin poster preview: other states', () => {
  test('a live event goes to its real poster', async () => {
    await seed('evt_pp_live', 'active');
    const res = await SELF.fetch(page('evt_pp_live'), { headers: admin, redirect: 'manual' });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/poster?event=evt_pp_live');
  });

  test('an archived event has nothing to preview', async () => {
    await seed('evt_pp_arch', 'archived');
    expect((await SELF.fetch(page('evt_pp_arch'), { headers: admin })).status).toBe(404);
    expect((await SELF.fetch(bundle('evt_pp_arch'), { headers: admin })).status).toBe(403);
  });
});
