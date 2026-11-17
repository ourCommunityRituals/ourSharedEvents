/**
 * Transport headers on every response (OSE-2118).
 *
 * Pages set Strict-Transport-Security and X-Content-Type-Options themselves,
 * but JSON, redirects, errors and the schema-drift answer did not, and the
 * zone's edge HSTS is off. The fetch seam in src/index.ts now adds both to any
 * response that lacks them, and leaves a handler's own value alone.
 */
import { SELF } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { TRANSPORT_HEADERS, applyTransportHeaders } from '../src/lib/transport-headers';

const HSTS = 'max-age=31536000; includeSubDomains';

function expectTransportHeaders(res: Response): void {
  expect(res.headers.get('Strict-Transport-Security')).toBe(HSTS);
  expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
}

describe('OSE-2118: every Worker response carries HSTS and nosniff', () => {
  test('public JSON API', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/events');
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expectTransportHeaders(res);
  });

  test('unknown API path (404)', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/nonexistent-route-xyz');
    expect(res.status).toBe(404);
    expectTransportHeaders(res);
  });

  test('redirect (/calendar → /events, 301)', async () => {
    const res = await SELF.fetch('https://t.test/calendar', { redirect: 'manual' });
    expect(res.status).toBe(301);
    expectTransportHeaders(res);
  });

  test('admin API refused without credentials', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/events');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expectTransportHeaders(res);
  });

  test('HTML page keeps its own headers and gets no duplicate', async () => {
    const res = await SELF.fetch('https://t.test/events');
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expectTransportHeaders(res);
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
  });
});

describe('applyTransportHeaders', () => {
  test('adds both headers when absent', () => {
    const h = new Headers({ 'Content-Type': 'application/json' });
    applyTransportHeaders(h);
    expect(h.get('Strict-Transport-Security')).toBe(HSTS);
    expect(h.get('X-Content-Type-Options')).toBe('nosniff');
  });

  test("keeps a handler's own value", () => {
    const h = new Headers({ 'Strict-Transport-Security': 'max-age=60' });
    applyTransportHeaders(h);
    expect(h.get('Strict-Transport-Security')).toBe('max-age=60');
  });

  test('matches what the page handlers send, so the two cannot drift', () => {
    expect(TRANSPORT_HEADERS['Strict-Transport-Security']).toBe(HSTS);
    expect(TRANSPORT_HEADERS['X-Content-Type-Options']).toBe('nosniff');
  });
});
