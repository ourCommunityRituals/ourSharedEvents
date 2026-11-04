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

// ── Review 2026-11-04: a brand admin cannot grant its own event a paid plan ──
// A per-event override is how the plan reaches one event, so writing one is an
// entitlement write. A brand admin may turn a feature OFF for an event or remove
// an override; turning one ON is allowed only when the plan already includes it.
// Anything beyond the plan is a platform action.
//
// @born-red OSE-682 | method: drop-guard | verified: removing the
//   EVENT_FLAG_ABOVE_PLAN check in router.ts turns "Free plan, brand admin
//   cannot switch the paid report on" red (the write succeeds and the dashboard
//   comes back in full).
describe('OSE-682 | event flag overrides are entitlement writes', () => {
  const flagPath = `/api/v2/admin/events/${A.activeEventId}/flags/analytics.shared-report`;

  test('Free plan, brand admin cannot switch the paid report on; the reads stay capped', async () => {
    await setPlan(false);
    const res = await callAs(OWNER, 'PUT', flagPath, { enabled: true });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('EVENT_FLAG_ABOVE_PLAN');
    const body = await read(OWNER, dash);
    expect(body.reach as Record<string, unknown>).not.toHaveProperty('scansByDay');
  });

  test('Free plan, brand admin cannot switch a plan-locked form on either', async () => {
    await setPlan(false);
    await formsDb()
      .prepare(
        `INSERT INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
         VALUES ('t682-survey', 'global', '', 'forms.survey', 0, datetime('now'))
         ON CONFLICT(scope, scope_id, flag_key) DO UPDATE SET enabled = 0`
      )
      .run();
    const res = await callAs(
      OWNER,
      'PUT',
      `/api/v2/admin/events/${A.activeEventId}/flags/forms.survey`,
      { enabled: true }
    );
    expect(res.status).toBe(403);
  });

  test('a brand admin may turn a feature off for an event, and remove the override', async () => {
    await setPlan(true);
    expect((await callAs(OWNER, 'PUT', flagPath, { enabled: false })).status).toBe(200);
    expect((await callAs(OWNER, 'DELETE', flagPath)).status).toBe(200);
  });

  test('Mid plan, brand admin may switch the paid report back on for its event', async () => {
    await setPlan(true);
    expect((await callAs(OWNER, 'PUT', flagPath, { enabled: true })).status).toBe(200);
  });

  test('Free plan, platform admin grants the event the paid report; the brand admin then reads it in full', async () => {
    await setPlan(false);
    expect((await callAs(PLATFORM, 'PUT', flagPath, { enabled: true })).status).toBe(200);
    const body = await read(OWNER, dash);
    expect(body.reach as Record<string, unknown>).toHaveProperty('scansByDay');
    expect(body).not.toHaveProperty('plan');
  });
});

// ── Review 2026-11-04: a platform admin's full view is audited ──────────────
describe('OSE-682 | platform reads past the plan are audited', () => {
  test('a platform admin reading a Free event dashboard leaves an audit row', async () => {
    await setPlan(false);
    await db().prepare(`DELETE FROM admin_audit_log WHERE action = 'READ_PAST_PLAN'`).run();
    await read(PLATFORM, dash);
    // The audit write is waitUntil'd; give it a turn.
    await new Promise((r) => setTimeout(r, 50));
    const row = await db()
      .prepare(
        `SELECT action, resource_type, resource_id, outcome, request_id FROM admin_audit_log
          WHERE action = 'READ_PAST_PLAN' ORDER BY rowid DESC LIMIT 1`
      )
      .first<{ resource_type: string; resource_id: string; outcome: string; request_id: string }>();
    expect(row).not.toBeNull();
    expect(row!.resource_type).toBe('event');
    expect(row!.resource_id).toBe(A.activeEventId);
    expect(row!.outcome).toBe('success');
    expect(row!.request_id).toBeTruthy();
  });

  test('a brand admin read is not a platform read: no such row', async () => {
    await setPlan(false);
    await db().prepare(`DELETE FROM admin_audit_log WHERE action = 'READ_PAST_PLAN'`).run();
    await read(OWNER, dash);
    await new Promise((r) => setTimeout(r, 50));
    const n = await db()
      .prepare(`SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'READ_PAST_PLAN'`)
      .first<{ n: number }>();
    expect(n!.n).toBe(0);
  });
});

