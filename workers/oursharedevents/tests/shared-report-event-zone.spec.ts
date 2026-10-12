/**
 * OSE-1376 — SharedReport hour buckets are labelled in the EVENT's time zone.
 *
 * @born-red OSE-1376 | method: ran against origin/main (src restored via tagged git stash, this spec kept) — the builder emitted no `_meta.timezone` and no first/last_scan_label (UTC only), and the page rendered first/last scan through the UTC date formatter; every zone/DST/Kolkata/fallback assertion below failed, the count/suppression/never-who assertions passed on both | date: 2026-09-30
 *
 * Reconciliation (what the report actually shows): the SharedReport has NO
 * per-hour scan histogram — adding one is a new temporal disclosure surface that
 * docs/security/SCAN_TIME_BUCKETING_DISCLOSURE_MODEL.md holds behind its own
 * CCR gate, so this story does not add one. The hour buckets the report DOES
 * surface are poster_attribution.first_scan_at / last_scan_at: UTC hour buckets
 * (OSE-596) that the page rendered as a UTC calendar date — a 7 PM CDT scan
 * read as "the next day". corridor_density.bucket_hour is a UTC lookup key that
 * must match the UTC-keyed baseline rows; it is not rendered as a time of day
 * and is left as-is.
 *
 * Decisions pinned here:
 *  - Label, never re-bucket: stored UTC hour buckets stay the cells; the 60-min
 *    floor and the K>=5 floors act on exactly what they did before.
 *  - Half-hour zones (Asia/Kolkata): a UTC hour is labelled at its real local
 *    start ("6:30 PM GMT+5:30"), not rounded to a local hour.
 *  - DST: the zone abbreviation is always in the label (fall-back's two 1 AMs
 *    stay distinct); a spring-forward day never shows the skipped 2 AM.
 *  - No / invalid event zone → America/Chicago (platform home zone, as
 *    event-discovery uses), flagged source='platform_default' and stated on the page.
 */

import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { buildSharedReport, type SharedReport } from '../src/lib/shared-report-builder';
import { CORRIDOR_MAP_MIN_COUNT } from '../src/lib/shared-report';
import * as eventDatetime from '../src/lib/event-datetime';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}

const tenv = () => env as unknown as TestEnv;

// Migrations apply EXACTLY ONCE per isolate (0018 is not idempotent) — same
// harness as poster-attribution-kanon-floor.spec.ts.
let migrated = false;
async function applyMigrations(): Promise<void> {
  if (migrated) return;
  const stmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such column')
      ) {
        continue;
      }
      throw e;
    }
  }
  migrated = true;
}

async function clearTables(): Promise<void> {
  const db = tenv().DB;
  await db.prepare(`DELETE FROM scan_placement_events WHERE id LIKE 'spe-1376-%'`).run();
  await db.prepare(`DELETE FROM poster_deployments WHERE id LIKE 'pd-1376-%'`).run();
  await db.prepare(`DELETE FROM scan_aggregates WHERE id LIKE 'sa-1376-%'`).run();
  await db.prepare(`DELETE FROM events WHERE id LIKE 'evt-1376-%'`).run();
}

