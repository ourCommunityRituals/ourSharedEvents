/**
 * OSE-1554 — brand test matrix (INVARIANT #9 tenant_isolation).
 *
 * One fixture tree (tests/helpers/brand-matrix.ts: four brands, each with a live
 * event, a draft, a sponsor with an accepted placement, a campaign, a poster
 * deployment) and one route list (tests/helpers/brand-matrix-routes.ts). Every
 * brand-scoped admin route is run as:
 *
 *   owner:<brand>  for every ordered pair of different brands (caller -> target)
 *   platform       a member of the reserved `ose-platform` brand (no tenant access)
 *   key-all        `key:` actor WITH ADMIN_SCOPE_ALL (CI/automation; sees every brand)
 *   key-none       `key:` actor WITHOUT ADMIN_SCOPE_ALL (deny: sees nothing)
 *   anonymous      no identity (401, never a scope answer)
 *
 * Leaks are found by substring: every id/title/name a brand owns carries
 * `bm-<brand>-`, so a body that reaches brand A's caller with `bm-cbc-` in it is
 * brand B's data, whatever shape the route returns.
 *
 * The matrix never mutates its shared fixture: cross-brand writes must be refused
 * and the snapshot of every fixture table must be byte-identical afterwards.
 *
 * Known gaps are listed in `MATRIX_ROUTES[].knownGap` (ticket per entry). A known
 * gap cell is still RUN and is asserted to still fail, so the day it is fixed this
 * spec goes red until the marker is removed: the list cannot go stale.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import {
  BRANDS,
  UNKNOWN_ID,
  FIXTURE_CELL,
  brandMatrix,
  callAs,
  callerLabel,
  routerEnv,
  seedBrandFixture,
  snapshotFixture,
  type BrandFx,
  type CallerKind,
} from './helpers/brand-matrix';
import {
  MATRIX_ROUTES,
  idOf,
  type CreateRoute,
  type ListRoute,
  type MatrixRoute,
  type ObjectRoute,
} from './helpers/brand-matrix-routes';
import { env } from 'cloudflare:test';

beforeAll(async () => {
  await seedBrandFixture();
});

// ── helpers ──────────────────────────────────────────────────────────────────

/** Every spelling of "brand `b`'s data" that could appear in a body. */
function carriesBrand(text: string, b: BrandFx): boolean {
  return text.includes(b.marker) || text.includes(`"brand_id":"${b.brandId}"`);
}

/** The target's id as the caller typed it is echoed in a 404 message; that is not a leak. */
function stripEcho(text: string, ...ids: string[]): string {
  let out = text;
  for (const id of ids) out = out.split(id).join('<id>');
  return out;
}

function foreignBrandsIn(text: string, own: BrandFx | null, ...echo: string[]): string[] {
  const t = stripEcho(text, ...echo);
  return BRANDS.filter((b) => (own ? b.key !== own.key : true) && carriesBrand(t, b)).map(
    (b) => b.key
  );
}

function normalise(text: string, id: string): string {
  return stripEcho(text, id)
    .replace(/"requestId":"[^"]*"/g, '"requestId":"<r>"')
    .replace(/"timestamp":"[^"]*"/g, '"timestamp":"<t>"');
}

/**
 * "The route let me in": anything except the scope/auth refusals. A 5xx here means the
 * handler ran and its backing store is absent in this pool (FORMS_DB-backed routes
 * answer 503), which still proves the scope wall did not stop an owner.
 */
const reachedHandler = (status: number): boolean => ![401, 403, 404].includes(status);

const objectRoutes = MATRIX_ROUTES.filter((r): r is ObjectRoute => r.shape === 'object');
const listRoutes = MATRIX_ROUTES.filter((r): r is ListRoute => r.shape === 'list');
const createRoutes = MATRIX_ROUTES.filter((r): r is CreateRoute => r.shape === 'create');

const label = (r: MatrixRoute) => `${r.method} ${r.pattern}${r.variant ? ` (${r.variant})` : ''}`;

/**
 * Run `body`; for a route carrying a knownGap, assert the cell STILL fails (so the
 * marker is removed the day the gap closes). Everything else runs as a plain test.
 */
