/**
 * OSE-325 — Proof-of-consumability example test.
 *
 * Demonstrates the fixtures + helpers from `tests/fixtures/uec/` and
 * `tests/helpers/uec/` are actually usable end-to-end. Per OSE-325 AC:
 * "At least one example test in OSE uses the fixtures (proof of
 * consumability)." This file IS that proof.
 *
 * Future SDET stories (OSE-326 contract suite, OSE-327 E2E, OSE-328
 * visual regression, OSE-329 runtime sync) follow the same patterns
 * shown here — they don't need to redeclare fixtures or rewrite the
 * helpers, they just import and parameterize.
 *
 * Per OCR_STANDARD_perStoryTestPyramid these tests carry the API
 * qualifier (SELF.fetch through the worker — same contract layer as
 * Postman/Newman).
 */

import { describe, test } from 'vitest';
import {
  ALL_CODES,
  CORE_CODES,
  EXTENSION_CODES,
  getCanonical,
} from './fixtures/uec/canonical-codes';
import {
  CASE_VARIATIONS,
  WHITESPACE_VARIATIONS,
  MULTI_WORD_LABELS,
} from './fixtures/uec/edge-cases';
import { MISSING_INPUTS, NON_CANONICAL_INPUTS } from './fixtures/uec/invalid-inputs';
import {
  requestCanonicalQR,
  requestQrWithoutCode,
  assertUECMapping,
  assertRefusalResponse,
  assertScanHex,
  loadCanonicalUEC,
} from './helpers/uec';

describe('OSE-325 fixtures + helpers — proof of consumability (happy path)', () => {
  for (const code of CORE_CODES) {
    test(`OSE-325 | API | GET /api/v2/uec/resolve?code=${code.id} (CORE_CODES sweep) | canonical mapping holds`, async () => {
      const res = await requestCanonicalQR(code.id);
      await assertUECMapping(res, code);
    });
  }

  for (const code of EXTENSION_CODES) {
    test(`OSE-325 | API | GET /api/v2/uec/resolve?code=${code.id} (EXTENSION_CODES sweep) | canonical mapping holds`, async () => {
      const res = await requestCanonicalQR(code.id);
      await assertUECMapping(res, code);
    });
  }
});

describe('OSE-325 fixtures + helpers — proof of consumability (edge cases)', () => {
  for (const { input, expectedId, why } of CASE_VARIATIONS) {
    test(`OSE-325 | API | GET /api/v2/uec/resolve?code=${input} (CASE_VARIATIONS — ${why}) | resolves to ${expectedId}`, async () => {
      const res = await requestCanonicalQR(input);
      await assertScanHex(res, getCanonical(expectedId).scan_hex);
    });
  }

  for (const { input, expectedId, why } of WHITESPACE_VARIATIONS) {
    test(`OSE-325 | API | GET /api/v2/uec/resolve?code=<whitespace> (WHITESPACE_VARIATIONS — ${why}) | resolves to ${expectedId}`, async () => {
      const res = await requestCanonicalQR(input);
      await assertScanHex(res, getCanonical(expectedId).scan_hex);
    });
  }

  for (const { input, expectedId, why } of MULTI_WORD_LABELS) {
    test(`OSE-325 | API | GET /api/v2/uec/resolve?code=${input} (MULTI_WORD_LABELS — ${why}) | resolves to ${expectedId}`, async () => {
      const res = await requestCanonicalQR(input);
      await assertScanHex(res, getCanonical(expectedId).scan_hex);
    });
  }
});

describe('OSE-325 fixtures + helpers — proof of consumability (refusal paths)', () => {
  test('OSE-325 | API | GET /api/v2/uec/resolve (no param) | MISSING_CODE', async () => {
    const res = await requestQrWithoutCode();
    await assertRefusalResponse(res, 'MISSING_CODE');
  });

  for (const input of MISSING_INPUTS) {
    test(`OSE-325 | API | GET /api/v2/uec/resolve?code=<whitespace/empty> (MISSING_INPUTS) | MISSING_CODE`, async () => {
      const res = await requestCanonicalQR(input);
      await assertRefusalResponse(res, 'MISSING_CODE', input);
    });
  }

  for (const input of NON_CANONICAL_INPUTS) {
    test(`OSE-325 | API | GET /api/v2/uec/resolve?code=${input} (NON_CANONICAL_INPUTS) | INVALID_CODE`, async () => {
      const res = await requestCanonicalQR(input);
      await assertRefusalResponse(res, 'INVALID_CODE', input);
    });
  }
});

describe('OSE-325 fixtures + helpers — loadCanonicalUEC()', () => {
  test('OSE-325 | UEC.loadCanonicalUEC() | returns 11 codes, version 1.1, 10 verticals', () => {
    const { codes, version, verticals } = loadCanonicalUEC();
    // 11 codes per UEC v1.1 (7 core + 4 extension)
    if (codes.length !== 11) throw new Error(`expected 11 codes, got ${codes.length}`);
    if (version !== '1.1') throw new Error(`expected version 1.1, got ${version}`);
    if (verticals.length !== 10) throw new Error(`expected 10 verticals, got ${verticals.length}`);
  });

  test('OSE-325 | UEC.ALL_CODES | matches loadCanonicalUEC().codes (single source of truth)', () => {
    const { codes } = loadCanonicalUEC();
    if (codes.length !== ALL_CODES.length) {
      throw new Error(`ALL_CODES length (${ALL_CODES.length}) != loader length (${codes.length})`);
    }
  });
});
