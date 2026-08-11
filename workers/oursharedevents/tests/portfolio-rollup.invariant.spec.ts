/**
 * OSE-669 — Portfolio rollup strip: brand-scoped aggregate counts, K≥5 floor.
 *
 * Two invariants are pinned here:
 *
 *   #7 aggregate_only_reporting — the K≥5 floor is applied PER CONTRIBUTING
 *   BUCKET (per event) BEFORE summation. An event with 1–4 registrants is
 *   dropped from the sum, never masked inside a large total. This is the ruling
 *   (per-contributing-bucket, not floor-the-SUM) and this spec is what makes it
 *   non-negotiable: it fails if the handler ever sums first and floors last.
 *
 *   #9 tenant_isolation — the brand set is server-derived from the verified
 *   actor; a forged ?brand_id= to another tenant is 403; anon/unmapped get a
 *   fully-suppressed strip. Never a merged all-brands view.
 *
 * Handler is called directly (mirrors admin-events-scope.invariant.spec) so the
 * scope math is exercised without the separately-tested requireAdmin guard.
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { handlePortfolioRollup, type PortfolioRollupEnv } from '../src/handlers/portfolio-rollup';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes('duplicate column name') || m.includes('already exists') || m.includes('no such column')) continue;
      throw e;
    }
  }
  for (const stmt of JSON.parse(tenv.TEST_FORMS_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.FORMS_DB.prepare(stmt).run();
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes('duplicate column name') || m.includes('already exists')) continue;
      throw e;
    }
  }
}

async function seedEvent(id: string, brandId: string): Promise<void> {
  const tenv = env as unknown as TestEnv;
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status) VALUES (?, ?, ?, ?, 'active')`
  )
    .bind(id, brandId, `Event ${id}`, `slug-${id}`)
    .run();
}

async function seedSponsors(eventId: string, n: number): Promise<void> {
  const tenv = env as unknown as TestEnv;
  for (let i = 0; i < n; i++) {
    await tenv.DB.prepare(
      `INSERT INTO sponsors (id, event_id, name, tier, placement_formats, is_active)
       VALUES (?, ?, ?, 'gold', '{}', 1)`
    )
      .bind(`sp-${eventId}-${i}`, eventId, `Sponsor ${eventId}-${i}`)
      .run();
  }
}

async function seedRegistrations(eventId: string, n: number): Promise<void> {
  const tenv = env as unknown as TestEnv;
  for (let i = 0; i < n; i++) {
    await tenv.FORMS_DB.prepare(
      `INSERT INTO form_registrations (id, event_id, registration_bucket, status)
       VALUES (?, ?, '2026-01', 'confirmed')`
    )
      .bind(`reg-${eventId}-${i}`, eventId)
      .run();
  }
}

async function seedCheckins(eventId: string, total: number): Promise<void> {
  const tenv = env as unknown as TestEnv;
  await tenv.FORMS_DB.prepare(
    `INSERT INTO checkin_counts (id, event_id, total_count) VALUES (?, ?, ?)`
  )
    .bind(`chk-${eventId}`, eventId, total)
    .run();
}

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function reqAsEmail(email: string, query = ''): Request {
  const now = Math.floor(Date.now() / 1000);
  const jwt = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ email, iat: now - 10, exp: now + 3600 })}.sig`;
  return new Request(`https://x/api/v2/admin/events/portfolio-rollup${query}`, {
    headers: { 'Cf-Access-Jwt-Assertion': jwt },
  });
}
function reqAnon(query = ''): Request {
  return new Request(`https://x/api/v2/admin/events/portfolio-rollup${query}`);
}

interface Floored {
  count: number | null;
  suppressed: boolean;
  floor: number;
}
interface RollupBody {
  ok: boolean;
  status?: number;
  code?: string;
  rollup?: {
    events: number;
    registrations: Floored;
    checkins: Floored;
    activeSponsors: number;
  };
  scopedTo?: string[] | null;
}

const rollupEnv = env as unknown as PortfolioRollupEnv;

async function rollup(req: Request): Promise<{ status: number; body: RollupBody }> {
  const res = await handlePortfolioRollup(req, rollupEnv);
  return { status: res.status, body: (await res.json()) as RollupBody };
}

beforeAll(async () => {
  await applyMigrations();

  // brand-A (br669a): two events — one clears K, one is sub-K (the trap).
  await seedEvent('e669a1', 'br669a');
  await seedEvent('e669a2', 'br669a');
  await seedRegistrations('e669a1', 6); // ≥5 → contributes
  await seedRegistrations('e669a2', 3); // 1–4 → dropped pre-sum
  await seedCheckins('e669a1', 7); // ≥5 → contributes
  await seedCheckins('e669a2', 2); // 1–4 → dropped pre-sum
  await seedSponsors('e669a1', 2);
  await seedSponsors('e669a2', 1);

  // brand-B (br669b): must never appear for a brand-A operator.
  await seedEvent('e669b1', 'br669b');
  await seedRegistrations('e669b1', 10);
  await seedCheckins('e669b1', 10);
  await seedSponsors('e669b1', 3);

  // brand-C (br669c): every bucket sub-K → the whole metric suppresses.
  await seedEvent('e669c1', 'br669c');
  await seedRegistrations('e669c1', 4); // sub-K

  rollupEnv.ADMIN_BRAND_MEMBERSHIP = JSON.stringify({
    'a@brand-a.test': ['br669a'],
    'c@brand-c.test': ['br669c'],
  });
});

describe('OSE-669 #7 — per-contributing-bucket floor BEFORE summation', () => {
  test('sub-K events are dropped, not folded into the total', async () => {
    const { body } = await rollup(reqAsEmail('a@brand-a.test'));
    expect(body.ok).toBe(true);
    expect(body.rollup!.events).toBe(2);
    // 6 (e669a1) + 3 (e669a2, dropped) → 6, NOT 9. This is the ruling.
    expect(body.rollup!.registrations).toEqual({ count: 6, suppressed: false, floor: 5 });
    // 7 (e669a1) + 2 (e669a2, dropped) → 7, NOT 9.
    expect(body.rollup!.checkins).toEqual({ count: 7, suppressed: false, floor: 5 });
  });

  test('when no event clears K, the metric suppresses (never shows a sub-K sum)', async () => {
    const { body } = await rollup(reqAsEmail('c@brand-c.test'));
    expect(body.rollup!.events).toBe(1);
    expect(body.rollup!.registrations).toEqual({ count: null, suppressed: true, floor: 5 });
  });

  test('active sponsors are exact (public businesses, not privacy contributors)', async () => {
    const { body } = await rollup(reqAsEmail('a@brand-a.test'));
    // 2 (e669a1) + 1 (e669a2) = 3 — summed plainly, no floor.
    expect(body.rollup!.activeSponsors).toBe(3);
  });
});

describe('OSE-669 #9 — brand-scoped, server-derived, no cross-tenant reach', () => {
  test('a brand-A operator never sees brand-B totals', async () => {
    const { body } = await rollup(reqAsEmail('a@brand-a.test'));
    // If brand-B leaked in, registrations would be 16 and sponsors 6.
    expect(body.rollup!.registrations.count).toBe(6);
    expect(body.rollup!.activeSponsors).toBe(3);
    expect(body.scopedTo).toEqual(['br669a']);
  });

  test('forged ?brand_id= to another tenant → 403', async () => {
    const { status, body } = await rollup(reqAsEmail('a@brand-a.test', '?brand_id=br669b'));
    expect(status).toBe(403);
    expect(body.code).toBe('BRAND_FORBIDDEN');
  });

  test('?brand_id= within the caller’s membership is allowed', async () => {
    const { status, body } = await rollup(reqAsEmail('a@brand-a.test', '?brand_id=br669a'));
    expect(status).toBe(200);
    expect(body.scopedTo).toEqual(['br669a']);
    expect(body.rollup!.registrations.count).toBe(6);
  });

  test('unauthenticated caller → fully-suppressed strip (zero events)', async () => {
    const { body } = await rollup(reqAnon());
    expect(body.ok).toBe(true);
    expect(body.rollup!.events).toBe(0);
    expect(body.rollup!.registrations.suppressed).toBe(true);
    expect(body.rollup!.activeSponsors).toBe(0);
  });

  test('unmapped operator → fully-suppressed strip (fail-closed)', async () => {
    const { body } = await rollup(reqAsEmail('outsider@nowhere.test'));
    expect(body.rollup!.events).toBe(0);
    expect(body.rollup!.registrations.suppressed).toBe(true);
  });
});

describe('OSE-669 — admin surface carries the rollup strip', () => {
  test('admin page renders the strip testids and wires the fetch', async () => {
    const res = await SELF.fetch('https://t.test/admin', {
      headers: { Authorization: 'Bearer test-admin-key-e2e-2026' },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    for (const id of [
      'portfolio-rollup',
      'rollup-events-num',
      'rollup-registrations-num',
      'rollup-checkins-num',
      'rollup-sponsors-num',
    ]) {
      expect(html.includes(`data-testid="${id}"`), `admin HTML missing ${id}`).toBe(true);
    }
    expect(html).toContain('/api/v2/admin/events/portfolio-rollup');
  });
});
