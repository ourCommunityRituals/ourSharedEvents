/**
 * Worker Handlers Exports
 *
 * Barrel file for exporting all API handlers.
 *
 * @module handlers
 * @see Story 1.3 - Port api_status + Simple Read-Only api_listEvents
 * @see Story 2.1 - Worker getPublicBundle from Sheets
 * @see Story 2.2 - Worker getAdminBundle from Sheets
 * @see Story 2.3 - Worker Upstream Config via Single Env Var
 * @see Story 3.2 - Port createEvent to Worker
 * @see Story 3.3 - Port recordResult to Worker
 */

// Status Handler
export {
  handleStatus,
  createSheetsDownResponse,
  type StatusEnv,
  type StatusResponse,
  type StatusErrorResponse,
} from './status';

// Events List Handler
export {
  handleListEvents,
  type EventsEnv,
  type EventSummary,
  type EventFull,
  type EventsListResponse,
  type EventsErrorResponse,
} from './eventsList';

// Public Bundle Handler (Story 2.1, Story E3)
export {
  handleGetPublicBundle,
  parseEventIdFromPath,
  PUBLIC_BUNDLE_ERROR_CODES,
  type PublicBundleEnv,
  type PublicBundleResponse,
  type PublicBundleNotModifiedResponse,
  type PublicBundleErrorResponse,
} from './publicBundle';

// Admin Bundle Handler (Story 2.2)
export {
  handleGetAdminBundle,
  parseAdminEventIdFromPath,
  type AdminBundleEnv,
  type AdminBundleResponse,
  type AdminBundleNotModifiedResponse,
  type AdminBundleErrorResponse,
} from './adminBundle';

// Admin Create Event Handler (Story 3.2)
export {
  handleAdminCreateEvent,
  type AdminCreateEventEnv,
  type CreateEventRequestBody,
  type AdminCreateEventResponse,
  type AdminCreateEventErrorResponse,
} from './adminCreateEvent';

// Admin Record Result Handler (Story 3.3)
export {
  handleAdminRecordResult,
  parseEventIdFromResultPath,
  type AdminRecordResultEnv,
  type RecordResultRequestBody,
  type AdminRecordResultResponse,
  type AdminRecordResultErrorResponse,
} from './adminRecordResult';

// Health Origin Handler (Story 2.3, Story 3.1)
export {
  handleHealthOrigin,
  type HealthOriginEnv,
  type HealthOriginResponse,
} from './healthOrigin';

// Health Backend Handler (Story B1, Story B2)
export {
  handleHealthBackend,
  createBackendHealthErrorResponse,
  HEALTH_ERROR_CODES,
  type HealthBackendEnv,
  type HealthBackendResponse,
  type HealthBackendErrorResponse,
  type SheetsProbeResult,
} from './healthBackend';

// Events V2 Handler (Story B5)
export {
  handleEventsV2,
  EVENTS_V2_ERROR_CODES,
  type EventsV2Env,
  type EventV2Summary,
  type EventV2Full,
  type EventsV2ListResponse,
  type EventsV2ErrorResponse,
  type EventsV2ErrorCode,
} from './eventsV2';

// V2 Admin Create Event Handler (Story C3)
export {
  handleV2AdminCreateEvent,
  type V2AdminCreateEventEnv,
  type V2CreateEventRequestBody,
  type V2CreatedEventItem,
  type V2AdminCreateEventResponse,
  type V2AdminCreateEventErrorResponse,
} from './v2AdminCreateEvent';

// V2 Admin Update Event Handler (Story D1)
export {
  handleV2AdminUpdateEvent,
  type V2AdminUpdateEventEnv,
  type V2UpdateEventRequestBody,
  type V2UpdatedEventItem,
  type V2AdminUpdateEventResponse,
  type V2AdminUpdateEventErrorResponse,
} from './v2AdminUpdateEvent';

// V2 Admin Archive/Unarchive Event Handler (Story D2)
export {
  handleV2AdminArchiveEvent,
  handleV2AdminUnarchiveEvent,
  type V2AdminArchiveEventEnv,
  type V2ArchivedEventItem,
  type V2AdminArchiveEventResponse,
  type V2AdminArchiveEventErrorResponse,
} from './v2AdminArchiveEvent';

// V2 Admin Default Event Handler (Story D3)
export {
  handleV2AdminDefaultEvent,
  type V2AdminDefaultEventEnv,
  type V2DefaultEventItem,
  type V2AdminDefaultEventResponse,
  type V2AdminDefaultEventErrorResponse,
} from './v2AdminDefaultEvent';

// V2 Admin Verify QR Handler (Story E2)
export {
  handleV2AdminVerifyQr,
  handleV2AdminUnverifyQr,
  VERIFY_QR_ERROR_CODES,
  type V2AdminVerifyQrEnv,
  type V2VerifyQrResponse,
  type V2VerifyQrErrorResponse,
  type VerifyQrErrorCode,
} from './v2AdminVerifyQr';

// Display Bundle Handler (Story E4)
export {
  handleGetDisplayBundle,
  parseDisplayEventIdFromPath,
  DISPLAY_BUNDLE_ERROR_CODES,
  type DisplayBundleEnv,
  type DisplayBundleResponse,
  type DisplayBundleNotModifiedResponse,
  type DisplayBundleErrorResponse,
  type DisplayBundleValue,
  type DisplayRotationConfig,
  type RotationPane,
} from './displayBundle';

// Poster Bundle Handler (Story E4)
export {
  handleGetPosterBundle,
  parsePosterEventIdFromPath,
  POSTER_BUNDLE_ERROR_CODES,
  type PosterBundleEnv,
  type PosterBundleResponse,
  type PosterBundleNotModifiedResponse,
  type PosterBundleErrorResponse,
  type PosterBundleValue,
  type PosterLayoutConfig,
} from './posterBundle';

// V2 Admin Upload File Handler (Phone Storage)
export {
  handleV2AdminUploadFile,
  handleV2GetUploadedFile,
  type V2AdminUploadFileEnv,
  type V2AdminUploadFileResponse,
  type V2AdminUploadFileErrorResponse,
} from './v2AdminUploadFile';

// Sponsor Page Handler (Story F3)
export {
  handleSponsorPage,
  handleSponsorsPage,
  SPONSOR_PAGE_ERROR_CODES,
  type SponsorPageEnv,
  type SponsorPageErrorCode,
} from './sponsorPage';
