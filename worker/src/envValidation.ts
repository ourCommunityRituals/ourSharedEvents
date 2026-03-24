/**
 * Environment Validation Utilities
 *
 * Provides type-safe validation for environment variables.
 * Validates that required env vars are set and provides type narrowing
 * so TypeScript knows the properties are defined after validation.
 *
 * @module envValidation
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Base environment interface that matches RouterEnv optional properties.
 * This avoids circular imports with router.ts.
 */
interface BaseEnv {
  WORKER_ENV?: string;
  WORKER_BUILD_VERSION?: string;
  DEBUG_LEVEL?: string;
  SHEETS_SPREADSHEET_ID?: string;
  GOOGLE_CLIENT_EMAIL?: string;
  GOOGLE_PRIVATE_KEY?: string;
  [key: string]: unknown;
}

/**
 * Validated environment with required Sheets properties.
 * Extends the base env but guarantees the Sheets-related properties are defined.
 */
export interface ValidatedSheetsEnv extends BaseEnv {
  SHEETS_SPREADSHEET_ID: string;
  GOOGLE_CLIENT_EMAIL: string;
  GOOGLE_PRIVATE_KEY: string;
}

/**
 * Validation result - either success with typed env, or error with response
 */
export type SheetsEnvValidationResult =
  | { valid: true; env: ValidatedSheetsEnv }
  | { valid: false; response: Response; missing: string[] };

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validate that required Sheets environment variables are set.
 *
 * This function validates env vars and returns a typed result that
 * provides type narrowing for downstream handlers.
 *
 * @param env - Router environment (with optional properties)
 * @param requestId - Request ID for error response
 * @returns Validation result with either validated env or error response
 *
 * @example
 * const validation = validateSheetsEnv(env, requestId);
 * if (!validation.valid) {
 *   return validation.response;
 * }
 * // validation.env is now ValidatedSheetsEnv with required props guaranteed
 * const result = await handleListEvents(request, validation.env);
 */
export function validateSheetsEnv<T extends BaseEnv>(
  env: T,
  requestId: string
): SheetsEnvValidationResult {
  const missing: string[] = [];

  if (!env.SHEETS_SPREADSHEET_ID) {
    missing.push('SHEETS_SPREADSHEET_ID');
  }
  if (!env.GOOGLE_CLIENT_EMAIL) {
    missing.push('GOOGLE_CLIENT_EMAIL');
  }
  if (!env.GOOGLE_PRIVATE_KEY) {
    missing.push('GOOGLE_PRIVATE_KEY');
  }

  if (missing.length > 0) {
    return {
      valid: false,
      missing,
      response: createMissingEnvResponse(missing, requestId),
    };
  }

  // Type assertion is safe here because we've validated the properties exist
  return {
    valid: true,
    env: env as ValidatedSheetsEnv,
  };
}

/**
 * Type guard to check if env has valid Sheets configuration
 *
 * Use this for inline type narrowing when you don't need the error response.
 *
 * @example
 * if (hasSheetsConfig(env)) {
 *   // env.SHEETS_SPREADSHEET_ID is now string (not string | undefined)
 * }
 */
export function hasSheetsConfig<T extends BaseEnv>(env: T): env is T & ValidatedSheetsEnv {
  return (
    typeof env.SHEETS_SPREADSHEET_ID === 'string' &&
    env.SHEETS_SPREADSHEET_ID.length > 0 &&
    typeof env.GOOGLE_CLIENT_EMAIL === 'string' &&
    env.GOOGLE_CLIENT_EMAIL.length > 0 &&
    typeof env.GOOGLE_PRIVATE_KEY === 'string' &&
    env.GOOGLE_PRIVATE_KEY.length > 0
  );
}

// =============================================================================
// Error Response Builders
// =============================================================================

/**
 * Create a 500 response for missing environment variables
 */
function createMissingEnvResponse(missing: string[], requestId: string): Response {
  const body = {
    ok: false,
    status: 500,
    error: 'Server Configuration Error',
    code: 'SHEETS_NOT_CONFIGURED',
    message: 'Required environment variables are not configured. Please contact the administrator.',
    details: {
      missing,
      hint: 'Check that all required Cloudflare Worker secrets are set.',
    },
    requestId,
    timestamp: new Date().toISOString(),
  };

  return new Response(JSON.stringify(body), {
    status: 500,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Request-Id': requestId,
    },
  });
}
