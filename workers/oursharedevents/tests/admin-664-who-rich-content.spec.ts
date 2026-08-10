/**
 * OSE-664 — Admin authoring of the rich 5W / WHO content (L2).
 *
 * The plain 5W text fields (OSE-239a) are covered by admin-event-5w.spec.ts.
 * This file covers the RICH supply side OSE-664 adds — the WHO conversion
 * engine — across the full POST/PUT → DB → render cycle:
 *
 *   who_story       host/artist story (rich text)
 *   who_image_url   WHO media reference (image; http(s) only)
 *   what_video_url  WHAT video reference (http(s) only)
 *
 * Born-red seam (feeds red-team OSE-662): host-supplied content is untrusted.
 *   - Media URLs: any non-http(s) scheme (javascript:/data:/…) is rejected at
 *     the API layer (400) so it never reaches D1.
 *   - Story rich text: stored raw, escaped on render — an authored <script>
 *     cannot execute on the public funnel.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const ADMIN_HEADERS = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const BRAND = 'ose664-test';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

interface CreateResponse {
  ok: boolean;
  status?: number;
  id?: string;
  error?: string;
  code?: string;
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

beforeAll(async () => {
  await applyMigrations();
  const tenv = env as unknown as TestEnv;
  await tenv.DB.prepare('DELETE FROM events WHERE brand_id = ?').bind(BRAND).run();
});

async function postEvent(body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch('https://t.test/api/v2/admin/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
    body: JSON.stringify(body),
  });
}

async function readRow(id: string): Promise<Record<string, unknown> | null> {
  const tenv = env as unknown as TestEnv;
  return tenv.DB.prepare(
    'SELECT who_story, who_image_url, what_video_url FROM events WHERE id = ?'
  )
    .bind(id)
    .first<Record<string, unknown>>();
}

describe('OSE-664: rich WHO / WHAT authoring persists', () => {
  test('POST with story + media URLs persists every column', async () => {
    const res = await postEvent({
      title: 'OSE-664 Rich Content Event',
      brand_id: BRAND,
      who_story: 'DJ Mallang has spun every block party on the south side since 2019.',
      who_image_url: 'https://cdn.example.com/host.jpg',
      what_video_url: 'https://videos.example.com/teaser.mp4',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as CreateResponse;
    expect(body.ok).toBe(true);

    const row = await readRow(body.id!);
    expect(row).toBeDefined();
    expect(row!.who_story).toBe(
      'DJ Mallang has spun every block party on the south side since 2019.'
    );
    expect(row!.who_image_url).toBe('https://cdn.example.com/host.jpg');
    expect(row!.what_video_url).toBe('https://videos.example.com/teaser.mp4');
  });

  test('POST with no rich fields persists all three as null (backward-compat)', async () => {
    const res = await postEvent({ title: 'OSE-664 Bare Event', brand_id: BRAND });
    const body = (await res.json()) as CreateResponse;
    const row = await readRow(body.id!);
    expect(row!.who_story).toBeNull();
    expect(row!.who_image_url).toBeNull();
    expect(row!.what_video_url).toBeNull();
  });

  test('POST empty-string story persists as null (not "")', async () => {
    const res = await postEvent({
      title: 'OSE-664 Empty Story',
      brand_id: BRAND,
      who_story: '   \n\t ',
    });
    const body = (await res.json()) as CreateResponse;
    const row = await readRow(body.id!);
    expect(row!.who_story).toBeNull();
  });

  test('POST oversized story is truncated to 4000 chars', async () => {
    const res = await postEvent({
      title: 'OSE-664 Long Story',
      brand_id: BRAND,
      who_story: 'z'.repeat(6000),
    });
    const body = (await res.json()) as CreateResponse;
    const row = await readRow(body.id!);
    expect((row!.who_story as string).length).toBe(4000);
  });

  test('PUT updates story + media URLs', async () => {
    const createRes = await postEvent({ title: 'OSE-664 Update Target', brand_id: BRAND });
    const created = (await createRes.json()) as CreateResponse;

    const putRes = await SELF.fetch(`https://t.test/api/v2/admin/events/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
      body: JSON.stringify({
        who_story: 'Updated host story.',
        who_image_url: 'https://cdn.example.com/updated.png',
        what_video_url: 'https://videos.example.com/updated.mp4',
      }),
    });
    expect(putRes.status).toBeLessThan(300);

    const row = await readRow(created.id!);
    expect(row!.who_story).toBe('Updated host story.');
    expect(row!.who_image_url).toBe('https://cdn.example.com/updated.png');
    expect(row!.what_video_url).toBe('https://videos.example.com/updated.mp4');
  });
});

describe('OSE-664: born-red media-URL scheme wall (feeds OSE-662)', () => {
  const HOSTILE_URLS = [
    'javascript:alert(document.cookie)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'not a url at all',
  ];

  for (const hostile of HOSTILE_URLS) {
    test(`POST rejects who_image_url = ${JSON.stringify(hostile)} with 400`, async () => {
      const res = await postEvent({
        title: 'OSE-664 Hostile Image URL',
        brand_id: BRAND,
        who_image_url: hostile,
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as CreateResponse;
      expect(body.ok).toBe(false);
      expect(body.code).toBe('INVALID_URL');
    });

    test(`POST rejects what_video_url = ${JSON.stringify(hostile)} with 400`, async () => {
      const res = await postEvent({
        title: 'OSE-664 Hostile Video URL',
        brand_id: BRAND,
        what_video_url: hostile,
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as CreateResponse;
      expect(body.code).toBe('INVALID_URL');
    });
  }

  test('PUT rejects a hostile media URL with 400', async () => {
    const createRes = await postEvent({ title: 'OSE-664 PUT Hostile', brand_id: BRAND });
    const created = (await createRes.json()) as CreateResponse;
    const putRes = await SELF.fetch(`https://t.test/api/v2/admin/events/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
      body: JSON.stringify({ who_image_url: 'javascript:alert(1)' }),
    });
    expect(putRes.status).toBe(400);
    // The bad update must not have landed.
    const row = await readRow(created.id!);
    expect(row!.who_image_url).toBeNull();
  });
});

describe('OSE-664: admin form carries the rich-content inputs', () => {
  test('admin page renders data-testid for story + media inputs', async () => {
    const res = await SELF.fetch('https://t.test/admin', { headers: ADMIN_HEADERS });
    const html = await res.text();
    for (const testid of [
      'create-who-story',
      'create-who-image-url',
      'create-what-video-url',
    ]) {
      expect(
        html.includes(`data-testid="${testid}"`),
        `admin form HTML missing data-testid="${testid}"`
      ).toBe(true);
    }
  });

  test('admin form JS submits the rich-content API field names', async () => {
    const res = await SELF.fetch('https://t.test/admin', { headers: ADMIN_HEADERS });
    const html = await res.text();
    for (const apiField of ['who_story', 'who_image_url', 'what_video_url']) {
      expect(
        html.includes(`'${apiField}'`),
        `admin form JS missing API field name '${apiField}'`
      ).toBe(true);
    }
  });
});

describe('OSE-664: XSS output wall — authored story is escaped on render', () => {
  test('a <script> in who_story cannot execute on the public funnel', async () => {
    const tenv = env as unknown as TestEnv;
    const id = 'evt_ose664_xss';
    const payload = '<script>alert("xss")</script>';
    const start = new Date(Date.now() + 7 * 86400000); // +7d → pre_event phase
    await tenv.DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
    await tenv.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, start_date,
                           who_host, who_story, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(id, BRAND, 'OSE-664 XSS Event', id, start.toISOString(), 'Host Name', payload)
      .run();

    const res = await SELF.fetch(`https://t.test/events/${id}`);
    expect(res.status).toBe(200);
    const html = await res.text();

    // The story surfaces...
    expect(html).toContain('data-testid="event-who-story"');
    // ...but the raw <script> must NOT appear — only its escaped form.
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
