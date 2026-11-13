/**
 * OSE-1644 — a refused publish step is logged, so refusals can be counted by
 * which value was missing.
 *
 * Both doors (PUT status and verify-qr) write one structured line when they
 * answer 409 CORE_VALUES_MISSING. The line carries the door, the move and which
 * values were missing. It carries nothing about the event: no id, no title, no
 * actor. The key set is sealed here so a later edit cannot widen it quietly.
 *
 * Level: W (workers pool, real D1, real routes through SELF).
 *
 * @born-red OSE-1644 | method: ran against the pre-change handlers. Both doors
 * answered 409 and wrote no line | date: 2026-10-06
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const E = env as unknown as Record<string, string> & { DB: D1Database };
const BEARER = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const JSON_HEADERS = { ...BEARER, 'Content-Type': 'application/json' };

beforeAll(async () => {
  for (const stmt of JSON.parse(E.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await E.DB.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes('duplicate column name') || m.includes('already exists')) continue;
      throw e;
    }
  }
});

afterEach(() => vi.restoreAllMocks());

const TITLE = 'Harvest Supper At The Grange';
let made = 0;

/** A title-only draft. Each gets its own title, since the slug must be unique. */
async function createDraft(): Promise<string> {
  made += 1;
  const res = await SELF.fetch('https://localhost/api/v2/admin/events', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      attendance_mode: 'in_person',
      location: 'Test Hall',
      title: `${TITLE} ${made}`,
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id?: string; item?: { id?: string } };
  return (body.item?.id ?? body.id) as string;
}

const put = (id: string, body: unknown) =>
  SELF.fetch(`https://localhost/api/v2/admin/events/${id}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });

const verifyQr = (id: string) =>
  SELF.fetch(`https://localhost/api/v2/admin/events/${id}/verify-qr`, {
    method: 'POST',
    headers: BEARER,
  });

/** Every `core_values_refused` line written while `fn` ran, raw and parsed. */
async function refusalLines(fn: () => Promise<unknown>) {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  await fn();
  const raw = spy.mock.calls
    .map((c) => c[0])
    .filter((l): l is string => typeof l === 'string' && l.includes('core_values_refused'));
  return { raw, parsed: raw.map((l) => JSON.parse(l) as Record<string, unknown>) };
}

/** A draft moved to archived: the one state verify-qr applies the rule from. */
async function createArchived(): Promise<string> {
  const id = await createDraft();
  expect((await put(id, { status: 'archived' })).status, 'draft to archived').toBe(200);
  return id;
}

const codeOf = async (res: Response) => ((await res.json()) as { code?: string }).code;

const SEALED_KEYS = ['door', 'event', 'from', 'missing_event_type', 'missing_time', 'to', 'type'];

describe('OSE-1644: a refused publish step is logged by what was missing', () => {
  it('PUT status with both values missing writes one line naming both', async () => {
    const id = await createDraft();
    const { parsed } = await refusalLines(async () => {
      const res = await put(id, { status: 'ready' });
      expect(res.status).toBe(409);
      expect(await codeOf(res)).toBe('CORE_VALUES_MISSING');
    });
    expect(parsed).toEqual([
      {
        type: 'LIFECYCLE',
        event: 'core_values_refused',
        door: 'put_status',
        from: 'draft',
        to: 'ready',
        missing_time: true,
        missing_event_type: true,
      },
    ]);
  });

  it('verify-qr, going live again from archived, writes its own line', async () => {
    const id = await createArchived();
    const { parsed } = await refusalLines(async () => {
      const res = await verifyQr(id);
      expect(res.status).toBe(409);
      expect(await codeOf(res)).toBe('CORE_VALUES_MISSING');
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      door: 'verify_qr',
      from: 'archived',
      to: 'active',
      missing_time: true,
      missing_event_type: true,
    });
  });

  it('only the value still missing is counted: a time supplied in the same PUT', async () => {
    const id = await createDraft();
    const { parsed } = await refusalLines(async () => {
      const res = await put(id, {
        status: 'ready',
        start_date: '2027-05-01',
        start_time: '18:00',
        timezone: 'America/Chicago',
      });
      expect(res.status).toBe(409);
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ missing_time: false, missing_event_type: true });
  });

  it('the line carries nothing about the event: sealed keys, no id, no title', async () => {
    const id = await createDraft();
    const archived = await createArchived();
    const { raw, parsed } = await refusalLines(async () => {
      await put(id, { status: 'ready' });
      await verifyQr(archived);
    });
    expect(raw).toHaveLength(2);
    for (const line of parsed) expect(Object.keys(line).sort()).toEqual(SEALED_KEYS);
    for (const line of raw) {
      expect(line).not.toContain(id);
      expect(line).not.toContain(archived);
      expect(line).not.toContain(TITLE);
      expect(line.toLowerCase()).not.toContain('harvest');
    }
  });

  it('a move that goes through writes no refusal line', async () => {
    const id = await createDraft();
    const type = await E.DB.prepare('SELECT id FROM event_type_registry LIMIT 1').first<{
      id: string;
    }>();
    const { raw } = await refusalLines(async () => {
      const res = await put(id, {
        status: 'ready',
        start_date: '2027-05-01',
        start_time: '18:00',
        timezone: 'America/Chicago',
        event_type_id: type?.id,
      });
      expect(res.status).toBe(200);
    });
    expect(raw).toEqual([]);
  });

  it('a refusal for another reason is not counted here', async () => {
    const id = await createDraft();
    const { raw } = await refusalLines(async () => {
      expect((await put(id, { status: 'not-a-status' })).status).toBeGreaterThanOrEqual(400);
      // A draft cannot go straight to live: verify-qr refuses the move itself,
      // before the core values are looked at.
      const res = await verifyQr(id);
      expect(res.status).toBe(409);
      expect(await codeOf(res)).toBe('INVALID_TRANSITION');
    });
    expect(raw).toEqual([]);
  });
});
