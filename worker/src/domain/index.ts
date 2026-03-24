/**
 * Domain Module Exports
 *
 * This barrel file exports all domain logic modules.
 *
 * Story E2: Verified-QR-Only Enforcement (Hard Invariant)
 * Story F1: Sponsor Object Contract (Single Source of Truth)
 * Story F2: Analytics Integrity Enforcement (No Silent Drift)
 * Story F3: Sponsor Page Gating (Trust-First Display)
 * Story F6: SharedAnalytics Bundle Contract (Event + Sponsor + Customer)
 *
 * @module domain
 */

// QR Verification Domain (Story E2)
export {
  // Types
  type AssetState,
  type VerifiedQR,
  type UnverifiedQR,
  type QRVerificationResult,
  type EventQRData,
  type LegacyEventQR,
  type EventLinks,

  // Constants
  ASSET_STATE,

  // Functions
  isQRAllowed,
  verifyQRUrl,
  buildVerifiedQRData,
  transformLegacyQR,
  isVerifiedQR,
  isValidQRContract,
  logQRVerification,
} from './qr';

// Sponsor Contract Domain (Story F1)
export {
  // Types
  type SponsorTier,
  type SponsorMetrics,
  type SponsorPlacements,
  type SponsorContract,
  type LegacySponsor,

  // Constants
  SPONSOR_CONTRACT_VERSION,
  VALID_SPONSOR_TIERS,
  SPONSOR_CONTRACT_REQUIRED_FIELDS,
  SPONSOR_METRICS_REQUIRED_FIELDS,
  DEFAULT_SPONSOR_METRICS,

  // Validation Functions
  isValidSponsorTier,
  isValidSponsorId,
  isValidSponsorMetrics,
  validateSponsorContract,
  assertSponsorContract,

  // Normalization Functions
  normalizeSponsor,
  normalizeSponsors,

  // Aggregation Functions
  aggregateSponsorMetrics,
  computeCTR,

  // Contract Compliance
  checkContractCompliance,

  // API Response Helpers
  buildSponsorResponse,
  buildSponsorsResponse,

  // Logging
  logSponsorContractCheck,
} from './sponsor';

// Sponsor Page Gating Domain (Story F3)
export {
  // Types
  type SponsorPageStatus,
  type EventStateInfo,
  type SponsorPageEligibility,
  type SponsorPageResponse,

  // Constants
  SPONSOR_PAGE_STATUS,
  VALID_SPONSOR_PAGE_STATUSES,
  SPONSOR_PAGE_STATUS_LABELS,
  SPONSOR_PAGE_STATUS_DESCRIPTIONS,

  // Functions
  resolveSponsorPageStatus,
  isValidSponsorPageStatus,
  buildSponsorPageResponse,
  buildSponsorPageErrorResponse,
  logSponsorPageStatus,
} from './sponsor';

// Analytics Integrity Domain (Story F2)
export {
  // Types
  type AnalyticsIntegrityStatus,
  type AnalyticsWindow,
  type EventAnalyticsMetrics,
  type SponsorAnalyticsMetrics,
  type AnalyticsIntegrityMetadata,
  type EventAnalyticsContract,
  type SponsorAnalyticsContract,
  type MonotonicityCheckpoint,
  type MonotonicityViolation,
  type AnalyticsDataSource,

  // Constants
  ANALYTICS_CONTRACT_VERSION,
  ANALYTICS_INTEGRITY_STATUS,
  VALID_INTEGRITY_STATUSES,
  ANALYTICS_WINDOW_REQUIRED_FIELDS,
  EVENT_METRICS_REQUIRED_FIELDS,
  SPONSOR_METRICS_REQUIRED_FIELDS,
  INTEGRITY_METADATA_REQUIRED_FIELDS,
  EVENT_ANALYTICS_REQUIRED_FIELDS,
  SPONSOR_ANALYTICS_REQUIRED_FIELDS,
  ANALYTICS_DATA_SOURCES,
  DEFAULT_STALENESS_THRESHOLD_SEC,
  MAX_STALENESS_THRESHOLD_SEC,
  DEFAULT_EVENT_METRICS,
  DEFAULT_SPONSOR_ANALYTICS_METRICS,

  // Validation Functions
  isValidIntegrityStatus,
  isValidAnalyticsWindow,
  isValidEventMetrics,
  isValidSponsorAnalyticsMetrics,
  isValidIntegrityMetadata,
  validateEventAnalytics,
  validateSponsorAnalytics,
  assertEventAnalytics,
  assertSponsorAnalytics,

  // Integrity Status
  determineIntegrityStatus,

  // Monotonicity Enforcement
  checkMonotonicity,
  assertMonotonicity,
  checkBatchMonotonicity,

  // Aggregation Functions
  aggregateEventMetrics,
  aggregateSponsorAnalyticsMetrics,

  // Builder Functions
  buildIntegrityMetadata,
  buildEventAnalyticsResponse,
  buildSponsorAnalyticsResponse,

  // Contract Compliance
  checkEventAnalyticsCompliance,
  checkSponsorAnalyticsCompliance,

  // Error Response Helpers
  createAnalyticsUnavailableResponse,
  createAnalyticsIncompleteWarning,

  // Logging
  logAnalyticsIntegrityCheck,
  logMonotonicityViolation,
  logAnalyticsContractCheck,
} from './analytics';

