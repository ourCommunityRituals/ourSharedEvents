/**
 * OSE-1357 part 2 — the pure rules behind poster codes (lib/poster-codes.ts):
 * the save-body parser, the kind catalog, the plan allotment table and the
 * internal targets. No D1, no runtime — the endpoint half is
 * tests/poster-multi-code.spec.ts (workers pool).
 *
 * @born-red OSE-1357 | method: written before lib/poster-codes.ts existed (import
 *   fails on the base branch) — red; green after | date: 2026-09-29
 */
import { describe, test, expect } from 'vitest';
import {
  POSTER_CODE_KINDS,
  POSTER_CODE_LIMITS,
  internalTarget,
  parsePosterCodes,
  posterCodeKind,
  posterCodeLimit,
  posterCodeUec,
} from '../src/lib/poster-codes';
import { getCode } from '../src/lib/uec';
import { WHAT_URL_TYPES } from '../src/lib/what-url-types';

describe('the kind catalog', () => {
  test('every target the brief names is a kind, each with one big word', () => {
    const kinds = POSTER_CODE_KINDS.map((k) => k.kind);
    for (const k of ['public', 'checkin', 'donation', 'signup', 'tickets', 'website', 'ow']) {
      expect(kinds).toContain(k);
    }
    for (const k of POSTER_CODE_KINDS) {
      expect(k.word).toMatch(/^[A-Z][A-Z ]+$/);
      expect(k.choice.length).toBeGreaterThan(0);
    }
    expect(posterCodeKind('checkin').word).toBe('CHECK IN');
    expect(posterCodeKind('donation').word).toBe('DONATE');
  });

  test('each kind prints as ONE Universal Event Code, read from the registry (PO mapping 2026-10-03)', () => {
    expect(Object.fromEntries(POSTER_CODE_KINDS.map((k) => [k.kind, k.uec]))).toEqual({
      public: 'UTILITY',
      checkin: 'CHECK-IN',
      register: 'ENTER',
      donation: 'SHOP',
      sponsor: 'SPONSOR',
      signup: 'ENTER',
      tickets: 'SHOP',
      ow: 'UTILITY',
      league: 'LIVE',
      workshop: 'ENTER',
      substack: 'UTILITY',
      menu: 'UTILITY',
      website: 'UTILITY',
    });
    for (const k of POSTER_CODE_KINDS) {
      const reg = getCode(k.uec);
      expect(reg, k.kind + ' names a UEC the registry has').not.toBeNull();
      expect(posterCodeUec(k.kind)).toEqual({
        id: reg!.id,
        color: reg!.label,
        scan_hex: reg!.scan_hex,
      });
    }
    // Anything unknown is the standard's catch-all.
    expect(posterCodeUec('not-a-kind').id).toBe('UTILITY');
  });

  test('only the event page, check-in and the event registration form are built server-side; every other kind is an https link', () => {
    for (const k of POSTER_CODE_KINDS) {
      if (k.kind === 'public') expect(k.target).toBe('event');
      else if (k.kind === 'checkin') expect(k.target).toBe('checkin');
      else if (k.kind === 'register') expect(k.target).toBe('register');
      else expect(k.target).toBe('https');
    }
  });

  test('an event’s existing typed link (what_url_type) is always a valid poster kind', () => {
    const kinds = POSTER_CODE_KINDS.map((k) => k.kind);
    for (const t of WHAT_URL_TYPES) expect(kinds).toContain(t);
  });

  test('internal targets carry the event id and the form type — nothing else', () => {
    expect(internalTarget('https://o.test', 'evt 1', 'checkin')).toBe(
      'https://o.test/forms/evt%201?type=checkin'
    );
    expect(internalTarget('https://o.test', 'evt1', 'public')).toBe('https://o.test/events/evt1');
    // A stale / unknown kind never becomes the check-in form.
    expect(internalTarget('https://o.test', 'evt1', 'nope')).toBe('https://o.test/events/evt1');
  });
});

