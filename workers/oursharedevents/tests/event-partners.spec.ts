/**
 * Partner links between groups, pure layer (owner 2026-11-28,
 * src/lib/event-partners.ts, migration 0128).
 *
 * Held here:
 *   1. an invite names another real brand, never the platform, the public
 *      brand or the event's own brand, with a group name of 1 to 80 characters;
 *   2. a public body is always a co-host, whatever kind was sent;
 *   3. "on" is one rule (both sides accept), and the page line uses it;
 *   4. the page line escapes every name, lists co-hosts before partners, says
 *      "public body", and is empty with no partner on show;
 *   5. every partner word is in every catalog.
 *
 * The routes and the event page are tests/event-partners-route.spec.ts
 * (workers pool).
 *
 * @born-red owner 2026-11-28 | method: three faults one at a time, each
 * restored: the own-brand check taken out (1 red); the public-body rule
 * dropped so kind is kept as sent (1 red); the escaper taken off the name
 * (1 red). | date: 2026-11-28
 */
import { describe, test, expect } from 'vitest';
import {
  NEVER_PARTNER,
  PARTNER_NAME_MAX,
  partnerOnSql,
  renderPartnerLine,
  validatePartnerInvite,
} from '../src/lib/event-partners';
import { CATALOG, type MessageKey } from '../src/lib/i18n/catalog';
import { LANGUAGES } from '../src/lib/i18n/languages';

const OK = { partner_brand_id: 'fernbrook-parks', partner_name: 'Fernbrook Park District' };

describe('an invite', () => {
  test('takes another brand and a group name; kind defaults to partner', () => {
    expect(validatePartnerInvite(OK, 'tansy-galleries')).toEqual({
      ok: true,
      value: {
        partner_brand_id: 'fernbrook-parks',
        partner_name: 'Fernbrook Park District',
        kind: 'partner',
        is_public_body: false,
      },
    });
  });

  test.each([
    ['its own brand', { ...OK, partner_brand_id: 'tansy-galleries' }],
    ...NEVER_PARTNER.map((b) => [`the ${b} brand`, { ...OK, partner_brand_id: b }] as const),
    ['a brand id with spaces', { ...OK, partner_brand_id: 'a b' }],
    ['a brand id with capitals', { ...OK, partner_brand_id: 'Fernbrook' }],
    ['no name', { ...OK, partner_name: '  ' }],
    ['a name too long', { ...OK, partner_name: 'x'.repeat(PARTNER_NAME_MAX + 1) }],
    ['a kind that is not one of two', { ...OK, kind: 'sponsor' }],
    ['a public-body flag that is not a boolean', { ...OK, is_public_body: 'yes' }],
    ['an array', [OK]],
    ['null', null],
  ])('refuses %s', (_name, body) => {
    expect(validatePartnerInvite(body, 'tansy-galleries').ok).toBe(false);
  });

  test('a public body is always a co-host, whatever kind was sent', () => {
    const r = validatePartnerInvite(
      { ...OK, kind: 'partner', is_public_body: true },
      'tansy-galleries'
    );
    expect(r.ok && r.value.kind).toBe('co_host');
    expect(r.ok && r.value.is_public_body).toBe(true);
  });

  test('a co-host that is not a public body stays a co-host', () => {
    const r = validatePartnerInvite({ ...OK, kind: 'co_host' }, 'tansy-galleries');
    expect(r.ok && r.value).toMatchObject({ kind: 'co_host', is_public_body: false });
  });
});

describe('on is one rule', () => {
  test('both sides accept', () => {
    expect(partnerOnSql('x')).toBe('(x.organizer_accepted = 1 AND x.partner_accepted = 1)');
  });
});

describe('the page line', () => {
  test('empty with no partner on show', () => {
    expect(renderPartnerLine([], 't')).toBe('');
  });

  test('co-hosts first, then partners, a public body named as one', () => {
    const html = renderPartnerLine(
      [
        { name: 'Hollyhock Eats', kind: 'partner', is_public_body: false },
        { name: 'Fernbrook Park District', kind: 'co_host', is_public_body: true },
      ],
      'event-partners'
    );
    expect(html).toContain('data-testid="event-partners"');
    expect(html).toContain(
      'Co-hosted with Fernbrook Park District (public body) · With Hollyhock Eats'
    );
  });

  test('escapes every name', () => {
    const html = renderPartnerLine(
      [{ name: '<img src=x onerror=alert(1)>', kind: 'partner', is_public_body: false }],
      't'
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  test('isolates a name in a right-to-left page', () => {
    const html = renderPartnerLine(
      [{ name: 'Fernbrook', kind: 'co_host', is_public_body: false }],
      't',
      'ar'
    );
    expect(html).toContain('<bdi>Fernbrook</bdi>');
  });
});

describe('every partner word is in every language', () => {
  const keys = Object.keys(CATALOG.en).filter((k) => k.startsWith('partners.')) as MessageKey[];

  test('there are partner words', () => {
    expect(keys.length).toBeGreaterThanOrEqual(3);
  });

  test.each(LANGUAGES.map((l) => [l]))('%s has each one, with its slot', (lang) => {
    for (const k of keys) {
      const v = CATALOG[lang][k];
      expect(v, `${lang} ${k}`).toBeTruthy();
      expect(v).toContain(k === 'partners.publicBody' ? '{name}' : '{names}');
    }
  });
});