// SharedAnalytics Bundle Domain (Story F6)
export {
  // Types
  type SharedAnalyticsIntegrity,
  type SharedAnalyticsWindow,
  type SharedAnalyticsEventSummary,
  type SharedAnalyticsEventTraffic,
  type SharedAnalyticsEventQR,
  type SharedAnalyticsEvent,
  type SharedAnalyticsSponsorSummary,
  type SharedAnalyticsSponsorPlacement,
  type SharedAnalyticsSponsor,
  type SharedAnalyticsCustomerGeo,
  type SharedAnalyticsCustomerSummary,
  type SharedAnalyticsCustomerOutcomes,
  type SharedAnalyticsCustomer,
  type SharedAnalyticsBundle,
  type SharedAnalyticsResponse,
  type SharedAnalyticsErrorResponse,
  type SharedAnalyticsErrorCode,

  // Constants
  SHARED_ANALYTICS_CONTRACT_VERSION,
  SHARED_ANALYTICS_BUNDLE_REQUIRED_FIELDS,
  SHARED_ANALYTICS_INTEGRITY_REQUIRED_FIELDS,
  SHARED_ANALYTICS_WINDOW_REQUIRED_FIELDS,
  SHARED_ANALYTICS_EVENT_REQUIRED_FIELDS,
  SHARED_ANALYTICS_EVENT_SUMMARY_REQUIRED_FIELDS,
  SHARED_ANALYTICS_EVENT_TRAFFIC_REQUIRED_FIELDS,
  SHARED_ANALYTICS_EVENT_QR_REQUIRED_FIELDS,
  SHARED_ANALYTICS_SPONSOR_REQUIRED_FIELDS,
  SHARED_ANALYTICS_SPONSOR_SUMMARY_REQUIRED_FIELDS,
  SHARED_ANALYTICS_SPONSOR_PLACEMENT_REQUIRED_FIELDS,
  SHARED_ANALYTICS_CUSTOMER_REQUIRED_FIELDS,
  SHARED_ANALYTICS_CUSTOMER_SUMMARY_REQUIRED_FIELDS,
  SHARED_ANALYTICS_CUSTOMER_OUTCOMES_REQUIRED_FIELDS,
  SHARED_ANALYTICS_ERROR_CODES,
  DEFAULT_EVENT_SUMMARY,
  DEFAULT_EVENT_TRAFFIC,
  DEFAULT_EVENT_QR,
  DEFAULT_SPONSOR_SUMMARY,
  DEFAULT_CUSTOMER_GEO,
  DEFAULT_CUSTOMER_SUMMARY,
  DEFAULT_CUSTOMER_OUTCOMES,
  DEFAULT_INTEGRITY,

  // Validation Functions
  isValidSharedAnalyticsIntegrity,
  isValidSharedAnalyticsWindow,
  isValidSharedAnalyticsEvent,
  isValidSharedAnalyticsSponsor,
  isValidSharedAnalyticsCustomer,
  validateSharedAnalyticsBundle,
  assertSharedAnalyticsBundle,

  // Builder Functions
  buildSharedAnalyticsIntegrity,
  buildSharedAnalyticsEvent,
  buildSharedAnalyticsSponsor,
  buildSharedAnalyticsCustomer,
  buildSharedAnalyticsBundle,
  buildSharedAnalyticsResponse,
  buildSharedAnalyticsErrorResponse,

  // Contract Compliance
  checkSharedAnalyticsBundleCompliance,

  // Logging
  logSharedAnalyticsBundleGeneration,
  logSharedAnalyticsAccess,
} from './sharedAnalytics';
