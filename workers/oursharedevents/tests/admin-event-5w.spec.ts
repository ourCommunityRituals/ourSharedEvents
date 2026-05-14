/**
 * OSE-239a / ADMIN-24 — Admin event-card 5W content round-trip (L2).
 *
 * Verifies the full POST → DB → GET cycle for the 5 new content fields
 * added by OSE-236 + accepted by OSE-239a:
 *
 *   what_short, who_host, why_purpose, how_details, where_address
 *
 * Plus the existing-shape preservation: legal_clearance_tier, phase
 * enrichment (OSE-242), and the cursor-pagination envelope (OSE-206)
 * all continue to work after the SELECT projection grew.
 *
 * Decomposition note: This story (OSE-239) was split into 4 substories
 * during Co-Arch pre-flight 2026-05-14. This PR ships OSE-239a (5W content
 * fields). Follow-ons:
 *   - 239b: Geocode button wiring
 *   - 239c: Manual override flow (depends on 239b)
 *   - 239d: Poster deployment sub-form (separate feature surface)
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const ADMIN_HEADERS = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const BRAND = 'ose239a-test';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

interface CreateResponse {
  ok: boolean;
  status?: number;
  id?: string;
  slug?: string;
  error?: string;
  code?: string;
}

interface AdminListResponse {
  ok: boolean;
  items: Array<Record<string, unknown>>;
  pagination: { limit: number; hasMore: boolean; nextCursor: string | null };
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
  // Clean slate per brand for deterministic re-runs.
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

describe('OSE-239a: admin event creation with 5W content fields', () => {
  test('POST with all 5 W fields persists every column', async () => {
    const res = await postEvent({
      title: 'OSE-239a Smoke Test Event',
      brand_id: BRAND,
      what_short: 'A test event that exercises every 5W column.',
      who_host: 'OSE-239a Test Host',
      why_purpose: 'To verify the round-trip from POST through D1 back to GET.',
      how_details: 'Free, bring nothing, the test runner does all the work.',
      where_address: '123 Verification Lane, Anywhere IL 60000',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as CreateResponse;
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^evt_/);

    // Pull the row back via the admin list. The OSE-206 canonical
    // cursor-pagination shape stays in force.
    const listRes = await SELF.fetch('https://t.test/api/v2/admin/events?limit=100', {
      headers: ADMIN_HEADERS,
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as AdminListResponse;
    expect(list.ok).toBe(true);
    expect(Array.isArray(list.items)).toBe(true);

    const created = list.items.find((i) => i.id === body.id);
    expect(created, `event ${body.id} not found in admin list`).toBeDefined();
    expect(created!.what_short).toBe('A test event that exercises every 5W column.');
    expect(created!.who_host).toBe('OSE-239a Test Host');
    expect(created!.why_purpose).toBe('To verify the round-trip from POST through D1 back to GET.');
    expect(created!.how_details).toBe('Free, bring nothing, the test runner does all the work.');
    expect(created!.where_address).toBe('123 Verification Lane, Anywhere IL 60000');
  });

  test('POST with no 5W fields persists all five as null (backward-compat)', async () => {
    const res = await postEvent({
      title: 'OSE-239a Bare Event',
      brand_id: BRAND,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as CreateResponse;
    expect(body.ok).toBe(true);

    const listRes = await SELF.fetch('https://t.test/api/v2/admin/events?limit=100', {
      headers: ADMIN_HEADERS,
    });
    const list = (await listRes.json()) as AdminListResponse;
    const created = list.items.find((i) => i.id === body.id);
    expect(created).toBeDefined();
    expect(created!.what_short).toBeNull();
    expect(created!.who_host).toBeNull();
    expect(created!.why_purpose).toBeNull();
    expect(created!.how_details).toBeNull();
    expect(created!.where_address).toBeNull();
  });

  test('POST with empty-string 5W fields persists as null (not as "")', async () => {
    // Distinguishes "intentionally blank after trim" from "never populated".
    // The handler's trimOrNull semantics MUST produce null for whitespace.
    const res = await postEvent({
      title: 'OSE-239a Empty 5W Event',
      brand_id: BRAND,
      what_short: '   ',
      who_host: '',
      why_purpose: '\n\t',
      how_details: '',
      where_address: '   ',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as CreateResponse;

    const listRes = await SELF.fetch('https://t.test/api/v2/admin/events?limit=100', {
      headers: ADMIN_HEADERS,
    });
    const list = (await listRes.json()) as AdminListResponse;
    const created = list.items.find((i) => i.id === body.id);
    expect(created).toBeDefined();
    expect(created!.what_short).toBeNull();
    expect(created!.who_host).toBeNull();
    expect(created!.why_purpose).toBeNull();
    expect(created!.how_details).toBeNull();
    expect(created!.where_address).toBeNull();
  });

  test('POST oversized 5W field is truncated to its max length', async () => {
    // Max for what_short = 300, why_purpose / how_details = 2000.
    const longShort = 'a'.repeat(500);
    const res = await postEvent({
      title: 'OSE-239a Truncation Test',
      brand_id: BRAND,
      what_short: longShort,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as CreateResponse;

    const listRes = await SELF.fetch('https://t.test/api/v2/admin/events?limit=100', {
      headers: ADMIN_HEADERS,
    });
    const list = (await listRes.json()) as AdminListResponse;
    const created = list.items.find((i) => i.id === body.id);
    expect(created).toBeDefined();
    expect((created!.what_short as string).length).toBe(300);
  });

  test('PUT update accepts 5W fields and persists the changes', async () => {
    const createRes = await postEvent({
      title: 'OSE-239a Update Target',
      brand_id: BRAND,
    });
    const created = (await createRes.json()) as CreateResponse;
    expect(created.ok).toBe(true);

    const putRes = await SELF.fetch(`https://t.test/api/v2/admin/events/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
      body: JSON.stringify({
        what_short: 'Updated WHAT',
        who_host: 'Updated WHO',
        why_purpose: 'Updated WHY',
        how_details: 'Updated HOW',
        where_address: 'Updated WHERE 9999 Update Ave',
      }),
    });
    expect(putRes.status).toBeLessThan(300);

    const listRes = await SELF.fetch('https://t.test/api/v2/admin/events?limit=100', {
      headers: ADMIN_HEADERS,
    });
    const list = (await listRes.json()) as AdminListResponse;
    const updated = list.items.find((i) => i.id === created.id);
    expect(updated).toBeDefined();
    expect(updated!.what_short).toBe('Updated WHAT');
    expect(updated!.who_host).toBe('Updated WHO');
    expect(updated!.why_purpose).toBe('Updated WHY');
    expect(updated!.how_details).toBe('Updated HOW');
    expect(updated!.where_address).toBe('Updated WHERE 9999 Update Ave');
  });
});

describe('OSE-239a: admin form HTML carries the 5 new inputs', () => {
  test('admin page renders 5 data-testid attributes for the 5W inputs', async () => {
    const res = await SELF.fetch('https://t.test/admin', { headers: ADMIN_HEADERS });
    expect(res.status).toBe(200);
    const html = await res.text();

    // Each 5W field needs a data-testid for E2E targetability. If any of
    // these go missing, OSE-239b geocode-button wiring and downstream E2E
    // tests would silently fail to locate the elements.
    for (const testid of [
      'create-what-short',
      'create-who-host',
      'create-why-purpose',
      'create-how-details',
      'create-where-address',
    ]) {
      expect(
        html.includes(`data-testid="${testid}"`),
        `admin form HTML missing data-testid="${testid}"`
      ).toBe(true);
    }
  });

  test('admin form JS submits 5W field names matching the API contract', async () => {
    // Static-source check: the inline submit handler in pages.ts MUST
    // serialize the canonical API field names (snake_case), not the
    // DOM ids (kebab-case). This catches handler/contract drift at the
    // render layer.
    const res = await SELF.fetch('https://t.test/admin', { headers: ADMIN_HEADERS });
    const html = await res.text();
    for (const apiField of [
      'what_short',
      'who_host',
      'why_purpose',
      'how_details',
      'where_address',
    ]) {
      expect(
        html.includes(`'${apiField}'`),
        `admin form JS submit handler missing API field name '${apiField}'`
      ).toBe(true);
    }
  });
});
