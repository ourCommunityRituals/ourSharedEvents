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
 */
import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
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
    body: JSON.stringify(body),
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
    body: JSON.stringify(body),
  });
}

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
      asKey({ brand_id: 'root', title: `${TITLE_PREFIX}key active`, status: 'active' })
    );
    expect(row.status).toBe('active');
    expect(row.qr_verified).toBe(1);
    expect(row.listed_from).not.toBeNull();
  });

  for (const asked of ['ready', 'archived', 'draft']) {
    test(`a key actor that asks for "${asked}" gets it, not verified`, async () => {
      const row = await create(
        asKey({ brand_id: 'root', title: `${TITLE_PREFIX}key ${asked}`, status: asked })
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
