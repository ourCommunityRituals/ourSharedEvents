/**
 * OSE-320 — UEC-aware QR generation endpoint.
 *
 *   GET /api/v2/qr/generate?code=<identifier>
 *
 * Returns the canonical UEC code metadata + a QR data URI for the code's
 * URL path. The endpoint is the customer-facing surface that reads UEC
 * from the brain artifact (consumed copy at `src/lib/uec/uec-codes.ts`)
 * and emits canonical hex / label / semantics — never inline constants.
 *
 * Scope: this story (OSE-320) adds the NEW endpoint and utility module.
 * It does NOT refactor existing QR call sites (that's OSE-321 scope).
 * Existing handlers continue to call `generateQrCode()` directly with
 * their own URLs and inherit the greyscale default.
 *
 * Per OSE-320 AC:
 *   - `?code=` may be either the canonical id ("ENTER") or the label ("Green")
 *   - Case-insensitive, whitespace-tolerant
 *   - Missing / null / empty / non-canonical → HTTP 400 with valid_codes list
 *   - Returns scan_hex + display_hex + label + semantics + url_path
 *
 * Per OCR_STANDARD_perStoryTestPyramid.md: customer-facing HTTP endpoint
 * → all 3 layers required. See tests/qr-generate-endpoint.spec.ts (vitest),
 * postman/collections/ose-api.json (Postman), tests/playwright/qr-generate.spec.ts.
 */

import { generateQrCode } from '../lib/qr';
import { getCode, allCodeIds, allCodeLabels, VERSION } from '../lib/uec';

export async function handleQrGenerate(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const codeParam = url.searchParams.get('code');

  // Missing or empty parameter → 400
  if (codeParam === null || codeParam.trim().length === 0) {
    return Response.json(
      {
        ok: false,
        error: 'MISSING_CODE',
        message:
          'The `code` query parameter is required. Provide a canonical UEC identifier — either an id (e.g., "ENTER") or a label (e.g., "Green").',
        invalid_code: codeParam,
        valid_codes: {
          ids: allCodeIds(),
          labels: allCodeLabels(),
        },
        uec_version: VERSION,
      },
      { status: 400 }
    );
  }

  // Look up via the UEC module (case-insensitive, whitespace-tolerant)
  const code = getCode(codeParam);

  // Non-canonical identifier → 400 with valid_codes
  if (code === null) {
    return Response.json(
      {
        ok: false,
        error: 'INVALID_CODE',
        message: `"${codeParam}" is not a canonical UEC identifier. Use one of the valid ids or labels listed below.`,
        invalid_code: codeParam,
        valid_codes: {
          ids: allCodeIds(),
          labels: allCodeLabels(),
        },
        uec_version: VERSION,
      },
      { status: 400 }
    );
  }

  // Build the URL the QR will encode — request origin + canonical url_path.
  // This makes the QR portable across deployments (staging vs prod) without
  // baking environment-specific hosts into the canonical artifact.
  const encodedUrl = `${url.origin}${code.url_path}`;
  const qrDataUri = generateQrCode(encodedUrl, { errorCorrection: 'H' });

  // Success — canonical metadata + QR
  return Response.json(
    {
      ok: true,
      code: {
        id: code.id,
        num: code.num,
        label: code.label,
        scan_hex: code.scan_hex,
        display_hex: code.display_hex,
        semantics: code.semantics,
        description: code.description,
        url_path: code.url_path,
        phase: code.phase,
        wcag_grade: code.wcag_grade,
      },
      qr: {
        data_uri: qrDataUri,
        encoded_url: encodedUrl,
        error_correction: 'H',
      },
      uec_version: VERSION,
    },
    {
      status: 200,
      headers: {
        // QR generation is deterministic given (code, origin) — safe to cache
        // at the edge. Short TTL so brain changes propagate within an hour.
        'Cache-Control': 'public, max-age=3600',
      },
    }
  );
}
