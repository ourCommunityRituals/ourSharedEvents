/**
 * OSE-1468 dashboard fixture — the first vertical slice as data.
 *
 * Brand `dash-a` runs two events in one corridor:
 *   • a bocce tournament (REC, live, listed, weekend, in a series of two),
 *     with three posters in two source cells, 12 scans, 9 taps on its event
 *     link and 3 on a donation link (a code under K),
 *     7 registrations, 6 check-ins, 2 email signups, two sponsors on show,
 *     one sponsor asking to join and one that declined;
 *   • a teacher/parent workshop (no event type → OTHER, draft, weekday),
 *     with one poster, 3 scans and 3 registrations: every count under K. Its
 *     one sponsor is not on show, because the event is a draft.
 * Plus one `demo` event that the default data_class filter must leave out.
 *
 * Brand `dash-b` has one big event in the same cell. A `dash-a` operator must
 * never see any of it.
 *
 * Written with the same columns the real handlers write, so the fixture
 * documents what each dashboard number is read from.
 */

import { seedSplitSponsor } from './seed-sponsor';

export const CELL_EVENT = '872664c1affffff';
export const CELL_SRC_1 = '872664c1effffff';
export const CELL_SRC_2 = '872664c18ffffff';

export const DASH = {
  brandA: 'dash-a',
  brandB: 'dash-b',
  bocce: 'evt-dash-bocce',
  workshop: 'evt-dash-workshop',
  demo: 'evt-dash-demo',
  other: 'evt-dash-b-big',
} as const;

interface SeedEvent {
  id: string;
  brand: string;
  status: string;
  published?: number;
  dataClass?: string;
  typeId?: string | null;
  startDate?: string | null;
  cell?: string | null;
  seriesId?: string | null;
}

async function insertEvent(db: D1Database, e: SeedEvent): Promise<void> {
  await db
    .prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, is_published, data_class,
                           event_type_id, start_date, h3_res7, series_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      e.id,
      e.brand,
      `Event ${e.id}`,
      `slug-${e.id}`,
      e.status,
      e.published ?? 1,
      e.dataClass ?? 'production',
      e.typeId ?? null,
      e.startDate ?? null,
      e.cell ?? null,
      e.seriesId ?? null
    )
    .run();
}

async function insertPoster(db: D1Database, id: string, eventId: string, cell: string) {
  await db
    .prepare(
      `INSERT INTO poster_deployments (id, event_id, qr_token, is_active, h3_res7)
       VALUES (?, ?, ?, 1, ?)`
    )
    .bind(id, eventId, `tok-${id}`, cell)
    .run();
}

async function insertScans(db: D1Database, eventId: string, posterId: string, n: number) {
  for (let i = 0; i < n; i++) {
    await db
      .prepare(
        `INSERT INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket)
         VALUES (?, ?, ?, '2026-09-26T18:00')`
      )
      .bind(`scan-${posterId}-${i}`, eventId, posterId)
      .run();
  }
}

async function insertRegistrations(forms: D1Database, eventId: string, n: number) {
  for (let i = 0; i < n; i++) {
    await forms
      .prepare(
        `INSERT INTO form_registrations (id, event_id, registration_bucket, status)
         VALUES (?, ?, '2026-09', 'confirmed')`
      )
      .bind(`reg-${eventId}-${i}`, eventId)
      .run();
  }
}

async function insertEmailSignups(forms: D1Database, eventId: string, n: number) {
  for (let i = 0; i < n; i++) {
    await forms
      .prepare(
        `INSERT INTO email_signups (id, event_id, email_hash, email_encrypted, signup_bucket,
                                    retention_expires_at)
         VALUES (?, ?, ?, 'enc', '2026-09', '2099-01-01')`
      )
      .bind(`mail-${eventId}-${i}`, eventId, `hash-${eventId}-${i}`)
      .run();
  }
}

