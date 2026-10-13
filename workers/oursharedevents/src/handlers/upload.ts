/**
 * R2 file upload handler (OSE-200 / BE-13)
 *
 *   POST /api/v2/admin/events/:id/uploads   — upload a file to R2
 *   GET  /api/v2/uploads/*key               — serve a file from R2
 *
 * Supported types: images (JPEG, PNG, WebP, GIF), videos (MP4, MOV), PDF
 * Max size: 25 MB
 *
 * Security:
 *   - MIME type validated against allowlist
 *   - Filename sanitised: [^a-zA-Z0-9._-] → '_', max 100 chars
 *   - Path traversal guard: key must start with 'events/' and not contain '..'
 *   - Early bail on oversized Content-Length header
 *
 * Key schema: events/{eventId}/{timestamp}-{sanitisedName}[.ext]
 * GET URL:    /api/v2/uploads/events/{eventId}/{filename}
 *
 * Ported from prior worker implementation.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'application/pdf': '.pdf',
};

const ALLOWED_TYPES_FRIENDLY = 'images (JPEG, PNG, WebP, GIF), videos (MP4, MOV), or PDF';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UploadEnv {
  UPLOADS_BUCKET?: R2Bucket;
}

// ── Response factories ────────────────────────────────────────────────────────

function rid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;
}

function ok201(
  file: { key: string; url: string; filename: string; contentType: string; size: number },
  requestId: string
): Response {
  return new Response(JSON.stringify({ ok: true, status: 201, file, requestId }), {
    status: 201,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Request-Id': requestId,
    },
  });
}

function err(code: string, message: string, status: number, requestId: string): Response {
  return new Response(JSON.stringify({ ok: false, status, code, message, requestId }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Request-Id': requestId,
    },
  });
}

// ── Upload handler ────────────────────────────────────────────────────────────

/**
 * POST /api/v2/admin/events/:id/uploads
 *
 * Accepts multipart/form-data with a file field named "file".
 * Returns 201 with the R2 key and a serve URL on success.
 */
export async function handleAdminUploadFile(
  request: Request,
  env: UploadEnv,
  eventId: string
): Promise<Response> {
  const requestId = rid();

  // Validate event ID
  if (!eventId || !/^[a-zA-Z0-9_-]+$/.test(eventId)) {
    return err('BAD_EVENT_ID', 'Invalid event ID format.', 400, requestId);
  }

  // R2 binding check
  if (!env.UPLOADS_BUCKET) {
    return err('NOT_CONFIGURED', 'File uploads are not available right now.', 503, requestId);
  }

  // Early size bail via Content-Length header
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength && parseInt(declaredLength, 10) > MAX_FILE_SIZE * 2) {
    return err('FILE_TOO_LARGE', 'The upload exceeds the 25 MB limit.', 413, requestId);
  }

  // Content-Type must be multipart/form-data with a boundary
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return err('BAD_CONTENT_TYPE', 'File must be uploaded as form data.', 400, requestId);
  }
  if (!contentType.includes('boundary=')) {
    return err(
      'BAD_CONTENT_TYPE',
      'Upload request is malformed (missing boundary).',
      400,
      requestId
    );
  }

  // Parse form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return err('BAD_FORM_DATA', 'File upload was corrupted or incomplete.', 400, requestId);
  }

  // Extract file field
  const fileEntry = formData.get('file');
  if (!fileEntry || typeof fileEntry === 'string') {
    return err('MISSING_FILE', 'No file was included in the upload.', 400, requestId);
  }
  const file = fileEntry as unknown as File;

  // Size validation
  if (file.size === 0) {
    return err('FILE_EMPTY', 'The selected file is empty (0 bytes).', 400, requestId);
  }
  if (file.size > MAX_FILE_SIZE) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return err('FILE_TOO_LARGE', `File is ${mb} MB — exceeds the 25 MB limit.`, 413, requestId);
  }

  // MIME type validation
  const mimeType = file.type || 'application/octet-stream';
  if (!ALLOWED_TYPES[mimeType]) {
    return err(
      'UNSUPPORTED_FILE_TYPE',
      `File type not supported. Upload ${ALLOWED_TYPES_FRIENDLY}.`,
      415,
      requestId
    );
  }

  // Build R2 key — sanitise filename, guard against path traversal
  const ext = ALLOWED_TYPES[mimeType];
  const timestamp = Date.now();
  const sanitisedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100);
  const key = `events/${eventId}/${timestamp}-${sanitisedName}${sanitisedName.endsWith(ext) ? '' : ext}`;

  try {
    await env.UPLOADS_BUCKET.put(key, file.stream(), {
      httpMetadata: { contentType: mimeType },
      customMetadata: {
        eventId,
        originalName: file.name,
        uploadedAt: new Date().toISOString(),
        requestId,
      },
    });

    const url = `/api/v2/uploads/${key}`;
    return ok201(
      { key, url, filename: file.name, contentType: mimeType, size: file.size },
      requestId
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        type: 'R2_UPLOAD_ERROR',
        requestId,
        eventId,
        error: errorLabel(error),
        timestamp: new Date().toISOString(),
      })
    );
    return err(
      'UPLOAD_FAILED',
      'Something went wrong saving your file. Please try again.',
      500,
      requestId
    );
  }
}

