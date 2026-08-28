/**
 * OSE-1049 — Layer B (Blindness) of the named × anonymous forbidden-join guarantee.
 *
 * THE GUARANTEE (this layer): even if a named OW session artifact DOES arrive at
 * the OSE scan endpoint — an `ow_session` cookie, N named-profile cookies (the
 * curator / bocce-player / artist personas a person holds at once), AND an
 * `Authorization: Bearer` header — `handleQrScan` attaches NONE of it. The
 * durable row it writes (`scan_node_returns`) carries only the `ose_anon`
 * anonymous id (+ ua_hash / country / bucket); the WHERE row
 * (`scan_placement_events`) carries no identity at all. The code's nature governs,
 * not the session's identity.
 *
 * This is a LOCK — verified true on `origin/main` (qr-scan.ts reads only
 * getOrCreateAnonId; no Authorization/session/profile read; OSE-798 split write).
 * It goes RED the moment any path threads a session/profile value into either
 * scan table.
 *
 * INTEGRITY-asserted (Dr. Cyber Security / Sr SDET): we parse the emitted rows
 * and prove no OW value survives anywhere — not a `toContain` on a string blob.
 *
 * Sibling layers: OSE-1053 (Boundary — the OW cookie can't even reach here) ·
 * OSE-923 (Unlinkability — the stored anon row is not re-joinable). Ties
 * OSE-1048 / OCR-43 (hybrid choice contract); OW-side mirror OW-117 / OW-118.
 *
 * Format: `OSE-1049 | INTEGRATION | <description> | <assertion>`.
 */

import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { handleQrScan, type QrScanEnv } from '../src/handlers/qr-scan';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

const TEST_EVENT_ID = 'test-evt-fjoin-blind';
const TEST_DEPLOYMENT_ID = 'test-pd-fjoin-blind-001';
const VALID_QR_TOKEN = 'qrt_fjoin_blind_token_1049';

// The named OW session a person may carry — session + three named personas.
const OW_SESSION_VALUES = [
  'ow-named-session-xyz789',
  'dj-mallang',
  'team-fist-of-five-7',
  'artist-jane-doe',
] as const;
const OW_BEARER = 'Bearer ow-named-jwt-token';

// A known ose_anon so we can prove the written id is EXACTLY the anon cookie,
// never a session-derived value.
const KNOWN_ANON = 'anon_known-boundary-abcdef';

function makeInMemoryKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [], list_complete: true, cacheStatus: null };
    },
    async getWithMetadata() {
      return { value: null, metadata: null, cacheStatus: null };
    },
  } as unknown as KVNamespace;
}

async function applyMigrations(): Promise<void> {
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
}

async function seedEventAndDeployment(db: D1Database): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO events
         (id, brand_id, title, slug, status, start_date, created_at, updated_at)
       VALUES (?, 'brand-fjoin', 'Forbidden-Join Blindness Event', ?, 'active', datetime('now'), datetime('now'), datetime('now'))`
    )
    .bind(TEST_EVENT_ID, TEST_EVENT_ID)
    .run();
  await db
    .prepare(
      `INSERT OR REPLACE INTO poster_deployments
         (id, event_id, qr_token, placement_label, is_active, created_at)
       VALUES (?, ?, ?, 'FJoin Poster', 1, datetime('now'))`
    )
    .bind(TEST_DEPLOYMENT_ID, TEST_EVENT_ID, VALID_QR_TOKEN)
    .run();
}

function makeEnv(kv?: KVNamespace): QrScanEnv {
  return { DB: tenv().DB, RATE_LIMIT_KV: kv };
}

/**
 * A scan request that an attacker/curious OW user would send: it carries a full
 * named OW session — session cookie, three named-profile cookies, AND a Bearer
 * token — alongside the legitimate `ose_anon` cookie.
 */
function adversarialNamedScanRequest(): Request {
  const cookie = [
    `ose_anon=${KNOWN_ANON}`,
    `ow_session=${OW_SESSION_VALUES[0]}`,
    `ow_profile_curator=${OW_SESSION_VALUES[1]}`,
    `ow_profile_player=${OW_SESSION_VALUES[2]}`,
    `ow_profile_artist=${OW_SESSION_VALUES[3]}`,
  ].join('; ');
  return new Request(`https://test.local/q/${VALID_QR_TOKEN}`, {
    headers: {
      Cookie: cookie,
      Authorization: OW_BEARER,
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15',
      'CF-IPCountry': 'US',
    },
  });
}