export async function seedDashboardFixture(db: D1Database, forms: D1Database): Promise<void> {
  // 2026-09-26 is a Saturday; 2026-09-29 is a Tuesday.
  await insertEvent(db, {
    id: DASH.bocce,
    brand: DASH.brandA,
    status: 'active',
    typeId: 'etr-rec-bocce',
    startDate: '2026-09-26',
    cell: CELL_EVENT,
  });
  await insertEvent(db, {
    id: `${DASH.bocce}-2`,
    brand: DASH.brandA,
    status: 'ready',
    typeId: 'etr-rec-bocce',
    startDate: '2026-10-03',
    cell: CELL_EVENT,
  });
  await insertEvent(db, {
    id: DASH.workshop,
    brand: DASH.brandA,
    status: 'draft',
    published: 0,
    startDate: '2026-09-29',
    cell: CELL_SRC_1,
  });
  await insertEvent(db, {
    id: DASH.demo,
    brand: DASH.brandA,
    status: 'active',
    dataClass: 'demo',
    cell: CELL_EVENT,
  });
  await insertEvent(db, {
    id: DASH.other,
    brand: DASH.brandB,
    status: 'active',
    typeId: 'etr-rec-bocce',
    startDate: '2026-09-26',
    cell: CELL_EVENT,
  });

  // event_series.venue_id points at an event, so the series follows the event.
  await db
    .prepare(
      `INSERT OR IGNORE INTO event_series (id, venue_id, series_name, cadence)
       VALUES ('ser-dash-bocce', ?, 'Saturday Bocce', 'weekly')`
    )
    .bind(DASH.bocce)
    .run();

  await db
    .prepare(`UPDATE events SET series_id = 'ser-dash-bocce' WHERE id IN (?, ?)`)
    .bind(DASH.bocce, `${DASH.bocce}-2`)
    .run();

  // Source layer. Bocce: 7 scans from cell 1, 5 from cell 2. Workshop: 3.
  await insertPoster(db, 'pd-dash-1', DASH.bocce, CELL_SRC_1);
  await insertPoster(db, 'pd-dash-2', DASH.bocce, CELL_SRC_2);
  await insertPoster(db, 'pd-dash-3', DASH.bocce, CELL_SRC_2);
  await insertPoster(db, 'pd-dash-ws', DASH.workshop, CELL_SRC_1);
  await insertPoster(db, 'pd-dash-demo', DASH.demo, CELL_SRC_1);
  // 3 demo scans in cell 2: a sub-K bucket that data_class=all must not add to
  // the 5 production scans there, or all minus production would reveal it.
  await insertPoster(db, 'pd-dash-demo-2', DASH.demo, CELL_SRC_2);
  await insertPoster(db, 'pd-dash-b', DASH.other, CELL_SRC_1);
  await insertScans(db, DASH.bocce, 'pd-dash-1', 7);
  await insertScans(db, DASH.bocce, 'pd-dash-2', 3);
  await insertScans(db, DASH.bocce, 'pd-dash-3', 2);
  await insertScans(db, DASH.workshop, 'pd-dash-ws', 3);
  await insertScans(db, DASH.demo, 'pd-dash-demo', 40);
  await insertScans(db, DASH.demo, 'pd-dash-demo-2', 3);
  await insertScans(db, DASH.other, 'pd-dash-b', 50);

  await db
    .prepare(
      `INSERT INTO shortlinks (code, event_id, clicks) VALUES
         ('dashB1', ?, 9), ('dashW1', ?, 2), ('dashX1', ?, 99)`
    )
    .bind(DASH.bocce, DASH.workshop, DASH.other)
    .run();
  // A second code on the bocce poster with 3 taps: under K on its own, so the
  // card withholds it and no total may include it (12 would give it back).
  // The demo event's link has 40: only data_class=all may count it.
  await db
    .prepare(
      `INSERT INTO shortlinks (code, event_id, clicks, kind) VALUES
         ('dashB2', ?, 3, 'donation'), ('dashD1', ?, 40, 'public')`
    )
    .bind(DASH.bocce, DASH.demo)
    .run();

  await seedSplitSponsor(db, { id: 'sb-dash-1', eventId: DASH.bocce, brandId: DASH.brandA });
  await seedSplitSponsor(db, { id: 'sb-dash-2', eventId: DASH.bocce, brandId: DASH.brandA });
  await seedSplitSponsor(db, {
    id: 'sb-dash-3',
    eventId: DASH.bocce,
    brandId: DASH.brandA,
    source: 'sponsor_request',
    isActive: 0,
    organizerAccepted: null,
  });
  // seedSplitSponsor defaults a null organizerAccepted to 1; a request the
  // organizer has not answered is NULL, as POST /api/v2/sponsor/requests writes it.
  await db
    .prepare(`UPDATE sponsor_placement SET organizer_accepted = NULL WHERE sponsor_business_id = ?`)
    .bind('sb-dash-3')
    .run();
  // Not on show, each for one reason: the sponsor declined (the placement stays
  // active, as the respond route leaves it), and an active placement on a draft.
  await seedSplitSponsor(db, {
    id: 'sb-dash-declined',
    eventId: DASH.bocce,
    brandId: DASH.brandA,
    sponsorAccepted: 0,
  });
  await seedSplitSponsor(db, { id: 'sb-dash-draft', eventId: DASH.workshop, brandId: DASH.brandA });
  await seedSplitSponsor(db, { id: 'sb-dash-b', eventId: DASH.other, brandId: DASH.brandB });
  // Malformed cross-brand rows (the schema permits them): a dash-b sponsor
  // placed on dash-a's bocce, once fully accepted and once as an unanswered
  // request. No dash-a sponsor count may include either.
  await seedSplitSponsor(db, { id: 'sb-dash-x-show', eventId: DASH.bocce, brandId: DASH.brandB });
  await seedSplitSponsor(db, {
    id: 'sb-dash-x-ask',
    eventId: DASH.bocce,
    brandId: DASH.brandB,
    source: 'sponsor_request',
    isActive: 0,
  });
  await db
    .prepare(`UPDATE sponsor_placement SET organizer_accepted = NULL WHERE sponsor_business_id = ?`)
    .bind('sb-dash-x-ask')
    .run();

  await db
    .prepare(
      `INSERT INTO report_access_log (id, date, event_id, role, outcome, access_count) VALUES
         ('ral-dash-1', ?, ?, 'bar_owner', 'granted', 4),
         ('ral-dash-2', ?, ?, 'bar_owner', 'denied', 9)`
    )
    .bind(
      new Date().toISOString().slice(0, 10),
      DASH.bocce,
      new Date().toISOString().slice(0, 10),
      DASH.bocce
    )
    .run();

  await insertRegistrations(forms, DASH.bocce, 7);
  await insertRegistrations(forms, DASH.workshop, 3);
  await insertRegistrations(forms, DASH.other, 20);
  await forms
    .prepare(
      `INSERT INTO checkin_counts (id, event_id, total_count) VALUES
         ('chk-dash-1', ?, 6), ('chk-dash-2', ?, 30)`
    )
    .bind(DASH.bocce, DASH.other)
    .run();
  await insertEmailSignups(forms, DASH.bocce, 2);
}
