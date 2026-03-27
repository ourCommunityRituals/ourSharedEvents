/**
 * Environment Configuration and Validation
 *
 * Centralized environment variable types and validation for Cloudflare Workers.
 *
 * @module env
 * @see Story B1 - Worker Service Account Auth (JWT -> OAuth Token) + Token Cache
 */

import { GoogleServiceAccountEnv } from './google';
import { type CloudEnv } from './cloud/config';

// =============================================================================
// Environment Types
// =============================================================================

/**
 * Complete worker environment bindings
 *
 * Combines all environment variables needed by the worker.
 */
export interface WorkerEnv extends GoogleServiceAccountEnv, CloudEnv {
  // Worker identification
  /** Worker environment (development, staging, production) */
  WORKER_ENV?: string;
  /** Worker name identifier */
  WORKER_NAME?: string;
  /** Build version for tracking */
  WORKER_BUILD_VERSION?: string;
  /** Debug level (debug, info, warn, error) */
  DEBUG_LEVEL?: string;

  // Admin authentication
  /** Admin bearer token for protected endpoints */
  ADMIN_TOKEN?: string;

  // Google Sheets configuration
  /** Google Sheets spreadsheet ID */
  SHEETS_SPREADSHEET_ID?: string;

  // Upstream configuration
  /** Upstream webapp URL for /health/origin checks */
  UPSTREAM_WEBAPP_URL?: string;

  // Legacy environment variables (for backwards compatibility)
  /** @deprecated Use GOOGLE_SA_CLIENT_EMAIL instead */
  GOOGLE_CLIENT_EMAIL?: string;
  /** @deprecated Use GOOGLE_SA_PRIVATE_KEY_PEM instead */
  GOOGLE_PRIVATE_KEY?: string;
}

/**
 * Environment variable groups for validation
 */
