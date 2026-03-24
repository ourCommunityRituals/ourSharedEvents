/**
 * Sponsor Domain Contract
 *
 * Story F1: Sponsor Object Contract (Single Source of Truth)
 *
 * This module defines the locked sponsor contract for monetization.
 * Sponsors must trust that what they see is accurate, consistent,
 * and reproducible.
 *
 * CONTRACT VERSION: 1.0.0
 * BREAKING CHANGE POLICY: Any field removal or type change requires version bump
 *
 * MVP Fields (read-only from backend):
 *   - sponsorId: Unique identifier
 *   - name: Display name
 *   - tier: Sponsorship tier (title, platinum, gold, silver, bronze, primary)
 *   - events: Array of event IDs associated with sponsor
 *
 * Computed Fields (aggregated at backend - NO UI math):
 *   - metrics.impressions: Total page views where sponsor was visible
 *   - metrics.scans: Total QR code scans attributed to sponsor
 *   - metrics.conversions: Total click-throughs on sponsor links
 *
 * Display Fields (for rendering - read-only):
 *   - logoUrl: URL to sponsor logo
 *   - linkUrl: Click-through URL
 *   - placements: Surface placement configuration
 *
 * @module domain/sponsor
 * @see Story F1 - Sponsor Object Contract (Single Source of Truth)
 * @see /schemas/sponsor.schema.json
 */

// =============================================================================
// Contract Version
// =============================================================================

/**
 * Current sponsor contract version
 *
 * LOCKED CONTRACT - Increment for breaking changes:
 *   - Major: Field removed or type changed
 *   - Minor: New optional field added
 *   - Patch: Documentation or validation only
 *
 * Version History:
 *   - 1.0.0: Initial MVP contract
 *   - 1.1.0: Story F4 - Added monetization hooks (billableUnits, billingWindow)
 */
export const SPONSOR_CONTRACT_VERSION = '1.1.0' as const;

// =============================================================================
// Story F4: Monetization Readiness Hooks (No Billing Yet)
// =============================================================================

/**
 * Billable unit types for monetization
 *
 * Story F4: Monetization Readiness Hooks
 *
 * These are the monetizable signals that can be tracked:
 *   - qrScans: QR code scans attributed to sponsor
 *   - impressions: Page views where sponsor was visible
 *   - eventCount: Number of events associated with sponsor
 *
 * INERT: These fields are for future billing integration.
 * NO billing logic is executed. NO payment processing.
 */
export interface BillableUnits {
  /** QR code scans attributed to sponsor */
  qrScans: number;
  /** Page impressions where sponsor was visible */
  impressions: number;
  /** Number of events associated with sponsor */
  eventCount: number;
}

/**
 * Required billable unit fields for validation
 */
export const BILLABLE_UNITS_REQUIRED_FIELDS = [
  'qrScans',
  'impressions',
  'eventCount',
] as const;

/**
 * Billing window for aggregation period
 *
 * Story F4: Monetization Readiness Hooks
 *
 * Defines the time window for billable unit aggregation.
 * INERT: Used for future billing calculations.
 */
export interface BillingWindow {
  /** Start of billing window (ISO 8601) */
  windowStart: string;
  /** End of billing window (ISO 8601) */
  windowEnd: string;
}

/**
 * Required billing window fields for validation
 */
export const BILLING_WINDOW_REQUIRED_FIELDS = [
  'windowStart',
  'windowEnd',
] as const;

/**
 * Monetization hooks for sponsor
 *
 * Story F4: Monetization Readiness Hooks
 *
 * FUTURE-PROOFING: These fields prepare for monetization without
 * coupling billing logic to product logic. Pricing can be added
 * without refactoring existing code.
 *
 * INVARIANTS:
 *   - Fields are INERT (no side effects)
 *   - No billing logic is executed
 *   - No user-visible billing UI
 *   - Read-only exposure via API
 *
 * @see Story F4 - Monetization Readiness Hooks (No Billing Yet)
 */
export interface MonetizationHooks {
  /** Aggregated billable units from analytics */
  billableUnits: BillableUnits;
  /** Billing window for this aggregation */
  billingWindow: BillingWindow;
  /** Whether monetization data is available */
  dataAvailable: boolean;
  /** Human-readable status message */
  statusMessage: string;
}

/**
 * Required monetization hooks fields for validation
 */
export const MONETIZATION_HOOKS_REQUIRED_FIELDS = [
  'billableUnits',
  'billingWindow',
  'dataAvailable',
  'statusMessage',
] as const;

/**
 * Default billable units (zeros - no data accumulated)
 */
export const DEFAULT_BILLABLE_UNITS: BillableUnits = {
  qrScans: 0,
  impressions: 0,
  eventCount: 0,
};

/**
 * Default billing window (empty)
 */
export const DEFAULT_BILLING_WINDOW: BillingWindow = {
  windowStart: '',
  windowEnd: '',
};

/**
 * Default monetization hooks (no data)
 */
export const DEFAULT_MONETIZATION_HOOKS: MonetizationHooks = {
  billableUnits: DEFAULT_BILLABLE_UNITS,
  billingWindow: DEFAULT_BILLING_WINDOW,
  dataAvailable: false,
  statusMessage: 'No monetization data available',
};