beforeAll(async () => {
  await applyMigrations();
  await seedEventAndDeployment(tenv().DB);
});

beforeEach(async () => {
  await tenv()
    .DB.prepare(`DELETE FROM scan_placement_events WHERE event_id = ?`)
    .bind(TEST_EVENT_ID)
    .run();
  await tenv()
    .DB.prepare(`DELETE FROM scan_node_returns WHERE event_id = ?`)
    .bind(TEST_EVENT_ID)
    .run();
});

describe('OSE-1049 Layer B — Blindness: a named OW session that reaches the scan endpoint is ignored', () => {
  test('OSE-1049 | INTEGRATION | scan with OW session + 3 profile cookies + Bearer | scan_node_returns holds ONLY the ose_anon id, no session-derived value', async () => {
    const res = await handleQrScan(
      adversarialNamedScanRequest(),
      makeEnv(makeInMemoryKV()),
      VALID_QR_TOKEN
    );
    expect(res.status).toBe(302); // attendee is never stranded

    const row = await tenv()
      .DB.prepare(`SELECT * FROM scan_node_returns WHERE event_id = ? LIMIT 1`)
      .bind(TEST_EVENT_ID)
      .first<Record<string, unknown>>();
    expect(row).not.toBeNull();

    // The WHO row's identity column is EXACTLY the ose_anon cookie value —
    // proving the id is the anonymous cookie, never derived from the session.
    expect(row!.anonymous_id).toBe(KNOWN_ANON);

    // Integrity: the row's SHAPE carries no session column beyond the known
    // anonymous schema (id / event_id / anonymous_id / user_agent_hash /
    // country_code / scan_bucket / created_at).
    const allowedColumns = new Set([
      'id',
      'event_id',
      'anonymous_id',
      'user_agent_hash',
      'country_code',
      'scan_bucket',
      'created_at',
    ]);
    for (const col of Object.keys(row!)) {
      expect(allowedColumns.has(col)).toBe(true);
    }

    // Integrity: no OW session/profile value, and no Bearer token, survives in
    // ANY column of the durable row.
    const serialized = JSON.stringify(row);
    for (const owValue of OW_SESSION_VALUES) {
      expect(serialized).not.toContain(owValue);
    }
    expect(serialized.toLowerCase()).not.toContain('bearer');
    expect(serialized).not.toContain('ow-named-jwt-token');
  });

  test('OSE-1049 | INTEGRATION | the WHERE row (scan_placement_events) carries no identity at all', async () => {
    await handleQrScan(adversarialNamedScanRequest(), makeEnv(makeInMemoryKV()), VALID_QR_TOKEN);

    const row = await tenv()
      .DB.prepare(`SELECT * FROM scan_placement_events WHERE event_id = ? LIMIT 1`)
      .bind(TEST_EVENT_ID)
      .first<Record<string, unknown>>();
    expect(row).not.toBeNull();

    // The placement (WHERE) side is pure location/time — no anon id, no session.
    const allowedColumns = new Set([
      'id',
      'event_id',
      'poster_deployment_id',
      'scan_bucket',
      'created_at',
    ]);
    for (const col of Object.keys(row!)) {
      expect(allowedColumns.has(col)).toBe(true);
    }
    const serialized = JSON.stringify(row);
    for (const owValue of [...OW_SESSION_VALUES, KNOWN_ANON]) {
      expect(serialized).not.toContain(owValue);
    }
  });

  test('OSE-1049 | INTEGRATION | anonymous scan writes exactly one WHO row keyed on the anon id, regardless of how many named profiles are present', async () => {
    await handleQrScan(adversarialNamedScanRequest(), makeEnv(makeInMemoryKV()), VALID_QR_TOKEN);

    const rows = await tenv()
      .DB.prepare(`SELECT anonymous_id FROM scan_node_returns WHERE event_id = ?`)
      .bind(TEST_EVENT_ID)
      .all<{ anonymous_id: string }>();

    expect(rows.results.length).toBe(1);
    // The single row is credited to the anonymous id — the named side (3 profiles
    // + session + Bearer) contributed nothing joinable.
    expect(rows.results[0].anonymous_id).toBe(KNOWN_ANON);
  });
});
