/**
 * Beacon token — the authenticated half of OSE-1310.
 *
 * Covers:
 *   - lib: mint/verify round trip, expiry, tamper, wrong `kind`, wrong
 *     (event, sponsor) scope, missing secret → fail closed (beacon-token.ts)
 *   - handler wiring: a bundle mints a token per sponsor; impression/click
 *     writes require it and are refused (honest 202, not counted) without a
 *     valid one, even when the (event, sponsor) pair is a real placement
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import {
  mintBeaconToken,
  verifyBeaconToken,
  BEACON_TOKEN_TTL_SECONDS,
} from '../src/lib/beacon-token';
import { mintSponsorHomeToken } from '../src/lib/sponsor-home-auth';
import { seedSplitSponsor } from './helpers/seed-sponsor';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  SHARED_REPORT_SIGNING_SECRET: string;
}
const tenv = env as unknown as TestEnv;

beforeAll(async () => {
  const statements: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of statements) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
  try {
    await tenv.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, start_date, end_date)
       VALUES ('bt-evt', 'bt-brand', 'Beacon Token Test Event', 'beacon-token-test-event', 'active', '2026-01-01', '2026-12-31')`
    ).run();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes('UNIQUE constraint failed')) throw e;
  }
  try {
    await seedSplitSponsor(tenv.DB, {
      id: 'bt-spon',
      eventId: 'bt-evt',
      brandId: 'bt-brand',
      name: 'Beacon Token Sponsor',
    });
  } catch {
    /* already exists */
  }
});

