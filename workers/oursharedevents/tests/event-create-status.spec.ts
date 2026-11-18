/**
 * The status an event is created in (OSE-1425).
 *
 * Creation is the start of the lifecycle. A signed-in person's event is always
 * created as a draft, whatever `status` the body sends: it goes live only
 * through ready → verify-qr (or PUT status), which check the step. Automation
 * (a key or the CI service actor) may still create an event in another state,
 * as the staging lifecycle job, the stock seed and the staging specs do; a live
 * one is written with qr_verified = 1 in the same insert, so the invariant
 * `active ⟺ qr_verified = 1` holds at this door too (owner, 2026-11-13).
 *
 * The other doors are pinned in their own specs: verify-qr and unverify-qr in
 * qr-verify.spec.ts, PUT status in admin-status-write-from.spec.ts. Which
 * statements may write `status` at all is pinned in event-status-writers.spec.ts.
 *
 * @born-red method: injected fault | date: 2026-11-13 | verified: on main as it
 *   was (create took `body.status` from anyone and left qr_verified at its
 *   default 0) every "a person" case that sent a status went red (stored
 *   active, ready or archived) and "a key actor creates it live" went red
 *   (qr_verified 0); with the actor check inverted, the key-actor cases went
 *   red; with qr_verified bound as 0, "creates it live" went red again; with
 *   the answer's event_status fixed to 'draft', every case that wrote another
 *   state went red.
 *
 * OSE-2036: automation's create is a publish step too. A key or service actor
 * that creates an event past draft (ready or active) must send a start time and
 * an event type, the same core values PUT status and verify-qr ask for
 * (lib/core-values.ts). Without them the answer is 409 CORE_VALUES_MISSING and
 * no row is written. Ready is covered as well as active because ready → active
 * is not itself a checked step: a ready row with no values could otherwise go
 * live by PUT.
 *
 * @born-red core values at create | method: ran against the pre-change handler |
 *   date: 2026-11-18 | verified: before the check existed every "is refused"
 *   case below went red with 201 where 409 was expected, and "writes one line"
 *   went red on an empty list. The cases that send both values, and the draft,
 *   archived and person cases, were green before and after: they are the
 *   over-blocking guard.
 */
import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll, vi } from 'vitest';
import { handleCreateEvent, type EventsEnv } from '../src/handlers/events';
import { BRANDS, seedBrandFixture, routerEnv } from './helpers/brand-matrix';

const A = BRANDS[0]!;
const eventsEnv = routerEnv as unknown as EventsEnv;
const KEY = 'test-admin-key-e2e-2026';
const TITLE_PREFIX = 'create-status ';

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function asKey(body: Record<string, unknown>): Request {
  return new Request('https://ose.test/api/v2/admin/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      attendance_mode: 'in_person',
      location: 'Test Hall',
      ...(body as object),
    }),
  });
}

