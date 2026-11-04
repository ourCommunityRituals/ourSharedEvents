/**
 * OSE-1801 — a token that expires mid-request must not leave the request with no
 * admin actor (and so with every brand).
 *
 * `extractAdminActor` decoded the Access JWT again on every call and re-checked
 * `exp` against the clock. On Workers the clock moves after I/O, so a request
 * whose token was valid when `requireAdmin` ran, but expired by the time a
 * handler re-read the actor after reading the body (or awaiting D1), saw a NULL
 * actor. Three create handlers treated null as "the DEV_OPEN_ADMIN local bypass,
 * allow": event create (any brand_id), sponsor create on another brand's event,
 * and draft promote of another brand's draft.
 *
 * These drive the real router with a brand-A admin token that expires 30 s after
 * the request starts, and a request body whose read moves the clock past `exp`
 * (the read is I/O: on Workers that is when time advances). Each expects the
 * brand-A refusal the same request gets with a fresh token.
 *
 * @born-red TL-084 | method: deliberate-fixture-break | date: 2026-11-04 | verified: on main (before the
 *   fix) all three tests were red — event create answered 201 in brand B, sponsor
 *   create 201 on brand B's event, promote went past the scope check — and are
 *   green after the actor is resolved once per request and a null actor denies.
 */
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, afterEach, vi } from 'vitest';
import { route } from '../src/router';
import { extractAdminActor, isDevOpenAdmin } from '../src/auth/admin';
import { handleCreateEvent } from '../src/handlers/events';
import { handleAdminCreateSponsor } from '../src/handlers/sponsors';
import { handlePromoteSponsorDraft } from '../src/handlers/sponsors-draft';
import { REPEAT_SOURCE_COLUMNS } from '../src/lib/event-repeat';
import { requireKeyActor } from '../src/lib/admin-object-scope';
import { BRANDS, seedBrandFixture, routerEnv } from './helpers/brand-matrix';

