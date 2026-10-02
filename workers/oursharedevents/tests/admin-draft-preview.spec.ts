import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const BRAND = 'ose1355-preview';
const ADMIN_EMAIL = 'preview-admin@ose.test';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const stmts: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv.DB.prepare(stmt).run();
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

async function seedDraft(id: string): Promise<void> {
  const db = (env as unknown as TestEnv).DB;
  await db.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  await db
    .prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, is_published, location,
                           start_date, end_date, timezone, what_short, who_host,
                           why_purpose, how_details, where_address, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .bind(
      id,
      BRAND,
      'Draft Preview Smoke',
      id,
      'Eagles Bowl',
      '2026-12-02T02:00:00.000Z',
      '2026-12-02T04:00:00.000Z',
      'America/Chicago',
      'A real public renderer preview.',
      'Beverly Hills Bocce League',
      'Make the draft reviewable before it goes live.',
      'Bring the poster proof.',
      '12345 South Western Ave, Blue Island IL 60406'
    )
    .run();
}

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jwtFor(email: string): string {
  const now = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ email, iat: now - 10, exp: now + 3600 })}.sig`;
}

function adminHeaders(): HeadersInit {
  return { 'Cf-Access-Jwt-Assertion': jwtFor(ADMIN_EMAIL) };
}

beforeAll(async () => {
  await applyMigrations();
  const tenv = env as unknown as TestEnv & {
    ADMIN_BRAND_MEMBERSHIP?: string;
    ALLOWED_ADMIN_EMAILS?: string;
  };
  tenv.ADMIN_BRAND_MEMBERSHIP = JSON.stringify({ [ADMIN_EMAIL]: [BRAND] });
  tenv.ALLOWED_ADMIN_EMAILS = ADMIN_EMAIL;
});

describe('OSE-1355 admin-only draft preview', () => {
  test('unauthenticated preview requests are blocked', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/events/evt_ose1355_auth/preview');
    expect(res.status).toBe(401);
  });

  test('authenticated draft preview renders the real public pre-event page plus admin toolbar', async () => {
    const id = 'evt_ose1355_preview';
    await seedDraft(id);

    const res = await SELF.fetch(`https://t.test/api/v2/admin/events/${id}/preview`, {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const html = await res.text();

    expect(html).toContain('data-testid="admin-draft-preview-toolbar"');
    expect(html).toContain('data-testid="admin-preview-go-live"');
    expect(html).toContain('data-testid="event-title"');
    expect(html).toContain('Draft Preview Smoke');
    expect(html).toContain('data-testid="event-what"');
    expect(html).toContain('A real public renderer preview.');
    expect(html).toContain('data-testid="event-rsvp"');
    // OSE-1355: the RSVP is shown but inert in a preview — no live form link.
    expect(html).not.toContain(`/forms/${id}?type=register`);
  });

  test('opening the preview does not publish or change lifecycle state', async () => {
    const id = 'evt_ose1355_no_mutation';
    await seedDraft(id);

    const res = await SELF.fetch(`https://t.test/api/v2/admin/events/${id}/preview`, {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);

    const row = await (env as unknown as TestEnv).DB.prepare(
      'SELECT status, is_published FROM events WHERE id = ?'
    )
      .bind(id)
      .first<{ status: string; is_published: number }>();
    expect(row).toEqual({ status: 'draft', is_published: 0 });
  });
});

describe('preview after publishing (the publish / unpublish loop)', () => {
  async function seedLive(id: string, listed: 0 | 1): Promise<void> {
    await seedDraft(id);
    await (env as unknown as TestEnv).DB.prepare(
      "UPDATE events SET status = 'active', qr_verified = 1, is_published = ? WHERE id = ?"
    )
      .bind(listed, id)
      .run();
  }

  test('live and listed: the preview goes to the public page', async () => {
    await seedLive('evt_preview_live_listed', 1);
    const res = await SELF.fetch(
      'https://t.test/api/v2/admin/events/evt_preview_live_listed/preview',
      {
        headers: adminHeaders(),
        redirect: 'manual',
      }
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/events/evt_preview_live_listed');
  });

  test('live but unlisted: no public page exists, so the preview renders here', async () => {
    const id = 'evt_preview_live_unlisted';
    await seedLive(id, 0);
    // The public page 404s by design for an unlisted event...
    expect((await SELF.fetch(`https://t.test/events/${id}`)).status).toBe(404);
    // ...so a redirect there would strand the organizer on "couldn't find".
    const res = await SELF.fetch(`https://t.test/api/v2/admin/events/${id}/preview`, {
      headers: adminHeaders(),
      redirect: 'manual',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const html = await res.text();
    expect(html).toContain('Draft Preview Smoke');
    expect(html).toContain('Live, unlisted');
    // Already published: no Publish button to press again.
    expect(html).not.toContain('data-testid="admin-preview-go-live"');
  });
});
