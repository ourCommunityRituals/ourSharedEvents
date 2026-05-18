/**
 * OSE-320 — UEC resolve endpoint.
 *
 *   GET /api/v2/uec/resolve?code=<identifier>
 *
 * Resolves a canonical UEC code identifier to its full metadata + a
 * rendered QR data URI for the code's URL path. The endpoint is the
 * primary customer-facing surface for UEC consumption — any caller that
 * needs to know "what's the canonical state of this code" comes here.
 *
 * UEC is NOT a QR concept. It's a semantic-category contract for any
 * URL the platform emits: QR codes, shortlinks, email deep links,
 * poster links, sponsor placements. This endpoint serves the QR-render
 * case first (the most common today) but the response shape is
 * deliberately QR-agnostic at the `code` level — callers needing just
 * metadata can ignore the `qr` block. Future stories may add an
 * opt-out (`?no_qr=true`) if QR generation cost becomes a concern.
 *
 * Endpoint naming history: shipped initially as `/api/v2/qr/generate`
 * during the same PR but renamed pre-merge to `/api/v2/uec/resolve`
 * after the founder named the broader UEC principle (the endpoint
 * had been narrowly scoped to the QR use case in error). The handler
 * file was renamed in tandem (qr-generate.ts → uec-resolve.ts).
 *
 * Scope: this story (OSE-320) adds the NEW endpoint + utility module.
 * It does NOT refactor existing QR call sites (that's OSE-321 scope)
 * and does NOT add UEC awareness to shortlinks (that's a separate
 * follow-on story — same principles apply, real schema migration).
 *
 * Per OSE-320 AC:
 *   - `?code=` may be either the canonical id ("ENTER") or the label ("Green")
 *   - Case-insensitive, whitespace-tolerant
 *   - Missing / null / empty / non-canonical → HTTP 400 with valid_codes list
 *   - Returns scan_hex + display_hex + label + semantics + url_path
 *
 * Per OCR_STANDARD_perStoryTestPyramid.md: customer-facing HTTP endpoint
 * → all 3 layers required. See tests/uec-resolve-endpoint.spec.ts
 * (vitest), postman/collections/ose-api.json group "10. UEC Resolve"
 * (Postman), tests/playwright/uec-resolve-endpoint.spec.ts.
 */

import { generateQrCode } from '../lib/qr';
import { getCode, allCodeIds, allCodeLabels, VERSION } from '../lib/uec';

export async function handleUecResolve(request: Request): Promise<Response> {
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
        // Surface the alt-print carve-out (OSE-324 / OSE-332 — added to brain
        // for codes whose scan_hex fundamentally fails WCAG on white, e.g.
        // ALERT yellow). Conditional include — only emit when true so the
        // response shape stays clean for codes without the flag.
        // CCR-4 audit gap #2 (2026-05-18): close consumer-side surface so
        // downstream UI can render alt-print guidance (yellow background +
        // dark modules) when this flag is set.
        ...(code.requires_alt_print ? { requires_alt_print: true } : {}),
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