function cell(r: MatrixRoute, name: string, body: () => Promise<void>): void {
  if (r.knownGap) {
    test(`[known gap ${r.knownGap.ticket}] ${name}`, async () => {
      let failed = false;
      try {
        await body();
      } catch {
        failed = true;
      }
      expect(failed, `${name} now passes: remove knownGap (${r.knownGap?.ticket})`).toBe(true);
    });
    return;
  }
  test(name, body);
}

// ── the matrix ───────────────────────────────────────────────────────────────

describe('OSE-1554 matrix: by-id routes, brand A caller against brand B object', () => {
  for (const r of objectRoutes) {
    for (const [caller, target] of brandMatrix()) {
      cell(r, `${label(r)} | owner:${caller.key} -> ${target.key}`, async () => {
        const before = r.mutates ? await snapshotFixture() : null;
        const id = idOf(target, r.objectOf);
        const res = await callAs(
          { kind: 'owner', brand: caller },
          r.method,
          r.path(id),
          r.body?.(target)
        );
        const text = await res.text();
        expect(res.status, `${label(r)} leaked: ${res.status} ${text.slice(0, 200)}`).toBe(404);
        expect(foreignBrandsIn(text, caller, id)).toEqual([]);
        if (before !== null) expect(await snapshotFixture()).toBe(before);
      });
    }
  }
});

describe('OSE-1554 matrix: by-id routes, other caller kinds', () => {
  for (const r of objectRoutes) {
    cell(r, `${label(r)} | platform member -> every brand`, async () => {
      const before = r.mutates ? await snapshotFixture() : null;
      for (const target of BRANDS) {
        const res = await callAs(
          { kind: 'platform' },
          r.method,
          r.path(idOf(target, r.objectOf)),
          r.body?.(target)
        );
        expect(res.status, `${label(r)} platform -> ${target.key}`).toBe(404);
      }
      if (before !== null) expect(await snapshotFixture()).toBe(before);
    });

    cell(r, `${label(r)} | key actor without ADMIN_SCOPE_ALL -> every brand`, async () => {
      const before = r.mutates ? await snapshotFixture() : null;
      for (const target of BRANDS) {
        const res = await callAs(
          { kind: 'key-none' },
          r.method,
          r.path(idOf(target, r.objectOf)),
          r.body?.(target)
        );
        expect(res.status, `${label(r)} key-none -> ${target.key}`).toBe(404);
      }
      if (before !== null) expect(await snapshotFixture()).toBe(before);
    });

    cell(r, `${label(r)} | anonymous -> 401, never a scope answer`, async () => {
      const res = await callAs(
        { kind: 'anonymous' },
        r.method,
        r.path(idOf(BRANDS[1], r.objectOf)),
        r.body?.(BRANDS[1])
      );
      expect(res.status).toBe(401);
    });

    // Positive controls: a cell that passes only because the route is dead proves nothing.
    // Reads only; the matrix never writes to its shared fixture on a "yes" path.
    if (!r.mutates) {
      cell(r, `${label(r)} | owner reaches OWN object (positive control)`, async () => {
        for (const b of BRANDS) {
          const res = await callAs(
            { kind: 'owner', brand: b },
            r.method,
            r.path(idOf(b, r.objectOf))
          );
          const ok = r.ownOk ? r.ownOk(res.status) : reachedHandler(res.status);
          expect(ok, `${label(r)} own ${b.key}: ${res.status}`).toBe(true);
        }
      });
      cell(r, `${label(r)} | key-all reaches every brand (ADMIN_SCOPE_ALL opt-in)`, async () => {
        for (const b of BRANDS) {
          const res = await callAs({ kind: 'key-all' }, r.method, r.path(idOf(b, r.objectOf)));
          const ok = r.ownOk ? r.ownOk(res.status) : reachedHandler(res.status);
          expect(ok, `${label(r)} key-all ${b.key}: ${res.status}`).toBe(true);
        }
      });
    }

    // Dr of Security: "not yours" and "does not exist" must be indistinguishable.
    cell(r, `${label(r)} | not-yours is indistinguishable from does-not-exist`, async () => {
      const caller = BRANDS[0];
      const target = BRANDS[1];
      const yoursId = idOf(target, r.objectOf);
      const cross = await callAs(
        { kind: 'owner', brand: caller },
        r.method,
        r.path(yoursId),
        r.body?.(target)
      );
      const unknown = await callAs(
        { kind: 'owner', brand: caller },
        r.method,
        r.path(UNKNOWN_ID),
        r.body?.(target)
      );
      expect(cross.status).toBe(unknown.status);
      expect(normalise(await cross.text(), yoursId)).toBe(
        normalise(await unknown.text(), UNKNOWN_ID)
      );
    });
  }
});