// =============================================================================
// Types - MVP Sponsor Contract
// =============================================================================

/**
 * Valid sponsor tiers
 *
 * LOCKED CONTRACT - Do not modify without version bump
 */
export const VALID_SPONSOR_TIERS = [
  'title',
  'platinum',
  'gold',
  'silver',
  'bronze',
  'primary',
] as const;

export type SponsorTier = typeof VALID_SPONSOR_TIERS[number];

/**
 * Sponsor metrics - computed at backend
 *
 * LOCKED CONTRACT - All aggregation happens server-side.
 * UI must NEVER compute these values.
 *
 * INVARIANT: metrics are always non-negative integers
 */
export interface SponsorMetrics {
  /** Total page views where sponsor was visible */
  impressions: number;
  /** Total QR code scans attributed to sponsor */
  scans: number;
  /** Total click-throughs on sponsor links (conversions) */
  conversions: number;
}

/**
 * Sponsor placement configuration
 *
 * LOCKED CONTRACT - Determines which surfaces display this sponsor
 */
export interface SponsorPlacements {
  /** Show on poster top banner */
  posterTop?: boolean;
  /** Show on TV display top banner */
  tvTop?: boolean;
  /** Show on TV display side panel */
  tvSide?: boolean;
  /** Show on mobile/public banner */
  mobileBanner?: boolean;
}

/**
 * MVP Sponsor Contract - Single Source of Truth
 *
 * LOCKED CONTRACT - All sponsor endpoints MUST return this shape.
 * Any endpoint returning partial or ad-hoc sponsor data is a contract violation.
 *
 * Field Categories:
 *   - READ-ONLY: sponsorId, name, tier, logoUrl, linkUrl, placements
 *   - COMPUTED: metrics (aggregated at backend)
 *   - ASSOCIATION: events[] (linked event IDs)
 */
export interface SponsorContract {
  /** Unique sponsor identifier (READ-ONLY) */
  sponsorId: string;
  /** Sponsor display name (READ-ONLY) */
  name: string;
  /** Sponsorship tier for display priority (READ-ONLY) */
  tier: SponsorTier | null;
  /** Associated event IDs (READ-ONLY) */
  events: string[];
  /** Aggregated metrics - COMPUTED AT BACKEND (READ-ONLY) */
  metrics: SponsorMetrics;

  // Display fields (optional, for rendering)
  /** URL to sponsor logo */
  logoUrl?: string | null;
  /** Click-through URL */
  linkUrl?: string | null;
  /** Surface placement configuration */
  placements?: SponsorPlacements | null;
}

/**
 * Required fields for SponsorContract validation
 *
 * Used by contract tests to ensure no field is accidentally removed.
 */
export const SPONSOR_CONTRACT_REQUIRED_FIELDS = [
  'sponsorId',
  'name',
  'tier',
  'events',
  'metrics',
] as const;

/**
 * Required fields for SponsorMetrics validation
 */
export const SPONSOR_METRICS_REQUIRED_FIELDS = [
  'impressions',
  'scans',
  'conversions',
] as const;

// =============================================================================
// Types - Legacy Display Sponsor (for backward compatibility)
// =============================================================================

/**
 * Legacy sponsor shape (from event data)
 *
 * This is the input format from sheet data.
 * Use normalizeSponsor() to convert to SponsorContract.
 */
export interface LegacySponsor {
  id: string;
  name: string;
  logoUrl?: string;
  linkUrl?: string;
  placement?: string;
  placements?: SponsorPlacements;
  tier?: string;
  clickToken?: string | null;
  impressionToken?: string | null;
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Check if a value is a valid sponsor tier
 */
export function isValidSponsorTier(value: unknown): value is SponsorTier {
  return typeof value === 'string' && VALID_SPONSOR_TIERS.includes(value as SponsorTier);
}

/**
 * Check if a value is a valid sponsor ID format
 *
 * ID format: alphanumeric with hyphens and underscores, max 128 chars
 */
export function isValidSponsorId(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > 128) return false;
  return /^[a-zA-Z0-9_-]+$/.test(value);
}

/**
 * Validate SponsorMetrics shape
 *
 * INVARIANT: All metrics must be non-negative integers
 */
export function isValidSponsorMetrics(metrics: unknown): metrics is SponsorMetrics {
  if (!metrics || typeof metrics !== 'object') return false;

  const m = metrics as Record<string, unknown>;

  // Check all required fields exist and are non-negative integers
  for (const field of SPONSOR_METRICS_REQUIRED_FIELDS) {
    if (!(field in m)) return false;
    const value = m[field];
    if (typeof value !== 'number' || value < 0 || !Number.isInteger(value)) {
      return false;
    }
  }

  return true;
}

/**
 * Validate full SponsorContract shape
 *
 * Returns validation result with specific error if invalid.
 */
