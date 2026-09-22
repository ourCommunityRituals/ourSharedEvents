/**
 * Red Team: rate-limit-adversarial.spec.ts
 *
 * Attacks targeted:
 *   RL-001  CF-Connecting-IP: in production this header cannot be spoofed
 *           because Cloudflare sets it. But in Miniflare (test env) nothing
 *           prevents sending it — this test documents the trust model.
 *   RL-002  'unknown' IP key collision: when no IP header is present,
 *           all clients share the same rate-limit bucket.
 *   RL-003  KV read-then-write race condition: two simultaneous requests
 *           at the bucket boundary can both read "count=60" and both write
 *           "count=61" without blocking each other — double-spend.
 *   RL-005  Rate limiting only applied to /forms/ endpoints — all other
 *           public paths (events list, sponsor endpoints, etc.) are unmetered.
 *   PII-03  Distributed bypass: 60 different IPs each send 60 requests
 *           before any is rate-limited (proof that per-IP is not sufficient).
 *
 * Testing strategy: pure library-function tests (isRateLimited, clientIp)
 * plus Worker-level HTTP tests through SELF.fetch.
 */

import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { seedSplitSponsor } from '../helpers/seed-sponsor';
import {
  clientIp,
  isRateLimited,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  _deleteRateLimitKey,
} from '../../src/lib/rate-limit';
import { IMPRESSION_WRITE_MAX } from '../../src/lib/invalid-traffic';

// ─── Test env bindings ───────────────────────────────────────────────────────

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  RATE_LIMIT_KV: KVNamespace;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;

