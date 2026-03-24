/**
 * Public Bundle Mapper
 *
 * Converts sheet rows to PublicBundle shape for the public surface.
 * Matches the contract from GAS api_getPublicBundle.
 *
 * @module mappers/publicBundleMapper
 * @see Story 2.1 - Worker getPublicBundle from Sheets
 * @see Story E1 - Asset State Model
 */

import {
  resolveAssetState,
  parseAssetState,
  type AssetState,
  type AssetStateInfo,
} from '../domain/assetState';

// =============================================================================
// Types
// =============================================================================

/**
 * Lifecycle phase constants - matches GAS LIFECYCLE_PHASE
 */
export const LIFECYCLE_PHASE = {
  PRE_EVENT: 'pre-event',
  EVENT_DAY: 'event-day',
  POST_EVENT: 'post-event',
} as const;

export type LifecyclePhaseValue = typeof LIFECYCLE_PHASE[keyof typeof LIFECYCLE_PHASE];

/**
 * Lifecycle phase info returned in bundle
 */
export interface LifecyclePhaseInfo {
  phase: LifecyclePhaseValue;
  label: string;
  isLive: boolean;
}

/**
 * Lifecycle phase labels - matches GAS LIFECYCLE_LABELS
 */
export const LIFECYCLE_LABELS: Record<LifecyclePhaseValue, string> = {
  'pre-event': 'Pre-Event Preparation',
  'event-day': 'Event Day - Live',
  'post-event': 'Post-Event Analytics',
};

/**
 * Brand configuration for API response (public-safe fields)
 */
export interface BrandConfigForApi {
  brandId: string;
  brandName: string;
  appTitle: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  features: {
    sponsors: boolean;
    analytics: boolean;
    templates: boolean;
  };
}

/**
 * Links object shape
 */
export interface EventLinks {
  publicUrl: string;
  displayUrl: string;
  posterUrl: string;
  signupUrl: string;
  sharedReportUrl?: string | null;
}

/**
 * QR codes object shape
 */
export interface EventQR {
  public: string;
  signup: string;
}

/**
 * CTA (Call-to-Action) shape
 */
export interface EventCTA {
  label: string;
  url: string;
}

/**
 * CTAs object shape
 */
export interface EventCTAs {
  primary: EventCTA;
  secondary?: EventCTA | null;
}

/**
 * Schedule item shape
 */
export interface ScheduleItem {
  time: string;
  title: string;
  description?: string;
}

/**
 * Standings item shape
 */
export interface StandingsItem {
  rank: number;
  team: string;
  wins: number;
  losses: number;
  points?: number;
}

/**
 * Bracket shape
 */
export interface Bracket {
  rounds?: Array<{
    name: string;
    matches: unknown[];
  }>;
  [key: string]: unknown;
}

/**
 * Sponsor placement options
 */
export interface SponsorPlacements {
  posterTop?: boolean;
  tvTop?: boolean;
  tvSide?: boolean;
  mobileBanner?: boolean;
}

/**
 * Sponsor shape
 */
export interface Sponsor {
  id: string;
  name: string;
  logoUrl?: string;
  linkUrl?: string;
  placement?: string;
  placements?: SponsorPlacements;
}

/**
 * Media shape
 */
export interface EventMedia {
  videoUrl?: string;
  mapUrl?: string;
  gallery?: unknown[];
}

/**
 * External data shape
 */
export interface ExternalData {
  scheduleUrl?: string;
  standingsUrl?: string;
  bracketUrl?: string;
}

/**
 * Settings shape - matches MVP required fields
 */
export interface EventSettings {
  showSchedule: boolean;
  showStandings: boolean;
  showBracket: boolean;
  showSponsors?: boolean;
  showVideo?: boolean;
  showMap?: boolean;
  showGallery?: boolean;
  showSponsorBanner?: boolean;
  showSponsorStrip?: boolean;
  showLeagueStrip?: boolean;
  showQRSection?: boolean;
}

/**
 * Full event shape for public bundle
 * Matches EVENT_CONTRACT.md v2.0 canonical event shape
 */
export interface PublicEvent {
  // Identity (MVP Required)
  id: string;
  slug: string;
  name: string;
  startDateISO: string;
  venue: string;
  brandId: string;
  templateId?: string | null;

  // Links (MVP Required)
  links: EventLinks;

  // QR Codes (MVP Required)
  qr: EventQR;

  // CTAs (MVP Required)
  ctas: EventCTAs;

  // Schedule/Standings/Bracket (MVP Optional)
  schedule?: ScheduleItem[] | null;
  standings?: StandingsItem[] | null;
  bracket?: Bracket | null;

  // Sponsors (V2 Optional)
  sponsors?: Sponsor[] | null;

  // Media (V2 Optional)
  media?: EventMedia | null;

  // External Data (V2 Optional)
  externalData?: ExternalData | null;

  // Settings (MVP Required)
  settings: EventSettings;

  // Timestamps (MVP Required)
  createdAtISO: string;
  updatedAtISO: string;