export function validateSponsorContract(
  sponsor: unknown
): { valid: true } | { valid: false; error: string } {
  if (!sponsor || typeof sponsor !== 'object') {
    return { valid: false, error: 'Sponsor must be a non-null object' };
  }

  const s = sponsor as Record<string, unknown>;

  // Check sponsorId
  if (!('sponsorId' in s) || typeof s.sponsorId !== 'string') {
    return { valid: false, error: 'Missing or invalid sponsorId' };
  }
  if (!isValidSponsorId(s.sponsorId)) {
    return { valid: false, error: 'Invalid sponsorId format' };
  }

  // Check name
  if (!('name' in s) || typeof s.name !== 'string') {
    return { valid: false, error: 'Missing or invalid name' };
  }
  if (s.name.length === 0 || s.name.length > 200) {
    return { valid: false, error: 'Name must be 1-200 characters' };
  }

  // Check tier (can be null)
  if (!('tier' in s)) {
    return { valid: false, error: 'Missing tier field' };
  }
  if (s.tier !== null && !isValidSponsorTier(s.tier)) {
    return { valid: false, error: 'Invalid tier value' };
  }

  // Check events array
  if (!('events' in s) || !Array.isArray(s.events)) {
    return { valid: false, error: 'Missing or invalid events array' };
  }
  for (const eventId of s.events) {
    if (typeof eventId !== 'string') {
      return { valid: false, error: 'Events array must contain only strings' };
    }
  }

  // Check metrics
  if (!('metrics' in s)) {
    return { valid: false, error: 'Missing metrics object' };
  }
  if (!isValidSponsorMetrics(s.metrics)) {
    return { valid: false, error: 'Invalid metrics object' };
  }

  return { valid: true };
}

/**
 * Assert sponsor contract is valid (throws if invalid)
 *
 * Use in endpoints to ensure response matches contract.
 */
export function assertSponsorContract(sponsor: unknown): asserts sponsor is SponsorContract {
  const result = validateSponsorContract(sponsor);
  if (!result.valid) {
    throw new Error(`[SponsorContract] Validation failed: ${result.error}`);
  }
}

// =============================================================================
// Story F4: Monetization Hooks Validation
// =============================================================================

/**
 * Validate BillableUnits shape
 *
 * INVARIANT: All billable units must be non-negative integers
 */
export function isValidBillableUnits(units: unknown): units is BillableUnits {
  if (!units || typeof units !== 'object') return false;

  const u = units as Record<string, unknown>;

  // Check all required fields exist and are non-negative integers
  for (const field of BILLABLE_UNITS_REQUIRED_FIELDS) {
    if (!(field in u)) return false;
    const value = u[field];
    if (typeof value !== 'number' || value < 0 || !Number.isInteger(value)) {
      return false;
    }
  }

  return true;
}

/**
 * Validate BillingWindow shape
 *
 * Window can be empty (no data yet) but if present must be valid ISO dates
 */
export function isValidBillingWindow(window: unknown): window is BillingWindow {
  if (!window || typeof window !== 'object') return false;

  const w = window as Record<string, unknown>;

  // Check required fields exist
  for (const field of BILLING_WINDOW_REQUIRED_FIELDS) {
    if (!(field in w)) return false;
    if (typeof w[field] !== 'string') return false;
  }

  // Empty window is valid (no data yet)
  if (w.windowStart === '' && w.windowEnd === '') {
    return true;
  }

  // If populated, validate ISO 8601 format
  const windowStart = new Date(w.windowStart as string);
  const windowEnd = new Date(w.windowEnd as string);

  if (isNaN(windowStart.getTime()) || isNaN(windowEnd.getTime())) {
    return false;
  }

  // windowEnd must be after or equal to windowStart
  if (windowEnd < windowStart) {
    return false;
  }

  return true;
}

/**
 * Validate MonetizationHooks shape
 *
 * Story F4: These fields are INERT - validation only checks shape,
 * no billing logic is executed.
 */
export function isValidMonetizationHooks(hooks: unknown): hooks is MonetizationHooks {
  if (!hooks || typeof hooks !== 'object') return false;

  const h = hooks as Record<string, unknown>;

  // Check required fields
  for (const field of MONETIZATION_HOOKS_REQUIRED_FIELDS) {
    if (!(field in h)) return false;
  }

  // Validate nested structures
  if (!isValidBillableUnits(h.billableUnits)) return false;
  if (!isValidBillingWindow(h.billingWindow)) return false;
  if (typeof h.dataAvailable !== 'boolean') return false;
  if (typeof h.statusMessage !== 'string') return false;

  return true;
}

/**
 * Validate full MonetizationHooks with error details
 */
export function validateMonetizationHooks(
  hooks: unknown
): { valid: true } | { valid: false; error: string } {
  if (!hooks || typeof hooks !== 'object') {
    return { valid: false, error: 'MonetizationHooks must be a non-null object' };
  }

  const h = hooks as Record<string, unknown>;

  // Check billableUnits
  if (!('billableUnits' in h)) {
    return { valid: false, error: 'Missing billableUnits' };
  }
  if (!isValidBillableUnits(h.billableUnits)) {
    return { valid: false, error: 'Invalid billableUnits' };
  }

  // Check billingWindow
  if (!('billingWindow' in h)) {
    return { valid: false, error: 'Missing billingWindow' };
  }
  if (!isValidBillingWindow(h.billingWindow)) {
    return { valid: false, error: 'Invalid billingWindow' };
  }

  // Check dataAvailable
  if (!('dataAvailable' in h) || typeof h.dataAvailable !== 'boolean') {
    return { valid: false, error: 'Missing or invalid dataAvailable' };
  }

  // Check statusMessage
  if (!('statusMessage' in h) || typeof h.statusMessage !== 'string') {
    return { valid: false, error: 'Missing or invalid statusMessage' };
  }

  return { valid: true };
}

