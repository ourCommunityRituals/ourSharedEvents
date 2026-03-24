/**
 * Admin Bundle Mapper
 *
 * Converts sheet rows to AdminBundle shape for the admin surface.
 * Matches the contract from GAS api_getAdminBundle.
 *
 * Admin bundle includes full event data plus admin-specific fields:
 * - brandConfig (allowed templates, default template)
 * - templates (available templates for dropdown)
 * - diagnostics (form status, shortlinks count)
 * - allSponsors (all sponsors for linking dropdown)
 * - lifecyclePhase (event lifecycle state)
 *
 * @module mappers/adminBundleMapper
 * @see Story 2.2 - Worker getAdminBundle from Sheets
 */

import {
  type PublicEvent,
  type LifecyclePhaseInfo,
  type Sponsor,
  computeLifecyclePhase,
  getBrandConfigForApi,
  parseEventRow,
  BRAND_CONFIG,
  DEFAULT_BRAND,
  isValidBrand,
  EVENT_COL,
} from './publicBundleMapper';

// =============================================================================
// Admin-Specific Types
// =============================================================================

/**
 * Template definition for admin dropdown
 */
export interface AdminTemplate {
  id: string;
  label: string;
  description?: string;
}

/**
 * Admin brand config with template settings
 */
export interface AdminBrandConfig {
  brandId: string;
  allowedTemplates: string[];
  defaultTemplateId: string | null;
}

/**
 * Event diagnostics for admin display
 */
export interface EventDiagnostics {
  formStatus: 'ok' | 'error' | 'pending' | 'not_configured';
  shortlinksCount: number;
  lastSyncedAt?: string | null;
  warnings?: string[];
}

/**
 * Sponsor summary for admin dropdown
 */
export interface AdminSponsor {
  id: string;
  name: string;
  logoUrl?: string | null;
  website?: string | null;
  tier?: string | null;
  entity?: string | null;
}

/**
 * Admin Bundle value shape (inside response envelope)
 */
export interface AdminBundleValue {
  /** Full canonical event shape */
  event: PublicEvent;
  /** Brand configuration for admin (templates, defaults) */
  brandConfig: AdminBrandConfig;
  /** Available templates for this brand */
  templates: AdminTemplate[];
  /** System diagnostics (readonly in UI) */
  diagnostics: EventDiagnostics;
  /** All sponsors for dropdown/linking */
  allSponsors: AdminSponsor[];
  /** Lifecycle phase for consistent state interpretation */
  lifecyclePhase: LifecyclePhaseInfo;
}

/**
 * Full Admin Bundle response envelope
 */
export interface AdminBundleResponse {
  ok: true;
  etag: string;
  value: AdminBundleValue;
}

/**
 * 304 Not Modified response
 */
export interface AdminBundleNotModifiedResponse {
  ok: true;
  notModified: true;
  etag: string;
}

// =============================================================================
// Template Configuration
// =============================================================================

/**
 * Available templates per brand
 *
 * In a full implementation, this would come from a TEMPLATES sheet.
 * For MVP, we define the common templates inline.
 */
export const TEMPLATES: AdminTemplate[] = [
  { id: 'event', label: 'Standard Event', description: 'Basic event template' },
  { id: 'tournament', label: 'Tournament', description: 'Bracket-style tournament' },
  { id: 'league', label: 'League', description: 'League with standings' },
  { id: 'rec_league', label: 'Recreational League', description: 'Casual league format' },
];

/**
 * Brand template configuration
 *
 * Defines which templates are allowed per brand and the default.
 */
export const BRAND_TEMPLATE_CONFIG: Record<string, { templates: string[]; defaultTemplateId: string | null }> = {
  root: {
    templates: ['event', 'tournament', 'league', 'rec_league'],
    defaultTemplateId: 'event',
  },
  abc: {
    templates: ['event', 'tournament', 'league', 'rec_league'],
    defaultTemplateId: 'event',
  },
  cbc: {
    templates: ['event', 'tournament', 'league', 'rec_league'],
    defaultTemplateId: 'event',
  },
  cbl: {
    templates: ['league', 'rec_league'],
    defaultTemplateId: 'league',
  },
};

// =============================================================================
// Admin Config Functions
// =============================================================================

/**
 * Get brand configuration for admin bundle
 *
 * @param brandId - Brand ID
 * @returns Admin brand config with template settings
 */
export function getAdminBrandConfig(brandId: string): AdminBrandConfig {
  const config = BRAND_TEMPLATE_CONFIG[brandId];
  if (!config) {
    const defaultConfig = BRAND_TEMPLATE_CONFIG[DEFAULT_BRAND];
    return {
      brandId,
      allowedTemplates: defaultConfig.templates,
      defaultTemplateId: defaultConfig.defaultTemplateId,
    };
  }

  return {
    brandId,
    allowedTemplates: config.templates,
    defaultTemplateId: config.defaultTemplateId,
  };
}

