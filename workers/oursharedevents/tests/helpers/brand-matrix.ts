/**
 * OSE-1554 — the brand test matrix: seeding + `forEachBrand` / `brandMatrix`.
 *
 * Workers pool only (it imports `cloudflare:test`). The pure ids live in
 * `brand-matrix-ids.ts`; the route list in `brand-matrix-routes.ts`.
 *
 * Isolation is proved the same way for every route: one shared fixture of several
 * brands, one helper that runs a test once per brand. A new brand-scoped route gets
 * coverage by being added to the route list, not by someone remembering to write a
 * cross-brand test.
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { test } from 'vitest';
import { route, type RouterEnv } from '../../src/router';
import { seedSplitSponsor } from './seed-sponsor';
import {
  BRANDS,
  EXTRA_ACTIVE_EVENTS,
  FIXTURE_CELL,
  PLATFORM_MEMBER_EMAIL,
  membershipJson,
  type BrandFx,
} from './brand-matrix-ids';

export * from './brand-matrix-ids';

export const routerEnv = env as unknown as RouterEnv;

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

export async function applyMigrations(): Promise<void> {
  const statements: string[] = JSON.parse((env as unknown as TestEnv).TEST_MIGRATION_STATEMENTS);
  for (const stmt of statements) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

async function seedEvent(
  b: BrandFx,
  id: string,
  status: 'active' | 'draft',
  withCell: boolean
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO events
       (id, brand_id, title, slug, status, is_published, data_class, start_date, h3_res7)
     VALUES (?, ?, ?, ?, ?, ?, 'synthetic', '2099-06-01', ?)`
  )
    .bind(
      id,
      b.brandId,
      `${b.marker}${status} event`,
      `slug-${id}`,
      status,
      status === 'active' ? 1 : 0,
      withCell ? FIXTURE_CELL : null
    )
    .run();
}

/**
 * Seed the whole tree (idempotent: INSERT OR REPLACE / delete-then-insert by fixed id)
 * and install the matrix membership map on the router env.
 * Per brand: one live event, one draft, one sponsor with an accepted placement on the
 * live event, one campaign, one poster deployment. All `data_class = 'synthetic'`.
 */
export async function seedBrandFixture(): Promise<void> {
  await applyMigrations();
  for (const b of BRANDS) {
    await seedEvent(b, b.activeEventId, 'active', true);
    await seedEvent(b, b.draftEventId, 'draft', false);
    for (let i = 1; i <= EXTRA_ACTIVE_EVENTS[b.key]; i++) {
      await seedEvent(b, `${b.marker}extra-${i}`, 'active', false);
    }
    await env.DB.prepare(`INSERT OR REPLACE INTO campaigns (id, brand_id, title) VALUES (?, ?, ?)`)
      .bind(b.campaignId, b.brandId, `${b.marker}campaign`)
      .run();
    await seedSplitSponsor(env.DB, {
      id: b.sponsorId,
      eventId: b.activeEventId,
      brandId: b.brandId,
      name: `${b.marker}sponsor`,
      campaignId: b.campaignId,
      placementId: b.placementId,
      sponsorAccepted: 1,
      organizerAccepted: 1,
    });
    await env.DB.prepare(
      `INSERT OR REPLACE INTO poster_deployments (id, event_id, qr_token) VALUES (?, ?, ?)`
    )
      .bind(b.posterDeploymentId, b.activeEventId, `qrt_${b.posterDeploymentId}`)
      .run();
  }
  (routerEnv as { ADMIN_BRAND_MEMBERSHIP?: string }).ADMIN_BRAND_MEMBERSHIP = membershipJson();
}

/** Run `fn` once per brand, each as its own named test (`<label> - as <brand>`). */
export function forEachBrand(label: string, fn: (b: BrandFx) => Promise<void> | void): void {
  for (const b of BRANDS) {
    test(`${label} - as ${b.key}`, () => fn(b));
  }
}

/** Every ordered pair of DIFFERENT brands: (caller, target). */
export function brandMatrix(): Array<readonly [BrandFx, BrandFx]> {
  const pairs: Array<readonly [BrandFx, BrandFx]> = [];
  for (const caller of BRANDS) {
    for (const target of BRANDS) {
      if (caller.key !== target.key) pairs.push([caller, target] as const);
    }
  }
  return pairs;
}