/**
 * Assert monetization hooks are valid (throws if invalid)
 */
export function assertMonetizationHooks(hooks: unknown): asserts hooks is MonetizationHooks {
  const result = validateMonetizationHooks(hooks);
  if (!result.valid) {
    throw new Error(`[MonetizationHooks] Validation failed: ${result.error}`);
  }
}

// =============================================================================
// Normalization
// =============================================================================

/**
 * Default metrics for sponsors without analytics data
 */
export const DEFAULT_SPONSOR_METRICS: SponsorMetrics = {
  impressions: 0,
  scans: 0,
  conversions: 0,
};

/**
 * Normalize a legacy sponsor to the MVP SponsorContract shape
 *
 * BACKEND NORMALIZATION: This ensures all sponsor endpoints return
 * identical shape regardless of data source.
 *
 * @param legacy - Legacy sponsor from sheet/event data
 * @param eventIds - Array of event IDs this sponsor is associated with
 * @param metrics - Optional pre-computed metrics (defaults to zeros)
 * @returns Normalized SponsorContract
 */
export function normalizeSponsor(
  legacy: LegacySponsor,
  eventIds: string[] = [],
  metrics: Partial<SponsorMetrics> = {}
): SponsorContract {
  // Normalize tier
  let tier: SponsorTier | null = null;
  if (legacy.tier && isValidSponsorTier(legacy.tier)) {
    tier = legacy.tier;
  }

  // Normalize metrics (ensure all fields present with defaults)
  const normalizedMetrics: SponsorMetrics = {
    impressions: metrics.impressions ?? DEFAULT_SPONSOR_METRICS.impressions,
    scans: metrics.scans ?? DEFAULT_SPONSOR_METRICS.scans,
    conversions: metrics.conversions ?? DEFAULT_SPONSOR_METRICS.conversions,
  };

  // Normalize placements
  let placements: SponsorPlacements | null = null;
  if (legacy.placements) {
    placements = {
      posterTop: legacy.placements.posterTop ?? false,
      tvTop: legacy.placements.tvTop ?? false,
      tvSide: legacy.placements.tvSide ?? false,
      mobileBanner: legacy.placements.mobileBanner ?? false,
    };
  } else if (legacy.placement) {
    // Convert legacy single placement to placements object
    placements = convertLegacyPlacement(legacy.placement);
  }

  return {
    sponsorId: legacy.id,
    name: legacy.name,
    tier,
    events: eventIds,
    metrics: normalizedMetrics,
    logoUrl: legacy.logoUrl ?? null,
    linkUrl: legacy.linkUrl ?? null,
    placements,
  };
}

/**
 * Convert legacy single placement string to placements object
 */
function convertLegacyPlacement(placement: string): SponsorPlacements {
  switch (placement) {
    case 'poster':
      return { posterTop: true, tvTop: false, tvSide: false, mobileBanner: false };
    case 'display':
    case 'tv-banner':
      return { posterTop: false, tvTop: true, tvSide: true, mobileBanner: false };
    case 'public':
      return { posterTop: false, tvTop: false, tvSide: false, mobileBanner: true };
    default:
      return { posterTop: false, tvTop: false, tvSide: false, mobileBanner: false };
  }
}

/**
 * Normalize an array of legacy sponsors
 *
 * @param sponsors - Array of legacy sponsors
 * @param eventId - Event ID to associate with all sponsors
 * @returns Array of normalized SponsorContracts
 */
export function normalizeSponsors(
  sponsors: LegacySponsor[] | null | undefined,
  eventId?: string
): SponsorContract[] {
  if (!sponsors || !Array.isArray(sponsors)) {
    return [];
  }

  const eventIds = eventId ? [eventId] : [];

  return sponsors.map((legacy) => normalizeSponsor(legacy, eventIds));
}

// =============================================================================
// Aggregation Rules
// =============================================================================

/**
 * Aggregate metrics from multiple sources
 *
 * BACKEND AGGREGATION: All metric computation happens here.
 * UI receives final computed values only.
 *
 * @param sources - Array of partial metrics to aggregate
 * @returns Aggregated metrics
 */
export function aggregateSponsorMetrics(
  sources: Array<Partial<SponsorMetrics>>
): SponsorMetrics {
  return sources.reduce(
    (acc, source) => ({
      impressions: acc.impressions + (source.impressions ?? 0),
      scans: acc.scans + (source.scans ?? 0),
      conversions: acc.conversions + (source.conversions ?? 0),
    }),
    { ...DEFAULT_SPONSOR_METRICS }
  );
}

/**
 * Compute click-through rate (CTR) from metrics
 *
 * BACKEND COMPUTATION: Returns percentage as number (e.g., 2.5 = 2.5%)
 *
 * @param metrics - Sponsor metrics
 * @returns CTR as percentage (0-100)
 */