function asPerson(email: string, body: Record<string, unknown>): Request {
  const now = Math.floor(Date.now() / 1000);
  const jwt = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
    email,
    iat: now - 10,
    exp: now + 3600,
  })}.sig`;
  return new Request('https://ose.test/api/v2/admin/events', {
    method: 'POST',
    headers: {
      'Cf-Access-Jwt-Assertion': jwt,
      'Sec-Fetch-Site': 'same-origin',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      attendance_mode: 'in_person',
      location: 'Test Hall',
      ...(body as object),
    }),
  });
}

/** A start time and an event type: what an event needs to leave draft. */
let CORE: { start_date: string; start_time: string; timezone: string; event_type_id: string };

interface Stored {
  status: string;
  qr_verified: number;
  listed_from: string | null;
}

async function stored(id: string): Promise<Stored | null> {
  return env.DB.prepare('SELECT status, qr_verified, listed_from FROM events WHERE id = ?')
    .bind(id)
    .first<Stored>();
}

async function create(req: Request): Promise<Stored> {
  const res = await handleCreateEvent(req, eventsEnv);
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string; event_status: string; qr_verified: boolean };
  const row = await stored(body.id);
  expect(row).not.toBeNull();
  // The answer says what was written, so a caller (and the staging Bruno run,
  // which cannot read the row) sees it.
  expect(body.event_status).toBe(row!.status);
  expect(body.qr_verified).toBe(row!.qr_verified === 1);
  return row!;
}

beforeAll(async () => {
  await seedBrandFixture();
  const type = await env.DB.prepare(
    'SELECT id FROM event_type_registry WHERE is_active = 1 ORDER BY id LIMIT 1'
  ).first<{ id: string }>();
  expect(type, 'the registry must hold an active event type').not.toBeNull();
  CORE = {
    start_date: '2027-06-01',
    start_time: '18:00',
    timezone: 'America/Chicago',
    event_type_id: type!.id,
  };
});

describe('event create: a signed-in person always starts with a draft', () => {
  for (const asked of ['active', 'ready', 'archived', 'draft']) {
    test(`a person who sends status "${asked}" gets a draft, not verified`, async () => {
      const row = await create(
        asPerson(A.ownerEmail, {
          brand_id: A.brandId,
          title: `${TITLE_PREFIX}person ${asked}`,
          status: asked,
        })
      );
      expect(row.status).toBe('draft');
      expect(row.qr_verified).toBe(0);
      expect(row.listed_from).toBeNull();
    });
  }

  test('a person who sends no status gets a draft', async () => {
    const row = await create(
      asPerson(A.ownerEmail, { brand_id: A.brandId, title: `${TITLE_PREFIX}person none` })
    );
    expect(row.status).toBe('draft');
    expect(row.qr_verified).toBe(0);
  });

  for (const odd of ['ACTIVE', 'live', '', 1, true, null, ['active'], { status: 'active' }]) {
    test(`a person who sends ${JSON.stringify(odd)} gets a draft`, async () => {
      const row = await create(
        asPerson(A.ownerEmail, {
          brand_id: A.brandId,
          title: `${TITLE_PREFIX}person odd ${JSON.stringify(odd)}`,
          status: odd,
        })
      );
      expect(row.status).toBe('draft');
      expect(row.qr_verified).toBe(0);
    });
  }
});

describe('event create: automation may create in another state, and live means verified', () => {
  test('a key actor creates it live: active, qr_verified 1, listed from now', async () => {
    const row = await create(
      asKey({ brand_id: 'root', title: `${TITLE_PREFIX}key active`, status: 'active', ...CORE })
    );
    expect(row.status).toBe('active');
    expect(row.qr_verified).toBe(1);
    expect(row.listed_from).not.toBeNull();
  });

  for (const asked of ['ready', 'archived', 'draft']) {
    test(`a key actor that asks for "${asked}" gets it, not verified`, async () => {
      const row = await create(
        asKey({
          brand_id: 'root',
          title: `${TITLE_PREFIX}key ${asked}`,
          status: asked,
          // Only a state past draft owes the core values (cases below).
          ...(asked === 'ready' ? CORE : {}),
        })
      );
      expect(row.status).toBe(asked);
      expect(row.qr_verified).toBe(0);
      expect(row.listed_from).toBeNull();
    });
  }

  for (const odd of [undefined, 'ACTIVE', 'live', '', 1, null]) {
    test(`a key actor that sends ${JSON.stringify(odd)} gets a draft`, async () => {
      const row = await create(
        asKey({
          brand_id: 'root',
          title: `${TITLE_PREFIX}key odd ${JSON.stringify(odd)}`,
          ...(odd === undefined ? {} : { status: odd }),
        })
      );
      expect(row.status).toBe('draft');
      expect(row.qr_verified).toBe(0);
    });
  }
});

describe('event create: automation past draft owes the core values (OSE-2036)', () => {
  async function refused(body: Record<string, unknown>) {
    const title = String(body.title);
    const res = await handleCreateEvent(asKey(body), eventsEnv);
    const json = (await res.json()) as { ok?: boolean; code?: string; missing?: string[] };
    const made = await env.DB.prepare('SELECT COUNT(*) AS n FROM events WHERE title = ?')
      .bind(title)
      .first<{ n: number }>();
    return { status: res.status, json, rows: made?.n ?? 0 };
  }

  for (const asked of ['active', 'ready']) {
    test(`a key actor asking for "${asked}" with only a title is refused, and nothing is written`, async () => {
      const r = await refused({
        brand_id: 'root',
        title: `${TITLE_PREFIX}refused bare ${asked}`,
        status: asked,
      });
      expect(r.status).toBe(409);
      expect(r.json.ok).toBe(false);
      expect(r.json.code).toBe('CORE_VALUES_MISSING');
      expect(r.json.missing).toEqual(['time', 'event_type']);
      expect(r.rows).toBe(0);
    });
  }

  test('a start time with no event type is refused for the type alone', async () => {
    const { event_type_id: _type, ...time } = CORE;
    const r = await refused({
      brand_id: 'root',
      title: `${TITLE_PREFIX}refused no type`,
      status: 'active',
      ...time,
    });
    expect(r.status).toBe(409);
    expect(r.json.missing).toEqual(['event_type']);
    expect(r.rows).toBe(0);
  });

  test('an event type with a date but no time of day is refused for the time alone', async () => {
    const r = await refused({
      brand_id: 'root',
      title: `${TITLE_PREFIX}refused no time`,
      status: 'active',
      start_date: CORE.start_date,
      timezone: CORE.timezone,
      event_type_id: CORE.event_type_id,
    });
    expect(r.status).toBe(409);
    expect(r.json.missing).toEqual(['time']);
    expect(r.rows).toBe(0);
  });

  test('a refusal writes one line that names the door and what was missing, and nothing else', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const r = await refused({
        brand_id: 'root',
        title: `${TITLE_PREFIX}refused logged`,
        status: 'active',
      });
      expect(r.status).toBe(409);
      const lines = spy.mock.calls
        .map((c) => c[0])
        .filter((l): l is string => typeof l === 'string' && l.includes('core_values_refused'))
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(lines).toEqual([
        {
          type: 'LIFECYCLE',
          event: 'core_values_refused',
          door: 'create',
          from: 'draft',
          to: 'active',
          missing_time: true,
          missing_event_type: true,
        },
      ]);
    } finally {
      spy.mockRestore();
    }
  });

  // The over-blocking guard: none of these owes the core values.
  for (const asked of ['draft', 'archived']) {
    test(`a key actor asking for "${asked}" with only a title is still created`, async () => {
      const row = await create(
        asKey({ brand_id: 'root', title: `${TITLE_PREFIX}bare ${asked} ok`, status: asked })
      );
      expect(row.status).toBe(asked);
    });
  }

  test('a person asking for active with only a title still gets a draft, not a refusal', async () => {
    const row = await create(
      asPerson(A.ownerEmail, {
        brand_id: A.brandId,
        title: `${TITLE_PREFIX}person bare active ok`,
        status: 'active',
      })
    );
    expect(row.status).toBe('draft');
  });

  test('every live row this spec made has a start time and an event type', async () => {
    const { results } = await env.DB.prepare(
      `SELECT title FROM events
        WHERE title LIKE ? AND status IN ('ready', 'active')
          AND (starts_at IS NULL OR event_type_id IS NULL)`
    )
      .bind(`${TITLE_PREFIX}%`)
      .all<{ title: string }>();
    expect(results).toEqual([]);
  });
});

describe('event create: the invariant over every row this spec made', () => {
  test('no created row is active without qr_verified = 1, or verified without being active', async () => {
    const { results } = await env.DB.prepare(
      `SELECT title, status, qr_verified FROM events
        WHERE title LIKE ? AND ((status = 'active') <> (qr_verified = 1))`
    )
      .bind(`${TITLE_PREFIX}%`)
      .all<{ title: string; status: string; qr_verified: number }>();
    expect(results).toEqual([]);
    // And the check above ran over rows, not over nothing.
    const made = await env.DB.prepare('SELECT COUNT(*) AS n FROM events WHERE title LIKE ?')
      .bind(`${TITLE_PREFIX}%`)
      .first<{ n: number }>();
    expect(made?.n ?? 0).toBeGreaterThanOrEqual(20);
  });
});
