/**
 * V2 Admin Upload File Handler
 *
 * POST /api/v2/admin/events/:id/uploads
 *
 * Accepts file uploads from phone storage (multipart/form-data)
 * and stores them in Cloudflare R2. Returns the public URL
 * for the uploaded file.
 *
 * Supported file types: images (JPEG, PNG, WebP, GIF), videos (MP4, MOV), PDF
 * Max file size: 25MB
 *
 * @module handlers/v2AdminUploadFile
 */

// =============================================================================
// Constants
// =============================================================================

/** Maximum file size in bytes (25MB) */
const MAX_FILE_SIZE = 25 * 1024 * 1024;

/** Allowed MIME types and their extensions */
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'application/pdf': '.pdf',
};

/** Human-readable file type descriptions for error messages */
const ALLOWED_TYPES_FRIENDLY = 'images (JPEG, PNG, WebP, GIF), videos (MP4, MOV), or PDF';

// =============================================================================
// Types
// =============================================================================

/**
 * Environment bindings for file upload handler
 */
export interface V2AdminUploadFileEnv {
  UPLOADS_BUCKET?: R2Bucket;
  WORKER_ENV?: string;
}

/**
 * Upload success response
 */
export interface V2AdminUploadFileResponse {
  ok: true;
  status: 201;
  file: {
    key: string;
    url: string;
    filename: string;
    contentType: string;
    size: number;
  };
  requestId: string;
}

/**
 * Upload error response
 */
export interface V2AdminUploadFileErrorResponse {
  ok: false;
  status: number;
  code: string;
  message: string;
  requestId: string;
}

// =============================================================================
// Response Factories
// =============================================================================

function createSuccessResponse(
  file: V2AdminUploadFileResponse['file'],
  requestId: string
): Response {
  const body: V2AdminUploadFileResponse = {
    ok: true,
    status: 201,
    file,
    requestId,
  };

  return new Response(JSON.stringify(body), {
    status: 201,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Request-Id': requestId,
    },
  });
}

function createErrorResponse(
  code: string,
  message: string,
  status: number,
  requestId: string
): Response {
  const body: V2AdminUploadFileErrorResponse = {
    ok: false,
    status,
    code,
    message,
    requestId,
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Request-Id': requestId,
    },
  });
}

// =============================================================================
// Handler
// =============================================================================

/**
 * Handle POST /api/v2/admin/events/:id/uploads
 *
 * Accepts multipart/form-data with a single file field named "file".
 * Stores the file in R2 under events/{eventId}/{timestamp}-{filename}.
 *
 * @param request - Incoming request with multipart form data
 * @param env - Worker environment with R2 bucket binding
 * @param requestId - Request ID for tracing
 * @param eventId - Event ID from URL path
 * @returns Response with uploaded file metadata or error
 */