export function computeCTR(metrics: SponsorMetrics): number {
  if (metrics.impressions === 0) return 0;
  return (metrics.conversions / metrics.impressions) * 100;
}

// =============================================================================
// Contract Drift Detection
// =============================================================================

/**
 * Check if sponsor object matches current contract version
 *
 * Used by CI/CD to detect contract drift.
 *
 * @param sponsor - Object to check
 * @returns Object with match status and details
 */
export function checkContractCompliance(sponsor: unknown): {
  compliant: boolean;
  version: string;
  missingFields: string[];
  invalidFields: string[];
} {
  const missingFields: string[] = [];
  const invalidFields: string[] = [];

  if (!sponsor || typeof sponsor !== 'object') {
    return {
      compliant: false,
      version: SPONSOR_CONTRACT_VERSION,
      missingFields: [...SPONSOR_CONTRACT_REQUIRED_FIELDS],
      invalidFields: ['_root: not an object'],
    };
  }

  const s = sponsor as Record<string, unknown>;

  // Check required fields
  for (const field of SPONSOR_CONTRACT_REQUIRED_FIELDS) {
    if (!(field in s)) {
      missingFields.push(field);
    }
  }

  // Validate field types
  if ('sponsorId' in s && !isValidSponsorId(s.sponsorId)) {
    invalidFields.push('sponsorId: invalid format');
  }

  if ('name' in s && (typeof s.name !== 'string' || s.name.length === 0)) {
    invalidFields.push('name: must be non-empty string');
  }

  if ('tier' in s && s.tier !== null && !isValidSponsorTier(s.tier)) {
    invalidFields.push('tier: invalid value');
  }

  if ('events' in s && !Array.isArray(s.events)) {
    invalidFields.push('events: must be an array');
  }

  if ('metrics' in s && !isValidSponsorMetrics(s.metrics)) {
    invalidFields.push('metrics: invalid shape');
  }

  return {
    compliant: missingFields.length === 0 && invalidFields.length === 0,
    version: SPONSOR_CONTRACT_VERSION,
    missingFields,
    invalidFields,
  };
}

// =============================================================================
// API Response Helpers
// =============================================================================

/**
 * Build sponsor contract response for API
 *
 * Ensures response includes contract version for client compatibility checks.
 */
export function buildSponsorResponse(sponsor: SponsorContract): {
  sponsor: SponsorContract;
  _contractVersion: string;
} {
  // Validate before sending
  assertSponsorContract(sponsor);

  return {
    sponsor,
    _contractVersion: SPONSOR_CONTRACT_VERSION,
  };
}

/**
 * Build sponsors array response for API
 *
 * Ensures all sponsors in array are contract-compliant.
 */
export function buildSponsorsResponse(sponsors: SponsorContract[]): {
  sponsors: SponsorContract[];
  _contractVersion: string;
  count: number;
} {
  // Validate all sponsors
  for (const sponsor of sponsors) {
    assertSponsorContract(sponsor);
  }

  return {
    sponsors,
    _contractVersion: SPONSOR_CONTRACT_VERSION,
    count: sponsors.length,
  };
}

// =============================================================================
// Logging & Diagnostics
// =============================================================================

/**
 * Log sponsor contract validation for debugging/audit
 */
export function logSponsorContractCheck(
  sponsorId: string,
  compliance: ReturnType<typeof checkContractCompliance>
): void {
  const timestamp = new Date().toISOString();

  console.log(JSON.stringify({
    type: 'SPONSOR_CONTRACT_CHECK',
    timestamp,
    sponsorId,
    compliant: compliance.compliant,
    version: compliance.version,
    missingFields: compliance.missingFields,
    invalidFields: compliance.invalidFields,
    invariant: 'F1_SPONSOR_CONTRACT',
  }));
}

// =============================================================================
// Story F3: Sponsor Page Gating (Trust-First Display)
// =============================================================================

/**
 * Sponsor page status values
 *
 * LOCKED CONTRACT - Story F3: Sponsor Page Gating
 *
 * Sponsors should never see broken, partial, or misleading pages.
 * Status is backend-decided based on associated event states.
 *
 *   ACTIVE   - At least one associated event is ACTIVE → metrics visible
 *   PENDING  - Has events but none are ACTIVE yet → data accumulating message
 *   INACTIVE - No events OR all events ARCHIVED → no active events message
 */
export const SPONSOR_PAGE_STATUS = {
  /** At least one event is ACTIVE - metrics can be displayed */
  ACTIVE: 'ACTIVE',
  /** Has events but none are ACTIVE (DRAFT/READY) - data accumulating */
  PENDING: 'PENDING',
  /** No events or all ARCHIVED - inactive sponsor */
  INACTIVE: 'INACTIVE',
} as const;

export type SponsorPageStatus = typeof SPONSOR_PAGE_STATUS[keyof typeof SPONSOR_PAGE_STATUS];

/**
 * Valid sponsor page statuses (for validation)
 */
export const VALID_SPONSOR_PAGE_STATUSES = [
  SPONSOR_PAGE_STATUS.ACTIVE,
  SPONSOR_PAGE_STATUS.PENDING,
  SPONSOR_PAGE_STATUS.INACTIVE,
] as const;