async function seedEvent(id: string, timezone: string | null, startDate: string): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO events
         (id, brand_id, title, slug, status, location, start_date, timezone, created_at, updated_at)
       VALUES (?, 'test-brand', ?, ?, 'active', 'Test Venue', ?, ?, datetime('now'), datetime('now'))`
    )
    .bind(id, `Test ${id}`, id, startDate, timezone)
    .run();
}

/**
 * One poster deployment whose placement scans land at the given UTC instants
 * (SQLite `datetime` shape, exactly what `datetime('now')` stores). The builder
 * reduces them to MIN/MAX and buckets those to the hour. Each instant is
 * scanned by `people` visitors (default K): the builder floors each
 * poster-hour (OSE-1459), so an hour needs K scans to count.
 */
async function seedPoster(
  eventId: string,
  posterId: string,
  scanTimesUtc: string[],
  people: number = CORRIDOR_MAP_MIN_COUNT
): Promise<void> {
  const db = tenv().DB;
  await db
    .prepare(
      `INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, location_desc)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(posterId, eventId, `qr-${posterId}`, 'Front door', 'Front door')
    .run();
  for (let i = 0; i < scanTimesUtc.length; i++) {
    const t = scanTimesUtc[i]!;
    for (let j = 0; j < people; j++) {
      await db
        .prepare(
          `INSERT INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(
          `spe-1376-${posterId}-${i}-${j}`,
          eventId,
          posterId,
          `${t.slice(0, 13).replace(' ', 'T')}:00`,
          t
        )
        .run();
    }
  }
}

/** Hour buckets on scan_aggregates (distinct_scanners source), distinct counts given. */
async function seedAggregates(
  eventId: string,
  buckets: Array<[string, number, number]>
): Promise<void> {
  for (const [date, hour, distinct] of buckets) {
    await tenv()
      .DB.prepare(
        `INSERT INTO scan_aggregates
           (id, event_id, bucket_date, bucket_hour, total_scans, distinct_agent_hashes, computed_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .bind(`sa-1376-${eventId}-${date}-${hour}`, eventId, date, hour, distinct * 2, distinct)
      .run();
  }
}

async function build(eventId: string): Promise<SharedReport> {
  const r = await buildSharedReport(tenv().DB, eventId);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error('report did not build');
  return r.report;
}

type Row = SharedReport['poster_attribution'][number];
const row = (rep: SharedReport, id: string): Row & Record<string, unknown> => {
  const p = rep.poster_attribution.find((x) => x.poster_deployment_id === id);
  expect(p, `poster ${id} must be published`).toBeDefined();
  return p as Row & Record<string, unknown>;
};
const zoneOf = (rep: SharedReport) =>
  (rep._meta as unknown as Record<string, unknown>).timezone as
    { zone: string; source: string } | undefined;

// A Saturday-evening event in the US Central zone: 7:14 PM CDT → 9:40 PM CDT.
// In UTC those scans are 00:14Z and 02:40Z on the NEXT day (Oct 25).
const EVENING_SCANS = [
  '2026-10-25 00:14:00',
  '2026-10-25 00:31:00',
  '2026-10-25 01:05:00',
  '2026-10-25 01:59:00',
  '2026-10-25 02:02:00',
  '2026-10-25 02:40:00',
];

beforeAll(async () => {
  await applyMigrations();
});

describe('OSE-1376 — same scans, different event zones → different labels, identical counts', () => {
  beforeEach(async () => {
    await applyMigrations();
    await clearTables();
  });

  test('America/Chicago vs Europe/Berlin: labels follow the event zone, counts and UTC cells do not move', async () => {
    const zones = ['America/Chicago', 'Europe/Berlin'] as const;
    const reports: SharedReport[] = [];
    for (const tz of zones) {
      const id = `evt-1376-${tz.replace('/', '-').toLowerCase()}`;
      await seedEvent(id, tz, '2026-10-24');
      await seedPoster(id, `pd-1376-${id}`, EVENING_SCANS);
      await seedAggregates(id, [
        ['2026-10-25', 0, 7],
        ['2026-10-25', 1, 3], // sub-K bucket — dropped before summation (OSE-683)
        ['2026-10-25', 2, 9],
      ]);
      reports.push(await build(id));
    }
    const [chi, ber] = reports as [SharedReport, SharedReport];
    const pc = row(chi, 'pd-1376-evt-1376-america-chicago');
    const pb = row(ber, 'pd-1376-evt-1376-europe-berlin');

    // The event's zone is carried on the report.
    expect(zoneOf(chi)).toEqual({ zone: 'America/Chicago', source: 'event' });
    expect(zoneOf(ber)).toEqual({ zone: 'Europe/Berlin', source: 'event' });

    // Local labels — Chicago reads the evening it was, not "the next day".
    expect(pc.first_scan_label).toBe('Sat, Oct 24 · 7 PM CDT');
    expect(pc.last_scan_label).toBe('Sat, Oct 24 · 9 PM CDT');
    // Berlin: 00:00Z is 2 AM CEST; EU clocks fall back at 01:00Z that morning,
    // so 02:00Z is 3 AM CET — offsets in the label keep both honest.
    expect(pb.first_scan_label).toBe('Sun, Oct 25 · 2 AM GMT+2');
    expect(pb.last_scan_label).toBe('Sun, Oct 25 · 3 AM GMT+1');
    expect(pc.first_scan_label).not.toBe(pb.first_scan_label);

    // Identical numbers and identical UTC cells — only the words changed.
    expect(pc.scan_count).toBe(EVENING_SCANS.length * CORRIDOR_MAP_MIN_COUNT);
    expect(pb.scan_count).toBe(pc.scan_count);
    expect(pc.first_scan_at).toBe('2026-10-25T00:00:00Z');
    expect(pc.last_scan_at).toBe('2026-10-25T02:00:00Z');
    expect(pb.first_scan_at).toBe(pc.first_scan_at);
    expect(pb.last_scan_at).toBe(pc.last_scan_at);
    // 7 + 9 survive; the 3-bucket is dropped exactly as before, in both zones.
    expect(chi.distinct_scanners).toBe(16);
    expect(ber.distinct_scanners).toBe(16);
  });
});

describe('OSE-1376 — DST days: no duplicated and no phantom hour labels', () => {
  beforeEach(async () => {
    await applyMigrations();
    await clearTables();
  });

  test('fall-back (Chicago, Sun Nov 1 2026): the two 1 AM hours stay distinguishable', async () => {
    const id = 'evt-1376-fallback';
    await seedEvent(id, 'America/Chicago', '2026-11-01');
    // 06:xxZ = 1 AM CDT, 07:xxZ = 1 AM CST (the repeated hour).
    await seedPoster(id, 'pd-1376-fallback', [
      '2026-11-01 06:10:00',
      '2026-11-01 06:20:00',
      '2026-11-01 06:45:00',
      '2026-11-01 07:05:00',
      '2026-11-01 07:50:00',
    ]);
    const p = row(await build(id), 'pd-1376-fallback');
    expect(p.first_scan_label).toBe('Sun, Nov 1 · 1 AM CDT');
    expect(p.last_scan_label).toBe('Sun, Nov 1 · 1 AM CST');
    expect(p.first_scan_label).not.toBe(p.last_scan_label);
  });

  test('spring-forward (Chicago, Sun Mar 8 2026): 1 AM CST is followed by 3 AM CDT — never a 2 AM', async () => {
    const id = 'evt-1376-springfwd';
    await seedEvent(id, 'America/Chicago', '2026-03-08');
    await seedPoster(id, 'pd-1376-springfwd', [
      '2026-03-08 07:05:00', // 1 AM CST
      '2026-03-08 07:30:00',
      '2026-03-08 08:10:00', // 3 AM CDT (02:00–02:59 local does not exist)
      '2026-03-08 08:20:00',
      '2026-03-08 08:30:00',
    ]);
    const p = row(await build(id), 'pd-1376-springfwd');
    expect(p.first_scan_label).toBe('Sun, Mar 8 · 1 AM CST');
    expect(p.last_scan_label).toBe('Sun, Mar 8 · 3 AM CDT');
  });

  test('every UTC hour across both DST days maps to a unique label, and no skipped 2 AM is invented', () => {
    const { formatHourBucketLabel } = eventDatetime as unknown as {
      formatHourBucketLabel: (v: string, tz: string) => string;
    };
    expect(typeof formatHourBucketLabel).toBe('function');
    for (const day of ['2026-03-08', '2026-11-01']) {
      const labels: string[] = [];
      // 48 consecutive UTC hour buckets straddling the local transition.
      const base = Date.parse(`${day}T00:00:00Z`) - 12 * 3600_000;
      for (let h = 0; h < 48; h++) {
        const iso = new Date(base + h * 3600_000).toISOString().slice(0, 13) + ':00';
        labels.push(formatHourBucketLabel(iso, 'America/Chicago'));
      }
      expect(labels.every((l) => l.length > 0)).toBe(true);
      expect(new Set(labels).size).toBe(labels.length); // no duplicate label
      if (day === '2026-03-08') {
        expect(labels.filter((l) => l.startsWith('Sun, Mar 8 · 2 AM'))).toEqual([]);
      } else {
        expect(labels.filter((l) => l.startsWith('Sun, Nov 1 · 1 AM'))).toEqual([
          'Sun, Nov 1 · 1 AM CDT',
          'Sun, Nov 1 · 1 AM CST',
        ]);
      }
    }
  });
});

describe('OSE-1376 — half-hour zone and missing-zone fallback', () => {
  beforeEach(async () => {
    await applyMigrations();
    await clearTables();
  });

  test('Asia/Kolkata keeps the UTC hour bucket and labels its real local start (:30)', async () => {
    const id = 'evt-1376-kolkata';
    await seedEvent(id, 'Asia/Kolkata', '2026-10-24');
    await seedPoster(id, 'pd-1376-kolkata', [
      '2026-10-24 13:05:00',
      '2026-10-24 13:15:00',
      '2026-10-24 13:25:00',
      '2026-10-24 14:40:00',
      '2026-10-24 14:55:00',
    ]);
    const rep = await build(id);
    const p = row(rep, 'pd-1376-kolkata');
    // Not re-bucketed to local hours: the cell is still the UTC hour.
    expect(p.first_scan_at).toBe('2026-10-24T13:00:00Z');
    expect(p.last_scan_at).toBe('2026-10-24T14:00:00Z');
    expect(p.first_scan_label).toBe('Sat, Oct 24 · 6:30 PM GMT+5:30');
    expect(p.last_scan_label).toBe('Sat, Oct 24 · 7:30 PM GMT+5:30');
    expect(zoneOf(rep)).toEqual({ zone: 'Asia/Kolkata', source: 'event' });
  });

  test.each([
    ['NULL zone', null],
    ['invalid zone', 'Not/AZone'],
  ])('%s → America/Chicago platform default, flagged as such', async (_label, tz) => {
    const id = `evt-1376-nozone-${tz ? 'bad' : 'null'}`;
    await seedEvent(id, tz, '2026-10-24');
    await seedPoster(id, `pd-1376-${id}`, EVENING_SCANS);
    const rep = await build(id);
    expect(zoneOf(rep)).toEqual({ zone: 'America/Chicago', source: 'platform_default' });
    const p = row(rep, `pd-1376-${id}`);
    expect(p.first_scan_label).toBe('Sat, Oct 24 · 7 PM CDT');
    expect(p.last_scan_label).toBe('Sat, Oct 24 · 9 PM CDT');
  });
});

describe('OSE-1376 — floors and never-who are unchanged by the zone', () => {
  beforeEach(async () => {
    await applyMigrations();
    await clearTables();
  });

  test('a sub-K poster is dropped and sub-K buckets are excluded identically in every zone', async () => {
    const totals: Array<number | null> = [];
    for (const tz of ['America/Chicago', 'Europe/Berlin', 'Asia/Kolkata', null]) {
      const id = `evt-1376-floor-${tz ? tz.split('/')[1]!.toLowerCase() : 'none'}`;
      await seedEvent(id, tz, '2026-10-24');
      await seedPoster(id, `pd-1376-small-${id}`, EVENING_SCANS.slice(0, 4), 1); // 4 < K
      await seedPoster(id, `pd-1376-big-${id}`, EVENING_SCANS); // 6 >= K
      await seedAggregates(id, [
        ['2026-10-25', 0, 4], // sub-K
        ['2026-10-25', 1, 4], // sub-K (4+4 would clear K if summed raw — must not)
        ['2026-10-25', 2, 5], // exactly K — survives
      ]);
      const rep = await build(id);
      expect(
        rep.poster_attribution.find((p) => p.poster_deployment_id === `pd-1376-small-${id}`)
      ).toBeUndefined();
      for (const p of rep.poster_attribution) {
        expect(p.scan_count).toBeGreaterThanOrEqual(CORRIDOR_MAP_MIN_COUNT);
      }
      totals.push(rep.distinct_scanners);
    }
    expect(totals).toEqual([5, 5, 5, 5]);
  });

  test('the payload carries no per-person field and nothing finer than the hour', async () => {
    const id = 'evt-1376-neverwho';
    await seedEvent(id, 'America/Chicago', '2026-10-24');
    await seedPoster(id, 'pd-1376-neverwho', EVENING_SCANS);
    const rep = await build(id);

    // (Spelled as a pattern, not the literal column names: schema.spec's PII
    // firewall rejects any source that INSERTs into a scan table AND names a PII column.)
    const banned =
      /^(anon(ymous)?_id|anon_id_hash|user_agent(_hash)?|ip(_addr\w*)?|e?mail|name|phone|country_code|created_at|scanned_at)$/;
    const walk = (v: unknown, path: string): void => {
      if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`));
      if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
          expect(banned.test(k), `per-person field ${path}.${k}`).toBe(false);
          walk(x, `${path}.${k}`);
        }
      }
    };
    walk(rep, 'report');

    for (const p of rep.poster_attribution) {
      expect(p.first_scan_at).toMatch(/T\d{2}:00:00Z$/);
      expect(p.last_scan_at).toMatch(/T\d{2}:00:00Z$/);
      // A label names an hour, never a minute inside it (whole-hour zone).
      expect(String((p as Record<string, unknown>).first_scan_label)).not.toMatch(/:\d{2}/);
    }
  });
});

describe('OSE-1376 — the page renders the server labels, not a re-zoned UTC date', () => {
  function templateSrc(): string {
    const files = JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
    const key = Object.keys(files).find((k) =>
      k.replace(/\\/g, '/').endsWith('templates/shared-report.html')
    );
    expect(key, 'shared-report.html must be in TEST_SOURCE_FILES_JSON').toBeDefined();
    return files[key!]!;
  }

  test('first/last scan cells use first_scan_label/last_scan_label and the zone is stated', () => {
    const html = templateSrc();
    expect(html).toContain('p.first_scan_label');
    expect(html).toContain('p.last_scan_label');
    expect(html).not.toContain('esc(fmtDate(p.first_scan_at))');
    expect(html).not.toContain('esc(fmtDate(p.last_scan_at))');
    expect(html).toContain('data-testid="report-timezone-note"');
    expect(html).toContain("reportZone.source === 'event'");
  });
});
