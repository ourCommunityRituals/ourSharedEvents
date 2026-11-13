/**
 * OSE-896 — admin event dashboard aggregate counts.
 *
 * GET /api/v2/admin/events/:id/stats → { ok, status, stats } feeding the ported
 * EventDashboard card (OSE-886). Asserts the per-data-class privacy model:
 *   • scans        — floored like every count of people (OSE-1656, owner ruling
 *                    2026-10-08: no exceptions): the sum of the event's
 *                    poster-hours with 5 or more, so 1 to 4 read like none.
 *   • appearances  — active sponsors present, EXACT (not impressions, #25).
 *   • registrations / checkins — identity-derived, uniform K=5 floor
 *     (lib/count-floor.ts / OSE-665): sub-K suppressed server-side, never leaked.
 *
 * FK is OFF by default in the test env (see constraints.spec.ts), so seed rows
 * insert without full referential setup.
 */

import { env, SELF } from 'cloudflare:test';
import { seedSplitSponsor } from './helpers/seed-sponsor';
import { describe, test, expect, beforeAll } from 'vitest';

const ADMIN = { Authorization: 'Bearer test-admin-key-e2e-2026' };

// Apply all migrations to both DBs (main + forms), matching poster-qr.spec.ts.
beforeAll(async () => {
  const tenv = env as unknown as {
    TEST_MIGRATION_STATEMENTS: string;
    TEST_FORMS_MIGRATION_STATEMENTS: string;
  };
  const run = async (db: D1Database, stmts: string[]) => {
    for (const stmt of stmts) {
      try {
        await db.prepare(stmt).run();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('duplicate column name')) continue;
        throw e;
      }
    }
  };
  await run(env.DB, JSON.parse(tenv.TEST_MIGRATION_STATEMENTS));
  await run(env.FORMS_DB, JSON.parse(tenv.TEST_FORMS_MIGRATION_STATEMENTS));
});