describe('OSE-1554 matrix: list routes never return another brand', () => {
  for (const r of listRoutes) {
    for (const b of BRANDS) {
      cell(r, `${label(r)} | owner:${b.key} sees no other brand`, async () => {
        const res = await callAs({ kind: 'owner', brand: b }, r.method, r.path);
        expect(res.status, `${label(r)}: ${res.status}`).toBeLessThan(500);
        const text = await res.text();
        expect(foreignBrandsIn(text, b)).toEqual([]);
        if (r.expectOwnMarker) {
          expect(res.status).toBe(200);
          expect(text, `${label(r)} own rows missing (empty-body pass)`).toContain(b.marker);
        }
      });
    }

    // Asking for a brand by name must not widen the caller's scope.
    for (const [caller, target] of brandMatrix()) {
      cell(r, `${label(r)} | owner:${caller.key} asks ?brand_id=${target.key}`, async () => {
        const sep = r.path.includes('?') ? '&' : '?';
        const res = await callAs(
          { kind: 'owner', brand: caller },
          r.method,
          `${r.path}${sep}brand_id=${target.brandId}`
        );
        expect(res.status).toBeLessThan(500);
        expect(foreignBrandsIn(await res.text(), caller)).toEqual([]);
      });
    }

    cell(r, `${label(r)} | platform member sees no tenant rows`, async () => {
      const res = await callAs({ kind: 'platform' }, r.method, r.path);
      expect(res.status).toBeLessThan(500);
      expect(foreignBrandsIn(await res.text(), null)).toEqual([]);
    });

    cell(r, `${label(r)} | key actor without ADMIN_SCOPE_ALL sees no tenant rows`, async () => {
      const res = await callAs({ kind: 'key-none' }, r.method, r.path);
      expect(res.status).toBeLessThan(500);
      expect(foreignBrandsIn(await res.text(), null)).toEqual([]);
    });

    cell(r, `${label(r)} | anonymous -> 401`, async () => {
      const res = await callAs({ kind: 'anonymous' }, r.method, r.path);
      expect(res.status).toBe(401);
    });

    if (r.expectOwnMarker) {
      cell(r, `${label(r)} | key-all sees every brand (positive control)`, async () => {
        const res = await callAs({ kind: 'key-all' }, r.method, r.path);
        const text = await res.text();
        for (const b of BRANDS) expect(text, `${b.key} missing for key-all`).toContain(b.marker);
      });
    }
  }
});

describe('OSE-1554 matrix: create routes refuse another brand', () => {
  for (const r of createRoutes) {
    for (const [caller, target] of brandMatrix()) {
      cell(r, `${label(r)} | owner:${caller.key} names ${target.key}`, async () => {
        const before = await snapshotFixture();
        const res = await callAs(
          { kind: 'owner', brand: caller },
          r.method,
          r.path,
          r.crossBody(target)
        );
        const text = await res.text();
        expect(
          res.status >= 400 && res.status < 500,
          `${label(r)} accepted a cross-brand create: ${res.status} ${text.slice(0, 200)}`
        ).toBe(true);
        expect(await snapshotFixture()).toBe(before);
      });
    }
    for (const kind of ['platform', 'key-none'] as const) {
      cell(r, `${label(r)} | ${kind} cannot create inside a tenant`, async () => {
        const before = await snapshotFixture();
        const caller: CallerKind = { kind };
        for (const target of BRANDS) {
          const res = await callAs(caller, r.method, r.path, r.crossBody(target));
          expect(res.status, `${callerLabel(caller)} -> ${target.key}`).toBeGreaterThanOrEqual(400);
          expect(res.status).toBeLessThan(500);
        }
        expect(await snapshotFixture()).toBe(before);
      });
    }
  }
});

