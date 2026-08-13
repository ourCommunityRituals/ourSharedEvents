/**
 * OSE-743 (P0) — Payment-links ops guard.
 *
 * P0 takes sponsor money OUT OF BAND (Stripe Payment Links + Wave), zero code on
 * the money path. This spec is the structural fence around the two committed
 * ops artifacts (the frozen contract + the operator manifest) so the manual flow
 * cannot drift away from the invariants the automated flow (P1/P2) will enforce:
 *
 *   G1 — coverage: exactly one manifest record per purchasable frequency tier.
 *   G2 — #25 (TL-059): no NON-purchasable dimension (price/size/slot/tier/…) can
 *        be sold — none may appear as a manifest key; only rotation frequency is
 *        purchasable, so a free/community-benefit sponsor is never billed.
 *   G3 — #9: every record binds a payment to a brand via the frozen brand_id key.
 *   G4 — #8 (TL-060): the committed manifest carries no PII and no secret; the
 *        link reference is a last-6 fragment, never a full URL/token.
 *
 * These run under the default (production) posture — no env, no DB, pure data.
 */

import { describe, test, expect } from 'vitest';
import {
  BRAND_ID_METADATA_KEY,
  PURCHASABLE_DIMENSION,
  FREQUENCY_TIERS,
  FORBIDDEN_PURCHASE_DIMENSIONS,
  PII_KEY_PATTERNS,
} from '../fixtures/payment-contract';
import { PAYMENT_LINKS_MANIFEST, type PaymentLinkRecord } from '../fixtures/payment-links-manifest';

const recordKeys = (r: PaymentLinkRecord): string[] => Object.keys(r);

describe('OSE-743 G1 — manifest covers exactly the purchasable frequency tiers', () => {
  test('one record per frequency tier, no duplicates, no extras', () => {
    const seen = PAYMENT_LINKS_MANIFEST.map((r) => r.frequency).sort();
    const expected = [...FREQUENCY_TIERS].sort();
    expect(seen).toEqual(expected);
  });

  test('the only purchasable dimension is rotation frequency', () => {
    // A structural pin: if someone tries to sell anything other than frequency,
    // this contract constant (and G2) is where it breaks.
    expect(PURCHASABLE_DIMENSION).toBe('rotation_frequency');
  });
});

describe('OSE-743 G2 — #25: non-purchasable dimensions cannot be sold', () => {
  // @born-red TL-059 | method: design-time-negative-assertion | date: 2026-08-13
  test('no manifest key names a non-purchasable dimension (price/size/slot/tier/…)', () => {
    const forbidden = new Set<string>(FORBIDDEN_PURCHASE_DIMENSIONS.map((d) => d.toLowerCase()));
    const violations: string[] = [];
    for (const rec of PAYMENT_LINKS_MANIFEST) {
      for (const key of recordKeys(rec)) {
        if (forbidden.has(key.toLowerCase())) {
          violations.push(`${rec.frequency}: key "${key}" is a non-purchasable dimension (#25)`);
        }
      }
    }
    expect(
      violations,
      `Payment manifest sells a non-purchasable dimension — #25 wall breach:\n${violations.join('\n')}`
    ).toHaveLength(0);
  });

  test('every record frequency is a member of the purchasable set (no smuggled tier)', () => {
    const allowed = new Set<string>(FREQUENCY_TIERS);
    for (const rec of PAYMENT_LINKS_MANIFEST) {
      expect(allowed.has(rec.frequency), `unknown frequency tier "${rec.frequency}"`).toBe(true);
    }
  });
});

describe('OSE-743 G3 — #9: payments bind to a brand via the frozen key', () => {
  test('every record uses the frozen brand_id binding key (byte-equal)', () => {
    for (const rec of PAYMENT_LINKS_MANIFEST) {
      expect(rec.brand_binding_key).toBe(BRAND_ID_METADATA_KEY);
      expect(BRAND_ID_METADATA_KEY).toBe('brand_id');
    }
  });
});

describe('OSE-743 G4 — #8: the committed manifest carries no PII or secret', () => {
  // @born-red TL-060 | method: design-time-negative-assertion | date: 2026-08-13
  test('no manifest key matches a PII/secret pattern', () => {
    const violations: string[] = [];
    for (const rec of PAYMENT_LINKS_MANIFEST) {
      for (const key of recordKeys(rec)) {
        for (const pattern of PII_KEY_PATTERNS) {
          if (pattern.test(key)) {
            violations.push(
              `${rec.frequency}: key "${key}" matches PII/secret pattern ${pattern.source}`
            );
          }
        }
      }
    }
    expect(
      violations,
      `Payment manifest carries a PII/secret key — bounded-PII (#8) breach:\n${violations.join('\n')}`
    ).toHaveLength(0);
  });

  // @born-red TL-060 | method: design-time-negative-assertion | date: 2026-08-13
  test('link reference is a last-6 fragment, never a full URL or long token', () => {
    for (const rec of PAYMENT_LINKS_MANIFEST) {
      if (rec.link_ref_last6 === null) continue; // placeholder — operator not yet filled it
      expect(
        rec.link_ref_last6.length,
        `${rec.frequency}: link_ref_last6 too long`
      ).toBeLessThanOrEqual(6);
      expect(rec.link_ref_last6, `${rec.frequency}: link_ref_last6 looks like a URL`).not.toMatch(
        /https?:|\//i
      );
    }
  });

  test('no note field leaks an email/phone value', () => {
    const valuePii = /@|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/;
    for (const rec of PAYMENT_LINKS_MANIFEST) {
      if (!rec.note) continue;
      expect(valuePii.test(rec.note), `${rec.frequency}: note leaks contact PII`).toBe(false);
    }
  });
});
