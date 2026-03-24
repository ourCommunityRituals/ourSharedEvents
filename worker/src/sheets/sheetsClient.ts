/**
 * Google Sheets Client - Re-export Module
 *
 * Story 2.1 — Sheets Client Implementation (Service Account Auth)
 *
 * This barrel module re-exports the core sheetsClient implementation
 * from the parent directory, making it accessible from the sheets/ module.
 *
 * The actual implementation lives in worker/src/sheetsClient.ts which provides:
 * - Service account authentication (JWT-based, no OAuth UI)
 * - getValues: Read a single sheet range
 * - batchGet: Read multiple ranges in one API call
 * - append: Add rows to a sheet
 * - update: Modify existing rows
 * - Automatic retry with exponential backoff for 429/5xx errors
 * - Structured error handling and logging
 *
 * @module sheets/sheetsClient
 * @see worker/src/sheetsClient.ts - Core implementation
 * @see worker/src/googleAuth.ts - Service account JWT authentication
 * @see Story 2.1 - Sheets Client Implementation
 */

// Re-export all public API from the core sheetsClient
export {
  // Types
  type SheetsEnv,
  type SheetsErrorCode,
  type SheetValues,
  type ReadOptions,
  type WriteOptions,
  type BatchGetResult,
  type UpdateResult,
  type AppendResult,

  // Error handling
  SheetsError,
  SHEETS_ERROR_CODES,
  logSheetsClientError,
  createUpstreamSafeError,

  // Configuration
  isConfigured,

  // Core operations (Story 2.1 AC)
  getSheetValues,    // getValues: Read single range
  batchGetRanges,    // batchGet: Read multiple ranges
  appendRow,         // append: Add row to sheet
  updateRow,         // update: Modify existing row

  // Health check
  healthCheck,
} from '../sheetsClient';

// Re-export Google Auth types and utilities for convenience
export {
  type GoogleAuthEnv,
  hasCredentials,
  validateCredentials,
  getAccessToken,
  clearTokenCache,
  AuthError,
  AUTH_ERROR_CODES,
  type AuthErrorCode,
  logAuthError,
} from '../googleAuth';