describe('OSE-1554 matrix: sponsor signed link of brand A against brand B placement', () => {
  // The mint route is rate limited per actor + sponsor (10/min): mint once per brand.
  const minted = new Map<string, string>();
  async function mintFor(b: BrandFx): Promise<string> {
    const cached = minted.get(b.key);
    if (cached) return cached;
    const res = await callAs(
      { kind: 'owner', brand: b },
      'POST',
      `/api/v2/admin/sponsors/${b.sponsorId}/home-link`
    );
    expect(res.status, 'mint sponsor link').toBe(200);
    const body = (await res.json()) as { url?: string; link?: string; token?: string };
    const raw = body.url ?? body.link ?? '';
    const token = body.token ?? new URL(raw).searchParams.get('t');
    expect(token, 'minted token').toBeTruthy();
    minted.set(b.key, token as string);
    return token as string;
  }

  async function acceptedOf(placementId: string): Promise<number | null> {
    const row = await env.DB.prepare('SELECT sponsor_accepted FROM sponsor_placement WHERE id = ?')
      .bind(placementId)
      .first<{ sponsor_accepted: number | null }>();
    return row?.sponsor_accepted ?? null;
  }

  for (const [caller, target] of brandMatrix()) {
    test(`POST /api/v2/sponsor/placements/:id/respond | link of ${caller.key} -> placement of ${target.key}`, async () => {
      const token = await mintFor(caller);
      const before = await snapshotFixture();
      const res = await routeRespond(token, target.placementId, false);
      expect(res.status).toBe(404);
      expect(await acceptedOf(target.placementId)).toBe(1);
      expect(await snapshotFixture()).toBe(before);
    });
  }

  test('POST /api/v2/sponsor/placements/:id/respond | a link reaches its OWN placement (positive control)', async () => {
    const b = BRANDS[2];
    const token = await mintFor(b);
    const res = await routeRespond(token, b.placementId, true);
    expect(res.status).toBe(200);
    expect(await acceptedOf(b.placementId)).toBe(1);
  });
});

async function routeRespond(token: string, placementId: string, accepted: boolean) {
  const { route } = await import('../src/router');
  const { createExecutionContext, waitOnExecutionContext } = await import('cloudflare:test');
  const ctx = createExecutionContext();
  const res = await route(
    new Request(`https://ose.test/api/v2/sponsor/placements/${placementId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, accepted }),
    }),
    routerEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe('OSE-1554 matrix: public reads', () => {
  async function publicGet(path: string): Promise<Response> {
    const { route } = await import('../src/router');
    const { createExecutionContext, waitOnExecutionContext } = await import('cloudflare:test');
    const ctx = createExecutionContext();
    const res = await route(new Request(`https://ose.test${path}`), routerEnv, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }

  for (const b of BRANDS) {
    test(`GET /api/v2/events?brand=${b.key} | only ${b.key}'s live events, never a draft`, async () => {
      const res = await publicGet(`/api/v2/events?brand=${b.brandId}`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain(b.activeEventId);
      expect(text).not.toContain(b.draftEventId);
      expect(foreignBrandsIn(text, b)).toEqual([]);
    });
  }

  test('GET /api/v2/events/map | brand-agnostic by design, but never a draft or unlisted event', async () => {
    const res = await publicGet(`/api/v2/events/map?cell=${FIXTURE_CELL}`);
    expect(res.status).toBeLessThan(500);
    const text = await res.text();
    for (const b of BRANDS) expect(text).not.toContain(b.draftEventId);
  });
});

test('OSE-1554 matrix size is printed so the CI log shows what ran', () => {
  const objectCells = objectRoutes.length;
  console.log(
    `[brand-matrix] brands=${BRANDS.length} objectRoutes=${objectCells} listRoutes=${listRoutes.length} createRoutes=${createRoutes.length} pairs=${brandMatrix().length}`
  );
  expect(MATRIX_ROUTES.length).toBeGreaterThan(30);
});
