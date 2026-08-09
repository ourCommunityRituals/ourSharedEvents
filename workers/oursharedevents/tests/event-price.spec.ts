/**
 * OSE-655 "HOW MUCH" — event price formatter (display only, #6-safe).
 */

import { describe, it, expect } from 'vitest';
import { formatEventPrice, resolvePriceModel } from '../src/lib/event-price';

const p = (
  price_cents: number | null,
  price_model: string | null = null,
  price_note: string | null = null
) => ({ price_cents, price_model, price_note });

describe('OSE-655 | formatEventPrice', () => {
  it('free — explicit model or 0 cents (0 = free)', () => {
    expect(formatEventPrice(p(0))).toBe('Free');
    expect(formatEventPrice(p(null, 'free'))).toBe('Free');
    expect(formatEventPrice(p(0, 'fixed'))).toBe('Free'); // fixed-price-0 is free
  });

  it('fixed — cents formatted compactly', () => {
    expect(formatEventPrice(p(1000))).toBe('$10');
    expect(formatEventPrice(p(1050))).toBe('$10.50');
    expect(formatEventPrice(p(500, 'fixed'))).toBe('$5');
    expect(formatEventPrice(p(1299))).toBe('$12.99');
  });

  it('sliding / donation / varies — with optional note', () => {
    expect(formatEventPrice(p(null, 'sliding', '$5-15 suggested'))).toBe('Sliding scale ($5-15 suggested)');
    expect(formatEventPrice(p(null, 'sliding'))).toBe('Sliding scale');
    expect(formatEventPrice(p(null, 'donation'))).toBe('Pay what you can');
    expect(formatEventPrice(p(null, 'varies', 'by session'))).toBe('Varies (by session)');
  });

  it('0 = free even with a note', () => {
    expect(formatEventPrice(p(0, 'free', 'donations welcome'))).toBe('Free (donations welcome)');
  });

  it('unset → null (renders no card)', () => {
    expect(formatEventPrice(p(null))).toBeNull();
    expect(formatEventPrice(p(null, 'not-a-model'))).toBeNull();
  });

  it('fixed with no amount → null (malformed, no card)', () => {
    expect(formatEventPrice(p(null, 'fixed'))).toBeNull();
  });

  it('resolvePriceModel infers from cents when model absent', () => {
    expect(resolvePriceModel(p(0))).toBe('free');
    expect(resolvePriceModel(p(1200))).toBe('fixed');
    expect(resolvePriceModel(p(null))).toBeNull();
    expect(resolvePriceModel(p(null, 'donation'))).toBe('donation');
  });
});
