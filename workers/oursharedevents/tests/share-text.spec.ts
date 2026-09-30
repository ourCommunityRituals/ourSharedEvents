/**
 * OSE-1371 — buildShareText: the one invite every share path sends — and
 * OSE-1370's posterArtPath, the one gate every public art `src` passes.
 *
 * Node-clean: pure modules, no DOM, no runtime.
 *
 * @born-red OSE-1370/OSE-1371 | method: spec written first; against origin/main
 *   neither module exists (lib/share-text.ts, lib/poster-art.ts) so the file
 *   fails to load — red; green after | date: 2026-09-30
 */
import { describe, it, expect } from 'vitest';
import {
  buildShareText,
  shareMailtoHref,
  SHARE_BODY_MAX,
  type ShareEventInput,
} from '../src/lib/share-text';
import { posterArtPath, posterArtAbsoluteUrl } from '../src/lib/poster-art';

const SHORT = 'https://oursharedevents.com/s/AbC123';
const FOOTER = 'Sent from OurSharedEvents. Nothing about you or me was collected to send this.';

const MIN: ShareEventInput = { title: 'Bocce Night', start_date: '2026-10-24' };
const FULL: ShareEventInput = {
  title: 'Harbor Bocce Night',
  what_short: 'Rolling on the green, all levels.',
  description: 'ignored when what_short exists',
  start_date: '2026-10-24',
  starts_at: '2026-10-24T23:00:00Z',
  timezone: 'America/Chicago',
  location: 'Eagles Bowl',
  where_address: '100 Red Arrow Hwy, Sawyer MI',
  how_details: 'Bring a team of four.',
  price_cents: 500,
  price_model: 'fixed',
  price_note: null,
};

describe('OSE-1371 | buildShareText', () => {
  it('minimum event: subject "{title}, {Sat Oct 24}", blank note line, link, footer', () => {
    const t = buildShareText(MIN, SHORT, 'en');
    expect(t.subject).toBe('Bocce Night, Sat Oct 24');
    expect(t.body).toBe(
      ['', 'Bocce Night', 'Saturday, October 24', `Details and RSVP: ${SHORT}`, '', FOOTER].join(
        '\n'
      )
    );
  });

  it('full 5W event: what, time in the EVENT zone, venue + address, price', () => {
    const t = buildShareText(FULL, SHORT, 'en');
    expect(t.body).toBe(
      [
        '',
        'Harbor Bocce Night',
        'Rolling on the green, all levels.',
        'Saturday, October 24 · 6:00 PM CDT',
        'Eagles Bowl, 100 Red Arrow Hwy, Sawyer MI',
        '$5',
        `Details and RSVP: ${SHORT}`,
        '',
        FOOTER,
      ].join('\n')
    );
  });

  it('the day is the event-local day, not UTC (a 02:00Z start is the evening before)', () => {
    const t = buildShareText(
      { title: 'Late', starts_at: '2026-12-02T02:00:00Z', timezone: 'America/Chicago' },
      SHORT
    );
    expect(t.subject).toBe('Late, Tue Dec 1');
    expect(t.body).toContain('Tuesday, December 1 · 8:00 PM CST');
  });

  it('empty fields are omitted — never "TBD", never "undefined"/"null"', () => {
    const t = buildShareText(
      { title: 'Only a title', location: '', where_address: null, what_short: '   ' },
      SHORT
    );
    expect(t.subject).toBe('Only a title');
    expect(t.body).toBe(['', 'Only a title', `Details and RSVP: ${SHORT}`, '', FOOTER].join('\n'));
    for (const bad of ['TBD', 'undefined', 'null', 'NaN']) expect(t.body).not.toContain(bad);
  });

  it('no price → the how line; venue equal to address is not repeated', () => {
    const t = buildShareText(
      { ...MIN, how_details: 'Walk in.', location: 'Hall', where_address: 'Hall' },
      SHORT
    );
    expect(t.body).toContain('\nHall\n');
    expect(t.body).toContain('\nWalk in.\n');
  });

  it('never an evt_ id, an internal path, a /q/ path or a private field', () => {
    const t = buildShareText(
      {
        ...FULL,
        // Extra row fields a caller might pass through — none may leak.
        ...({ id: 'evt_secret', brand_id: 'brand_x', created_by: 'host@example.com' } as object),
      } as ShareEventInput,
      SHORT
    );
    const all = t.subject + t.body;
    for (const bad of ['evt_', 'brand_x', 'host@example.com', '/api/', '/admin', '/q/', '?'])
      expect(all).not.toContain(bad);
  });

  it(`stays under ${SHARE_BODY_MAX} chars even with every field at its limit`, () => {
    const long = (n: number) => 'x'.repeat(n);
    const t = buildShareText(
      {
        ...FULL,
        title: long(400),
        what_short: long(900),
        location: long(300),
        where_address: long(300),
        price_cents: null,
        price_model: null,
        how_details: long(900),
      },
      'https://oursharedevents.com/events/0123456789abcdef0123456789abcdef'
    );
    expect(t.body.length).toBeLessThanOrEqual(SHARE_BODY_MAX);
    expect(t.body).toContain('Details and RSVP: https://oursharedevents.com/events/');
    expect(t.body.endsWith(FOOTER)).toBe(true);
  });

  it('Spanish: subject date, link label and footer follow lang', () => {
    const t = buildShareText(FULL, SHORT, 'es');
    expect(t.subject).toBe('Harbor Bocce Night, sáb 24 oct');
    expect(t.body).toContain('sábado, 24 de octubre');
    expect(t.body).toContain(`Detalles y confirmación: ${SHORT}`);
    expect(t.body).toContain('Enviado desde OurSharedEvents.');
  });

  it('mailto: encodes subject + body (newlines as %0A) and round-trips exactly', () => {
    const t = buildShareText(FULL, SHORT, 'en');
    const href = shareMailtoHref(t);
    expect(href.startsWith('mailto:?subject=')).toBe(true);
    expect(href).toContain('%0A');
    expect(href).not.toMatch(/[\n\r ]/);
    const q = new URLSearchParams(href.slice('mailto:?'.length));
    expect(q.get('subject')).toBe(t.subject);
    expect(q.get('body')).toBe(t.body);
  });
});

describe('OSE-1370 | posterArtPath — our own upload path, image extension, nothing else', () => {
  const OK = '/api/v2/uploads/events/evt_x/1727700000000-poster.JPG';

  it('accepts the admin Poster art upload path', () => {
    expect(posterArtPath(OK)).toBe(OK);
    expect(posterArtAbsoluteUrl(OK, 'https://oursharedevents.com')).toBe(
      `https://oursharedevents.com${OK}`
    );
  });

  it.each([
    null,
    undefined,
    42,
    '',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'data:image/png;base64,AAAA',
    'http://evil.example/p.png',
    'https://evil.example/p.png',
    '//evil.example/p.png',
    '/api/v2/uploads/events/evt_x/../../x.png',
    '/api/v2/uploads/events/evt_x/sub/x.png',
    '/api/v2/uploads/sponsors/sp_1/logo.png',
    '/api/v2/uploads/events/evt_x/flyer.pdf',
    '/api/v2/uploads/events/evt_x/clip.mp4',
    '/api/v2/uploads/events/evt_x/p.png?x=1',
    '/api/v2/uploads/events/evt_x/p.png" onerror="alert(1)',
    ` ${OK}`,
  ])('rejects %s', (bad) => {
    expect(posterArtPath(bad)).toBeNull();
    expect(posterArtAbsoluteUrl(bad, 'https://oursharedevents.com')).toBeNull();
  });
});