describe('beacon token (lib)', () => {
  test('round trip carries event + sponsor and expires in 10 minutes', async () => {
    const token = await mintBeaconToken(tenv, 'evt-1', 'spon-1');
    expect(token).not.toBeNull();
    const claim = await verifyBeaconToken(tenv, token, 'evt-1', 'spon-1');
    expect(claim?.event_id).toBe('evt-1');
    expect(claim?.sponsor_id).toBe('spon-1');
    expect(claim!.exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(
      BEACON_TOKEN_TTL_SECONDS - 5
    );
  });

  test('an expired token is refused', async () => {
    const token = await mintBeaconToken(tenv, 'evt-1', 'spon-1', -1);
    expect(await verifyBeaconToken(tenv, token, 'evt-1', 'spon-1')).toBeNull();
  });

  test('a token minted for a different sponsor cannot be replayed here', async () => {
    const token = await mintBeaconToken(tenv, 'evt-1', 'spon-1');
    expect(await verifyBeaconToken(tenv, token, 'evt-1', 'spon-OTHER')).toBeNull();
  });

  test('a token minted for a different event cannot be replayed here', async () => {
    const token = await mintBeaconToken(tenv, 'evt-1', 'spon-1');
    expect(await verifyBeaconToken(tenv, token, 'evt-OTHER', 'spon-1')).toBeNull();
  });

  test('a tampered payload is refused (signature covers it)', async () => {
    const token = await mintBeaconToken(tenv, 'evt-1', 'spon-1');
    const [payload, sig] = token!.split('.');
    const forged = btoa(
      JSON.stringify({
        kind: 'beacon',
        event_id: 'evt-OTHER',
        sponsor_id: 'spon-1',
        exp: 9999999999,
      })
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await verifyBeaconToken(tenv, `${forged}.${sig}`, 'evt-OTHER', 'spon-1')).toBeNull();
    expect(
      await verifyBeaconToken(tenv, `${payload}.${'0'.repeat(64)}`, 'evt-1', 'spon-1')
    ).toBeNull();
  });

  test('a sponsor-home token (different kind, same secret) can never authenticate a beacon', async () => {
    const homeToken = await mintSponsorHomeToken(tenv, 'spon-1', 'bt-brand');
    expect(homeToken).not.toBeNull();
    expect(await verifyBeaconToken(tenv, homeToken!.token, 'evt-1', 'spon-1')).toBeNull();
  });

  test('no secret → fail closed on both mint and verify', async () => {
    const noSecret = { SHARED_REPORT_SIGNING_SECRET: '' };
    expect(await mintBeaconToken(noSecret, 'evt-1', 'spon-1')).toBeNull();
    const token = await mintBeaconToken(tenv, 'evt-1', 'spon-1');
    expect(await verifyBeaconToken(noSecret, token, 'evt-1', 'spon-1')).toBeNull();
  });
});

describe('sponsor-bundle mints, impression/click writes verify', () => {
  test('sponsor-bundle response carries a beacon_token per sponsor', async () => {
    const res = await SELF.fetch(
      'http://localhost/api/v2/events/bt-evt/sponsor-bundle?surface=display'
    );
    const body = await res.json<{
      ok: boolean;
      bundle: { sponsors: Array<Record<string, unknown>> };
    }>();
    expect(body.ok).toBe(true);
    const sponsor = body.bundle.sponsors.find((s) => s.id === 'bt-spon');
    expect(sponsor).toBeTruthy();
    expect(typeof sponsor!.beacon_token).toBe('string');
    expect((sponsor!.beacon_token as string).length).toBeGreaterThan(0);
  });

  test('impression write with a valid bundle-minted token becomes a row (201)', async () => {
    const bundleRes = await SELF.fetch(
      'http://localhost/api/v2/events/bt-evt/sponsor-bundle?surface=display'
    );
    const bundleBody = await bundleRes.json<{
      bundle: { sponsors: Array<Record<string, unknown>> };
    }>();
    const token = bundleBody.bundle.sponsors.find((s) => s.id === 'bt-spon')!.beacon_token;

    const res = await SELF.fetch(
      'http://localhost/api/v2/events/bt-evt/sponsors/bt-spon/impression',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        },
        body: JSON.stringify({
          surface: 'display',
          placement: 'tvTop-beacon-auth',
          beacon_token: token,
        }),
      }
    );
    const body = await res.json<{ ok: boolean; status: number }>();
    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
  });

  test('impression write with NO token is accepted-but-not-counted (202, honest shape)', async () => {
    const res = await SELF.fetch(
      'http://localhost/api/v2/events/bt-evt/sponsors/bt-spon/impression',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surface: 'display', placement: 'tvTop-beacon-no-token' }),
      }
    );
    const body = await res.json<{ ok: boolean; status: number; counted?: boolean }>();
    expect(res.status).toBe(202);
    expect(body.ok).toBe(true);
    expect(body.counted).toBe(false);
  });

  test('impression write with a token minted for a DIFFERENT sponsor is not counted', async () => {
    const foreignToken = await mintBeaconToken(tenv, 'bt-evt', 'some-other-sponsor-id');
    const res = await SELF.fetch(
      'http://localhost/api/v2/events/bt-evt/sponsors/bt-spon/impression',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          surface: 'display',
          placement: 'tvTop-beacon-wrong-sponsor',
          beacon_token: foreignToken,
        }),
      }
    );
    const body = await res.json<{ ok: boolean; counted?: boolean }>();
    expect(res.status).toBe(202);
    expect(body.counted).toBe(false);
  });

  test('click write with a valid bundle-minted token becomes a row (201)', async () => {
    const bundleRes = await SELF.fetch(
      'http://localhost/api/v2/events/bt-evt/sponsor-bundle?surface=display'
    );
    const bundleBody = await bundleRes.json<{
      bundle: { sponsors: Array<Record<string, unknown>> };
    }>();
    const token = bundleBody.bundle.sponsors.find((s) => s.id === 'bt-spon')!.beacon_token;

    const res = await SELF.fetch('http://localhost/api/v2/events/bt-evt/sponsors/bt-spon/click', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      },
      body: JSON.stringify({
        surface: 'display',
        placement: 'tvTop-beacon-auth-click',
        beacon_token: token,
      }),
    });
    const body = await res.json<{ ok: boolean; status: number }>();
    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
  });

  test('click write with no token is accepted-but-not-counted (202, honest shape)', async () => {
    const res = await SELF.fetch('http://localhost/api/v2/events/bt-evt/sponsors/bt-spon/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surface: 'display', placement: 'tvTop-beacon-no-token-click' }),
    });
    const body = await res.json<{ ok: boolean; counted?: boolean }>();
    expect(res.status).toBe(202);
    expect(body.counted).toBe(false);
  });
});
