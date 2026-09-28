/**
 * L7 observability (OSE-1378 / OSE-1380) — born-red coverage for the Cloudflare
 * GraphQL Analytics baseline tool (scripts/observability/cf-analytics-baseline.mjs).
 *
 * Node-clean: imports the pure functions from the .mjs tool and asserts the query
 * shape, aggregation math, the never-who guard, and formatting. No network, no
 * cloudflare:test, no D1. Listed in vitest.node-specs.mjs.
 */
import { describe, it, expect } from 'vitest';
import {
  WORKERS_ANALYTICS_QUERY,
  GRAPHQL_ENDPOINT,
  buildVariables,
  summarizeBaseline,
  assertNeverWho,
  formatBaseline,
  SUMMARY_KEYS,
} from '../scripts/observability/cf-analytics-baseline.mjs';

const RESP = {
  data: {
    viewer: {
      accounts: [
        {
          workersInvocationsAdaptive: [
            {
              sum: { requests: 100, errors: 2, subrequests: 10 },
              quantiles: { cpuTimeP50: 5, cpuTimeP99: 40 },
              dimensions: { status: '200' },
            },
            {
              sum: { requests: 5, errors: 5, subrequests: 0 },
              quantiles: { cpuTimeP50: 3, cpuTimeP99: 90 },
              dimensions: { status: '500' },
            },
            {
              sum: { requests: 20, errors: 0, subrequests: 1 },
              quantiles: { cpuTimeP50: 4, cpuTimeP99: 20 },
              dimensions: { status: '404' },
            },
          ],
        },
      ],
    },
  },
};

describe('cf-analytics baseline — query', () => {
  it('targets workersInvocationsAdaptive with the documented filters + metrics', () => {
    for (const needle of [
      'workersInvocationsAdaptive',
      'accountTag',
      'scriptName',
      'datetime_geq',
      'datetime_leq',
      'requests',
      'errors',
      'cpuTimeP99',
      'status',
    ]) {
      expect(WORKERS_ANALYTICS_QUERY).toContain(needle);
    }
  });

  it('uses the Cloudflare GraphQL endpoint', () => {
    expect(GRAPHQL_ENDPOINT).toBe('https://api.cloudflare.com/client/v4/graphql');
  });

  it('buildVariables maps the window to start/end', () => {
    expect(
      buildVariables({ accountTag: 'a', scriptName: 's', startISO: 'x', endISO: 'y' })
    ).toEqual({
      accountTag: 'a',
      scriptName: 's',
      start: 'x',
      end: 'y',
    });
  });
});

describe('cf-analytics baseline — summarize', () => {
  it('aggregates requests / errors / subrequests + error rate', () => {
    const s = summarizeBaseline(RESP, { scriptName: 'w', startISO: 'a', endISO: 'b' });
    expect(s.totalRequests).toBe(125);
    expect(s.totalErrors).toBe(7);
    expect(s.totalSubrequests).toBe(11);
    expect(s.errorRatePct).toBe(5.6); // 7 / 125 * 100
    expect(s.rowCount).toBe(3);
  });

  it('builds a per-status breakdown keyed by requests', () => {
    expect(summarizeBaseline(RESP).statusBreakdown).toEqual({ '200': 100, '500': 5, '404': 20 });
  });

  it('reports the max cpuTime percentiles across the window', () => {
    const s = summarizeBaseline(RESP);
    expect(s.cpuTimeP99MaxMicros).toBe(90);
    expect(s.cpuTimeP50MaxMicros).toBe(5);
  });

  it('empty result → zeroed summary, no divide-by-zero', () => {
    const s = summarizeBaseline({
      data: { viewer: { accounts: [{ workersInvocationsAdaptive: [] }] } },
    });
    expect(s.totalRequests).toBe(0);
    expect(s.errorRatePct).toBe(0);
    expect(s.statusBreakdown).toEqual({});
  });

  it('surfaces GraphQL errors instead of silently returning zeros', () => {
    expect(() => summarizeBaseline({ errors: [{ message: 'invalid token' }] })).toThrow(
      /invalid token/
    );
  });
});

describe('cf-analytics baseline — never-who', () => {
  it('summary carries ONLY allowlisted aggregate fields', () => {
    const s = summarizeBaseline(RESP, { scriptName: 'w' });
    expect(assertNeverWho(s)).toBe(true);
    expect(Object.keys(s).sort()).toEqual([...SUMMARY_KEYS].sort());
  });

  it('rejects a non-HTTP-status breakdown key (identity leak)', () => {
    const bad = summarizeBaseline(RESP);
    bad.statusBreakdown['user@example.com'] = 1;
    expect(() => assertNeverWho(bad)).toThrow(/never-who/);
  });

  it('rejects an unexpected summary field (e.g. an ip)', () => {
    const bad = summarizeBaseline(RESP);
    bad.ip = '1.2.3.4';
    expect(() => assertNeverWho(bad)).toThrow(/never-who/);
  });
});

describe('cf-analytics baseline — format', () => {
  it('renders a human summary with counts + statuses', () => {
    const out = formatBaseline(
      summarizeBaseline(RESP, { scriptName: 'w', startISO: 'a', endISO: 'b' })
    );
    expect(out).toContain('requests:      125');
    expect(out).toContain('200: 100');
    expect(out).toContain('errors:        7  (5.6%)');
  });
});
