/**
 * One address for the public events page.
 *
 * /schedule, /calendar, /agenda and /lineup used to serve the same page as
 * /events at four more addresses. Each now answers GET and HEAD with a 301 to
 * /events, query string kept, like /public. seo-canonical-schema.spec.ts covers
 * the GET redirect; this adds HEAD, other methods, the neighbouring routes that
 * must not be swept up (/events/:id, calendar.ics) and trailing-slash variants.
 *
 * Born-red: drop one path from the router's redirect list and that path's tests
 * go red; put the page handler back in front of the redirect and every redirect
 * test does.
 */

import { describe, test, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

const ORIGIN = 'https://oursharedevents.com';

// The four the SEO audit named, plus the one OSE-1520 already redirected.
const NAMED = ['/public', '/schedule', '/calendar', '/agenda', '/lineup'];

const manual = (path: string, init: RequestInit = {}) =>
  SELF.fetch(`${ORIGIN}${path}`, { redirect: 'manual', ...init });

describe('events page aliases | 301 to /events', () => {
  for (const p of NAMED) {
    test(`GET ${p} -> 301 /events`, async () => {
      const res = await manual(p, { headers: { Accept: 'text/html' } });
      expect(res.status).toBe(301);
      expect(res.headers.get('location')).toBe(`${ORIGIN}/events`);
    });

    test(`HEAD ${p} -> 301 /events`, async () => {
      const res = await manual(p, { method: 'HEAD' });
      expect(res.status).toBe(301);
      expect(res.headers.get('location')).toBe(`${ORIGIN}/events`);
    });

    test(`GET ${p} keeps the query string`, async () => {
      const res = await manual(`${p}?when=week&q=bocce`);
      expect(res.status).toBe(301);
      expect(res.headers.get('location')).toBe(`${ORIGIN}/events?when=week&q=bocce`);
    });
  }

  test('a redirect sends no page body to a crawler', async () => {
    const res = await manual('/schedule');
    expect((await res.text()).toLowerCase()).not.toContain('<h1');
  });
});

describe('singular /event | 301 to the plural', () => {
  test('GET /event -> 301 /events', async () => {
    const res = await manual('/event', { headers: { Accept: 'text/html' } });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/events`);
  });

  test('GET and HEAD /event/:id -> 301 /events/:id', async () => {
    for (const method of ['GET', 'HEAD']) {
      const res = await manual('/event/evt_smoke_sponsored', { method });
      expect(res.status, method).toBe(301);
      expect(res.headers.get('location'), method).toBe(`${ORIGIN}/events/evt_smoke_sponsored`);
    }
  });

  test('the rest of the path and the query string ride along', async () => {
    const ics = await manual('/event/evt-1/calendar.ics');
    expect(ics.headers.get('location')).toBe(`${ORIGIN}/events/evt-1/calendar.ics`);
    const q = await manual('/event?when=week&q=bocce');
    expect(q.headers.get('location')).toBe(`${ORIGIN}/events?when=week&q=bocce`);
  });

  test('a doubled slash stays on this site', async () => {
    const res = await manual('/event//evil.example/x');
    expect(res.status).toBe(301);
    expect(new URL(res.headers.get('location') ?? '').origin).toBe(ORIGIN);
  });

  test('/event/ alone, other methods and look-alike paths are not redirected', async () => {
    expect((await manual('/event/')).status).toBe(404);
    const post = await manual('/event/evt-1', { method: 'POST', body: '{}' });
    expect(post.status).not.toBe(301);
    expect((await manual('/eventsx')).status).not.toBe(301);
    expect((await manual('/eventful/evt-1')).status).not.toBe(301);
  });
});

describe('events page aliases | what must not change', () => {
  test('/events still answers 200 HTML', async () => {
    const res = await manual('/events', { headers: { Accept: 'text/html' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  test('other methods on an alias are not redirected', async () => {
    for (const p of NAMED) {
      const res = await manual(p, { method: 'POST', body: '{}' });
      expect(res.status, `POST ${p}`).not.toBe(301);
    }
  });

  test('/events/:id/calendar.ics is a different route and is not an alias', async () => {
    const res = await manual('/events/no-such-event/calendar.ics');
    expect(res.status).not.toBe(301);
  });

  test('/events/:id is not swallowed by the alias table', async () => {
    const res = await manual('/events/no-such-event');
    expect(res.status).not.toBe(301);
  });

  test('a trailing-slash variant is not an alias (it is an unknown path, like any other)', async () => {
    for (const p of NAMED) {
      const res = await manual(`${p}/`);
      expect(res.status, `${p}/`).toBe(404);
    }
  });
});
