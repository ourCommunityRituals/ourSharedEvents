/**
 * OSE-325 — UEC request helpers (vitest layer).
 *
 * Wraps SELF.fetch calls to the /api/v2/uec/resolve endpoint with
 * response-shape typing and origin-aware URL building. Keeps test specs
 * lean — request orchestration in one place; assertions in another.
 *
 * Usage:
 *
 *   const res = await requestCanonicalQR('green');
 *   const body = await res.json() as UecResolveSuccess;
 *   expect(body.code.id).toBe('ENTER');
 *
 *   // Or with a custom origin (e.g., simulating a tenant-specific host):
 *   const res = await requestCanonicalQR('sponsor', { origin: 'https://acme.events' });
 */

import { SELF } from 'cloudflare:test';
import { CURRENT_TENANT, type UecTenantContext } from '../../fixtures/uec/tenant-contexts';

/** Successful /api/v2/uec/resolve response shape. */
export interface UecResolveSuccess {
  ok: true;
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
    wcag_grade: 'AA' | 'AAA';
  };
  qr: {
    data_uri: string;
    encoded_url: string;
    error_correction: string;
  };
  uec_version: string;
}

/** Refusal /api/v2/uec/resolve response shape. */
export interface UecResolveRefusal {
  ok: false;
  error: 'MISSING_CODE' | 'INVALID_CODE';
  message: string;
  invalid_code: string | null;
  valid_codes: {
    ids: ReadonlyArray<string>;
    labels: ReadonlyArray<string>;
  };
  uec_version: string;
}

export interface RequestOptions {
  /** Override the request origin (defaults to CURRENT_TENANT.origin). */
  tenant?: UecTenantContext;
}

/**
 * Request a UEC code resolution via the /api/v2/uec/resolve endpoint.
 * Returns the raw Response; caller parses + asserts.
 *
 * `codeId` is the canonical id or label — case-insensitive and
 * whitespace-tolerant (per OSE-320 contract). Pass any string the
 * endpoint accepts; refusal/success is determined by the response.
 */
export async function requestCanonicalQR(
  codeId: string,
  opts: RequestOptions = {}
): Promise<Response> {
  const tenant = opts.tenant ?? CURRENT_TENANT;
  const url = `${tenant.origin}/api/v2/uec/resolve?code=${encodeURIComponent(codeId)}`;
  return SELF.fetch(url);
}

/**
 * Request the endpoint WITHOUT the code param — used to test the
 * MISSING_CODE refusal path.
 */
export async function requestQrWithoutCode(opts: RequestOptions = {}): Promise<Response> {
  const tenant = opts.tenant ?? CURRENT_TENANT;
  return SELF.fetch(`${tenant.origin}/api/v2/uec/resolve`);
}
