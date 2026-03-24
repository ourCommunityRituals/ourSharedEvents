/**
 * Worker Mappers Exports
 *
 * Barrel file for exporting all mapper modules.
 *
 * @module mappers
 * @see Story 2.1 - Worker getPublicBundle from Sheets
 * @see Story 2.2 - Worker getAdminBundle from Sheets
 */

// Public Bundle Mapper
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
  type PublicBundleResponse,
  type PublicBundleNotModifiedResponse,

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
} from './publicBundleMapper';

// Admin Bundle Mapper (Story 2.2)
export {
  // Types
  type AdminTemplate,
  type AdminBrandConfig,
  type EventDiagnostics,
  type AdminSponsor,
  type AdminBundleValue,
  type AdminBundleResponse,
  type AdminBundleNotModifiedResponse,

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
} from './adminBundleMapper';