/**
 * Sponsor page status labels for UI display
 */
export const SPONSOR_PAGE_STATUS_LABELS: Record<SponsorPageStatus, string> = {
  ACTIVE: 'Active',
  PENDING: 'Pending Verification',
  INACTIVE: 'Inactive',
} as const;

/**
 * Sponsor page status descriptions
 *
 * User-friendly descriptions explaining each state
 */
export const SPONSOR_PAGE_STATUS_DESCRIPTIONS: Record<SponsorPageStatus, string> = {
  ACTIVE: 'Your sponsorship is active and metrics are available.',
  PENDING: 'Your associated events are being verified. Metrics will be available once event QR codes are verified.',
  INACTIVE: 'No active events are currently associated with this sponsorship.',
} as const;

/**
 * Event state info for eligibility resolution
 */
export interface EventStateInfo {
  eventId: string;
  /** Asset state from domain/assetState.ts (DRAFT, READY, ACTIVE, ARCHIVED) */
  assetState: 'DRAFT' | 'READY' | 'ACTIVE' | 'ARCHIVED';
}

/**
 * Sponsor page eligibility result
 *
 * Returned by resolveSponsorPageStatus() to determine page display
 */
export interface SponsorPageEligibility {
  /** The resolved sponsor page status */
  status: SponsorPageStatus;
  /** Whether metrics should be visible */
  metricsVisible: boolean;
  /** Human-readable label for UI */
  label: string;
  /** User-friendly description */
  description: string;
  /** Number of ACTIVE events */
  activeEventCount: number;
  /** Number of PENDING events (DRAFT + READY) */
  pendingEventCount: number;
  /** Number of ARCHIVED events */
  archivedEventCount: number;
  /** Total associated events */
  totalEventCount: number;
}

/**
 * Resolve sponsor page status based on associated event states
 *
 * BACKEND-DECIDED: Frontend must honor this status - no client-side overrides.
 *
 * Resolution Rules:
 *   1. If any event is ACTIVE → sponsor page is ACTIVE (metrics visible)
 *   2. If no ACTIVE events but some DRAFT/READY → PENDING (data accumulating)
 *   3. If no events OR all ARCHIVED → INACTIVE (no active events)
 *
 * @param eventStates - Array of event state information for associated events
 * @returns SponsorPageEligibility with resolved status and metadata
 *
 * @example
 * // Sponsor with one ACTIVE event
 * const eligibility = resolveSponsorPageStatus([
 *   { eventId: 'evt-1', assetState: 'ACTIVE' },
 *   { eventId: 'evt-2', assetState: 'DRAFT' }
 * ]);
 * // eligibility.status === 'ACTIVE'
 * // eligibility.metricsVisible === true
 */
export function resolveSponsorPageStatus(
  eventStates: EventStateInfo[]
): SponsorPageEligibility {
  // Count events by state
  let activeCount = 0;
  let pendingCount = 0; // DRAFT + READY
  let archivedCount = 0;

  for (const event of eventStates) {
    switch (event.assetState) {
      case 'ACTIVE':
        activeCount++;
        break;
      case 'DRAFT':
      case 'READY':
        pendingCount++;
        break;
      case 'ARCHIVED':
        archivedCount++;
        break;
    }
  }

  const totalCount = eventStates.length;

  // Resolution: Priority is ACTIVE > PENDING > INACTIVE
  let status: SponsorPageStatus;

  if (activeCount > 0) {
    // At least one ACTIVE event → sponsor page is ACTIVE
    status = SPONSOR_PAGE_STATUS.ACTIVE;
  } else if (pendingCount > 0) {
    // No ACTIVE, but some DRAFT/READY → PENDING (waiting for verification)
    status = SPONSOR_PAGE_STATUS.PENDING;
  } else {
    // No events OR all ARCHIVED → INACTIVE
    status = SPONSOR_PAGE_STATUS.INACTIVE;
  }

  return {
    status,
    metricsVisible: status === SPONSOR_PAGE_STATUS.ACTIVE,
    label: SPONSOR_PAGE_STATUS_LABELS[status],
    description: SPONSOR_PAGE_STATUS_DESCRIPTIONS[status],
    activeEventCount: activeCount,
    pendingEventCount: pendingCount,
    archivedEventCount: archivedCount,
    totalEventCount: totalCount,
  };
}

/**
 * Check if a value is a valid SponsorPageStatus
 */
export function isValidSponsorPageStatus(value: unknown): value is SponsorPageStatus {
  return typeof value === 'string' && VALID_SPONSOR_PAGE_STATUSES.includes(value as SponsorPageStatus);
}

/**
 * Sponsor page response structure
 *
 * API response shape for sponsor page endpoint
 */
export interface SponsorPageResponse {
  ok: boolean;
  /** Sponsor contract data (only included if ACTIVE or PENDING) */
  sponsor: SponsorContract | null;
  /** Page eligibility status */
  pageStatus: SponsorPageEligibility;
  /** Contract version */
  _contractVersion: string;
  /** Timestamp of response generation */
  generatedAt: string;
}

