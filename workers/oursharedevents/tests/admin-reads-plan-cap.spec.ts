/**
 * Who × plan on the admin reads (OSE-682, owner decisions 2026-11-04).
 *
 * The SharedReport caps depth by the event's plan; the same numbers also leave
 * through admin reads, and the front end hiding them changes nothing if the API
 * returns them. On an event whose plan lacks the paid report
 * (`analytics.shared-report` off, the Free preset):
 *
 *   - the event's brand admin gets the Local line only, meaning totals. Per-day
 *     series, per-poster / per-placement / per-code counts and map cells and
 *     flows are left out of the response, and a `plan` block names them;
 *   - a platform admin (scope `all`; here the key actor, which the workers config
 *     runs with ADMIN_SCOPE_ALL=true) gets everything, as on a paid plan.
 *
 * @born-red OSE-682 | method: plan-lookup-forced-paid | verified: making
 *   reportPlanFor in router.ts return FULL_PLAN for every caller turns every
 *   "Free plan, brand admin" test red (the withheld sections come back).
 */
import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { BRANDS, FIXTURE_CELL, callAs, seedBrandFixture } from './helpers/brand-matrix';
import { usePaidReportPlan } from './helpers/paid-report-plan';

const A = BRANDS[0]!;
const OWNER = { kind: 'owner', brand: A } as const;
const PLATFORM = { kind: 'key-all' } as const;
const formsDb = () => (env as unknown as { FORMS_DB: D1Database }).FORMS_DB;
const db = () => (env as unknown as { DB: D1Database }).DB;

async function setPlan(paid: boolean): Promise<void> {
  await usePaidReportPlan(); // forms tables + a global row
  await formsDb()
    .prepare(
      `UPDATE feature_flags SET enabled = ? WHERE scope = 'global' AND flag_key = 'analytics.shared-report'`
    )
    .bind(paid ? 1 : 0)
    .run();
  await formsDb()
    .prepare(
      `DELETE FROM feature_flags WHERE scope = 'event' AND flag_key = 'analytics.shared-report'`
    )
    .run();
}

async function setEventOverride(eventId: string, paid: boolean): Promise<void> {
  await formsDb()
    .prepare(
      `INSERT INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
       VALUES (?, 'event', ?, 'analytics.shared-report', ?, datetime('now'))
       ON CONFLICT(scope, scope_id, flag_key) DO UPDATE SET enabled = excluded.enabled`
    )
    .bind(`t682-ovr-${eventId}`, eventId, paid ? 1 : 0)
    .run();
}

