/**
 * sponsor-signal-anonymity.spec.ts  [OSE-1164]
 *
 * L1 UNIT / INTEGRATION rung of the "sponsor signal is never-who" guarantee
 * (Worker router + D1 via miniflare). The L0 structural spec
 * (tests/e2e/0-architecture/sponsor-signal-never-who.invariant.spec.ts) locks
 * the SOURCE shape on both sides of the wire; this proves the RUNTIME behavior:
 *
 *   Even when a request arrives WITH the anonymous-scan cookie present
 *   (Cookie: ose_anon=anon_...), the persisted sponsor_impressions row contains
 *   NO identity — not the cookie value, not any anon/ip/user-agent column.
 *
 * This is the server half of "impossible by construction": the client omits
 * credentials so the cookie is never sent (public.html / display.html), and even
 * if a cookie does arrive, the handler structurally cannot link it. Belt + brace.
 *
 * Pyramid map: L0 source shape → THIS (L1 cookie-present → no linkage) →
 * L2 Newman contract → E2E (anonymous-id.invariant.spec.ts: real request sends
 * no Cookie; anchor rel has noreferrer).
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { mintBeaconToken } from '../src/lib/beacon-token';

const ADMIN_HEADERS = {
  Authorization: 'Bearer test-admin-key-e2e-2026',
  'Content-Type': 'application/json',
} as const;

// A distinctive anonymous-id value planted in the Cookie header. If ANY byte of
// this reaches the persisted row, the never-who guarantee is broken.
const PLANTED_ANON = 'anon_PLANTED_SECRET_9c3f7';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const stmts: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
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

async function seedEvent(id: string): Promise<void> {
  const tenv = env as unknown as TestEnv;
  await tenv.DB.prepare(
    `INSERT OR IGNORE INTO events (id, brand_id, title, slug, status, h3_res7)
     VALUES (?, 'nw-test', ?, ?, 'active', '872664544ffffff')`
  )
    .bind(id, `Never-Who Test ${id}`, `nw-test-${id}`)
    .run();
}

async function createSponsor(eventId: string, name: string): Promise<string> {
  const res = await SELF.fetch('https://t.test/api/v2/admin/sponsors', {
    method: 'POST',
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ name, event_id: eventId }),
  });
  expect(res.status, 'sponsor create must succeed to give the signal a valid FK').toBe(201);
  const body = (await res.json()) as { id: string };
  // Strict consent (ADR-019 / D3): an admin-created placement is PENDING
  // (sponsor_accepted = NULL) and does not render, so the impression/click gate
  // (sponsors.ts: `sponsor_accepted = 1`) 404s it. Mark the sponsor accepted —
  // the precondition for a RENDERABLE sponsor whose signal we then prove is
  // never-who. This does not touch the never-who assertions below.
  const tenv = env as unknown as TestEnv;
  await tenv.DB.prepare(
    'UPDATE sponsor_placement SET sponsor_accepted = 1 WHERE sponsor_business_id = ? AND event_id = ?'
  )
    .bind(body.id, eventId)
    .run();
  return body.id;
}

/** All persisted sponsor_impressions rows for an event, as plain objects. */
async function signalRows(eventId: string): Promise<Array<Record<string, unknown>>> {
  const tenv = env as unknown as TestEnv;
  const r = await tenv.DB.prepare('SELECT * FROM sponsor_impressions WHERE event_id = ?')
    .bind(eventId)
    .all<Record<string, unknown>>();
  return r.results ?? [];
}

// Column names that would represent a person. None may exist on the signal row.
const FORBIDDEN_COLUMNS = [
  'anonymous_id',
  'anon_id',
  'anon_id_hash',
  'ose_anon',
  'user_agent',
  'user_agent_hash',
  'ip',
  'ip_address',
  'cookie',
];

const EVENT_ID = 'evt-nw-signal';
let sponsorId = '';

beforeAll(async () => {
  await applyMigrations();
  const tenv = env as unknown as TestEnv;
  await tenv.DB.prepare('DELETE FROM sponsor_impressions WHERE event_id = ?').bind(EVENT_ID).run();
  await tenv.DB.prepare("DELETE FROM events WHERE brand_id = 'nw-test'").run();
  await seedEvent(EVENT_ID);
  sponsorId = await createSponsor(EVENT_ID, 'NW Signal Sponsor');
});

describe('OSE-1164 — sponsor signal is never-who even with a cookie present', () => {
  for (const kind of ['impression', 'click'] as const) {
    test(`${kind}: cookie present on the request → 201 and NO identity persisted`, async () => {
      const beaconToken = await mintBeaconToken(env as unknown as TestEnv, EVENT_ID, sponsorId);
      const res = await SELF.fetch(
        `https://t.test/api/v2/events/${EVENT_ID}/sponsors/${sponsorId}/${kind}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // OSE-1310: a real browser always sends a User-Agent, and the IVT
            // filter refuses clients that send none. This test is about what the
            // SERVER persists for an accepted signal, so it must present as the
            // real browser it stands for or it would exercise the bot path.
            'User-Agent':
              'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
            'CF-Connecting-IP': `198.51.100.${kind === 'impression' ? 11 : 12}`,
            // The anon cookie a real browser would carry — deliberately sent here
            // to prove the SERVER cannot link it (the client separately omits it).
            Cookie: `ose_anon=${PLANTED_ANON}`,
          },
          body: JSON.stringify({
            surface: 'public',
            placement: 'mobileBanner',
            beacon_token: beaconToken,
          }),
        }
      );
      expect(res.status, `${kind} must be accepted`).toBe(201);

      const rows = await signalRows(EVENT_ID);
      const mine = rows.filter((r) => r.event_type === kind);
      expect(mine.length, `exactly one ${kind} row expected`).toBe(1);
      const row = mine[0];

      // 1. No forbidden identity column exists on the row.
      const cols = Object.keys(row).map((c) => c.toLowerCase());
      for (const bad of FORBIDDEN_COLUMNS) {
        expect(cols.includes(bad), `sponsor_impressions row must not have a '${bad}' column`).toBe(
          false
        );
      }
      // 2. The planted cookie value appears in NO column value.
      expect(
        JSON.stringify(row).includes(PLANTED_ANON),
        `the anon cookie value leaked into the persisted ${kind} row — never-who broken`
      ).toBe(false);

      // 3. Only the sanctioned aggregate fields carry data.
      expect(row.sponsor_id).toBe(sponsorId);
      expect(row.event_id).toBe(EVENT_ID);
      expect(row.event_type).toBe(kind);
    });
  }
});