  // Asset State (Story E1)
  /** Whether QR codes have been verified */
  qrVerified?: boolean;
  /** Legacy status column */
  status?: 'active' | 'archived';
}

/**
 * Public Bundle value shape (inside response envelope)
 */
export interface PublicBundleValue {
  event: PublicEvent;
  config: BrandConfigForApi;
  lifecyclePhase: LifecyclePhaseInfo;
  /** Asset lifecycle state - Story E1 */
  assetState: AssetState;
  /** Asset state metadata - Story E1 */
  assetStateInfo: AssetStateInfo;
}

/**
 * Full Public Bundle response envelope
 */
export interface PublicBundleResponse {
  ok: true;
  etag: string;
  value: PublicBundleValue;
}

/**
 * 304 Not Modified response
 */
export interface PublicBundleNotModifiedResponse {
  ok: true;
  notModified: true;
  etag: string;
}

// =============================================================================
// Brand Configuration
// =============================================================================

/**
 * Brand configuration map - matches cloudflare-proxy/src/utils/brand.js
 * This is the single source of truth for Worker brand config.
 */
export const BRAND_CONFIG: Record<string, BrandConfigForApi> = Object.freeze({
  root: {
    brandId: 'root',
    brandName: 'EventAngle',
    appTitle: 'Events',
    logoUrl: null,
    primaryColor: '#2563eb',
    secondaryColor: '#1e40af',
    features: {
      sponsors: true,
      analytics: true,
      templates: true,
    },
  },
  abc: {
    brandId: 'abc',
    brandName: 'American Bocce Co',
    appTitle: 'ABC Events',
    logoUrl: null,
    primaryColor: '#dc2626',
    secondaryColor: '#991b1b',
    features: {
      sponsors: true,
      analytics: true,
      templates: true,
    },
  },
  cbc: {
    brandId: 'cbc',
    brandName: 'Chicago Bocce Club',
    appTitle: 'CBC Events',
    logoUrl: null,
    primaryColor: '#059669',
    secondaryColor: '#047857',
    features: {
      sponsors: true,
      analytics: true,
      templates: true,
    },
  },
  cbl: {
    brandId: 'cbl',
    brandName: 'Chicago Bocce League',
    appTitle: 'CBL Leagues',
    logoUrl: null,
    primaryColor: '#7c3aed',
    secondaryColor: '#6d28d9',
    features: {
      sponsors: true,
      analytics: true,
      templates: true,
    },
  },
}) as Record<string, BrandConfigForApi>;

/**
 * Valid brand IDs
 */
export const VALID_BRANDS = Object.keys(BRAND_CONFIG) as readonly string[];

/**
 * Default brand
 */
export const DEFAULT_BRAND = 'root';

/**
 * Check if brand ID is valid
 */
export function isValidBrand(brandId: string): boolean {
  return VALID_BRANDS.includes(brandId);
}

/**
 * Get brand config for API response (public-safe fields)
 */
export function getBrandConfigForApi(brandId: string): BrandConfigForApi {
  const config = BRAND_CONFIG[brandId];
  if (!config) {
    return BRAND_CONFIG[DEFAULT_BRAND];
  }
  return config;
}

// =============================================================================
// Lifecycle Phase
// =============================================================================

/**
 * Compute event lifecycle phase from startDateISO
 *
 * Ported from GAS computeLifecyclePhase_ in Code.gs
 * Single source of truth for lifecycle state interpretation.
 *
 * @param startDateISO - Event start date in YYYY-MM-DD format
 * @returns Lifecycle phase info
 */
export function computeLifecyclePhase(startDateISO: string | null | undefined): LifecyclePhaseInfo {
  if (!startDateISO) {
    return {
      phase: LIFECYCLE_PHASE.PRE_EVENT,
      label: LIFECYCLE_LABELS[LIFECYCLE_PHASE.PRE_EVENT],
      isLive: false,
    };
  }

  // Parse dates without time component for date-only comparison
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const eventDate = new Date(startDateISO);
  eventDate.setHours(0, 0, 0, 0);

  let phase: LifecyclePhaseValue = LIFECYCLE_PHASE.PRE_EVENT;

  if (eventDate.getTime() === today.getTime()) {
    phase = LIFECYCLE_PHASE.EVENT_DAY;
  } else if (eventDate < today) {
    phase = LIFECYCLE_PHASE.POST_EVENT;
  }

  return {
    phase,
    label: LIFECYCLE_LABELS[phase],
    isLive: phase === LIFECYCLE_PHASE.EVENT_DAY,
  };
}

// =============================================================================
// Sponsor Filtering
// =============================================================================

/**
 * Filter sponsors by placement for public display
 *
 * Public surface shows sponsors with mobileBanner placement.
 *
 * @param sponsors - All sponsors
 * @returns Sponsors filtered for public display
 */
export function filterSponsorsForPublic(sponsors: Sponsor[] | null | undefined): Sponsor[] {
  if (!sponsors || !Array.isArray(sponsors)) {
    return [];
  }

  return sponsors.filter((sponsor) => {
    // Check legacy placement field
    if (sponsor.placement === 'public') return true;

    // Check new placements object
    if (sponsor.placements) {
      return sponsor.placements.mobileBanner === true;
    }

    return false;
  });
}

