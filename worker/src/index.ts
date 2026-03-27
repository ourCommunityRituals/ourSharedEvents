/**
 * Worker Module Exports
 *
 * Barrel file for exporting all worker modules.
 *
 * @module worker
 * @see Story 1.1 - Create Central Worker Router
 * @see Story 1.2 - Implement sheetsClient.ts for Workers
 * @see Story 1.3 - Port api_status + Simple Read-Only api_listEvents
 * @see Story 2.1 - Worker getPublicBundle from Sheets
 * @see Story 2.2 - Worker getAdminBundle from Sheets
 * @see Story 2.3 - Worker Upstream Config via Single Env Var
 * @see Story 3.1 - Define Admin Auth Model for Worker API
 * @see Story 3.2 - Port createEvent to Worker
 * @see Story 3.3 - Port recordResult to Worker
 */

// Central Router (Story 1.1)
export {
  handleRequest,
  ROUTER_VERSION,
  type RouterEnv,
} from './router';

// Structured Logger (Story 1.1)
export {
  RouterLogger,
  createLogger,
  type LogLevel,
  type LogEntry,
  type LoggerConfig,
} from './logger';

// Google Authentication
export {
  getAccessToken,
  hasCredentials,
  validateCredentials,
  clearTokenCache,
  logAuthError,
  AuthError,
  AUTH_ERROR_CODES,
  type GoogleAuthEnv,
  type AuthErrorCode as GoogleAuthErrorCode,
} from './googleAuth';

// Google Sheets Client
export {
  getSheetValues,
  batchGetRanges,
  appendRow,
  updateRow,
  isConfigured,
  healthCheck,
  createUpstreamSafeError,
  logSheetsClientError,
  SheetsError,
  SHEETS_ERROR_CODES,
  type SheetsEnv,
  type SheetsErrorCode,
  type SheetValues,
  type ReadOptions,
  type WriteOptions,
  type BatchGetResult,
  type UpdateResult,
  type AppendResult,
} from './sheetsClient';

// API Handlers (Story 1.3)
export {
  handleStatus,
  createSheetsDownResponse,
  handleListEvents,
  type StatusEnv,
  type StatusResponse,
  type StatusErrorResponse,
  type EventsEnv,
  type EventSummary,
  type EventFull,
  type EventsListResponse,
  type EventsErrorResponse,
} from './handlers';

// API Handlers (Story 2.1 - Public Bundle)
export {
  handleGetPublicBundle,
  parseEventIdFromPath,
  type PublicBundleEnv,
  type PublicBundleResponse,
  type PublicBundleNotModifiedResponse,
  type PublicBundleErrorResponse,
} from './handlers';

// API Handlers (Story 2.2 - Admin Bundle)
export {
  handleGetAdminBundle,
  parseAdminEventIdFromPath,
  type AdminBundleEnv,
  type AdminBundleResponse,
  type AdminBundleNotModifiedResponse,
  type AdminBundleErrorResponse,
} from './handlers';

// Mappers (Story 2.1)
export {
  // Types
  type LifecyclePhaseValue,
  type LifecyclePhaseInfo,
  type BrandConfigForApi,
  type EventLinks,
  type EventQR,
  type EventCTA,
  type EventCTAs,
  type ScheduleItem,
  type StandingsItem,
  type Bracket,
  type SponsorPlacements,
  type Sponsor,
  type EventMedia,
  type ExternalData,
  type EventSettings,
  type PublicEvent,
  type PublicBundleValue,

  // Constants
  LIFECYCLE_PHASE,
  LIFECYCLE_LABELS,
  BRAND_CONFIG,
  VALID_BRANDS,
  DEFAULT_BRAND,
  EVENT_COL,

  // Functions
  isValidBrand,
  getBrandConfigForApi,
  computeLifecyclePhase,
  filterSponsorsForPublic,
  generatePublicBundleEtag,
  generateContentEtag,
  parseEventRow,
  buildPublicBundleValue,
  buildPublicBundleResponse,
} from './mappers';

// Mappers (Story 2.2 - Admin Bundle)
export {
  // Types
  type AdminTemplate,
  type AdminBrandConfig,
  type EventDiagnostics,
  type AdminSponsor,
  type AdminBundleValue,

  // Constants
  TEMPLATES,
  BRAND_TEMPLATE_CONFIG,

  // Functions
  getAdminBrandConfig,
  getTemplatesForBrand,
  buildEventDiagnostics,
  mapSponsorsForAdmin,
  generateAdminBundleEtag,
  buildAdminBundleValue,
  buildAdminBundleResponse,
} from './mappers';