const A = BRANDS[0]!;
const B = BRANDS[1]!;

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A brand-A owner's Access JWT that expires `ttlSec` after now (decode-only in this env). */
function tokenFor(email: string, ttlSec: number): string {
  const now = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
    email,
    iat: now - 10,
    exp: now + ttlSec,
  })}.sig`;
}

/**
 * A JSON body whose read moves the clock `advanceMs` forward — the read is the
 * I/O after which Workers time advances. Returns the stream and a restore().
 */
/** How many times a clock-advancing body was read, and the last token sent. */
let bodyPulls = 0;
let lastToken = '';

/**
 * Precondition for every race test: the fault really happened. Under the moved
 * clock, the same token on a FRESH Request (no memo) reads as no actor, and the
 * I/O ran. Without this, a test could pass with no race at all.
 */
function expectTheTokenHadExpired(): void {
  expect(bodyPulls).toBeGreaterThanOrEqual(1);
  const fresh = new Request('https://ose.test/probe', {
    headers: { 'Cf-Access-Jwt-Assertion': lastToken },
  });
  expect(extractAdminActor(fresh, routerEnv)).toBeNull();
}

function bodyThatAdvancesTheClock(json: unknown, advanceMs: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(JSON.stringify(json));
  const realNow = Date.now;
  const t0 = realNow();
  let sent = false;
  // highWaterMark 0: pull() runs only when the handler reads the body, never at
  // construction (the default of 1 pulls eagerly and would move the clock before
  // requireAdmin even runs).
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (sent) {
          controller.close();
          return;
        }
        vi.spyOn(Date, 'now').mockImplementation(() => t0 + advanceMs);
        bodyPulls++;
        sent = true;
        controller.enqueue(bytes);
      },
    },
    { highWaterMark: 0 }
  );
}

async function postAsExpiring(path: string, json: unknown): Promise<Response> {
  bodyPulls = 0;
  lastToken = tokenFor(A.ownerEmail, 30);
  const req = new Request(`https://ose.test${path}`, {
    method: 'POST',
    headers: {
      'Cf-Access-Jwt-Assertion': lastToken,
      'Sec-Fetch-Site': 'same-origin',
      'Content-Type': 'application/json',
    },
    body: bodyThatAdvancesTheClock(json, 60_000),
    // @ts-expect-error duplex is required for a streamed body in some runtimes
    duplex: 'half',
  });
  const ctx = createExecutionContext();
  const res = await route(req, routerEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

beforeAll(async () => {
  await seedBrandFixture();
  const db = (env as unknown as { DB: D1Database }).DB;
  await db
    .prepare(
      `INSERT OR REPLACE INTO sponsor_business_draft (draft_token, brand_id, event_id, name)
       VALUES ('tl075-draft-b', ?, ?, 'Brand B draft')`
    )
    .bind(B.brandId, B.activeEventId)
    .run();
  await db
    .prepare(
      `INSERT OR REPLACE INTO sponsor_business_draft (draft_token, brand_id, event_id, name)
       VALUES ('tl084-draft-a', ?, ?, 'Brand A draft')`
    )
    .bind(A.brandId, A.activeEventId)
    .run();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OSE-1801 | a token that expires mid-request keeps the brand it started with', () => {
  test('event create: a brand-A admin cannot create in brand B (403), even if the token expires during the body read', async () => {
    const res = await postAsExpiring('/api/v2/admin/events', {
      title: `${A.marker}race event`,
      brand_id: B.brandId,
      start_date: '2099-06-01',
    });
    expectTheTokenHadExpired();
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('BRAND_FORBIDDEN');
  });

  test("sponsor create: a brand-A admin cannot attach a sponsor to brand B's event", async () => {
    const res = await postAsExpiring('/api/v2/admin/sponsors', {
      name: `${A.marker}race sponsor`,
      tier: 'silver',
      event_id: B.activeEventId,
    });
    expectTheTokenHadExpired();
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('EVENT_NOT_FOUND');
  });

  test("draft promote: brand B's draft reads as missing to a brand-A admin", async () => {
    const res = await postAsExpiring('/api/v2/admin/sponsors/promote', {
      draft_token: 'tl075-draft-b',
    });
    expectTheTokenHadExpired();
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('DRAFT_NOT_FOUND');
  });
});

describe('OSE-1801 | the actor is the one auth decided on', () => {
  test('event create in their own brand still works when the token expires during the body read', async () => {
    const res = await postAsExpiring('/api/v2/admin/events', {
      title: `${A.marker}race own-brand event`,
      brand_id: A.brandId,
      start_date: '2099-06-01',
    });
    expectTheTokenHadExpired();
    // Before the memo the null actor read as "all brands"; with deny-on-null
    // alone this would be 403. 201 proves the actor stayed brand A's admin.
    expect(res.status).toBe(201);
  });
});

describe('OSE-1801 | a null actor allows nothing unless the local bypass is really on', () => {
  const anon = () => new Request('https://ose.test/api/v2/admin/flags/x', { method: 'PUT' });
  test.each([
    ['staging', 'true'],
    ['production', 'true'],
    [undefined, undefined],
    [undefined, 'false'],
  ])(
    'requireKeyActor refuses a null actor (WORKER_ENV=%s, DEV_OPEN_ADMIN=%s)',
    (workerEnv, devOpen) => {
      const res = requireKeyActor(anon(), {
        ...routerEnv,
        WORKER_ENV: workerEnv,
        DEV_OPEN_ADMIN: devOpen,
      } as typeof routerEnv);
      expect(res?.status).toBe(403);
    }
  );
  test('requireKeyActor lets a null actor through only on local dev with the bypass on', () => {
    const res = requireKeyActor(anon(), {
      ...routerEnv,
      WORKER_ENV: undefined,
      DEV_OPEN_ADMIN: 'true',
    } as typeof routerEnv);
    expect(res).toBeNull();
  });
  test.each([
    ['staging', 'true', false],
    ['production', 'true', false],
    [undefined, 'false', false],
    ['development', 'true', true],
    [undefined, 'true', true],
  ])('isDevOpenAdmin(WORKER_ENV=%s, DEV_OPEN_ADMIN=%s) is %s', (workerEnv, devOpen, expected) => {
    expect(
      isDevOpenAdmin({ WORKER_ENV: workerEnv, DEV_OPEN_ADMIN: devOpen } as Parameters<
        typeof isDevOpenAdmin
      >[0])
    ).toBe(expected);
  });
});

describe('OSE-1801 | controls: the same calls with a token that does not expire', () => {
  test('event create in brand B is refused the same way', async () => {
    const req = new Request('https://ose.test/api/v2/admin/events', {
      method: 'POST',
      headers: {
        'Cf-Access-Jwt-Assertion': tokenFor(A.ownerEmail, 3600),
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: `${A.marker}control`,
        brand_id: B.brandId,
        start_date: '2099-06-01',
      }),
    });
    const ctx = createExecutionContext();
    const res = await route(req, routerEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(403);
  });
});

describe('OSE-1801 | repeat keeps the actor across the source read', () => {
  // @born-red TL-084 | method: deliberate-fixture-break | date: 2026-11-04
  test('repeating their own brand-A event still works when the token expires during the source read', async () => {
    const jwt = tokenFor(A.ownerEmail, 30);
    lastToken = jwt;
    const db = (routerEnv as unknown as { DB: D1Database }).DB;
    const realPrepare = db.prepare.bind(db);
    const t0 = Date.now();
    bodyPulls = 0;
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      // The repeat handler's own source read (not the object-scope guard's brand
      // lookup, which runs before requireAdmin) is the I/O after which time moves.
      if (
        sql.startsWith(`SELECT ${REPEAT_SOURCE_COLUMNS.join(', ')} FROM events`) &&
        bodyPulls === 0
      ) {
        bodyPulls++;
        vi.spyOn(Date, 'now').mockImplementation(() => t0 + 60_000);
      }
      return realPrepare(sql);
    });
    const req = new Request(`https://ose.test/api/v2/admin/events/${A.activeEventId}/repeat`, {
      method: 'POST',
      headers: {
        'Cf-Access-Jwt-Assertion': jwt,
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    const ctx = createExecutionContext();
    const res = await route(req, routerEnv, ctx);
    await waitOnExecutionContext(ctx);
    expectTheTokenHadExpired();
    expect(res.status).toBe(201);
  });
});

describe('OSE-1801 | each deny site refuses a null actor on its own', () => {
  // These call the handlers directly with no credentials, so the memo cannot
  // supply an actor: each test goes red if its own site's deny is reverted.
  const deployedOrNotLocal = [
    { WORKER_ENV: 'staging', DEV_OPEN_ADMIN: 'true' },
    { WORKER_ENV: 'production', DEV_OPEN_ADMIN: 'true' },
    { WORKER_ENV: 'Production', DEV_OPEN_ADMIN: 'true' },
    { WORKER_ENV: undefined, DEV_OPEN_ADMIN: undefined },
  ];
  const envWith = (over: Record<string, string | undefined>) =>
    ({ ...routerEnv, ...over }) as unknown as typeof routerEnv;
  const jsonPost = (path: string, body: unknown) =>
    new Request(`https://ose.test${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  // @born-red TL-084 | method: deliberate-fixture-break | date: 2026-11-04
  test.each(deployedOrNotLocal)('event create (%o): 403 BRAND_FORBIDDEN', async (over) => {
    const res = await handleCreateEvent(
      jsonPost('/api/v2/admin/events', {
        title: `${A.marker}null actor`,
        brand_id: A.brandId,
        start_date: '2099-06-01',
      }),
      envWith(over) as never
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('BRAND_FORBIDDEN');
  });

  // @born-red TL-084 | method: deliberate-fixture-break | date: 2026-11-04
  test.each(deployedOrNotLocal)(
    'sponsor create on an event (%o): 400 EVENT_NOT_FOUND',
    async (over) => {
      const res = await handleAdminCreateSponsor(
        jsonPost('/api/v2/admin/sponsors', {
          name: `${A.marker}null actor sponsor`,
          tier: 'silver',
          event_id: A.activeEventId,
        }),
        envWith(over) as never
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe('EVENT_NOT_FOUND');
    }
  );

  // @born-red TL-084 | method: deliberate-fixture-break | date: 2026-11-04
  test.each(deployedOrNotLocal)('draft promote (%o): 404 DRAFT_NOT_FOUND', async (over) => {
    const ctx = createExecutionContext();
    const res = await handlePromoteSponsorDraft(
      jsonPost('/api/v2/admin/sponsors/promote', { draft_token: 'tl084-draft-a' }),
      envWith(over) as never,
      ctx,
      'rid-null-actor'
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('DRAFT_NOT_FOUND');
  });

  test('control: under the real local bypass the same event create is not refused', async () => {
    const res = await handleCreateEvent(
      jsonPost('/api/v2/admin/events', {
        title: `${A.marker}dev bypass`,
        brand_id: A.brandId,
        start_date: '2099-06-01',
      }),
      envWith({ WORKER_ENV: 'development', DEV_OPEN_ADMIN: 'true' }) as never
    );
    expect(res.status).toBe(201);
  });
});