// =============================================================================
// ETag Generation
// =============================================================================

/**
 * Generate ETag for public bundle
 *
 * Uses MD5 hash of the bundle value, matching GAS behavior.
 * Note: In Workers we use a simpler hash approach since we don't have
 * direct MD5 access. Using updatedAtISO + id as a sufficient cache key.
 *
 * @param event - Event data
 * @returns ETag string
 */
export function generatePublicBundleEtag(event: PublicEvent): string {
  // Use updatedAtISO as primary cache invalidation key
  // Falls back to id + name hash for events without updatedAtISO
  const key = event.updatedAtISO || `${event.id}-${event.name}`;
  return `W/"public-${key}"`;
}

/**
 * Generate content-based ETag using Web Crypto API
 *
 * For full GAS parity, compute MD5-like hash of the bundle value.
 * This is async because it uses the Web Crypto API.
 *
 * @param value - Bundle value to hash
 * @returns Promise resolving to ETag string
 */
export async function generateContentEtag(value: PublicBundleValue): Promise<string> {
  const json = JSON.stringify(value);
  const encoder = new TextEncoder();
  const data = encoder.encode(json);

  // Use SHA-256 (more secure than MD5, available in Web Crypto)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  // Return first 16 chars (64 bits) as base64-like string
  return btoa(hashHex.slice(0, 16));
}

// =============================================================================
// Row to Event Mapping
// =============================================================================

/**
 * Column indices for EVENTS sheet (0-based)
 *
 * Story E1: Added ASSET_STATE column (J = index 9)
 */
export const EVENT_COL = {
  ID: 0,
  BRAND_ID: 1,
  TEMPLATE_ID: 2,
  DATA_JSON: 3,
  CREATED_AT: 4,
  SLUG: 5,
  UPDATED_AT: 6,
  STATUS: 7,      // Story D2: active | archived
  IS_DEFAULT: 8,  // Story D3: default event flag
  ASSET_STATE: 9, // Story E1: asset lifecycle state
} as const;

/**
 * Parse event row from sheet to PublicEvent
 *
 * Story E1: Includes status for asset state resolution
 *
 * @param row - Sheet row data
 * @returns Parsed event or null if invalid
 */
export function parseEventRow(row: string[]): PublicEvent | null {
  if (!row || row.length < 4) return null;

  const id = row[EVENT_COL.ID];
  const dataJson = row[EVENT_COL.DATA_JSON];

  if (!id || !dataJson) return null;

  try {
    const event = JSON.parse(dataJson) as PublicEvent;
    const statusValue = row[EVENT_COL.STATUS];
    const status = (statusValue === 'active' || statusValue === 'archived')
      ? statusValue
      : 'active';

    // Ensure ID from column matches and brandId is set
    return {
      ...event,
      id,
      brandId: row[EVENT_COL.BRAND_ID] || event.brandId || 'root',
      templateId: row[EVENT_COL.TEMPLATE_ID] || event.templateId || null,
      // Story E1: Include status for asset state resolution
      status,
    };
  } catch (e) {
    console.error(`Failed to parse event ${id}:`, e);
    return null;
  }
}

// =============================================================================
// Public Bundle Builder
// =============================================================================

/**
 * Build public bundle value from event
 *
 * Story E1: Includes assetState in bundle
 *
 * @param event - Full event data
 * @param brandId - Brand ID for config lookup
 * @returns Public bundle value
 */
export function buildPublicBundleValue(
  event: PublicEvent,
  brandId: string
): PublicBundleValue {
  // Filter sponsors for public display
  const publicSponsors = filterSponsorsForPublic(event.sponsors);

  // Compute lifecycle phase
  const lifecyclePhase = computeLifecyclePhase(event.startDateISO);

  // Get brand config
  const config = getBrandConfigForApi(brandId);

  // Story E1: Resolve asset state
  const assetStateInfo = resolveAssetState({
    id: event.id,
    name: event.name,
    startDateISO: event.startDateISO,
    venue: event.venue,
    status: event.status,
    qrVerified: event.qrVerified,
    qr: event.qr,
  });

  return {
    event: {
      ...event,
      sponsors: publicSponsors,
    },
    config,
    lifecyclePhase,
    assetState: assetStateInfo.state,
    assetStateInfo,
  };
}

/**
 * Build complete public bundle response
 *
 * @param event - Full event data
 * @param brandId - Brand ID
 * @param etag - Pre-computed ETag (optional)
 * @returns Public bundle response
 */
export async function buildPublicBundleResponse(
  event: PublicEvent,
  brandId: string,
  etag?: string
): Promise<PublicBundleResponse> {
  const value = buildPublicBundleValue(event, brandId);

  // Use provided ETag or generate content-based one
  const finalEtag = etag || (await generateContentEtag(value));

  return {
    ok: true,
    etag: finalEtag,
    value,
  };
}