// Admin Authentication (Story 3.1)
export {
  // Functions
  checkAdminAuth,
  requireAdminAuth,
  createAuthErrorResponse,
  isAuthConfigured,
  isAdminRoute,
  guardAdminRoute,
  logAuthAttempt,

  // Types
  type AdminAuthEnv,
  type AuthResult,
  type AuthContext,
  type AuthErrorCode,
  type AdminAuthErrorResponse,

  // Constants
  AUTH_ERROR_MESSAGES,
  AUTH_STATUS_CODES,
} from './auth';

// Admin Key Authentication (Story C1) + Cloudflare Access (Story D4)
export {
  // Functions
  requireAdmin,
  isAdminKeyConfigured,
  createUnauthorizedResponse,
  isV2AdminRoute,
  guardV2AdminRoute,
  decodeCloudflareAccessJwt,

  // Types
  type AdminKeyEnv,
  type AdminAuthError,
  type CloudflareAccessJwtPayload,
  type JwtDecodeResult,
} from './auth';

// API Handlers (Story 3.2 - Admin Create Event)
export {
  handleAdminCreateEvent,
  type AdminCreateEventEnv,
  type CreateEventRequestBody,
  type AdminCreateEventResponse,
  type AdminCreateEventErrorResponse,
} from './handlers';

// API Handlers (Story C3 - V2 Admin Create Event)
export {
  handleV2AdminCreateEvent,
  type V2AdminCreateEventEnv,
  type V2CreateEventRequestBody,
  type V2CreatedEventItem,
  type V2AdminCreateEventResponse,
  type V2AdminCreateEventErrorResponse,
} from './handlers';

// API Handlers (Story D1 - V2 Admin Update Event)
export {
  handleV2AdminUpdateEvent,
  type V2AdminUpdateEventEnv,
  type V2UpdateEventRequestBody,
  type V2UpdatedEventItem,
  type V2AdminUpdateEventResponse,
  type V2AdminUpdateEventErrorResponse,
} from './handlers';

// API Handlers (Story D2 - V2 Admin Archive/Unarchive Event)
export {
  handleV2AdminArchiveEvent,
  handleV2AdminUnarchiveEvent,
  type V2AdminArchiveEventEnv,
  type V2ArchivedEventItem,
  type V2AdminArchiveEventResponse,
  type V2AdminArchiveEventErrorResponse,
} from './handlers';

// API Handlers (Story D3 - V2 Admin Default Event)
export {
  handleV2AdminDefaultEvent,
  type V2AdminDefaultEventEnv,
  type V2DefaultEventItem,
  type V2AdminDefaultEventResponse,
  type V2AdminDefaultEventErrorResponse,
} from './handlers';

// API Handlers (Story E2 - V2 Admin Verify QR)
export {
  handleV2AdminVerifyQr,
  handleV2AdminUnverifyQr,
  VERIFY_QR_ERROR_CODES,
  type V2AdminVerifyQrEnv,
  type V2VerifyQrResponse,
  type V2VerifyQrErrorResponse,
  type VerifyQrErrorCode,
} from './handlers';

// API Handlers (Story 3.3 - Admin Record Result)
export {
  handleAdminRecordResult,
  parseEventIdFromResultPath,
  type AdminRecordResultEnv,
  type RecordResultRequestBody,
  type AdminRecordResultResponse,
  type AdminRecordResultErrorResponse,
} from './handlers';

// Sheets Module (Story 3.2 - Event Writer)
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

  // Constants (aliased to avoid conflict with mappers/EVENT_COL)
  EVENT_COL as SHEETS_EVENT_COL,
} from './sheets';

// Sheets Module (Story 3.3 - Result Writer)
export {
  // Functions
  findEventById,
  mergeResultUpdates,
  saveEventRow,
  recordResult,
  updateSchedule,
  updateStandings,
  updateBracket,

  // Types (Note: ScheduleItem, StandingsItem, Bracket exported from ./mappers above)
  type BracketMatch,
  type RecordResultInput,
  type EventData,
  type LoadEventResult,
  type RecordResultResult,
} from './sheets';

// Sheets Module (Story 3.3 - Analytics Writer)
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
} from './sheets';

// Backend Origin Resolution (Story 2.3, Story 3.1)
export {
  // Functions
  resolveBackendOrigin,
  isBackendConfigured,
  createUpstreamNotConfiguredResponse,
  logUpstreamConfigError,
  checkUpstreamHealth,

  // Types
  type BackendEnv,
  type BackendOriginResult,
  type UpstreamConfigError,
  type UpstreamHealthResult,
} from './resolveBackendOrigin';

