/**
 * lib/admin-events-upcoming — the pure half: floor, bands, cursor codec.
 * Node project (no D1). The SQL behaviour is covered against real D1 by
 * admin-events-upcoming.spec.ts.
 */
import { describe, test, expect } from 'vitest';
import {
  upcomingFloor,
  upcomingBand,
  encodeUpcomingCursor,
  decodeUpcomingCursor,
  cursorAfter,
  upcomingSql,
} from '../src/lib/admin-events-upcoming';

describe('upcomingFloor — "today somewhere"', () => {
  test('is the UTC date 12h ago', () => {
    expect(upcomingFloor(new Date('2026-10-02T01:00:00Z'))).toBe('2026-10-01');
    expect(upcomingFloor(new Date('2026-10-02T12:00:00Z'))).toBe('2026-10-02');
    expect(upcomingFloor(new Date('2026-10-02T11:59:59Z'))).toBe('2026-10-01');
  });
  test('a Chicago evening event is still upcoming after UTC midnight', () => {
    // 2026-10-24 20:00 CDT = 2026-10-25 01:00 UTC.
    const floor = upcomingFloor(new Date('2026-10-25T01:00:00Z'));
    expect(upcomingBand('2026-10-24', floor)).toBe(0);
  });
});

describe('upcomingBand', () => {
  test('bands', () => {
    expect(upcomingBand('2026-10-02', '2026-10-02')).toBe(0);
    expect(upcomingBand('2026-10-03', '2026-10-02')).toBe(0);
    expect(upcomingBand('2026-10-01', '2026-10-02')).toBe(2);
    expect(upcomingBand(null, '2026-10-02')).toBe(1);
    expect(upcomingBand('', '2026-10-02')).toBe(1);
  });
});

describe('cursor codec', () => {
  test('round trips, including non-ASCII ids', () => {
    const c = {
      f: '2026-10-02',
      b: 0 as const,
      d: '2026-10-05',
      s: '2026-10-05T18:00:00.000Z',
      i: 'evt_é',
    };
    expect(decodeUpcomingCursor(encodeUpcomingCursor(c))).toEqual(c);
  });
  test('cursorAfter reads the row’s band', () => {
    const past = decodeUpcomingCursor(
      cursorAfter({ id: 'a', start_date: '2020-01-01', starts_at: null }, '2026-10-02')
    );
    expect(past).toEqual({ f: '2026-10-02', b: 2, d: '2020-01-01', s: '', i: 'a' });
    const undated = decodeUpcomingCursor(cursorAfter({ id: 'b', start_date: null }, '2026-10-02'));
    expect(undated).toEqual({ f: '2026-10-02', b: 1, d: '', s: '', i: 'b' });
  });
  test.each([null, '', '2026-01-01T00:00:00Z', 'u1.', 'u1.!!!!', 'u1.' + 'A'.repeat(600)])(
    'refuses %s',
    (raw) => {
      expect(decodeUpcomingCursor(raw as string | null)).toBeNull();
    }
  );
  test('refuses a band-1 cursor that carries a date, and a band-0 one that does not', () => {
    expect(
      decodeUpcomingCursor(
        encodeUpcomingCursor({ f: '2026-10-02', b: 1, d: '2026-10-02', s: '', i: 'x' })
      )
    ).toBeNull();
    expect(
      decodeUpcomingCursor(encodeUpcomingCursor({ f: '2026-10-02', b: 0, d: '', s: '', i: 'x' }))
    ).toBeNull();
  });
});

describe('upcomingSql', () => {
  test('binds every value; nothing from the cursor is spliced into SQL text', () => {
    const evil = {
      f: '2026-10-02',
      b: 2 as const,
      d: '2026-10-01',
      s: "x' OR 1=1 --",
      i: "y'; DROP TABLE events; --",
    };
    const { where, orderBy } = upcomingSql('2026-10-02', evil);
    expect(where!.sql).not.toContain('OR 1=1');
    expect(where!.sql).not.toContain('DROP');
    expect(where!.binds).toContain(evil.s);
    expect(where!.binds).toContain(evil.i);
    // One bind per placeholder.
    expect((where!.sql.match(/\?/g) ?? []).length).toBe(where!.binds.length);
    expect((orderBy.sql.match(/\?/g) ?? []).length).toBe(orderBy.binds.length);
  });
  test('placeholders match binds for every band', () => {
    for (const b of [0, 1, 2] as const) {
      const { where } = upcomingSql('2026-10-02', {
        f: '2026-10-02',
        b,
        d: b === 1 ? '' : '2026-10-01',
        s: '',
        i: 'x',
      });
      expect((where!.sql.match(/\?/g) ?? []).length).toBe(where!.binds.length);
    }
  });
});
