/**
 * Google Authentication Module
 *
 * Exports all Google service account authentication functionality
 * for Cloudflare Workers.
 *
 * @module google
 * @see Story B1 - Worker Service Account Auth (JWT -> OAuth Token) + Token Cache
 */

// Auth exports (Story B1)
export {
  // Functions
  hasGoogleCredentials,
  validateGoogleCredentials,
  getGoogleAccessToken,
  checkGoogleAuthHealth,
  clearTokenCache,
  getTokenCacheStatus,
  createGoogleAuthErrorResponse,

  // Error class and codes
  GoogleAuthError,
  GOOGLE_AUTH_ERROR_CODES,

  // Types
  type GoogleServiceAccountEnv,
  type GoogleAuthErrorCode,
  type TokenMintResult,
  type GoogleAuthHealthResult,
} from './auth';

// PEM utilities (Story B1)
export {
  // Functions
  parsePem,
  stripPemHeaders,
  isValidPem,
  base64ToArrayBuffer,
  importPrivateKeyFromPem,

  // Types
  type PemParseResult,
} from './pem';

// Sheets Read API (Story B3)
export {
  // Functions
  sheetsGetValues,
  createSheetsReadErrorResponse,

  // Error class and codes
  SheetsReadError,
  SHEETS_READ_ERROR_CODES,

  // Types
  type SheetsEnv,
  type SheetsReadErrorCode,
  type SheetValues,
  type SheetsGetValuesOptions,
  type SheetsGetValuesResult,
} from './sheets';

// Sheets Write API (Story C2)
export {
  // Functions
  sheetsAppendValues,
  sheetsUpdateValues,
  findEventRowById,
  updateEventById,
  createSheetsWriteErrorResponse,
  generateUUID,
  generateShortId,

  // Error class and codes
  SheetsWriteError,
  SHEETS_WRITE_ERROR_CODES,

  // Types
  type SheetsWriteEnv,
  type SheetsWriteErrorCode,
  type MinimalEventShape,
  type SheetsAppendOptions,
  type SheetsUpdateOptions,
  type SheetsAppendResult,
  type SheetsUpdateResult,
  type FindEventRowResult,
} from './sheetsWrite';

// Sheets Write API - Status Functions (Story D2)
export {
  // Functions
  updateEventStatus,
  getEventStatus,

  // Constants
  STATUS_COLUMN_INDEX,
  EVENT_STATUS,

  // Types
  type EventStatus,
} from './sheetsWrite';

// Sheets Write API - Default Event Functions (Story D3)
export {
  // Functions
  setEventAsDefault,
  getEventIsDefault,

  // Constants
  IS_DEFAULT_COLUMN_INDEX,
  BRAND_COLUMN_INDEX,

  // Types
  type SetDefaultEventResult,
} from './sheetsWrite';
