/**
 * OSE-1198 — the Local sponsor price is a three-way split, recorded in the
 * authoritative pricing plan. Guards the DECISION against a stray revert of
 * "Local $0 forever / paid conversion ≈ 0 by design" and keeps the mechanism
 * doc pointing at it.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const plan = readFileSync(join(ROOT, 'docs', 'positioning', 'PRICING-PLAN.md'), 'utf8');
const mech = readFileSync(join(ROOT, 'docs', 'features', 'SPONSOR-PRICING.md'), 'utf8');

describe('OSE-1198 | PRICING-PLAN.md carries the three-way Local split', () => {
  test('three Local rows: community use, established business, first-year business', () => {
    expect(plan).toMatch(/\|\s*\*\*Local · community use\*\*/);
    expect(plan).toMatch(/\|\s*\*\*Local · established business\*\*/);
    expect(plan).toMatch(/\|\s*\*\*Local · first-year business\*\*/);
  });

  test('community use is $0 forever; business rows are priced, with the flat fee still marked [HYP]', () => {
    const community = plan.match(/\*\*Local · community use\*\*[^\n]*/)?.[0] ?? '';
    expect(community).toMatch(/\$0 forever/);
    const business = plan.match(/\*\*Local · established business\*\*[^\n]*/)?.[0] ?? '';
    expect(business).toMatch(/flat fee/i);
    expect(business).toMatch(/\[HYP/);
    const firstYear = plan.match(/\*\*Local · first-year business\*\*[^\n]*/)?.[0] ?? '';
    expect(firstYear).toMatch(/first placement free/i);
    expect(firstYear).toMatch(/license_issued_month/);
  });

  test('the retired line is gone and revenue names local business sponsors', () => {
    expect(plan).not.toMatch(/paid conversion ≈ 0 by design/);
    expect(plan).toMatch(
      /Revenue = event managers \+ \*\*non-local\*\* sponsors \+ \*\*local business\*\* sponsors/
    );
  });

  test('§B states the Local-business 3-month-clock position and defers discount grammar', () => {
    expect(plan).toMatch(/### Local business sponsors — NOT on the 3-month clock/);
    expect(plan).toMatch(/discount grammar/i);
  });

  test('SPONSOR-PRICING.md points at the decision instead of an illustrative Local price', () => {
    expect(mech).not.toMatch(/Local \(\$75 illustrative\)/);
    expect(mech).toMatch(/OSE-1198/);
  });
});