/**
 * Build sponsor page response
 *
 * Creates the full API response for sponsor page endpoint.
 * Enforces gating logic - INACTIVE sponsors don't get sponsor data.
 *
 * @param sponsor - Sponsor contract data
 * @param eligibility - Resolved page eligibility
 * @returns Complete sponsor page response
 */
export function buildSponsorPageResponse(
  sponsor: SponsorContract | null,
  eligibility: SponsorPageEligibility
): SponsorPageResponse {
  // For INACTIVE sponsors, don't expose sponsor data
  // (They might not have a valid sponsor relationship anymore)
  const includeSponsor = eligibility.status !== SPONSOR_PAGE_STATUS.INACTIVE;

  return {
    ok: true,
    sponsor: includeSponsor ? sponsor : null,
    pageStatus: eligibility,
    _contractVersion: SPONSOR_CONTRACT_VERSION,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Build sponsor page error response
 *
 * Creates error response for sponsor page failures
 */
export function buildSponsorPageErrorResponse(
  code: string,
  message: string,
  status: SponsorPageStatus = SPONSOR_PAGE_STATUS.INACTIVE
): {
  ok: false;
  error: { code: string; message: string };
  pageStatus: SponsorPageEligibility;
  _contractVersion: string;
  generatedAt: string;
} {
  return {
    ok: false,
    error: { code, message },
    pageStatus: {
      status,
      metricsVisible: false,
      label: SPONSOR_PAGE_STATUS_LABELS[status],
      description: message,
      activeEventCount: 0,
      pendingEventCount: 0,
      archivedEventCount: 0,
      totalEventCount: 0,
    },
    _contractVersion: SPONSOR_CONTRACT_VERSION,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Log sponsor page status resolution for audit
 */
export function logSponsorPageStatus(
  sponsorId: string,
  eligibility: SponsorPageEligibility
): void {
  const timestamp = new Date().toISOString();

  console.log(JSON.stringify({
    type: 'SPONSOR_PAGE_STATUS',
    timestamp,
    sponsorId,
    status: eligibility.status,
    metricsVisible: eligibility.metricsVisible,
    activeEventCount: eligibility.activeEventCount,
    pendingEventCount: eligibility.pendingEventCount,
    archivedEventCount: eligibility.archivedEventCount,
    totalEventCount: eligibility.totalEventCount,
    invariant: 'F3_SPONSOR_PAGE_GATING',
  }));
}

// =============================================================================
// Story F4: Monetization Hooks Builder Functions
// =============================================================================

/**
 * Build billable units from sponsor metrics and event count
 *
 * Story F4: Populates billable units from analytics.
 * INERT: No billing logic is executed.
 *
 * @param metrics - Sponsor metrics (impressions, scans, conversions)
 * @param eventCount - Number of events associated with sponsor
 * @returns BillableUnits object
 */
export function buildBillableUnits(
  metrics: SponsorMetrics,
  eventCount: number
): BillableUnits {
  return {
    qrScans: metrics.scans,
    impressions: metrics.impressions,
    eventCount: Math.max(0, Math.floor(eventCount)),
  };
}

/**
 * Build billing window from analytics window
 *
 * Story F4: Copies window from analytics integrity metadata.
 * INERT: No billing calculations are performed.
 *
 * @param windowStart - Start of aggregation window (ISO 8601)
 * @param windowEnd - End of aggregation window (ISO 8601)
 * @returns BillingWindow object
 */
export function buildBillingWindow(
  windowStart: string,
  windowEnd: string
): BillingWindow {
  return {
    windowStart,
    windowEnd,
  };
}

/**
 * Build monetization hooks from sponsor data
 *
 * Story F4: Creates monetization hooks from sponsor metrics and analytics.
 * INERT: These fields are for future billing integration only.
 * NO billing logic is executed. NO payment processing.
 *
 * @param sponsor - Sponsor contract with metrics
 * @param windowStart - Start of aggregation window (ISO 8601)
 * @param windowEnd - End of aggregation window (ISO 8601)
 * @param dataAvailable - Whether analytics data was available
 * @returns MonetizationHooks object
 */
export function buildMonetizationHooks(
  sponsor: SponsorContract,
  windowStart: string,
  windowEnd: string,
  dataAvailable: boolean
): MonetizationHooks {
  const billableUnits = buildBillableUnits(sponsor.metrics, sponsor.events.length);
  const billingWindow = buildBillingWindow(windowStart, windowEnd);

  let statusMessage: string;
  if (!dataAvailable) {
    statusMessage = 'Analytics data unavailable - billable units may be incomplete';
  } else if (billableUnits.impressions === 0 && billableUnits.qrScans === 0) {
    statusMessage = 'No billable activity recorded in this window';
  } else {
    statusMessage = 'Billable units aggregated from analytics';
  }

  return {
    billableUnits,
    billingWindow,
    dataAvailable,
    statusMessage,
  };
}

/**
 * Sponsor monetization response structure
 *
 * Story F4: API response shape for monetization hooks endpoint.
 * Read-only exposure - no billing UI visible.
 */
export interface SponsorMonetizationResponse {
  ok: boolean;
  /** Sponsor identifier */
  sponsorId: string;
  /** Sponsor name */
  sponsorName: string;
  /** Monetization hooks (INERT - no billing logic) */
  monetization: MonetizationHooks;
  /** Page eligibility status */
  pageStatus: SponsorPageEligibility;
  /** Contract version */
  _contractVersion: string;
  /** Timestamp of response generation */
  generatedAt: string;
  /** Invariant marker for contract testing */
  _invariant: 'F4_MONETIZATION_HOOKS';
}

/**
 * Build sponsor monetization response
 *
 * Story F4: Creates the full API response for monetization hooks endpoint.
 * INERT: No billing logic is executed. Read-only exposure.
 *
 * @param sponsor - Sponsor contract
 * @param monetization - Monetization hooks
 * @param eligibility - Page eligibility status
 * @returns Complete monetization response
 */
export function buildSponsorMonetizationResponse(
  sponsor: SponsorContract,
  monetization: MonetizationHooks,
  eligibility: SponsorPageEligibility
): SponsorMonetizationResponse {
  // Validate monetization hooks
  assertMonetizationHooks(monetization);

  return {
    ok: true,
    sponsorId: sponsor.sponsorId,
    sponsorName: sponsor.name,
    monetization,
    pageStatus: eligibility,
    _contractVersion: SPONSOR_CONTRACT_VERSION,
    generatedAt: new Date().toISOString(),
    _invariant: 'F4_MONETIZATION_HOOKS',
  };
}

/**
 * Build monetization error response
 *
 * Creates error response for monetization endpoint failures
 */
export function buildMonetizationErrorResponse(
  code: string,
  message: string
): {
  ok: false;
  error: { code: string; message: string };
  monetization: null;
  _contractVersion: string;
  generatedAt: string;
  _invariant: 'F4_MONETIZATION_HOOKS';
} {
  return {
    ok: false,
    error: { code, message },
    monetization: null,
    _contractVersion: SPONSOR_CONTRACT_VERSION,
    generatedAt: new Date().toISOString(),
    _invariant: 'F4_MONETIZATION_HOOKS',
  };
}

/**
 * Check if monetization hooks are inert (no side effects)
 *
 * Story F4 CI/CD Gate: Contract test uses this to ensure
 * billing hooks stay inert - no billing logic executed.
 *
 * INVARIANT: This function MUST always return true.
 * If billing logic is ever added, this becomes false and
 * contract tests fail, alerting to the coupling violation.
 *
 * @returns true if hooks are inert (no billing logic)
 */
export function checkMonetizationHooksInert(): {
  inert: true;
  billingLogicExecuted: false;
  paymentProcessing: false;
  billingUIVisible: false;
  message: string;
} {
  // LOCKED INVARIANT: These fields MUST remain false
  // until billing is intentionally implemented
  return {
    inert: true,
    billingLogicExecuted: false,
    paymentProcessing: false,
    billingUIVisible: false,
    message: 'Story F4: Monetization hooks are inert - no billing logic executed',
  };
}

/**
 * Log monetization hooks access for audit
 */
export function logMonetizationHooksAccess(
  sponsorId: string,
  monetization: MonetizationHooks
): void {
  const timestamp = new Date().toISOString();

  console.log(JSON.stringify({
    type: 'MONETIZATION_HOOKS_ACCESS',
    timestamp,
    sponsorId,
    billableUnits: monetization.billableUnits,
    billingWindow: monetization.billingWindow,
    dataAvailable: monetization.dataAvailable,
    inert: true, // Billing hooks are always inert in F4
    invariant: 'F4_MONETIZATION_HOOKS',
  }));
}

/**
 * Contract compliance check for monetization hooks
 *
 * Used by CI/CD to detect contract drift.
 */
export function checkMonetizationHooksCompliance(hooks: unknown): {
  compliant: boolean;
  version: string;
  missingFields: string[];
  invalidFields: string[];
  inert: boolean;
} {
  const missingFields: string[] = [];
  const invalidFields: string[] = [];

  if (!hooks || typeof hooks !== 'object') {
    return {
      compliant: false,
      version: SPONSOR_CONTRACT_VERSION,
      missingFields: [...MONETIZATION_HOOKS_REQUIRED_FIELDS],
      invalidFields: ['_root: not an object'],
      inert: true,
    };
  }

  const h = hooks as Record<string, unknown>;

  // Check required fields
  for (const field of MONETIZATION_HOOKS_REQUIRED_FIELDS) {
    if (!(field in h)) {
      missingFields.push(field);
    }
  }

  // Validate field types
  if ('billableUnits' in h && !isValidBillableUnits(h.billableUnits)) {
    invalidFields.push('billableUnits: invalid shape');
  }

  if ('billingWindow' in h && !isValidBillingWindow(h.billingWindow)) {
    invalidFields.push('billingWindow: invalid shape');
  }

  if ('dataAvailable' in h && typeof h.dataAvailable !== 'boolean') {
    invalidFields.push('dataAvailable: must be boolean');
  }

  if ('statusMessage' in h && typeof h.statusMessage !== 'string') {
    invalidFields.push('statusMessage: must be string');
  }

  return {
    compliant: missingFields.length === 0 && invalidFields.length === 0,
    version: SPONSOR_CONTRACT_VERSION,
    missingFields,
    invalidFields,
    inert: true, // Always true for F4
  };
}
