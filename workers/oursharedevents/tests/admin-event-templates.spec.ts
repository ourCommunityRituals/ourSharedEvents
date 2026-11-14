/**
 * OSE-868 — GET /api/v2/admin/event-templates (L2, live D1).
 *
 * migration 0015 seeds the event templates (incl. their `default_sections`
 * payload) but no route exposed them, so the launch wizard's template picker
 * fell back to a hardcoded list. This endpoint is the FE↔DB read seam: the
 * picker populates from here, and a selection sets `events.template_id` through
 * the existing write path without touching the slug (Invariant #18).
 *
 * Drives the full worker (SELF.fetch) over a migrated D1. Gates:
 *   G1 — endpoint returns 200 with every seeded template, each carrying
 *        `default_sections` as a parsed object (not a JSON string)
 *   G2 — the count equals the ACTUAL rows in D1 (dynamic, never a hardcoded 32)
 *   G3 — selecting a returned template on an event persists `template_id` and
 *        leaves the slug unchanged (Invariant #18 slug_permanence)
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const ADMIN_HEADERS = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const BRAND = 'ose868-test';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

interface TemplatesResponse {
  ok: boolean;
  items: Array<{
    id: string;
    name: string;
    category: string;
    default_sections: unknown;
    default_ctas: unknown;
    default_ui_presets: unknown;
  }>;
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
});

describe('OSE-868 G1/G2 — GET /api/v2/admin/event-templates returns the seeded rows', () => {
  test('200 with every seeded template, each carrying default_sections as an object', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/event-templates', {
      headers: ADMIN_HEADERS,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TemplatesResponse;
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);

    for (const t of body.items) {
      expect(t.id, 'template must have an id').toBeTruthy();
      expect(t.name, 'template must have a name').toBeTruthy();
      expect(t.category, 'template must have a category (for the grouped picker)').toBeTruthy();
      // default_sections is the payload the picker + gates depend on — it must be
      // a parsed object, never the raw JSON string from the column.
      expect(
        typeof t.default_sections === 'object' && t.default_sections !== null,
        `default_sections must be a parsed object for ${t.id}`
      ).toBe(true);
      expect(Array.isArray(t.default_ctas), `default_ctas must be an array for ${t.id}`).toBe(true);
    }
  });

  test('count equals the actual rows in D1 (not a hard-coded number)', async () => {
    const tenv = env as unknown as TestEnv;
    const row = await tenv.DB.prepare('SELECT COUNT(*) AS n FROM event_templates').first<{
      n: number;
    }>();
    const dbCount = row?.n ?? 0;
    expect(dbCount, 'seed must have populated event_templates').toBeGreaterThan(0);

    const res = await SELF.fetch('https://t.test/api/v2/admin/event-templates', {
      headers: ADMIN_HEADERS,
    });
    const body = (await res.json()) as TemplatesResponse;
    expect(body.items.length, 'endpoint must return exactly the rows that exist in D1').toBe(
      dbCount
    );
  });
});

describe('OSE-868 G3 — selecting a template sets template_id and preserves the slug (Invariant #18)', () => {
  test('PUT template_id from a returned template persists it, slug unchanged', async () => {
    // Pull a real template id from the endpoint (the FE would do the same).
    const listRes = await SELF.fetch('https://t.test/api/v2/admin/event-templates', {
      headers: ADMIN_HEADERS,
    });
    const templates = (await listRes.json()) as TemplatesResponse;
    const chosen = templates.items[0]!;
    expect(chosen?.id).toBeTruthy();

    // Create an event with a fixed slug and NO template.
    const slug = `ose868-slugcheck-${Date.now().toString(36)}`;
    const createRes = await SELF.fetch('https://t.test/api/v2/admin/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
      body: JSON.stringify({
        attendance_mode: 'in_person',
        location: 'Test Hall',
        title: 'OSE-868 template round-trip',
        brand_id: BRAND,
        slug,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; slug: string };
    const eventId = created.id;

    // Select the template — set template_id via the existing update path.
    const putRes = await SELF.fetch(`https://t.test/api/v2/admin/events/${eventId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
      body: JSON.stringify({ template_id: chosen.id }),
    });
    expect(putRes.status).toBe(200);

    // Re-read from D1: template_id persisted, slug untouched (Invariant #18).
    const tenv = env as unknown as TestEnv;
    const rrow = await tenv.DB.prepare('SELECT template_id, slug FROM events WHERE id = ?')
      .bind(eventId)
      .first<{ template_id: string | null; slug: string }>();
    expect(rrow?.template_id, 'template selection must persist template_id').toBe(chosen.id);
    expect(rrow?.slug, 'template selection must NOT change the slug (Invariant #18)').toBe(slug);
  });
});