// ── Serve handler ─────────────────────────────────────────────────────────────

/**
 * GET /api/v2/uploads/*key
 *
 * Serves uploaded files from R2.
 * Path traversal guard: key must start with 'events/' and must not contain '..'.
 */
export async function handleGetUploadedFile(
  _request: Request,
  env: UploadEnv,
  key: string
): Promise<Response> {
  const requestId = rid();

  if (!env.UPLOADS_BUCKET) {
    return err('NOT_CONFIGURED', 'File storage is not configured.', 503, requestId);
  }

  // Path traversal guard. OSE-733 extends the allowed prefixes to include
  // `sponsors/` (sponsor onboarding assets) — the `..` traversal check is
  // SHARED across BOTH prefixes so widening the allowlist never widens traversal.
  if (!key || key.includes('..') || (!key.startsWith('events/') && !key.startsWith('sponsors/'))) {
    return err('BAD_INPUT', 'Invalid file path.', 400, requestId);
  }

  try {
    const object = await env.UPLOADS_BUCKET.get(key);

    if (!object) {
      return err(
        'NOT_FOUND',
        'File could not be found — it may have been deleted.',
        404,
        requestId
      );
    }

    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType ?? 'application/octet-stream');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('X-Request-Id', requestId);

    return new Response(object.body, { headers });
  } catch (error) {
    console.error(
      JSON.stringify({
        type: 'R2_GET_ERROR',
        requestId,
        key,
        error: errorLabel(error),
        timestamp: new Date().toISOString(),
      })
    );
    return err('RETRIEVAL_FAILED', 'Something went wrong loading this file.', 500, requestId);
  }
}

// ── Sponsor onboarding asset upload (OSE-733 / T6) ─────────────────────────────

import { ASSET_FORMATS, isAssetFormat, type AssetFormat } from '../lib/sponsor-asset';
import { verifySponsorInviteToken, type SponsorInviteEnv } from '../lib/sponsor-invite';
import { errorLabel } from '../lib/error-label';

export type SponsorAssetUploadEnv = UploadEnv & SponsorInviteEnv & { DB: D1Database };

// Raster-only crop sources. SVG (script/animation vector) and GIF (animation)
// are DELIBERATELY excluded — a focal/crop source must be a static raster.
const SPONSOR_ASSET_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

function bearerToken(request: Request): string | null {
  const m = (request.headers.get('Authorization') ?? '').match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * Magic-byte sniff — confirms the bytes actually match the declared raster MIME
 * and, crucially, rejects an SVG or GIF disguised under an allowed content-type
 * (defense against content-type spoofing of the crop source).
 */
function rasterSignatureOk(mime: string, head: Uint8Array): boolean {
  // Reject obvious SVG ('<') / GIF ('GIF8') regardless of declared type.
  if (head[0] === 0x3c) return false; // '<' → XML/SVG
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38) return false; // GIF8
  if (mime === 'image/jpeg') return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (mime === 'image/png') {
    return head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  }
  if (mime === 'image/webp') {
    return (
      head[0] === 0x52 &&
      head[1] === 0x49 &&
      head[2] === 0x46 &&
      head[3] === 0x46 && // RIFF
      head[8] === 0x57 &&
      head[9] === 0x45 &&
      head[10] === 0x42 &&
      head[11] === 0x50 // WEBP
    );
  }
  return false;
}

/**
 * POST /api/v2/sponsors/draft/:draftToken/asset/:format
 *
 * Uploads one per-format creative for a sponsor onboarding draft. Authorized by
 * the invite token (NOT admin bearer); the draft must belong to the token's
 * brand (cross-tenant write blocked). Stores under R2 key
 * `sponsors/{draftToken}/{format}` and UPSERTs sponsor_asset_draft. 503 when
 * UPLOADS_BUCKET is unbound.
 */
