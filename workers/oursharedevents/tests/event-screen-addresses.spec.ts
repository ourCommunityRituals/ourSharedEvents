/**
 * Every screen of one event lives under that event's address (OSE-1684).
 *
 * The Triangle, read as addresses:
 *   attendee  /events, /events/<id>, /events/<id>/calendar.ics
 *   organizer /events/<id>/tv, /events/<id>/poster, /admin
 *   sponsor   /sponsor (signed link), /sponsors/<id> (public card)
 * Printed codes (/s/<code>, /q/<token>) never change.
 *
 * This file holds the organizer half the platform now writes: the TV and the
 * poster answer at /events/<id>/tv and /events/<id>/poster, and the older
 * /display?event= and /poster?event= keep answering. That no source writes the
 * older shape any more is checked in event-screen-route-read.spec.ts (node).
 *
 * Born-red: remove the router's /events/<id>/(tv|poster) match and the address
 * tests fail.
 */
import { describe, test, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

const ORIGIN = 'https://oursharedevents.com';
const get = (path: string, init: RequestInit = {}) =>
  SELF.fetch(`${ORIGIN}${path}`, { redirect: 'manual', ...init });

describe("an event's TV and poster at its own address", () => {
  test('GET /events/<id>/tv is the TV page', async () => {
    const res = await get('/events/evt_smoke_sponsored/tv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('function routeEventId()');
  });

  test('GET /events/<id>/poster is the poster page, ?kind= kept as state', async () => {
    for (const path of ['/events/evt-1/poster', '/events/evt-1/poster?kind=digital']) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toContain('const ROUTE_EVENT = (function ()');
    }
  });

  test('HEAD answers too', async () => {
    for (const path of ['/events/evt-1/tv', '/events/evt-1/poster']) {
      expect((await get(path, { method: 'HEAD' })).status, path).toBe(200);
    }
  });

  test('the older addresses still answer (printed, saved on kiosks)', async () => {
    for (const path of ['/display?event=evt-1', '/tv?event=evt-1', '/poster?event=evt-1']) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
    }
  });
});

describe('search engines skip the TV and the poster (OSE-1684)', () => {
  test('every address of the TV and the poster answers noindex', async () => {
    for (const path of [
      '/events/evt-1/tv',
      '/events/evt-1/poster',
      '/display',
      '/display?event=evt-1',
      '/tv',
      '/poster?event=evt-1',
      '/posters',
    ]) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('X-Robots-Tag'), path).toBe('noindex');
    }
  });

  test('the events list stays findable', async () => {
    const res = await get('/events');
    expect(res.headers.get('X-Robots-Tag')).toBeNull();
  });
});

describe('what is not an event screen', () => {
  test('a malformed id, a trailing slash or an unknown screen is a 404', async () => {
    for (const path of [
      '/events/evt.1/tv',
      `/events/${'a'.repeat(129)}/tv`,
      '/events/evt-1/tv/',
      '/events/evt-1/tvx',
      '/events/evt-1/screen',
      '/events//tv',
    ]) {
      expect((await get(path)).status, path).toBe(404);
    }
  });

  test('other methods do not get the page', async () => {
    const res = await get('/events/evt-1/tv', { method: 'POST', body: '{}' });
    expect(res.status).not.toBe(200);
  });

  test('the event page and its calendar are not taken over by the screen route', async () => {
    for (const path of ['/events/no-such-event', '/events/no-such-event/calendar.ics']) {
      const body = await (await get(path)).text();
      expect(body, path).not.toContain('function routeEventId()');
      expect(body, path).not.toContain('const ROUTE_EVENT = (function ()');
    }
  });
});