export interface EnvValidationGroups {
  /** Required for Google Sheets API access */
  googleAuth: {
    configured: boolean;
    missing: string[];
    usingLegacy: boolean;
  };
  /** Required for admin operations */
  admin: {
    configured: boolean;
    missing: string[];
  };
  /** Required for Sheets operations */
  sheets: {
    configured: boolean;
    missing: string[];
  };
  /** Required for upstream health checks */
  upstream: {
    configured: boolean;
    missing: string[];
  };
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Check if Google service account secrets are configured
 *
 * Supports both new naming (GOOGLE_SA_*) and legacy naming (GOOGLE_*).
 *
 * @param env - Worker environment
 * @returns Validation result for Google auth secrets
 */
export function validateGoogleAuthEnv(env: WorkerEnv): EnvValidationGroups['googleAuth'] {
  const missing: string[] = [];
  let usingLegacy = false;

  // Check for new naming convention first
  const hasNewClientEmail = !!env.GOOGLE_SA_CLIENT_EMAIL;
  const hasNewPrivateKey = !!env.GOOGLE_SA_PRIVATE_KEY_PEM;

  // Check for legacy naming
  const hasLegacyClientEmail = !!env.GOOGLE_CLIENT_EMAIL;
  const hasLegacyPrivateKey = !!env.GOOGLE_PRIVATE_KEY;

  // Determine which naming is being used
  if (hasNewClientEmail || hasNewPrivateKey) {
    // Using new naming convention
    if (!hasNewClientEmail) missing.push('GOOGLE_SA_CLIENT_EMAIL');
    if (!hasNewPrivateKey) missing.push('GOOGLE_SA_PRIVATE_KEY_PEM');
  } else if (hasLegacyClientEmail || hasLegacyPrivateKey) {
    // Using legacy naming convention
    usingLegacy = true;
    if (!hasLegacyClientEmail) missing.push('GOOGLE_CLIENT_EMAIL');
    if (!hasLegacyPrivateKey) missing.push('GOOGLE_PRIVATE_KEY');
  } else {
    // Neither configured
    missing.push('GOOGLE_SA_CLIENT_EMAIL', 'GOOGLE_SA_PRIVATE_KEY_PEM');
  }

  return {
    configured: missing.length === 0,
    missing,
    usingLegacy,
  };
}

/**
 * Check if admin authentication is configured
 *
 * @param env - Worker environment
 * @returns Validation result for admin auth
 */
export function validateAdminEnv(env: WorkerEnv): EnvValidationGroups['admin'] {
  const missing: string[] = [];

  if (!env.ADMIN_TOKEN) {
    missing.push('ADMIN_TOKEN');
  }

  return {
    configured: missing.length === 0,
    missing,
  };
}

/**
 * Check if Sheets configuration is complete
 *
 * @param env - Worker environment
 * @returns Validation result for Sheets config
 */
export function validateSheetsEnv(env: WorkerEnv): EnvValidationGroups['sheets'] {
  const missing: string[] = [];

  if (!env.SHEETS_SPREADSHEET_ID) {
    missing.push('SHEETS_SPREADSHEET_ID');
  }

  return {
    configured: missing.length === 0,
    missing,
  };
}

/**
 * Check if upstream configuration is complete
 *
 * @param env - Worker environment
 * @returns Validation result for upstream config
 */
export function validateUpstreamEnv(env: WorkerEnv): EnvValidationGroups['upstream'] {
  const missing: string[] = [];

  if (!env.UPSTREAM_WEBAPP_URL) {
    missing.push('UPSTREAM_WEBAPP_URL');
  }

  return {
    configured: missing.length === 0,
    missing,
  };
}

/**
 * Validate all environment variable groups
 *
 * @param env - Worker environment
 * @returns Validation results for all groups
 */
export function validateEnv(env: WorkerEnv): EnvValidationGroups {
  return {
    googleAuth: validateGoogleAuthEnv(env),
    admin: validateAdminEnv(env),
    sheets: validateSheetsEnv(env),
    upstream: validateUpstreamEnv(env),
  };
}

/**
 * Get effective Google credentials from environment
 *
 * Returns normalized credentials, preferring new naming over legacy.
 *
 * @param env - Worker environment
 * @returns Object with clientEmail and privateKey (may be undefined)
 */
export function getEffectiveGoogleCredentials(env: WorkerEnv): {
  clientEmail: string | undefined;
  privateKey: string | undefined;
  isLegacy: boolean;
} {
  // Prefer new naming convention
  if (env.GOOGLE_SA_CLIENT_EMAIL || env.GOOGLE_SA_PRIVATE_KEY_PEM) {
    return {
      clientEmail: env.GOOGLE_SA_CLIENT_EMAIL,
      privateKey: env.GOOGLE_SA_PRIVATE_KEY_PEM,
      isLegacy: false,
    };
  }

  // Fall back to legacy naming
  return {
    clientEmail: env.GOOGLE_CLIENT_EMAIL,
    privateKey: env.GOOGLE_PRIVATE_KEY,
    isLegacy: !!(env.GOOGLE_CLIENT_EMAIL || env.GOOGLE_PRIVATE_KEY),
  };
}

/**
 * Create normalized GoogleServiceAccountEnv from WorkerEnv
 *
 * Maps legacy naming to new naming if needed.
 *
 * @param env - Worker environment
 * @returns GoogleServiceAccountEnv with normalized naming
 */
export function normalizeGoogleEnv(env: WorkerEnv): {
  GOOGLE_SA_CLIENT_EMAIL?: string;
  GOOGLE_SA_PRIVATE_KEY_PEM?: string;
} {
  const creds = getEffectiveGoogleCredentials(env);
  return {
    GOOGLE_SA_CLIENT_EMAIL: creds.clientEmail,
    GOOGLE_SA_PRIVATE_KEY_PEM: creds.privateKey,
  };
}

/**
 * Check if running in development mode
 *
 * @param env - Worker environment
 * @returns True if in development mode
 */
export function isDevelopment(env: WorkerEnv): boolean {
  return env.WORKER_ENV === 'development' || !env.WORKER_ENV;
}

/**
 * Check if running in staging mode
 *
 * @param env - Worker environment
 * @returns True if in staging mode
 */
export function isStaging(env: WorkerEnv): boolean {
  return env.WORKER_ENV === 'staging';
}

/**
 * Check if running in production mode
 *
 * @param env - Worker environment
 * @returns True if in production mode
 */
export function isProduction(env: WorkerEnv): boolean {
  return env.WORKER_ENV === 'production';
}

/**
 * Get environment display name
 *
 * @param env - Worker environment
 * @returns Human-readable environment name
 */
export function getEnvironmentName(env: WorkerEnv): string {
  return env.WORKER_ENV || 'development';
}
