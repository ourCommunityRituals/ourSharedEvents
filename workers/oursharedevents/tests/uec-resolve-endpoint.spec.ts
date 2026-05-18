/**
 * OSE-320 — `GET /api/v2/uec/resolve` endpoint API tests
 *
 * Exercises the HTTP contract of the new UEC resolve endpoint. The
 * endpoint resolves a canonical UEC code identifier to its full metadata
 * + a rendered QR data URI. UEC is the semantic-category contract for
 * any URL the platform emits (QR, shortlinks, deep links) — not a
 * QR-specific concept. This endpoint serves the QR-render case first;
 * future /api/v2/uec/* endpoints will serve shortlink creation and other
 * surfaces.
 *
 * Per OCR_STANDARD_perStoryTestPyramid these tests carry the API qualifier
 * (they call SELF.fetch — same contract as Postman/Newman would).
 *
 * Coverage:
 *   - Happy path: all 11 codes resolvable via ?code=<id>
 *   - Happy path: all 11 codes resolvable via ?code=<label>
 *   - Case-insensitive ?code= values
 *   - Whitespace-tolerant ?code= values
 *   - Response shape: ok, code{...}, qr{data_uri, encoded_url}, uec_version
 *   - QR data URI is well-formed (data:image/png;base64,...)
 *   - encoded_url uses request origin + canonical url_path
 *   - 400 on missing ?code= param
 *   - 400 on empty ?code= param
 *   - 400 on whitespace-only ?code= param
 *   - 400 on non-canonical ?code=xyz
 *   - 400 body lists valid_codes (ids + labels)
 *   - 400 body NEVER leaks internal codes / stack traces
 *   - Cache-Control header present (edge-cacheable; deterministic output)
 */