// ── Review 2026-11-04 (2): a downgrade reaches every event ───────────────────
// A brand admin's "on" within its plan follows the plan (the override is
// removed), so changing the global plan later changes the event too. Only a
// platform admin writes an explicit grant that outlives the plan.
//
// @born-red OSE-682 | method: write-override | verified: letting a brand admin's
//   in-plan "on" write an event row (handleSetEventFlag) turns "Mid → brand admin
//   switches on → Free" red (the event keeps the paid view after the downgrade).
describe('OSE-682 | a brand admin cannot carry a paid plan past a downgrade', () => {
  const flagPath = `/api/v2/admin/events/${A.activeEventId}/flags/analytics.shared-report`;
  const setGlobalOnly = (paid: boolean) =>
    formsDb()
      .prepare(
        `UPDATE feature_flags SET enabled = ? WHERE scope = 'global' AND flag_key = 'analytics.shared-report'`
      )
      .bind(paid ? 1 : 0)
      .run();

  test('Mid → brand admin switches the paid report on → Free: the event is capped', async () => {
    await setPlan(true);
    // Off, then on again: the organizer's own choice, within the plan.
    expect((await callAs(OWNER, 'PUT', flagPath, { enabled: false })).status).toBe(200);
    expect((await callAs(OWNER, 'PUT', flagPath, { enabled: true })).status).toBe(200);
    // The plan changes; event overrides are left as they are.
    await setGlobalOnly(false);
    const body = await read(OWNER, dash);
    expect(body.reach as Record<string, unknown>).not.toHaveProperty('scansByDay');
    expect(body).toHaveProperty('plan');
  });

  test("a platform admin's grant outlives the downgrade", async () => {
    await setPlan(true);
    expect((await callAs(PLATFORM, 'PUT', flagPath, { enabled: true })).status).toBe(200);
    await setGlobalOnly(false);
    const body = await read(OWNER, dash);
    expect(body.reach as Record<string, unknown>).toHaveProperty('scansByDay');
  });

  test("a brand admin's off still holds: it is their choice, below the plan", async () => {
    await setPlan(true);
    expect((await callAs(OWNER, 'PUT', flagPath, { enabled: false })).status).toBe(200);
    const body = await read(OWNER, dash);
    expect(body.reach as Record<string, unknown>).not.toHaveProperty('scansByDay');
  });
});

// ── Review 2026-11-04 (2): the audit records what actually happened ──────────
describe('OSE-682 | a platform read is audited with its real outcome', () => {
  test('a rejected platform read (no brand named) is audited as denied, not success', async () => {
    await setPlan(false);
    await db().prepare(`DELETE FROM admin_audit_log WHERE action = 'READ_PAST_PLAN'`).run();
    // A key actor in all-scope must name a brand: 400 BRAND_REQUIRED.
    const res = await callAs(PLATFORM, 'GET', '/api/v2/admin/dashboards/corridor?data_class=all');
    expect(res.status).toBe(400);
    await new Promise((r) => setTimeout(r, 50));
    const rows = await db()
      .prepare(`SELECT outcome FROM admin_audit_log WHERE action = 'READ_PAST_PLAN'`)
      .all<{ outcome: string }>();
    expect(rows.results.map((r) => r.outcome)).toEqual(['denied']);
  });
});