/**
 * Get available templates for a brand
 *
 * Returns template definitions filtered by brand's allowed templates.
 *
 * @param brandId - Brand ID
 * @returns Array of template definitions
 */
export function getTemplatesForBrand(brandId: string): AdminTemplate[] {
  const config = BRAND_TEMPLATE_CONFIG[brandId] || BRAND_TEMPLATE_CONFIG[DEFAULT_BRAND];
  const allowedIds = config.templates;

  return TEMPLATES.filter((t) => allowedIds.includes(t.id));
}

// =============================================================================
// Diagnostics
// =============================================================================

/**
 * Build event diagnostics
 *
 * For Worker MVP, we return basic diagnostics.
 * Full diagnostics (form status, shortlinks) would require additional sheet reads.
 *
 * @param event - Event data
 * @returns Event diagnostics
 */
export function buildEventDiagnostics(event: PublicEvent): EventDiagnostics {
  const warnings: string[] = [];

  // Check for potential issues
  if (!event.links?.signupUrl) {
    warnings.push('No signup URL configured');
  }
  if (!event.qr?.public || !event.qr?.signup) {
    warnings.push('QR codes may not be configured');
  }

  return {
    formStatus: event.links?.signupUrl ? 'ok' : 'not_configured',
    shortlinksCount: 0, // Would need SHORTLINKS sheet to compute
    lastSyncedAt: event.updatedAtISO || null,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// =============================================================================
// Sponsor Mapping for Admin
// =============================================================================

/**
 * Map sponsors to admin format
 *
 * Returns all sponsors (not filtered) with admin-specific fields.
 *
 * @param sponsors - Array of sponsors from event
 * @returns Admin sponsor summaries
 */
export function mapSponsorsForAdmin(sponsors: Sponsor[] | null | undefined): AdminSponsor[] {
  if (!sponsors || !Array.isArray(sponsors)) {
    return [];
  }

  return sponsors.map((s) => ({
    id: s.id,
    name: s.name,
    logoUrl: s.logoUrl || null,
    website: s.linkUrl || null,
    tier: null, // Would come from extended sponsor data
    entity: null, // Would come from extended sponsor data
  }));
}

// =============================================================================
// ETag Generation
// =============================================================================

/**
 * Generate content-based ETag for admin bundle using Web Crypto API
 *
 * @param value - Bundle value to hash
 * @returns Promise resolving to ETag string
 */
export async function generateAdminBundleEtag(value: AdminBundleValue): Promise<string> {
  const json = JSON.stringify(value);
  const encoder = new TextEncoder();
  const data = encoder.encode(json);

  // Use SHA-256 (more secure than MD5, available in Web Crypto)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  // Return first 16 chars (64 bits) as base64-like string, prefixed with admin
  return btoa(hashHex.slice(0, 16));
}

// =============================================================================
// Admin Bundle Builder
// =============================================================================

/**
 * Build admin bundle value from event
 *
 * @param event - Full event data
 * @param brandId - Brand ID for config lookup
 * @param allSponsors - All sponsors for brand (optional, defaults to event sponsors)
 * @returns Admin bundle value
 */
export function buildAdminBundleValue(
  event: PublicEvent,
  brandId: string,
  allSponsors?: AdminSponsor[]
): AdminBundleValue {
  // Get admin-specific configs
  const brandConfig = getAdminBrandConfig(brandId);
  const templates = getTemplatesForBrand(brandId);
  const diagnostics = buildEventDiagnostics(event);
  const lifecyclePhase = computeLifecyclePhase(event.startDateISO);

  // Use provided sponsors or map from event sponsors
  const sponsors = allSponsors || mapSponsorsForAdmin(event.sponsors);

  return {
    event,
    brandConfig,
    templates,
    diagnostics,
    allSponsors: sponsors,
    lifecyclePhase,
  };
}

/**
 * Build complete admin bundle response
 *
 * @param event - Full event data
 * @param brandId - Brand ID
 * @param allSponsors - Optional all sponsors for brand
 * @param etag - Pre-computed ETag (optional)
 * @returns Admin bundle response
 */
export async function buildAdminBundleResponse(
  event: PublicEvent,
  brandId: string,
  allSponsors?: AdminSponsor[],
  etag?: string
): Promise<AdminBundleResponse> {
  const value = buildAdminBundleValue(event, brandId, allSponsors);

  // Use provided ETag or generate content-based one
  const finalEtag = etag || (await generateAdminBundleEtag(value));

  return {
    ok: true,
    etag: finalEtag,
    value,
  };
}

// =============================================================================
// Re-exports from publicBundleMapper
// =============================================================================

export {
  type PublicEvent,
  type LifecyclePhaseInfo,
  type Sponsor,
  computeLifecyclePhase,
  getBrandConfigForApi,
  parseEventRow,
  BRAND_CONFIG,
  DEFAULT_BRAND,
  isValidBrand,
  EVENT_COL,
};