describe('the plan allotment', () => {
  test('every tier has a number, bigger plans fit more, and the smallest still fits event page + 1', () => {
    expect(POSTER_CODE_LIMITS.free).toBeGreaterThanOrEqual(2);
    expect(POSTER_CODE_LIMITS.mid).toBeGreaterThan(POSTER_CODE_LIMITS.free);
    expect(POSTER_CODE_LIMITS.enterprise).toBeGreaterThan(POSTER_CODE_LIMITS.mid);
    expect(posterCodeLimit('free')).toBe(POSTER_CODE_LIMITS.free);
    // An unrecognised tier falls to the smallest allotment, never unlimited.
    expect(posterCodeLimit('unknown' as never)).toBe(POSTER_CODE_LIMITS.free);
  });
});

describe('parsePosterCodes', () => {
  const LIMIT = 4;

  test('keeps the order sent, drops any explicit event-page entry, strips client targets from check-in', () => {
    const r = parsePosterCodes(
      {
        codes: [
          { kind: 'donation', target_url: ' https://give.example.org/x ' },
          { kind: 'public' },
          { kind: 'checkin', target_url: 'https://evil.example' },
        ],
      },
      LIMIT
    );
    expect(r).toEqual({
      ok: true,
      codes: [
        { kind: 'donation', target_url: 'https://give.example.org/x' },
        { kind: 'checkin', target_url: null },
      ],
    });
  });

  test.each([
    ['javascript:alert(1)'],
    ['http://give.example.org'],
    ['data:text/html,hi'],
    ['//give.example.org'],
    ['give.example.org'],
    [''],
    [42],
    [null],
    ['https://' + 'a'.repeat(2050)],
  ])('refuses a non-https external target %j with INVALID_TARGET + the row index', (target) => {
    const r = parsePosterCodes(
      { codes: [{ kind: 'checkin' }, { kind: 'ow', target_url: target }] },
      LIMIT
    );
    expect(r).toMatchObject({ ok: false, code: 'INVALID_TARGET', index: 1 });
    if (!r.ok) expect(r.error).toContain('https://');
  });

  test('refuses unknown kinds, duplicates, a non-array body and oversized requests', () => {
    expect(parsePosterCodes({ codes: [{ kind: 'q' }] }, LIMIT)).toMatchObject({
      ok: false,
      code: 'INVALID_KIND',
      index: 0,
    });
    expect(
      parsePosterCodes({ codes: [{ kind: 'checkin' }, { kind: 'checkin' }] }, LIMIT)
    ).toMatchObject({ ok: false, code: 'DUPLICATE_KIND', index: 1 });
    expect(parsePosterCodes({ codes: {} }, LIMIT)).toMatchObject({
      ok: false,
      code: 'INVALID_BODY',
    });
    expect(parsePosterCodes(null, LIMIT)).toMatchObject({ ok: false, code: 'INVALID_BODY' });
    expect(
      parsePosterCodes({ codes: Array.from({ length: 21 }, () => ({ kind: 'checkin' })) }, 99)
    ).toMatchObject({ ok: false, code: 'TOO_MANY_CODES' });
  });

  test('the event page counts toward the plan: limit-1 extra codes fit, one more is PLAN_LIMIT', () => {
    const extra = [
      { kind: 'checkin' },
      { kind: 'donation', target_url: 'https://a.example' },
      { kind: 'signup', target_url: 'https://b.example' },
      { kind: 'tickets', target_url: 'https://c.example' },
    ];
    expect(parsePosterCodes({ codes: extra.slice(0, LIMIT - 1) }, LIMIT).ok).toBe(true);
    const over = parsePosterCodes({ codes: extra.slice(0, LIMIT) }, LIMIT);
    expect(over).toMatchObject({ ok: false, code: 'PLAN_LIMIT' });
    if (!over.ok) {
      expect(over.error).toContain(String(LIMIT));
      expect(over.error).not.toMatch(/\b(free|mid|enterprise|tier)\b/i);
    }
  });
});