import { describe, test, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

const BASE = 'https://test.local';

interface SuccessResponse {
  ok: boolean;
  code: {
    id: string;
    num: string;
    label: string;
    scan_hex: string;
    display_hex: string;
    semantics: string;
    description: string;
    url_path: string;
    phase: string;
    wcag_grade: string;
    // Surfaced 2026-05-18 (CCR-4 audit gap closure) — present + true only
    // when the code's scan_hex fails WCAG on white (ALERT yellow).
    requires_alt_print?: true;
  };
  qr: {
    data_uri: string;
    encoded_url: string;
    error_correction: string;
  };
  uec_version: string;
}

interface ErrorResponse {
  ok: false;
  error: string;
  message: string;
  invalid_code: string | null;
  valid_codes: {
    ids: string[];
    labels: string[];
  };
  uec_version: string;
}

describe('OSE-320 GET /api/v2/uec/resolve — canonical happy path (by id)', () => {
  const canonicalCodes = [
    'ENTER',
    'LIVE',
    'SPONSOR',
    'ARCHIVE',
    'HELP',
    'FEEDBACK',
    'UTILITY',
    'ALERT',
    'STAFF',
    'CHECK-IN',
    'SHOP',
  ];

  for (const codeId of canonicalCodes) {
    test(`OSE-320 | API | GET /api/v2/uec/resolve?code=${codeId} (canonical id) | 200 with code metadata + QR`, async () => {
      const res = await SELF.fetch(`${BASE}/api/v2/uec/resolve?code=${encodeURIComponent(codeId)}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('application/json');
      const body = (await res.json()) as SuccessResponse;
      expect(body.ok).toBe(true);
      expect(body.code.id).toBe(codeId);
      expect(body.code.scan_hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(body.code.display_hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(body.qr.data_uri).toMatch(/^data:image\/png;base64,/);
      expect(body.qr.encoded_url).toBe(`${BASE}${body.code.url_path}`);
      expect(body.qr.error_correction).toBe('H');
      expect(body.uec_version).toBe('1.1');
    });
  }
});

describe('OSE-320 GET /api/v2/uec/resolve — canonical happy path (by label)', () => {
  // AC example: ?code=green should resolve. Spot-check several labels.
  const labelTests: Array<[string, string]> = [
    ['green', 'ENTER'],
    ['Coral', 'LIVE'],
    ['BLUE', 'SPONSOR'],
    ['purple', 'ARCHIVE'],
    ['Dark Teal', 'SHOP'],
  ];
  for (const [label, expectedId] of labelTests) {
    test(`OSE-320 | API | GET /api/v2/uec/resolve?code=${label} (label) | resolves to ${expectedId}`, async () => {
      const res = await SELF.fetch(`${BASE}/api/v2/uec/resolve?code=${encodeURIComponent(label)}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as SuccessResponse;
      expect(body.code.id).toBe(expectedId);
    });
  }
});

describe('OSE-320 GET /api/v2/uec/resolve — case insensitivity', () => {
  const variants: Array<[string, string]> = [
    ['enter', 'ENTER'],
    ['Enter', 'ENTER'],
    ['ENTER', 'ENTER'],
    ['EnTeR', 'ENTER'],
    ['GREEN', 'ENTER'],
    ['gReEn', 'ENTER'],
  ];
  for (const [input, expectedId] of variants) {
    test(`OSE-320 | API | GET /api/v2/uec/resolve?code=${input} (case variant) | resolves to ${expectedId}`, async () => {
      const res = await SELF.fetch(`${BASE}/api/v2/uec/resolve?code=${encodeURIComponent(input)}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as SuccessResponse;
      expect(body.code.id).toBe(expectedId);
    });
  }
});

describe('OSE-320 GET /api/v2/uec/resolve — whitespace tolerance', () => {
  test('OSE-320 | API | GET /api/v2/uec/resolve?code=%20green%20 (padded space) | trims and resolves', async () => {
    const res = await SELF.fetch(
      `${BASE}/api/v2/uec/resolve?code=${encodeURIComponent(' green ')}`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as SuccessResponse;
    expect(body.code.id).toBe('ENTER');
  });

  test('OSE-320 | API | GET /api/v2/uec/resolve?code=%20%20SPONSOR%20%20 (double-padded) | trims and resolves', async () => {
    const res = await SELF.fetch(
      `${BASE}/api/v2/uec/resolve?code=${encodeURIComponent('  SPONSOR  ')}`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as SuccessResponse;
    expect(body.code.id).toBe('SPONSOR');
  });
});

describe('OSE-320 GET /api/v2/uec/resolve — encoded_url uses request origin', () => {
  test('OSE-320 | API | GET /api/v2/uec/resolve?code=green (test.local origin) | encoded_url = test.local/enter', async () => {
    const res = await SELF.fetch(`${BASE}/api/v2/uec/resolve?code=green`);
    const body = (await res.json()) as SuccessResponse;
    expect(body.qr.encoded_url).toBe('https://test.local/enter');
  });

  test('OSE-320 | API | GET /api/v2/uec/resolve?code=sponsor (custom origin) | encoded_url uses request origin', async () => {
    const customOrigin = 'https://stg.oursharedevents.com';
    const res = await SELF.fetch(`${customOrigin}/api/v2/uec/resolve?code=sponsor`);
    const body = (await res.json()) as SuccessResponse;
    expect(body.qr.encoded_url).toBe(`${customOrigin}/sponsor`);
  });
});

describe('OSE-320 GET /api/v2/uec/resolve — refusal paths (HTTP 400)', () => {
  test('OSE-320 | API | GET /api/v2/uec/resolve (no code param) | 400 MISSING_CODE', async () => {
    const res = await SELF.fetch(`${BASE}/api/v2/uec/resolve`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorResponse;
    expect(body.ok).toBe(false);
    expect(body.error).toBe('MISSING_CODE');
    expect(body.valid_codes.ids).toContain('ENTER');
    expect(body.valid_codes.labels).toContain('Green');
  });

  test('OSE-320 | API | GET /api/v2/uec/resolve?code= (empty value) | 400 MISSING_CODE', async () => {
    const res = await SELF.fetch(`${BASE}/api/v2/uec/resolve?code=`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error).toBe('MISSING_CODE');
  });

  test('OSE-320 | API | GET /api/v2/uec/resolve?code=%20%20 (whitespace-only) | 400 MISSING_CODE', async () => {
    const res = await SELF.fetch(`${BASE}/api/v2/uec/resolve?code=${encodeURIComponent('   ')}`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error).toBe('MISSING_CODE');
  });

  test('OSE-320 | API | GET /api/v2/uec/resolve?code=xyz (non-canonical) | 400 INVALID_CODE with valid_codes list', async () => {
    const res = await SELF.fetch(`${BASE}/api/v2/uec/resolve?code=xyz`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorResponse;
    expect(body.ok).toBe(false);
    expect(body.error).toBe('INVALID_CODE');
    expect(body.invalid_code).toBe('xyz');
    // valid_codes lists must be present and complete
    expect(body.valid_codes.ids).toHaveLength(11);
    expect(body.valid_codes.labels).toHaveLength(11);
    expect(body.valid_codes.ids).toEqual([
      'ENTER',
      'LIVE',
      'SPONSOR',
      'ARCHIVE',
      'HELP',
      'FEEDBACK',
      'UTILITY',
      'ALERT',
      'STAFF',
      'CHECK-IN',
      'SHOP',
    ]);
  });

  test('OSE-320 | API | GET /api/v2/uec/resolve?code=VIOLET (valid-shape but unknown color) | 400 INVALID_CODE', async () => {
    const res = await SELF.fetch(`${BASE}/api/v2/uec/resolve?code=VIOLET`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error).toBe('INVALID_CODE');
  });

  test('OSE-320 | API | GET /api/v2/uec/resolve?code=xyz | error body uses friendly voice (per brand-voice §4.2)', async () => {
    const res = await SELF.fetch(`${BASE}/api/v2/uec/resolve?code=xyz`);
    const body = (await res.json()) as ErrorResponse;
    // No raw stack traces, no internal jargon leaking
    expect(body.message).not.toMatch(/at .* \(.+\.ts:\d+/);
    expect(body.message).not.toMatch(/undefined|null|TypeError|SyntaxError/);
    // Must mention what to use instead
    expect(body.message).toMatch(/canonical|valid|use one of/i);
  });
});

describe('OSE-320 GET /api/v2/uec/resolve — requires_alt_print surface (CCR-4 gap closure 2026-05-18)', () => {
  test('OSE-320 | API | GET /api/v2/uec/resolve?code=ALERT | response.code.requires_alt_print === true', async () => {
    // ALERT yellow (#B8960A) computes 2.84:1 on white — fundamentally below
    // WCAG AA. The brain documents this carve-out via requires_alt_print=true
    // (OSE-324). This test confirms the flag flows through the OSE-side
    // consumed copy AND the endpoint response shape so downstream UI can
    // render alt-print guidance (yellow background + dark modules) without
    // having to introspect the typed module separately.
    const res = await SELF.fetch(`${BASE}/api/v2/uec/resolve?code=ALERT`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SuccessResponse;
    expect(body.code.id).toBe('ALERT');
    expect(body.code.requires_alt_print).toBe(true);
  });

  test('OSE-320 | API | GET /api/v2/uec/resolve?code=ENTER | response.code OMITS requires_alt_print (only ALERT has it)', async () => {
    // Negative guard — for every code that does NOT carry the carve-out
    // flag, the response must NOT include the field (clean shape, no
    // false-positive consumer confusion).
    const res = await SELF.fetch(`${BASE}/api/v2/uec/resolve?code=ENTER`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SuccessResponse;
    expect(body.code.id).toBe('ENTER');
    expect(body.code.requires_alt_print).toBeUndefined();
  });
});

describe('OSE-320 GET /api/v2/uec/resolve — caching + headers', () => {
  test('OSE-320 | API | GET /api/v2/uec/resolve?code=green | Cache-Control set (edge-cacheable)', async () => {
    const res = await SELF.fetch(`${BASE}/api/v2/uec/resolve?code=green`);
    expect(res.status).toBe(200);
    const cc = res.headers.get('Cache-Control');
    expect(cc).toBeTruthy();
    expect(cc).toMatch(/max-age=\d+/);
  });

  test("OSE-320 | API | GET /api/v2/uec/resolve?code=xyz | 400 does NOT carry long Cache-Control (don't cache errors)", async () => {
    const res = await SELF.fetch(`${BASE}/api/v2/uec/resolve?code=xyz`);
    expect(res.status).toBe(400);
    const cc = res.headers.get('Cache-Control');
    // Error responses should NOT carry the aggressive 1-hour cache
    if (cc) {
      expect(cc).not.toMatch(/max-age=3600/);
    }
  });
});
