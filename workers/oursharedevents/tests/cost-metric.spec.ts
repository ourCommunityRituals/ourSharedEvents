/**
 * COST-301 (OSE-780) — cost metric boundary + regression unit tests.
 *
 * L5 Boundary: the emitter's payload boundary — exactly the sealed aggregate
 *   keys are emitted, and an injected identifier can NOT leak through.
 * L4 Regression: normalizeOperation masks every non-keyword segment; the D1
 *   instrumentation accumulates rows/queries through the proxy.
 *
 * These are the runtime companions to the structural invariant
 * tests/e2e/0-architecture/cost-metric-never-who.invariant.spec.ts.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  normalizeOperation,
  createCostAccumulator,
  instrumentEnvForCost,
  emitOperationCost,
  type CostAccumulator,
} from '../src/lib/cost-metric';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('normalizeOperation — identifier-free, low-cardinality labels', () => {
  it('keeps recognized keyword segments verbatim', () => {
    expect(normalizeOperation('GET', '/api/v2/events')).toBe('GET /api/v2/events');
    expect(normalizeOperation('GET', '/health')).toBe('GET /health');
    expect(normalizeOperation('GET', '/api/v2/admin/sponsors/promote')).toBe(
      'GET /api/v2/admin/sponsors/promote'
    );
  });

  it('masks event slugs (never-who: a slug could identify a church)', () => {
    expect(normalizeOperation('GET', '/events/my-church-picnic-2026')).toBe('GET /events/:x');
  });

  it('masks resource ids and QR/shortlink tokens', () => {
    expect(normalizeOperation('PUT', '/api/v2/admin/events/abc123')).toBe(
      'PUT /api/v2/admin/events/:x'
    );
    expect(normalizeOperation('POST', '/api/v2/admin/events/xyz789/verify-qr')).toBe(
      'POST /api/v2/admin/events/:x/verify-qr'
    );
    expect(normalizeOperation('GET', '/q/SECRET_QR_TOKEN')).toBe('GET /q/:x');
    expect(normalizeOperation('GET', '/s/aB9xQ')).toBe('GET /s/:x');
  });

  it('normalizes the root path and a bogus method', () => {
    expect(normalizeOperation('GET', '/')).toBe('GET /');
    expect(normalizeOperation('weird méthod', '/health')).toBe('OTHER /health');
  });

  it('keeps the Epic TRIANGLE sponsor-home corner routes readable (CCR-PR567 L2c)', () => {
    // sponsor (page + /api/v2/sponsor prefix), placements, respond, home-link
    // must be recognised segments so the new corner (incl. the HMAC-mint
    // amplification on /sponsor) is observable, not masked to :x/:x/:x.
    expect(normalizeOperation('POST', '/api/v2/sponsor/placements/abc/respond')).toBe(
      'POST /api/v2/sponsor/placements/:x/respond'
    );
    expect(normalizeOperation('POST', '/api/v2/admin/sponsors/xyz/home-link')).toBe(
      'POST /api/v2/admin/sponsors/:x/home-link'
    );
    expect(normalizeOperation('GET', '/sponsor')).toBe('GET /sponsor');
  });
});

describe('emitOperationCost — sealed aggregate payload boundary', () => {
  it('emits exactly one OPERATION_COST line with only the sealed keys', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const acc = createCostAccumulator();
    acc.d1RowsRead = 5;
    acc.d1RowsWritten = 2;
    acc.d1Queries = 3;
    emitOperationCost({ op: 'GET /api/v2/events', wallMs: 12.7, acc, status: 200 });

    expect(spy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(spy.mock.calls[0][0] as string);
    expect(Object.keys(payload).sort()).toEqual(
      ['d1Queries', 'd1RowsRead', 'd1RowsWritten', 'op', 'status', 'type', 'wallMs'].sort()
    );
    expect(payload).toMatchObject({
      type: 'OPERATION_COST',
      op: 'GET /api/v2/events',
      wallMs: 13, // rounded
      d1RowsRead: 5,
      d1RowsWritten: 2,
      d1Queries: 3,
      status: 200,
    });
  });

  it('cannot leak an injected identifier smuggled onto the accumulator', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Simulate a future mistake: someone attaches PII to the accumulator object.
    const tainted = createCostAccumulator() as CostAccumulator & Record<string, unknown>;
    tainted.email = 'attendee@example.com';
    tainted.ip = '203.0.113.7';
    emitOperationCost({ op: 'GET /health', wallMs: 1, acc: tainted, status: 200 });

    const raw = spy.mock.calls[0][0] as string;
    expect(raw).not.toContain('attendee@example.com');
    expect(raw).not.toContain('203.0.113.7');
    const payload = JSON.parse(raw);
    expect(payload.email).toBeUndefined();
    expect(payload.ip).toBeUndefined();
  });

  it('never throws (observability must not break a response)', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {
      throw new Error('log sink down');
    });
    expect(() =>
      emitOperationCost({ op: 'GET /', wallMs: 0, acc: createCostAccumulator(), status: 500 })
    ).not.toThrow();
    spy.mockRestore();
  });
});

describe('instrumentEnvForCost — D1 row/query accumulation via proxy', () => {
  // Minimal fake D1 that mirrors the .prepare().bind().run()/.all()/.first() and
  // .batch() surface, returning canned `.meta`. Validates the proxy accounting
  // independent of miniflare (the real host-D1 path is exercised by the many
  // SELF.fetch integration specs that route through the instrumented index.ts).
  function fakeD1(meta: { rows_read?: number; rows_written?: number }) {
    const stmt = {
      bind: () => stmt,
      run: async () => ({ success: true, meta }),
      all: async () => ({ success: true, results: [], meta }),
      first: async () => null,
    };
    return {
      prepare: () => stmt,
      batch: async (stmts: unknown[]) => stmts.map(() => ({ success: true, meta })),
    } as unknown as D1Database;
  }

  it('accumulates rows_read / rows_written from run() and all()', async () => {
    const acc = createCostAccumulator();
    const env = instrumentEnvForCost(
      { DB: fakeD1({ rows_read: 4, rows_written: 1 }) } as Record<string, unknown>,
      acc
    );
    await (env.DB as D1Database).prepare('SELECT 1').bind().all();
    await (env.DB as D1Database).prepare('UPDATE x SET y=1').run();
    expect(acc.d1RowsRead).toBe(8);
    expect(acc.d1RowsWritten).toBe(2);
    expect(acc.d1Queries).toBe(2);
  });

  it('counts first() as a query but records no rows (no .meta on first())', async () => {
    const acc = createCostAccumulator();
    const env = instrumentEnvForCost(
      { DB: fakeD1({ rows_read: 9, rows_written: 0 }) } as Record<string, unknown>,
      acc
    );
    await (env.DB as D1Database).prepare('SELECT 1').first();
    expect(acc.d1Queries).toBe(1);
    expect(acc.d1RowsRead).toBe(0);
  });

  it('returns the original env unchanged when there are no D1 bindings', () => {
    const acc = createCostAccumulator();
    const plain = { SOMETHING: 'else' } as Record<string, unknown>;
    expect(instrumentEnvForCost(plain, acc)).toBe(plain);
  });
});
