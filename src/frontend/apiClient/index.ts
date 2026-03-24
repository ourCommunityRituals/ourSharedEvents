/**
 * Frontend API Client Module Exports
 *
 * Story 4.1 - Extract Frontend API Adapter Layer
 *
 * Barrel file for exporting all frontend API client modules.
 *
 * Usage:
 *   import { createPublicApiClient, isSuccess } from '@/frontend/apiClient';
 *
 *   const api = createPublicApiClient('brandId');
 *   const result = await api.getPublicBundle(eventId);
 *   if (isSuccess(result)) {
 *     console.log(result.value.event);
 *   }
 *
 * @module frontend/apiClient
 */

// =============================================================================
// Base API Client
// =============================================================================

export {
  // Classes
  BaseApiClient,
  // Factory
  createApiClient,
  // Types
  type ApiSuccessResponse,
  type ApiErrorCode,
  type ApiErrorResponse,
  type ApiResponse,
  type ApiClientConfig,
  type RequestOptions,
  type ErrorUIHandler,
  // Type guards
  isSuccess,
  isError,
} from './base';

// =============================================================================
// Admin API Client
// =============================================================================

export {
  // Classes
  AdminApiClient,
  // Factory
  createAdminApiClient,
  // Types
  type AdminAuthContext,
  type AdminTemplate,
  type AdminBrandConfig,
  type EventDiagnostics,
  type AdminSponsor,
  type AdminEvent,
  type AdminBundleValue,
  type CreateEventRequest,
  type CreateEventResponse,
  type SaveEventRequest,
  type RecordResultRequest,
  type RecordResultResponse,
} from './admin';

// =============================================================================
// Public API Client
// =============================================================================

export {
  // Classes
  PublicApiClient,
  // Factory
  createPublicApiClient,
  // Types
  type EventSummary,
  type EventListResponse,
  type LifecyclePhase,
  type EventCTA,
  type EventCTAs,
  type EventSettings,
  type ScheduleItem,
  type StandingsItem,
  type BracketMatch,
  type BracketRound,
  type Bracket,
  type Sponsor,
  type EventMedia,
  type ExternalData,
  type PaymentInfo,
  type EventLinks,
  type PublicEvent,
  type BrandConfig,
  type PublicBundleValue,
  type AnalyticsPayload,
  type ExternalClickPayload,
} from './public';

// =============================================================================
// Display API Client
// =============================================================================

export {
  // Classes
  DisplayApiClient,
  // Factory
  createDisplayApiClient,
  // Types
  type DisplaySponsor,
  type DisplayQR,
  type DisplayEvent,
  type DisplayBundleValue,
  type AnalyticsPayload as DisplayAnalyticsPayload,
} from './display';

// =============================================================================
// Poster API Client
// =============================================================================

export {
  // Classes
  PosterApiClient,
  // Factory
  createPosterApiClient,
  // Types
  type PosterSponsor,
  type PosterQR,
  type PosterEvent,
  type PosterBundleValue,
  type AnalyticsPayload as PosterAnalyticsPayload,
} from './poster';

// =============================================================================
// Environment Detection (Story 4.2)
// =============================================================================

export {
  // Types
  type Environment,
  type ApiBackend,
  type EnvironmentConfig,
  // Detection functions
  detectEnvironment,
  getApiBackend,
  shouldUseWorkerV2,
  getBaseApiUrl,
  getEnvironmentConfig,
  getEnvConfig,
  isStaging,
  isProduction,
  // Path builders
  buildWorkerV2BundlePath,
  buildWorkerV2EventsPath,
} from './env';