async function read(caller: typeof OWNER | typeof PLATFORM, path: string) {
  const res = await callAs(caller, 'GET', path);
  expect(res.status, path).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

beforeAll(async () => {
  await seedBrandFixture();
  // Brand A's poster hangs in the event's cell and has 6 scans in one hour, so
  // a flow clears the floor and the paid case has something to withhold.
  await db()
    .prepare(`UPDATE poster_deployments SET h3_res7 = ?, is_active = 1 WHERE id = ?`)
    .bind(FIXTURE_CELL, A.posterDeploymentId)
    .run();
  for (let i = 0; i < 6; i++) {
    await db()
      .prepare(
        `INSERT OR REPLACE INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket)
         VALUES (?, ?, ?, '2026-05-07T19:00')`
      )
      .bind(`t682-scan-${i}`, A.activeEventId, A.posterDeploymentId)
      .run();
  }
});

const dash = `/api/v2/admin/events/${A.activeEventId}/dashboard`;
const pre = `/api/v2/admin/events/${A.activeEventId}/pre-event-activity`;
const posters = `/api/v2/admin/events/${A.activeEventId}/poster-deployments`;
const corridor = `/api/v2/admin/dashboards/corridor?brand_id=${A.brandId}&data_class=all`;

describe('OSE-682 | event dashboard', () => {
  test('Free plan, brand admin: reach is totals only, the day series is withheld and named', async () => {
    await setPlan(false);
    const body = await read(OWNER, dash);
    const reach = body.reach as Record<string, unknown>;
    expect(reach).toHaveProperty('scans');
    expect(reach).toHaveProperty('clicks');
    expect(reach).not.toHaveProperty('scansByDay');
    expect((body.plan as { locked_sections: string[] }).locked_sections).toContain(
      'reach.scansByDay'
    );
  });

  test('Mid plan, brand admin: the day series is there and nothing is named as withheld', async () => {
    await setPlan(true);
    const body = await read(OWNER, dash);
    expect(body.reach as Record<string, unknown>).toHaveProperty('scansByDay');
    expect(body).not.toHaveProperty('plan');
  });

  test('Free plan, platform admin: everything', async () => {
    await setPlan(false);
    const body = await read(PLATFORM, dash);
    expect(body.reach as Record<string, unknown>).toHaveProperty('scansByDay');
    expect(body).not.toHaveProperty('plan');
  });
});

describe('OSE-682 | pre-event activity', () => {
  test('Free plan, brand admin: totals only; per-placement and per-code reach and the day series withheld', async () => {
    await setPlan(false);
    const body = await read(OWNER, pre);
    const reach = body.reach as Record<string, unknown>;
    expect(reach).toHaveProperty('totals');
    expect(reach).not.toHaveProperty('venue');
    expect(reach).not.toHaveProperty('community');
    expect(reach).not.toHaveProperty('taps');
    expect(body.activity as Record<string, unknown>).not.toHaveProperty('scansByDay');
    const locked = (body.plan as { locked_sections: string[] }).locked_sections;
    expect(locked).toEqual(
      expect.arrayContaining([
        'reach.venue',
        'reach.community',
        'reach.taps',
        'activity.scansByDay',
      ])
    );
  });

  test('Mid plan, brand admin: per-placement reach is there', async () => {
    await setPlan(true);
    const body = await read(OWNER, pre);
    expect(body.reach as Record<string, unknown>).toHaveProperty('venue');
    expect(body).not.toHaveProperty('plan');
  });

  test('Free plan, platform admin: per-placement reach is there', async () => {
    await setPlan(false);
    const body = await read(PLATFORM, pre);
    expect(body.reach as Record<string, unknown>).toHaveProperty('venue');
  });
});

describe('OSE-682 | poster deployments', () => {
  test('Free plan, brand admin: placements listed, their per-poster scans withheld', async () => {
    await setPlan(false);
    const body = await read(OWNER, posters);
    const items = body.items as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) expect(it).not.toHaveProperty('scans');
    expect((body.plan as { locked_sections: string[] }).locked_sections).toContain('items.scans');
  });

  test('Mid plan, brand admin: per-poster scans are there', async () => {
    await setPlan(true);
    const body = await read(OWNER, posters);
    for (const it of body.items as Array<Record<string, unknown>>)
      expect(it).toHaveProperty('scans');
  });

  test('Free plan, platform admin: per-poster scans are there', async () => {
    await setPlan(false);
    const body = await read(PLATFORM, posters);
    for (const it of body.items as Array<Record<string, unknown>>)
      expect(it).toHaveProperty('scans');
  });
});

describe('OSE-682 | corridor dashboard (brand-wide map)', () => {
  beforeEach(async () => {
    await setPlan(false);
  });

  test('Free plan, platform admin: the flow is there (the fixture clears the floor)', async () => {
    const body = await read(PLATFORM, corridor);
    expect((body.flows as unknown[]).length).toBeGreaterThan(0);
    expect((body.event_cells as unknown[]).length).toBeGreaterThan(0);
  });

  test('Free plan, brand admin: no event cells, source cells or flows; named as withheld', async () => {
    // The brand admin reaches the same dashboard through the platform key's
    // ?brand_id= path only when scoped to it; the owner's own scope is brand A.
    const body = await read(OWNER, `/api/v2/admin/dashboards/corridor?data_class=all`);
    expect(body.event_cells).toEqual([]);
    expect(body.source_cells).toEqual([]);
    expect(body.flows).toEqual([]);
    expect((body.plan as { locked_sections: string[] }).locked_sections).toEqual(
      expect.arrayContaining(['event_cells', 'source_cells', 'flows'])
    );
    // Entity totals stay: categories, day parts, series, partners.
    expect(body).toHaveProperty('by_category');
    expect(body).toHaveProperty('partner_network');
  });

  test('Free plan with a paid override on the event: its cells and flow come back', async () => {
    await setEventOverride(A.activeEventId, true);
    const body = await read(OWNER, `/api/v2/admin/dashboards/corridor?data_class=all`);
    expect((body.flows as unknown[]).length).toBeGreaterThan(0);
    expect((body.event_cells as unknown[]).length).toBeGreaterThan(0);
  });

  test('Mid plan, brand admin: the map is there, nothing named as withheld', async () => {
    await setPlan(true);
    const body = await read(OWNER, `/api/v2/admin/dashboards/corridor?data_class=all`);
    expect((body.flows as unknown[]).length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('plan');
  });
});