async function createEvent(title: string): Promise<string> {
  const res = await SELF.fetch('https://t.test/api/v2/admin/events', {
    method: 'POST',
    headers: { ...ADMIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      attendance_mode: 'in_person',
      location: 'Test Hall',
      title,
      status: 'active',
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function stats(eventId: string, headers: Record<string, string> = ADMIN) {
  return SELF.fetch(`https://t.test/api/v2/admin/events/${eventId}/stats`, { headers });
}

/** `n` scans at one poster in one hour (the cell every scan figure sums). */
async function seedScansAt(eventId: string, poster: string, hour: string, n: number) {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO poster_deployments (id, event_id, qr_token) VALUES (?, ?, ?)'
  )
    .bind(poster, eventId, `qrt-${poster}`)
    .run();
  for (let i = 0; i < n; i++) {
    await env.DB.prepare(
      'INSERT INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket) VALUES (?, ?, ?, ?)'
    )
      .bind(crypto.randomUUID(), eventId, poster, `${hour}:00`)
      .run();
  }
}

async function seedScan(eventId: string): Promise<void> {
  const dep = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO poster_deployments (id, event_id, qr_token) VALUES (?, ?, ?)')
    .bind(dep, eventId, crypto.randomUUID())
    .run();
  // OSE-798: a scan is one placement event (WHERE side of the split scan path).
  await env.DB.prepare(
    'INSERT INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket) VALUES (?, ?, ?, ?)'
  )
    .bind(crypto.randomUUID(), eventId, dep, 'b1')
    .run();
}

async function seedSponsor(eventId: string, active: number): Promise<void> {
  // OSE-799 A2: is_active is now a sponsor_placement fact (appearances counts it).
  await seedSplitSponsor(env.DB, {
    id: crypto.randomUUID(),
    eventId,
    name: 'Acme',
    isActive: active,
  });
}

async function seedRegistration(eventId: string): Promise<void> {
  await env.FORMS_DB.prepare(
    `INSERT INTO form_registrations (id, event_id, registration_bucket, status, attendee_email_hash)
     VALUES (?, ?, ?, 'confirmed', ?)`
  )
    .bind(crypto.randomUUID(), eventId, 'bucket-a', crypto.randomUUID())
    .run();
}

async function seedCheckins(eventId: string, total: number): Promise<void> {
  await env.FORMS_DB.prepare(
    'INSERT INTO checkin_counts (id, event_id, total_count, updated_at) VALUES (?, ?, ?, ?)'
  )
    .bind(crypto.randomUUID(), eventId, total, new Date().toISOString())
    .run();
}

describe('OSE-896 — admin event stats endpoint', () => {
  test('unauthenticated request is rejected (admin-guarded)', async () => {
    const eventId = await createEvent('Auth Guard');
    const res = await stats(eventId, {});
    expect(res.status).not.toBe(200);
    expect([401, 403]).toContain(res.status);
  });

  test('empty event → appearances exact 0; scans and PII tiles suppressed under K', async () => {
    const eventId = await createEvent('Empty Event');
    const res = await stats(eventId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.status).toBe(200);
    expect(body.stats.scans).toEqual({ count: null, suppressed: true, floor: 5 });
    expect(body.stats.appearances).toBe(0); // exact, public
    // 0 < K → suppressed, raw value withheld (count null)
    expect(body.stats.registrations).toMatchObject({ count: null, suppressed: true });
    expect(body.stats.checkins).toMatchObject({ count: null, suppressed: true });
    expect(body.stats.registrations.floor).toBeGreaterThanOrEqual(5);
  });

  // OSE-1656. The First-Scan gauge used to show a single scan as 1, which
  // told "nobody" from "1 to 4". It now reads withheld until one poster has
  // 5 scans in one hour (decision 5 on the ticket: withheld until 5).
  test('one scan reads withheld, like none: the First-Scan gauge is floored', async () => {
    const eventId = await createEvent('First Scan');
    await seedScan(eventId);
    const body = (await (await stats(eventId)).json()) as any;
    expect(body.stats.scans).toEqual({ count: null, suppressed: true, floor: 5 });
  });

  test('scans are the poster-hours with 5 or more: 4 + 4 is withheld, a fifth in one hour shows 5', async () => {
    const eventId = await createEvent('Poster Hours');
    await seedScansAt(eventId, `${eventId}-p`, '2026-10-01T18', 4);
    await seedScansAt(eventId, `${eventId}-p`, '2026-10-01T19', 4);
    let body = (await (await stats(eventId)).json()) as any;
    expect(body.stats.scans).toEqual({ count: null, suppressed: true, floor: 5 });
    await seedScansAt(eventId, `${eventId}-p`, '2026-10-01T19', 1);
    body = (await (await stats(eventId)).json()) as any;
    expect(body.stats.scans).toEqual({ count: 5, suppressed: false, floor: 5 });
  });

  test('active sponsors are counted exact; inactive are excluded', async () => {
    const eventId = await createEvent('Sponsors');
    await seedSponsor(eventId, 1);
    await seedSponsor(eventId, 1);
    await seedSponsor(eventId, 0); // inactive — must not count
    const res = await stats(eventId);
    const body = (await res.json()) as any;
    expect(body.stats.appearances).toBe(2);
  });

  test('registrations below K are suppressed; at/above K are exact', async () => {
    const low = await createEvent('Reg Low');
    await seedRegistration(low);
    await seedRegistration(low); // 2 < 5 → suppressed
    const lowBody = (await (await stats(low)).json()) as any;
    expect(lowBody.stats.registrations).toMatchObject({ count: null, suppressed: true });

    const high = await createEvent('Reg High');
    for (let i = 0; i < 5; i++) await seedRegistration(high); // 5 >= 5 → exact
    const highBody = (await (await stats(high)).json()) as any;
    expect(highBody.stats.registrations).toMatchObject({ count: 5, suppressed: false });
  });

  test('check-ins use the same uniform floor', async () => {
    const low = await createEvent('Chk Low');
    await seedCheckins(low, 3); // 3 < 5 → suppressed
    const lowBody = (await (await stats(low)).json()) as any;
    expect(lowBody.stats.checkins).toMatchObject({ count: null, suppressed: true });

    const high = await createEvent('Chk High');
    await seedCheckins(high, 7); // 7 >= 5 → exact
    const highBody = (await (await stats(high)).json()) as any;
    expect(highBody.stats.checkins).toMatchObject({ count: 7, suppressed: false });
  });
});

describe('OSE-896 — admin dashboard wiring (source shape)', () => {
  async function adminHtml(): Promise<string> {
    const res = await SELF.fetch('https://t.test/admin', { headers: ADMIN });
    expect(res.status).toBe(200);
    return res.text();
  }

  test('the dashboard fetches the stats endpoint on event selection', async () => {
    const html = await adminHtml();
    expect(html).toContain('/stats');
    expect(html).toContain('fetchStats');
  });

  test('floored PII values render "<N" via the suppressed flag (never a raw sub-K count)', async () => {
    const html = await adminHtml();
    expect(html).toContain('v.suppressed');
    expect(html).toContain("'<'");
  });

  test('the sponsor tile is labelled "Sponsors", not an impression/"appearances" reading', async () => {
    const html = await adminHtml();
    expect(html).toContain('>Sponsors<');
    expect(html).not.toContain('Sponsor appearances');
  });
});
