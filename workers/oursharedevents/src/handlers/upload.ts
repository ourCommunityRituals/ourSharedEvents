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
 * Ported from Codex worker/src/handlers/v2AdminUploadFile.ts.
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
        error: error instanceof Error ? error.message : String(error),
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

  // Path traversal guard
  if (!key || key.includes('..') || !key.startsWith('events/')) {
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
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      })
    );
    return err('RETRIEVAL_FAILED', 'Something went wrong loading this file.', 500, requestId);
  }
}