export async function handleV2AdminUploadFile(
  request: Request,
  env: V2AdminUploadFileEnv,
  requestId: string,
  eventId: string
): Promise<Response> {
  // Validate HTTP method
  if (request.method !== 'POST') {
    return createErrorResponse(
      'METHOD_NOT_ALLOWED',
      'Only POST method is allowed',
      405,
      requestId
    );
  }

  // Validate event ID format
  if (!eventId || !/^[a-zA-Z0-9_-]+$/.test(eventId)) {
    return createErrorResponse(
      'BAD_EVENT_ID',
      'Invalid event ID. Please select a valid event before uploading.',
      400,
      requestId
    );
  }

  // Validate R2 bucket is configured
  if (!env.UPLOADS_BUCKET) {
    return createErrorResponse(
      'NOT_CONFIGURED',
      'File uploads are not available right now. Please try again later.',
      503,
      requestId
    );
  }

  // Reject requests that declare a Content-Length exceeding the limit (early bail)
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength && parseInt(declaredLength, 10) > MAX_FILE_SIZE * 2) {
    return createErrorResponse(
      'FILE_TOO_LARGE',
      'The upload is too large. Maximum file size is 25MB.',
      413,
      requestId
    );
  }

  // Validate Content-Type is multipart with a boundary
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return createErrorResponse(
      'BAD_CONTENT_TYPE',
      'File must be uploaded as form data. Please use the upload button instead of sending raw data.',
      400,
      requestId
    );
  }
  if (!contentType.includes('boundary=')) {
    return createErrorResponse(
      'BAD_CONTENT_TYPE',
      'The upload request is malformed (missing boundary). Please try again.',
      400,
      requestId
    );
  }

  // Parse form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return createErrorResponse(
      'BAD_FORM_DATA',
      'The file upload was corrupted or incomplete. Please try again.',
      400,
      requestId
    );
  }

  // Get the file from the form
  const fileEntry = formData.get('file');
  if (!fileEntry || typeof fileEntry === 'string') {
    return createErrorResponse(
      'MISSING_FILE',
      'No file was included in the upload. Please select a file and try again.',
      400,
      requestId
    );
  }
  // Cast to File type (Cloudflare Workers FormData returns File for file entries)
  const file = fileEntry as unknown as File;

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    return createErrorResponse(
      'FILE_TOO_LARGE',
      `This file is ${sizeMB}MB, which exceeds the 25MB limit. Try compressing the file or using a lower resolution.`,
      413,
      requestId
    );
  }

  if (file.size === 0) {
    return createErrorResponse(
      'FILE_EMPTY',
      'The selected file is empty (0 bytes). Please choose a different file.',
      400,
      requestId
    );
  }

  // Validate file type
  const mimeType = file.type || 'application/octet-stream';
  if (!ALLOWED_TYPES[mimeType]) {
    return createErrorResponse(
      'UNSUPPORTED_FILE_TYPE',
      `This file type is not supported. Please upload ${ALLOWED_TYPES_FRIENDLY}.`,
      415,
      requestId
    );
  }

  // Build the storage key
  const ext = ALLOWED_TYPES[mimeType];
  const timestamp = Date.now();
  const sanitizedName = file.name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .substring(0, 100);
  const key = `events/${eventId}/${timestamp}-${sanitizedName}${sanitizedName.endsWith(ext) ? '' : ext}`;

  try {
    // Upload to R2
    await env.UPLOADS_BUCKET.put(key, file.stream(), {
      httpMetadata: {
        contentType: mimeType,
      },
      customMetadata: {
        eventId,
        originalName: file.name,
        uploadedAt: new Date().toISOString(),
        requestId,
      },
    });

    // Build the public URL for the uploaded file
    // In production, this would be served via a custom domain or R2 public access
    const url = `/api/v2/uploads/${key}`;

    console.log(JSON.stringify({
      type: 'V2_UPLOAD_FILE_SUCCESS',
      requestId,
      eventId,
      key,
      size: file.size,
      contentType: mimeType,
      timestamp: new Date().toISOString(),
    }));

    return createSuccessResponse(
      {
        key,
        url,
        filename: file.name,
        contentType: mimeType,
        size: file.size,
      },
      requestId
    );
  } catch (error) {
    console.error(JSON.stringify({
      type: 'V2_UPLOAD_FILE_ERROR',
      requestId,
      eventId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    }));

    return createErrorResponse(
      'UPLOAD_FAILED',
      'Something went wrong saving your file. Please try again.',
      500,
      requestId
    );
  }
}

/**
 * Handle GET /api/v2/uploads/events/:eventId/:filename
 *
 * Serves uploaded files from R2.
 *
 * @param request - Incoming request
 * @param env - Worker environment with R2 bucket binding
 * @param requestId - Request ID for tracing
 * @param key - R2 object key
 * @returns Response with file content or 404
 */
export async function handleV2GetUploadedFile(
  request: Request,
  env: V2AdminUploadFileEnv,
  requestId: string,
  key: string
): Promise<Response> {
  if (request.method !== 'GET') {
    return createErrorResponse(
      'METHOD_NOT_ALLOWED',
      'Only GET method is allowed',
      405,
      requestId
    );
  }

  if (!env.UPLOADS_BUCKET) {
    return createErrorResponse(
      'NOT_CONFIGURED',
      'File storage is not configured',
      503,
      requestId
    );
  }

  // Validate key to prevent path traversal
  if (!key || key.includes('..') || !key.startsWith('events/')) {
    return createErrorResponse(
      'BAD_INPUT',
      'Invalid file path.',
      400,
      requestId
    );
  }

  try {
    const object = await env.UPLOADS_BUCKET.get(key);

    if (!object) {
      return createErrorResponse(
        'NOT_FOUND',
        'This file could not be found. It may have been deleted.',
        404,
        requestId
      );
    }

    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('X-Request-Id', requestId);

    return new Response(object.body, { headers });
  } catch (error) {
    console.error(JSON.stringify({
      type: 'V2_GET_UPLOAD_ERROR',
      requestId,
      key,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }));

    return createErrorResponse(
      'RETRIEVAL_FAILED',
      'Something went wrong loading this file. Please try again.',
      500,
      requestId
    );
  }
}