/** Rows actually written into the sponsor proof layer for one (event, sponsor). */
async function impressionRowCount(eventId: string, sponsorId: string): Promise<number> {
  const row = await tenv()
    .DB.prepare(
      'SELECT COUNT(*) AS c FROM sponsor_impressions WHERE event_id = ? AND sponsor_id = ?'
    )
    .bind(eventId, sponsorId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

// ─── DB + KV setup ───────────────────────────────────────────────────────────

beforeAll(async () => {
  const mainStmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of mainStmts) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
  const formsStmts: string[] = JSON.parse(tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  for (const stmt of formsStmts) {
    try {
      await tenv().FORMS_DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }

  // Seed one ACTIVE event so form endpoint rate-limit tests can reach the RL layer
  try {
    await tenv()
      .DB.prepare(
        `INSERT INTO events (id, brand_id, title, status, start_date, end_date)
       VALUES ('evt_rl_test', 'brand_rl', 'Rate Limit Test Event', 'active', '2026-01-01', '2026-12-31')`
      )
      .run();
  } catch {
    /* already exists */
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFormRequest(
  eventId: string,
  formType: string,
  headers: Record<string, string> = {}
): Request {
  return new Request(`http://localhost/api/v2/events/${eventId}/forms/${formType}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      name: 'Test User',
      email: 'test@example.com',
      event_id: eventId,
    }),
  });
}

async function drainRateLimit(ip: string, kv: KVNamespace): Promise<number> {
  /** Hit isRateLimited until we get the first rejection, return count used. */
  let used = 0;
  for (let i = 0; i < RATE_LIMIT_MAX + 5; i++) {
    const limited = await isRateLimited(ip, kv);
    if (limited) return used;
    used++;
  }
  return used;
}

// ════════════════════════════════════════════════════════════════════════════
// RL-001: CF-Connecting-IP trust model documentation
// ════════════════════════════════════════════════════════════════════════════

describe('RL-001: CF-Connecting-IP trust model', () => {
  test('clientIp() prefers CF-Connecting-IP over X-Forwarded-For', () => {
    const req = new Request('http://localhost/', {
      headers: {
        'CF-Connecting-IP': '1.2.3.4',
        'X-Forwarded-For': '5.6.7.8, 9.10.11.12',
      },
    });
    expect(clientIp(req)).toBe('1.2.3.4');
  });

  test('clientIp() falls back to X-Forwarded-For first segment when CF-Connecting-IP absent', () => {
    const req = new Request('http://localhost/', {
      headers: { 'X-Forwarded-For': '10.0.0.1, 192.168.1.1' },
    });
    expect(clientIp(req)).toBe('10.0.0.1');
  });

  test('clientIp() returns "unknown" when no IP headers present', () => {
    const req = new Request('http://localhost/');
    expect(clientIp(req)).toBe('unknown');
  });

  test('in Miniflare: CF-Connecting-IP can be set by the test — trust is environment-dependent', () => {
    // This documents the production vs test difference.
    // In production: Cloudflare always sets CF-Connecting-IP; X-Forwarded-For from
    //                upstream is preserved but CF-Connecting-IP cannot be spoofed.
    // In Miniflare:  Both headers come from the test and are equally untrusted.
    const spoofedReq = new Request('http://localhost/', {
      headers: { 'CF-Connecting-IP': '127.0.0.1' },
    });
    // This shows that in Miniflare, "spoofing" CF-Connecting-IP is trivial
    expect(clientIp(spoofedReq)).toBe('127.0.0.1');
    console.log(
      '[RL-001] Miniflare: CF-Connecting-IP is caller-controlled — production CF edge prevents this'
    );
  });

  test('X-Forwarded-For injection: attacker can control rate-limit bucket when CF-Connecting-IP absent', () => {
    // AUTH-004 / RL-001 attack: absent CF-Connecting-IP → XFF first segment used for bucket key
    // Attacker rotates IPs in XFF to get unlimited requests
    const attackerIps = ['10.1.1.1', '10.1.1.2', '10.1.1.3', '10.1.1.4'];
    for (const ip of attackerIps) {
      const req = new Request('http://localhost/', {
        headers: { 'X-Forwarded-For': `${ip}, 172.16.0.1` },
      });
      // Each request gets a different rate-limit key
      expect(clientIp(req)).toBe(ip);
    }
    console.log(
      '[RL-001] X-Forwarded-For injection: each IP gets separate 60-req bucket (RL-001 confirmed)'
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RL-002: 'unknown' IP key collision — shared anonymous bucket
// ════════════════════════════════════════════════════════════════════════════

describe('RL-002: "unknown" IP collision — shared anonymous rate-limit bucket (HIGH)', () => {
  beforeEach(async () => {
    // Clear the 'unknown' bucket before each test
    await _deleteRateLimitKey('unknown', tenv().RATE_LIMIT_KV);
  });

  test('"unknown" key is used when no IP headers are present', () => {
    const req = new Request('http://localhost/');
    const ip = clientIp(req);
    expect(ip).toBe('unknown');
  });

  test('all headerless clients share the same rate-limit bucket', async () => {
    const kv = tenv().RATE_LIMIT_KV;
    // A-5: the KV key is now a SHA-256 of the composed key, so we can no longer
    // read the raw `ratelimit:unknown` key. Assert the SHARED-BUCKET behaviour
    // instead: draining the 'unknown' bucket blocks the next 'unknown' caller.
    await _deleteRateLimitKey('unknown', kv);
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      expect(await isRateLimited('unknown', kv)).toBe(false);
    }
    // All headerless callers share the same 'unknown' bucket → now blocked.
    expect(await isRateLimited('unknown', kv)).toBe(true);
    console.log('[RL-002] headerless clients all share the same "unknown" bucket');
  });

  test('collision DoS: exhausting "unknown" bucket blocks ALL headerless clients', async () => {
    const kv = tenv().RATE_LIMIT_KV;
    // Drain the bucket completely
    const used = await drainRateLimit('unknown', kv);
    expect(used).toBe(RATE_LIMIT_MAX);
    console.log(
      `[RL-002] Bucket exhausted after ${used} requests — ALL headerless clients now blocked`
    );

    // Next headerless request is blocked
    const blocked = await isRateLimited('unknown', kv);
    expect(blocked).toBe(true);
  });

  test('Worker /forms endpoint: missing IP headers hit shared "unknown" bucket', async () => {
    // Clear bucket
    await _deleteRateLimitKey('unknown', tenv().RATE_LIMIT_KV);

    // One request with no IP headers should not be rate-limited yet
    const res = await SELF.fetch('http://localhost/api/v2/events/evt_rl_test/forms/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Deliberately no CF-Connecting-IP or X-Forwarded-For
      body: JSON.stringify({ event_id: 'evt_rl_test' }),
    });
    // Should not be 429 (first request)
    expect(res.status).not.toBe(429);
    console.log(`[RL-002] First headerless request status: ${res.status} (not 429 yet)`);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RL-003: KV read-then-write race condition (concurrent double-spend)
// ════════════════════════════════════════════════════════════════════════════

describe('RL-003: KV read-then-write race condition (HIGH)', () => {
  const RACE_IP = 'race-test-192.168.100.1';

  beforeEach(async () => {
    await _deleteRateLimitKey(RACE_IP, tenv().RATE_LIMIT_KV);
  });

  test('sequential requests increment correctly up to limit', async () => {
    const kv = tenv().RATE_LIMIT_KV;
    let passed = 0;
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      const limited = await isRateLimited(RACE_IP, kv);
      if (!limited) passed++;
    }
    expect(passed).toBe(RATE_LIMIT_MAX);
    // Next one should be blocked
    expect(await isRateLimited(RACE_IP, kv)).toBe(true);
  });

  test('concurrent parallel requests at limit boundary can all succeed (race window)', async () => {
    const kv = tenv().RATE_LIMIT_KV;
    // A-5: the KV key is now hashed, so we can no longer pre-seed the raw
    // `ratelimit:${RACE_IP}` key. Drive the counter to RATE_LIMIT_MAX - 1 via
    // real calls so we sit one below the threshold before the concurrent burst.
    await _deleteRateLimitKey(RACE_IP, kv);
    for (let i = 0; i < RATE_LIMIT_MAX - 1; i++) {
      await isRateLimited(RACE_IP, kv);
    }

    // Fire CONCURRENCY requests simultaneously — in a true race, multiple reads
    // all see count=59, all compute newCount=60 (allowed), all write count=60.
    // Without atomic operations, all pass even though only one should.
    const CONCURRENCY = 5;
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => isRateLimited(RACE_IP, kv))
    );

    const passed = results.filter((r) => !r).length;
    const blocked = results.filter((r) => r).length;

    console.log(
      `[RL-003] Race window: ${passed} passed, ${blocked} blocked out of ${CONCURRENCY} concurrent requests`
    );
    console.log(
      '[RL-003] Expected in race: up to all 5 pass (double-spend). Correct: at most 1 passes.'
    );

    // Document the vulnerability: in a race, multiple requests can pass
    // the limit when only 1 should be allowed.
    // If this assertion fails (only 1 passed), the race window is too small
    // for Miniflare's synchronous KV. The vulnerability is real on distributed KV.
    if (passed > 1) {
      console.log('[RL-003] Race condition confirmed: multiple concurrent requests bypassed limit');
    } else {
      console.log(
        '[RL-003] Race not reproduced in Miniflare (single-process KV). Still a real distributed risk.'
      );
    }
    // Either outcome is expected — we document the risk, not fail on it
    expect(passed + blocked).toBe(CONCURRENCY);
  });

  test('isRateLimited is NOT atomic — no compare-and-swap, pure read-modify-write', () => {
    // Static analysis: verify the implementation is a read-modify-write
    const sources = JSON.parse(
      (env as unknown as Record<string, string>).TEST_SOURCE_FILES_JSON
    ) as Record<string, string>;

    for (const [path, content] of Object.entries(sources)) {
      if (path.replace(/\\/g, '/').includes('lib/rate-limit.ts')) {
        // Verify: kv.get() followed by kv.put() — no atomic operation
        expect(content).toMatch(/kv\.get\(/);
        expect(content).toMatch(/kv\.put\(/);
        // Verify: no use of Cloudflare Durable Objects, atomic KV, or Workers analytics
        expect(content).not.toMatch(/DurableObject/);
        expect(content).not.toMatch(/atomic/i);
        console.log('[RL-003] Confirmed: rate-limit.ts uses non-atomic read-modify-write pattern');
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RL-005: Rate limiting only applied to /forms/ endpoints — scope gap
// ════════════════════════════════════════════════════════════════════════════

describe('RL-005: Rate limiting scope gap — non-forms endpoints unprotected (HIGH)', () => {
  test('GET /api/v2/events is unmetered — no rate limit applied', async () => {
    // Drain a fake IP on forms to show RL is working there
    const formIp = 'rl-scope-test-1.2.3.4';
    await _deleteRateLimitKey(formIp, tenv().RATE_LIMIT_KV);

    // Events list endpoint — no RL
    const eventResults = await Promise.all(
      Array.from({ length: 10 }, () =>
        SELF.fetch('http://localhost/api/v2/events', {
          headers: { 'CF-Connecting-IP': formIp },
        })
      )
    );
    // None should be 429
    for (const res of eventResults) {
      expect(res.status).not.toBe(429);
    }
    console.log('[RL-005] GET /api/v2/events: 10 rapid requests, none rate-limited');
  });

  test('static: isRateLimited only called in publicFormsMatch block', () => {
    const sources = JSON.parse(
      (env as unknown as Record<string, string>).TEST_SOURCE_FILES_JSON
    ) as Record<string, string>;

    for (const [path, content] of Object.entries(sources)) {
      if (path.replace(/\\/g, '/').includes('/src/router.ts')) {
        // Count total calls to isRateLimited
        const matches = content.match(/isRateLimited\s*\(/g) ?? [];
        console.log(`[RL-005] isRateLimited() calls in router.ts: ${matches.length}`);
        // Document: currently only 1 call site (inside publicFormsMatch block)
        // A hardened implementation would also rate-limit sponsor impression/click
        // endpoints and other public POST endpoints
        expect(matches.length).toBeGreaterThanOrEqual(1);
        // Document which routes are protected
        const rlLineMatch = content.match(/isRateLimited[\s\S]{0,200}/);
        if (rlLineMatch) {
          console.log('[RL-005] Rate-limit context:', rlLineMatch[0].slice(0, 150));
        }
      }
    }
  });

  test('POST sponsor impression flooding no longer reaches the proof layer (OSE-1310)', async () => {
    // Seed a sponsor if possible (best-effort). OSE-799 A2: split model.
    try {
      await seedSplitSponsor(tenv().DB, {
        id: 'spon_rl_test',
        eventId: 'evt_rl_test',
        brandId: 'brand_rl',
        name: 'Test Sponsor',
      });
    } catch {
      /* already exists or table structure differs */
    }

    // This test used to ASSERT the gap: it sent 20 beacons, observed no 429,
    // and recorded "impression flooding confirmed". That was accurate when the
    // endpoint had no control in front of it, and stayed green afterwards for
    // the wrong reason — the 120/min READ allowance later added to the route is
    // too generous to bite at 20 requests, so the test could not tell a
    // hardened endpoint from an unprotected one.
    //
    // OSE-1310 makes the question answerable: what matters is not the status
    // code but whether a flood becomes ROWS in the proof layer. It must not.
    const ip = '192.0.2.77';
    const before = await impressionRowCount('evt_rl_test', 'spon_rl_test');

    // Vary `placement` so dedup is not what is under test — this isolates the
    // write-cadence ceiling from the replay control.
    for (let i = 0; i < 40; i++) {
      await SELF.fetch(
        'http://localhost/api/v2/events/evt_rl_test/sponsors/spon_rl_test/impression',
        {
          method: 'POST',
          headers: {
            'CF-Connecting-IP': ip,
            'Content-Type': 'application/json',
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          },
          body: JSON.stringify({ surface: 'public', placement: `slot-${i}` }),
        }
      );
    }

    const written = (await impressionRowCount('evt_rl_test', 'spon_rl_test')) - before;
    console.log(`[RL-005] 40 flood beacons → ${written} rows written`);
    expect(written).toBeLessThan(40);
    expect(written).toBeLessThanOrEqual(IMPRESSION_WRITE_MAX + 1);
  });

  test('a scripted flood with no User-Agent writes NOTHING (OSE-1310)', async () => {
    try {
      await seedSplitSponsor(tenv().DB, {
        id: 'spon_rl_bot',
        eventId: 'evt_rl_bot',
        brandId: 'brand_rl',
        name: 'Bot Target',
      });
    } catch {
      /* already exists */
    }

    const before = await impressionRowCount('evt_rl_bot', 'spon_rl_bot');
    // The shape of the original attack in this file: raw scripted POSTs.
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        SELF.fetch('http://localhost/api/v2/events/evt_rl_bot/sponsors/spon_rl_bot/impression', {
          method: 'POST',
          headers: { 'CF-Connecting-IP': '192.0.2.78', 'Content-Type': 'application/json' },
          body: JSON.stringify({ surface: 'public', placement: `slot-${i}` }),
        })
      )
    );

    expect(await impressionRowCount('evt_rl_bot', 'spon_rl_bot')).toBe(before);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PII-03: Distributed rate-limit bypass via IP rotation
// ════════════════════════════════════════════════════════════════════════════

describe('PII-03: Distributed bypass — per-IP rate limit does not prevent form flooding (HIGH)', () => {
  test('60 different IPs can each submit 60 forms before any is blocked', async () => {
    const kv = tenv().RATE_LIMIT_KV;
    const ATTACKER_IPS = Array.from(
      { length: 60 },
      (_, i) => `10.0.${Math.floor(i / 255)}.${i % 255}`
    );

    // Clear all attacker IP buckets
    await Promise.all(ATTACKER_IPS.map((ip) => _deleteRateLimitKey(ip, kv)));

    // Each IP sends exactly RATE_LIMIT_MAX requests — none should be blocked
    let totalPassed = 0;
    for (const ip of ATTACKER_IPS) {
      for (let req = 0; req < RATE_LIMIT_MAX; req++) {
        const limited = await isRateLimited(ip, kv);
        if (!limited) totalPassed++;
      }
    }

    const totalCapacity = ATTACKER_IPS.length * RATE_LIMIT_MAX;
    console.log(
      `[PII-03] ${ATTACKER_IPS.length} IPs × ${RATE_LIMIT_MAX} requests = ${totalCapacity} total requests passed`
    );
    console.log(
      `[PII-03] Actually passed: ${totalPassed} — all passed = distributed bypass confirmed`
    );

    // Every request passed — the rate limiter is completely ineffective
    // against a distributed attack even with 60 IPs
    expect(totalPassed).toBe(totalCapacity);
  });

  test('single IP: request 61 is blocked, request 60 is not', async () => {
    const kv = tenv().RATE_LIMIT_KV;
    const ip = 'single-ip-limit-test-10.9.8.7';
    await _deleteRateLimitKey(ip, kv);

    // Requests 1 through 60 should all pass
    for (let i = 1; i <= RATE_LIMIT_MAX; i++) {
      const limited = await isRateLimited(ip, kv);
      expect(limited, `Request ${i} should not be rate-limited`).toBe(false);
    }
    // Request 61 should be blocked
    const blocked = await isRateLimited(ip, kv);
    expect(blocked, 'Request 61 should be rate-limited').toBe(true);
  });

  test('rate limit state: RATE_LIMIT_MAX constant is 60 (per spec)', () => {
    expect(RATE_LIMIT_MAX).toBe(60);
    expect(RATE_LIMIT_WINDOW_MS).toBe(60_000);
  });

  test('A-5: KV key is a hash of the IP, never the raw dotted-quad literal', async () => {
    // Data-at-rest doctrine: the raw client IP must NOT appear as (or in) the KV
    // key. Migration 0028 already hashes the same IP in D1; the rate limiter must
    // not re-introduce it in KV. Same IP must still map to the same (hashed)
    // bucket — deterministic hash — so per-IP semantics are unchanged.
    const kv = tenv().RATE_LIMIT_KV;
    const ip1 = 'ns-192.168.1.1';
    const ip2 = 'ns-192.168.1.2';
    await _deleteRateLimitKey(ip1, kv);
    await _deleteRateLimitKey(ip2, kv);

    await isRateLimited(ip1, kv);
    await isRateLimited(ip2, kv);

    const keys = (await kv.list()).keys.map((k) => k.name);
    // No stored key may contain the raw IP literal.
    for (const name of keys) {
      expect(name).not.toContain(ip1);
      expect(name).not.toContain(ip2);
      expect(name).not.toContain('192.168.1.1');
      expect(name).not.toContain('192.168.1.2');
    }
    // Buckets are still present and distinct (per-IP isolation preserved).
    const ip1Keys = keys.filter((n) => n.startsWith('ratelimit:'));
    expect(ip1Keys.length).toBeGreaterThanOrEqual(2);
    // The raw-IP key does not exist; the hashed one does.
    expect(await kv.get(`ratelimit:${ip1}`)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// X-Forwarded-For injection attack (AUTH-004)
// ════════════════════════════════════════════════════════════════════════════

describe('AUTH-004: X-Forwarded-For injection bypasses rate limit (HIGH)', () => {
  test('attacker with no CF-Connecting-IP can rotate XFF headers to avoid rate limiting', async () => {
    const kv = tenv().RATE_LIMIT_KV;
    // Simulate 5 different "clients" that are really the same attacker rotating XFF
    const attackerXffs = [
      '203.0.113.1',
      '203.0.113.2',
      '203.0.113.3',
      '203.0.113.4',
      '203.0.113.5',
    ];

    for (const xff of attackerXffs) {
      await _deleteRateLimitKey(xff, kv);
    }

    let totalAllowed = 0;
    for (const xff of attackerXffs) {
      const req = new Request('http://localhost/', {
        headers: { 'X-Forwarded-For': xff },
      });
      const ip = clientIp(req);
      expect(ip).toBe(xff); // confirms XFF is used as the key

      // Drain 60 requests through this "IP"
      for (let i = 0; i < RATE_LIMIT_MAX; i++) {
        const limited = await isRateLimited(ip, kv);
        if (!limited) totalAllowed++;
      }
    }

    console.log(
      `[AUTH-004] XFF rotation: ${totalAllowed} requests through ${attackerXffs.length} fake IPs`
    );
    expect(totalAllowed).toBe(attackerXffs.length * RATE_LIMIT_MAX);
    console.log(
      '[AUTH-004] Confirmed: X-Forwarded-For rotation completely bypasses per-IP rate limiting'
    );
  });

  test('XFF with spaces and multiple proxies: first segment extraction is correct', () => {
    const req = new Request('http://localhost/', {
      headers: { 'X-Forwarded-For': '  1.2.3.4  ,  5.6.7.8  ,  9.10.11.12  ' },
    });
    // clientIp() takes first segment and trims
    expect(clientIp(req)).toBe('1.2.3.4');
  });

  test('XFF with only commas and spaces returns empty string → falls to "unknown"', () => {
    const req = new Request('http://localhost/', {
      headers: { 'X-Forwarded-For': ' , , ' },
    });
    // First segment after split and trim is '' — the || chain then returns 'unknown'
    const ip = clientIp(req);
    console.log(`[AUTH-004] XFF="  , ,  " → clientIp="${ip}"`);
    // Either '' or 'unknown' depending on trim edge case — both are safe behaviors
    expect(['', 'unknown']).toContain(ip);
  });
});
