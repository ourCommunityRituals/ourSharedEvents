/**
 * OSE-325 — UEC assertion helpers.
 *
 * Composable assertion functions that bundle common response-shape +
 * canonical-mapping checks. Each helper does ONE thing and is meant
 * to be combined in test bodies — not a giant "assert everything" call.
 *
 * Usage:
 *
 *   const res = await requestCanonicalQR('green');
 *   await assertUECMapping(res, ENTER);
 *
 *   const bad = await requestCanonicalQR('xyz');
 *   await assertRefusalResponse(bad, 'INVALID_CODE', 'xyz');
 */

import { expect } from 'vitest';
import type { UECCode } from '../../../src/lib/uec';
import type { UecResolveSuccess, UecResolveRefusal } from './request';

/**
 * Assert a /api/v2/uec/resolve response matches the canonical mapping
 * for the given code. Verifies: HTTP 200, JSON content type, ok=true,
 * every UEC code field equals canonical, qr.data_uri is a valid PNG
 * data URI, qr.encoded_url ends with the canonical url_path.
 *
 * Returns the parsed body so the caller can do additional assertions.
 */
export async function assertUECMapping(
  res: Response,
  expectedCode: UECCode
): Promise<UecResolveSuccess> {
  expect(res.status, `expected 200 OK for ${expectedCode.id}`).toBe(200);
  expect(res.headers.get('Content-Type')).toContain('application/json');

  const body = (await res.json()) as UecResolveSuccess;
  expect(body.ok, 'expected ok=true on a successful resolution').toBe(true);

  // Every canonical field must match — drift-resistant per-field check
  expect(body.code.id).toBe(expectedCode.id);
  expect(body.code.num).toBe(expectedCode.num);
  expect(body.code.label).toBe(expectedCode.label);
  expect(body.code.scan_hex).toBe(expectedCode.scan_hex);
  expect(body.code.display_hex).toBe(expectedCode.display_hex);
  expect(body.code.semantics).toBe(expectedCode.semantics);
  expect(body.code.description).toBe(expectedCode.description);
  expect(body.code.url_path).toBe(expectedCode.url_path);
  expect(body.code.phase).toBe(expectedCode.phase);
  expect(body.code.wcag_grade).toBe(expectedCode.wcag_grade);

  // QR data URI shape
  expect(body.qr.data_uri).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
  // encoded_url must end with the canonical url_path
  expect(body.qr.encoded_url).toMatch(new RegExp(`${expectedCode.url_path}$`));
  // QR error correction is always 'H' per the OSE-320 endpoint contract
  expect(body.qr.error_correction).toBe('H');

  // Brand metadata
  expect(body.uec_version).toBe('1.1');

  return body;
}

/**
 * Assert a /api/v2/uec/resolve refusal response matches the expected
 * error shape. Verifies: HTTP 400, ok=false, error code matches,
 * valid_codes list is complete (all 11 ids + labels), message is
 * friendly-voice (no raw stack traces / jargon).
 *
 * @param res            the Response to assert against
 * @param expectedError  the error code to expect (MISSING_CODE | INVALID_CODE)
 * @param invalidCode    optional — the input the test passed (echoed back in body.invalid_code)
 */
export async function assertRefusalResponse(
  res: Response,
  expectedError: 'MISSING_CODE' | 'INVALID_CODE',
  invalidCode?: string | null
): Promise<UecResolveRefusal> {
  expect(res.status, `expected 400 Bad Request for ${expectedError}`).toBe(400);
  expect(res.headers.get('Content-Type')).toContain('application/json');

  const body = (await res.json()) as UecResolveRefusal;
  expect(body.ok).toBe(false);
  expect(body.error).toBe(expectedError);

  // Echo of the offending input (for support tooling)
  if (invalidCode !== undefined) {
    expect(body.invalid_code).toBe(invalidCode);
  }

  // valid_codes list is always complete (all 11)
  expect(body.valid_codes.ids).toHaveLength(11);
  expect(body.valid_codes.labels).toHaveLength(11);
  expect(body.valid_codes.ids).toContain('ENTER');
  expect(body.valid_codes.labels).toContain('Green');

  // Friendly-voice guard (per brand-voice §4.2) — no raw stack traces
  expect(body.message).not.toMatch(/TypeError|undefined|at .+\.ts:\d+/);

  return body;
}

/**
 * Assert a Response's canonical hex appears in the body (without the
 * full mapping check). Useful for narrowly-scoped tests that only care
 * about one field.
 */
export async function assertScanHex(res: Response, expectedScanHex: string): Promise<void> {
  expect(res.status).toBe(200);
  const body = (await res.json()) as UecResolveSuccess;
  expect(body.code.scan_hex).toBe(expectedScanHex);
}