// API Handlers (Story 2.3, Story 3.1 - Health Origin)
export {
  handleHealthOrigin,
  type HealthOriginEnv,
  type HealthOriginResponse,
} from './handlers';

// API Handlers (Story B1 - Health Backend)
export {
  handleHealthBackend,
  createBackendHealthErrorResponse,
  HEALTH_ERROR_CODES,
  type HealthBackendEnv,
  type HealthBackendResponse,
  type HealthBackendErrorResponse,
  type SheetsProbeResult,
} from './handlers';

// API Handlers (Story B5 - Events V2)
export {
  handleEventsV2,
  EVENTS_V2_ERROR_CODES,
  type EventsV2Env,
  type EventV2Summary,
  type EventV2Full,
  type EventsV2ListResponse,
  type EventsV2ErrorResponse,
  type EventsV2ErrorCode,
} from './handlers';

// Google Service Account Authentication (Story B1)
export {
  // Functions
  hasGoogleCredentials,
  validateGoogleCredentials,
  getGoogleAccessToken,
  checkGoogleAuthHealth,
  clearTokenCache as clearGoogleTokenCache,
  getTokenCacheStatus,
  createGoogleAuthErrorResponse,

  // Error class and codes
  GoogleAuthError,
  GOOGLE_AUTH_ERROR_CODES,

  // PEM utilities
  parsePem,
  stripPemHeaders,
  isValidPem,
  importPrivateKeyFromPem,

  // Types
  type GoogleServiceAccountEnv,
  type GoogleAuthErrorCode as GoogleSAAuthErrorCode,
  type TokenMintResult,
  type GoogleAuthHealthResult,
  type PemParseResult,
} from './google';

// Environment Configuration (Story B1)
export {
  // Functions
  validateEnv,
  validateGoogleAuthEnv,
  validateAdminEnv,
  validateSheetsEnv,
  validateUpstreamEnv,
  getEffectiveGoogleCredentials,
  normalizeGoogleEnv,
  isDevelopment,
  isStaging,
  isProduction,
  getEnvironmentName,

  // Types
  type WorkerEnv,
  type EnvValidationGroups,
} from './env';

// Asset State Domain Model (Story E1)
export {
  // Types
  type AssetState,
  type RenderSurface,
  type AssetStateInfo,
  type AssetStateEvent,

  // Constants
  ASSET_STATE_COLUMN_INDEX,
  VALID_ASSET_STATES,
  ASSET_STATE_LABELS,
  ASSET_STATE_DESCRIPTIONS,
  RENDERABLE_SURFACES,
  VALID_TRANSITIONS,

  // Functions
  isValidAssetState,
  parseAssetState,
  resolveAssetState,
  assertRenderable,
  canRender,
  isValidTransition,
  getAllowedTransitions,
  buildAssetStateResponse,
  createNonRenderableResponse,
} from './domain/assetState';

// Google Cloud Platform Integrations
export {
  // Cloud Configuration
  GCP_PROJECT_ID,
  GCP_DEFAULT_REGION,
  GCP_API_URLS,
  GCP_SCOPES,
  getProjectId,
  getRegion,
  getVertexAiBaseUrl,
  type CloudEnv,

  // BigQuery - Data Backup
  bigQueryInsertRows,
  bigQueryRunQuery,
  backupEvents,
  backupSharedReport,
  isBigQueryConfigured,
  BigQueryError,
  BIGQUERY_ERROR_CODES,
  BACKUP_TABLES,
  type BigQueryEnv,
  type BigQueryErrorCode,
  type BigQueryInsertRow,
  type BigQueryInsertResult,
  type BigQueryQueryResult,

  // Google Maps - SharedReports & OurEventRings
  geocodeAddress,
  getPlaceDetails,
  buildStaticMapUrl,
  buildMapsLink,
  getReportLocationData,
  isMapsConfigured,
  MapsError,
  MAPS_ERROR_CODES,
  type MapsEnv,
  type MapsErrorCode,
  type LatLng,
  type GeocodeResult,
  type PlaceDetails,
  type StaticMapOptions,
  type ReportLocationData,

  // Vertex AI - Chat Bot Creation
  generateText,
  chat,
  eventBotRespond,
  isVertexAiConfigured,
  VertexAiError,
  VERTEX_AI_ERROR_CODES,
  type VertexAiEnv,
  type VertexAiErrorCode,
  type ChatMessage,
  type GenerationConfig,
  type GenerationResult,
  type EventBotContext,
} from './cloud';