/** Run `fn` for every (caller, target) pair, each as its own named test. */
export function forEachBrandPair(
  label: string,
  fn: (caller: BrandFx, target: BrandFx) => Promise<void> | void
): void {
  for (const [caller, target] of brandMatrix()) {
    test(`${label} - ${caller.key} -> ${target.key}`, () => fn(caller, target));
  }
}

// ── Callers ──────────────────────────────────────────────────────────────────

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** CF Access JWT for `email` (decode-only: CF_ACCESS_TEAM_DOMAIN is unset in the test env). */
export function headersAsEmail(email: string): Record<string, string> {
  const now = Math.floor(Date.now() / 1000);
  return {
    'Cf-Access-Jwt-Assertion': `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
      email,
      iat: now - 10,
      exp: now + 3600,
    })}.sig`,
    // A signed-in person is a browser on the admin site (admin write guard).
    'Sec-Fetch-Site': 'same-origin',
  };
}

export const KEY_HEADERS: Record<string, string> = {
  Authorization: 'Bearer test-admin-key-e2e-2026',
};

export type CallerKind =
  | { kind: 'owner'; brand: BrandFx }
  | { kind: 'platform' }
  | { kind: 'key-all' }
  | { kind: 'key-none' }
  | { kind: 'anonymous' };

export function callerLabel(c: CallerKind): string {
  return c.kind === 'owner' ? `owner:${c.brand.key}` : c.kind;
}

export async function callAs(
  caller: CallerKind,
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  const headers: Record<string, string> = {};
  let e: RouterEnv = routerEnv;
  switch (caller.kind) {
    case 'owner':
      Object.assign(headers, headersAsEmail(caller.brand.ownerEmail));
      break;
    case 'platform':
      Object.assign(headers, headersAsEmail(PLATFORM_MEMBER_EMAIL));
      break;
    case 'key-all':
      Object.assign(headers, KEY_HEADERS); // vitest config sets ADMIN_SCOPE_ALL=true
      break;
    case 'key-none':
      Object.assign(headers, KEY_HEADERS);
      e = Object.assign(Object.create(Object.getPrototypeOf(routerEnv)), routerEnv, {
        ADMIN_SCOPE_ALL: undefined,
      }) as RouterEnv;
      break;
    case 'anonymous':
      break;
  }
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const ctx = createExecutionContext();
  let res: Response;
  try {
    res = await route(new Request(`https://ose.test${path}`, init), e, ctx);
  } catch (err) {
    // index.ts turns an escaped throw into a 500; in this pool FORMS_DB has no tables, so
    // a handler that reads it throws AFTER the scope wall let the caller through.
    res = new Response(`handler threw: ${err instanceof Error ? err.message : String(err)}`, {
      status: 500,
    });
  }
  await waitOnExecutionContext(ctx);
  return res;
}

/** Row snapshot of every brand-scoped fixture table, for "the write never happened". */
export async function snapshotFixture(): Promise<string> {
  const tables: Array<[string, string]> = [
    ['events', 'id'],
    ['sponsor_business', 'id'],
    ['sponsor_placement', 'id'],
    ['campaigns', 'id'],
    ['poster_deployments', 'id'],
  ];
  const out: Record<string, unknown> = {};
  for (const [t, k] of tables) {
    const r = await env.DB.prepare(
      `SELECT * FROM ${t} WHERE ${k} LIKE 'bm-%' OR ${k} LIKE 'spl_bm-%' ORDER BY ${k}`
    ).all();
    out[t] = r.results;
  }
  const assets = await env.DB.prepare(
    `SELECT * FROM sponsor_asset WHERE sponsor_business_id LIKE 'bm-%' ORDER BY 1`
  ).all();
  out.sponsor_asset = assets.results;
  // Rows a refused cross-brand create would have left behind.
  out.cross_events = (
    await env.DB.prepare(`SELECT id, brand_id FROM events WHERE title LIKE 'bm-cross-%'`).all()
  ).results;
  out.cross_sponsors = (
    await env.DB.prepare(
      `SELECT id, brand_id FROM sponsor_business WHERE name LIKE 'bm-cross-%'`
    ).all()
  ).results;
  return JSON.stringify(out);
}