export async function handleSponsorAssetUpload(
  request: Request,
  env: SponsorAssetUploadEnv,
  draftToken: string,
  format: string
): Promise<Response> {
  const requestId = rid();

  // 1. Invite-token auth → brand scope from the signed claim.
  const claim = await verifySponsorInviteToken(env, bearerToken(request));
  if (!claim) return err('UNAUTHORIZED', 'Valid sponsor invite token required.', 401, requestId);

  // 2. Format must be one of the four frozen values (shared constant).
  if (!isAssetFormat(format)) {
    return err('BAD_FORMAT', `format must be one of ${ASSET_FORMATS.join(', ')}.`, 400, requestId);
  }
  const fmt: AssetFormat = format;

  // 3. R2 binding (optional) — graceful 503 when unbound.
  if (!env.UPLOADS_BUCKET) {
    return err('NOT_CONFIGURED', 'Uploads are not available right now.', 503, requestId);
  }

  // 4. The draft must exist AND belong to the token's brand (cross-tenant guard).
  if (!/^[a-zA-Z0-9_-]+$/.test(draftToken)) {
    return err('BAD_DRAFT_TOKEN', 'Invalid draft token.', 400, requestId);
  }
  const draft = await env.DB.prepare(
    'SELECT brand_id, status FROM sponsor_business_draft WHERE draft_token = ?'
  )
    .bind(draftToken)
    .first<{ brand_id: string; status: string }>();
  if (!draft) return err('NOT_FOUND', 'Draft not found.', 404, requestId);
  if (draft.brand_id !== claim.brand_id) {
    return err('FORBIDDEN', 'Draft belongs to another brand.', 403, requestId);
  }

  // 5. Multipart parse + size/MIME/raster validation.
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('multipart/form-data') || !contentType.includes('boundary=')) {
    return err('BAD_CONTENT_TYPE', 'File must be uploaded as form data.', 400, requestId);
  }
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return err('BAD_FORM_DATA', 'File upload was corrupted or incomplete.', 400, requestId);
  }
  const fileEntry = formData.get('file');
  if (!fileEntry || typeof fileEntry === 'string') {
    return err('MISSING_FILE', 'No file was included in the upload.', 400, requestId);
  }
  const file = fileEntry as unknown as File;

  if (file.size === 0) return err('FILE_EMPTY', 'The selected file is empty.', 400, requestId);
  if (file.size > MAX_FILE_SIZE) {
    return err('FILE_TOO_LARGE', 'File exceeds the 25 MB limit.', 413, requestId);
  }
  const mimeType = file.type || 'application/octet-stream';
  if (!SPONSOR_ASSET_TYPES[mimeType]) {
    return err(
      'UNSUPPORTED_FILE_TYPE',
      'Sponsor assets must be a static raster image (JPEG, PNG, or WebP). SVG and GIF are not allowed.',
      415,
      requestId
    );
  }
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!rasterSignatureOk(mimeType, head)) {
    return err(
      'BAD_IMAGE',
      'File content does not match a static raster image (possible SVG/GIF or spoofed type).',
      415,
      requestId
    );
  }

  // 6. Store under the sponsors/ namespace and UPSERT the asset draft.
  const key = `sponsors/${draftToken}/${fmt}`;
  try {
    await env.UPLOADS_BUCKET.put(key, file.stream(), {
      httpMetadata: { contentType: mimeType },
      customMetadata: { draftToken, format: fmt, uploadedAt: new Date().toISOString(), requestId },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        type: 'R2_SPONSOR_ASSET_UPLOAD_ERROR',
        requestId, // correlates with the request; the draft token is a credential and is not logged
        format: fmt,
        error: errorLabel(error),
      })
    );
    return err('UPLOAD_FAILED', 'Something went wrong saving your file.', 500, requestId);
  }

  const url = `/api/v2/uploads/${key}`;
  const focalX = readNum(formData.get('focal_x'));
  const focalY = readNum(formData.get('focal_y'));
  const cropRect = readStr(formData.get('crop_rect'));
  await env.DB.prepare(
    `INSERT INTO sponsor_asset_draft (id, draft_token, format, url, content_type, focal_x, focal_y, crop_rect, validated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(draft_token, format) DO UPDATE SET
       url = excluded.url,
       content_type = excluded.content_type,
       focal_x = excluded.focal_x,
       focal_y = excluded.focal_y,
       crop_rect = excluded.crop_rect,
       validated_at = datetime('now')`
  )
    .bind(crypto.randomUUID(), draftToken, fmt, url, mimeType, focalX, focalY, cropRect)
    .run();

  return ok201(
    { key, url, filename: file.name, contentType: mimeType, size: file.size },
    requestId
  );
}

function readNum(v: File | string | null): number | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function readStr(v: File | string | null): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
