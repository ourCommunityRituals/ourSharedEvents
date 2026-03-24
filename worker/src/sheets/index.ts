/**
 * Sheets Module Exports
 *
 * Barrel file for exporting all sheets-related modules.
 *
 * @module sheets
 * @see Story 2.1 - Sheets Client Implementation (Service Account Auth)
 * @see Story 3.2 - Port createEvent to Worker
 * @see Story 3.3 - Port recordResult to Worker
 */

// Sheets Client (Story 2.1)
// Core operations: getValues, batchGet, append, update
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
  type GoogleAuthEnv,
  type AuthErrorCode,

  // Error handling
  SheetsError,
  SHEETS_ERROR_CODES,
  logSheetsClientError,
  createUpstreamSafeError,
  AuthError,
  AUTH_ERROR_CODES,
  logAuthError,

  // Configuration
  isConfigured,
  hasCredentials,
  validateCredentials,

  // Authentication
  getAccessToken,
  clearTokenCache,

  // Core operations
  getSheetValues,
  batchGetRanges,
  appendRow,
  updateRow,

  // Health check
  healthCheck,
} from './sheetsClient';

// Event Writer (Story 3.2)
export {
  // Functions
  generateEventId,
  generateEventTag,
  toSlug,
  slugExists,
  generateUniqueSlug,
  generateUniqueSlugFromRows,
  generateIdempotencyKey,
  findDuplicateEvent,
  createEvent,

  // Types
  type CreateEventInput,
  type CreatedEvent,
  type CreateEventResult,

  // Constants
  EVENT_COL,
} from './eventWriter';

// Result Writer (Story 3.3)
export {
  // Functions
  findEventById,
  mergeResultUpdates,
  saveEventRow,
  recordResult,
  updateSchedule,
  updateStandings,
  updateBracket,

  // Types
  type ScheduleItem,
  type StandingsItem,
  type BracketMatch,
  type Bracket,
  type RecordResultInput,
  type EventData,
  type LoadEventResult,
  type RecordResultResult,
} from './resultWriter';

// Analytics Writer (Story 3.3)
export {
  // Functions
  getEnvironmentString,
  isValidSurface,
  isValidMetric,
  sanitizeSpreadsheetValue,
  buildAnalyticsRow,
  logAnalyticsEvent,
  logAnalyticsEvents,
  logResultUpdate,

  // Types
  type AnalyticsWriterEnv,
  type AnalyticsLogInput,
  type AnalyticsLogResult,
  type AnalyticsBatchLogResult,
  type Surface,
  type Metric,

  // Constants
  ANALYTICS_COL,
  ANALYTICS_SOURCE,
  ANALYTICS_ENV,
  VALID_SURFACES,
  VALID_METRICS,
} from './analyticsWriter';
