/**
 * OSE-1319 R3 — canonical what_url_type vocabulary + drift guard.
 *
 * `WHAT_URL_TYPES` (src/lib/what-url-types.ts) is the ONE allowlist the admin
 * write path validates against. The two READ-path label maps must stay supersets
 * of it, or a type the organizer picks would have no label on one surface:
 *   - WHAT_LINK_LABELS  (public event-page CTA)  — handlers/pages.ts
 *   - POSTER_SLOT_LABELS (poster destination slot) — handlers/poster-bundle.ts
 *
 * The drift guard below is behavioural: it imports the actual maps and fails if
 * either drops a canonical key. Verified red by removing 'donation' from the
 * allowlist (isValid test flips) and by deleting a key from WHAT_LINK_LABELS.
 */
import { describe, test, expect } from 'vitest';
import { WHAT_URL_TYPES, isValidWhatUrlType } from '../src/lib/what-url-types';
import { WHAT_LINK_LABELS } from '../src/handlers/pages';
import { POSTER_SLOT_LABELS } from '../src/handlers/poster-bundle';

describe('WHAT_URL_TYPES allowlist', () => {
  test('isValidWhatUrlType accepts every canonical value', () => {
    for (const t of WHAT_URL_TYPES) {
      expect(isValidWhatUrlType(t)).toBe(true);
    }
  });

  test('isValidWhatUrlType rejects out-of-vocabulary + non-string values', () => {
    for (const bad of ['hacker', 'signup', 'public', '', 'Donation', null, undefined, 7, {}]) {
      expect(isValidWhatUrlType(bad)).toBe(false);
    }
  });

  test('the allowlist has no duplicates', () => {
    expect(new Set(WHAT_URL_TYPES).size).toBe(WHAT_URL_TYPES.length);
  });
});

describe('drift guard — read-path label maps stay supersets of the allowlist', () => {
  test('every WHAT_URL_TYPES key has a public-page CTA label (WHAT_LINK_LABELS)', () => {
    for (const t of WHAT_URL_TYPES) {
      expect(WHAT_LINK_LABELS[t], `WHAT_LINK_LABELS is missing '${t}'`).toBeDefined();
    }
  });

  test('every WHAT_URL_TYPES key has a poster slot label (POSTER_SLOT_LABELS)', () => {
    for (const t of WHAT_URL_TYPES) {
      expect(POSTER_SLOT_LABELS[t], `POSTER_SLOT_LABELS is missing '${t}'`).toBeDefined();
    }
  });
});