// ── Review 2026-11-04 (3): the corridor note is about the caller's own events ──
//
// @born-red OSE-682 | method: note-on-narrowed | verified: emitting the plan
//   note whenever the filter narrows (any override anywhere) turns "an override
//   in another brand leaves brand A's map whole and unannotated" red.
describe('OSE-682 | corridor plan note covers in-scope events only', () => {
  const B = BRANDS[1]!;

  test("an override in another brand leaves brand A's map whole and unannotated", async () => {
    await setPlan(true);
    await setEventOverride(B.activeEventId, false);
    const body = await read(OWNER, `/api/v2/admin/dashboards/corridor?data_class=all`);
    expect((body.flows as unknown[]).length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('plan');
  });

  test("an override on brand A's own event is named", async () => {
    await setPlan(true);
    await setEventOverride(A.activeEventId, false);
    const body = await read(OWNER, `/api/v2/admin/dashboards/corridor?data_class=all`);
    expect(body).toHaveProperty('plan');
    expect(body.flows).toEqual([]);
  });
});

// ── Review 2026-11-04 (3): the audit names the validated brand ───────────────
//
// @born-red OSE-682 | method: audit-requested-brand | verified: recording
//   ?brand_id= as the audit brand turns "a refused platform read names no
//   tenant" red (brand A gets an entry for a read it never served).
describe('OSE-682 | the corridor audit records the brand the handler validated', () => {
  const PLATFORM_MEMBER = { kind: 'platform' } as const;
  const auditRows = () =>
    db()
      .prepare(
        `SELECT outcome, brand_id FROM admin_audit_log WHERE action = 'READ_PAST_PLAN' ORDER BY rowid`
      )
      .all<{ outcome: string; brand_id: string | null }>();

  test('a served platform read names the brand it served', async () => {
    await setPlan(false);
    await db().prepare(`DELETE FROM admin_audit_log WHERE action = 'READ_PAST_PLAN'`).run();
    const res = await callAs(PLATFORM, 'GET', corridor);
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect((await auditRows()).results).toEqual([{ outcome: 'success', brand_id: A.brandId }]);
  });

  test('a refused platform read names no tenant', async () => {
    await setPlan(false);
    await db().prepare(`DELETE FROM admin_audit_log WHERE action = 'READ_PAST_PLAN'`).run();
    // An ose-platform member holds no membership in brand A: 403 BRAND_FORBIDDEN.
    const res = await callAs(
      PLATFORM_MEMBER,
      'GET',
      `/api/v2/admin/dashboards/corridor?brand_id=${A.brandId}&data_class=all`
    );
    expect(res.status).toBe(403);
    await new Promise((r) => setTimeout(r, 50));
    expect((await auditRows()).results).toEqual([{ outcome: 'denied', brand_id: null }]);
  });
});

// ── Review 2026-11-04 (4): the plan rule answers in the flag handler's envelope ──
// A refusal carries its code and a request reference (X-Request-Id, equal to the
// body's requestId) so the admin toast can link it to its audit row
// (toast-refusal-reference.spec.ts is the contract); an unknown flag key is a
// 400 before any plan rule runs.
describe('OSE-682 | event flag plan rule keeps the flag envelope', () => {
  const REFERENCE = /^[0-9a-f-]{8,}$/i;
  const flagPath = (key: string) => `/api/v2/admin/events/${A.activeEventId}/flags/${key}`;

  test('the above-plan refusal carries its code and request reference', async () => {
    await setPlan(false);
    const res = await callAs(OWNER, 'PUT', flagPath('analytics.shared-report'), { enabled: true });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string; requestId: string };
    expect(body.code).toBe('EVENT_FLAG_ABOVE_PLAN');
    expect(res.headers.get('X-Request-Id')).toMatch(REFERENCE);
    expect(body.requestId).toBe(res.headers.get('X-Request-Id'));
  });

  test('an in-plan "on" (the override removed) answers with a request reference', async () => {
    await setPlan(true);
    const res = await callAs(OWNER, 'PUT', flagPath('analytics.shared-report'), { enabled: true });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-Id')).toMatch(REFERENCE);
  });

  test('an unknown flag key is a 400 for a brand admin, before any plan rule', async () => {
    await setPlan(true);
    const res = await callAs(OWNER, 'PUT', flagPath('not.a.flag'), { enabled: true });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('INVALID_FLAG_KEY');
  });
});

// ── Review 2026-11-04 (5): a platform read's reference finds its audit row ───
//
// @born-red OSE-682 | method: audit-router-id | verified: auditing with the
//   router's own reqId instead of the response's reference turns every case red
//   (the handlers mint their own X-Request-Id, and pre-event activity sent none).
describe("OSE-682 | a platform read's X-Request-Id is its audit row's request_id", () => {
  for (const [label, path] of [
    ['event dashboard', dash],
    ['pre-event activity', pre],
    ['poster deployments', posters],
    ['corridor dashboard', corridor],
  ] as const) {
    test(label, async () => {
      await setPlan(false);
      await db().prepare(`DELETE FROM admin_audit_log WHERE action = 'READ_PAST_PLAN'`).run();
      const res = await callAs(PLATFORM, 'GET', path);
      expect(res.status).toBe(200);
      const reference = res.headers.get('X-Request-Id');
      expect(reference, 'X-Request-Id').toBeTruthy();
      await new Promise((r) => setTimeout(r, 50));
      const row = await db()
        .prepare(`SELECT request_id FROM admin_audit_log WHERE action = 'READ_PAST_PLAN'`)
        .first<{ request_id: string }>();
      expect(row?.request_id).toBe(reference);
    });
  }
});
