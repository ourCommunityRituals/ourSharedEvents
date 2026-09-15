import { describe, it, expect } from 'vitest';
import { componentStyles } from '../src/styles';

// OSE-1326 — the uniform management-card anatomy. Opt-in (.card--sectioned) so
// existing .card (padding:14px) consumers are untouched. Born-red: none of these
// selectors existed in componentStyles before this story.
describe('componentStyles — uniform Card anatomy (OSE-1326)', () => {
  const CARD_ANATOMY = [
    '.card--sectioned',
    '.card-header',
    '.card-title',
    '.card-action',
    '.card-body',
    '.card--collapsed .card-body',
    '.card--locked',
  ];

  for (const sel of CARD_ANATOMY) {
    it(`defines ${sel}`, () => {
      expect(componentStyles).toContain(sel);
    });
  }

  it('sectioned card zeroes its own padding (header/body pad instead)', () => {
    expect(componentStyles).toMatch(/\.card--sectioned\{padding:0\}/);
  });

  it('card header meets the >=56px height (touch-target floor)', () => {
    expect(componentStyles).toMatch(/\.card-header\{[^}]*min-height:56px/);
  });

  it('the base .card is unchanged — still padding:14px (no regression for existing cards)', () => {
    expect(componentStyles).toMatch(/\.card\{[^}]*padding:14px\}/);
  });
});
