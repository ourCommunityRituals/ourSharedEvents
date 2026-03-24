/**
 * Admin Surface API Client
 *
 * Story 4.1 - Extract Frontend API Adapter Layer
 * Story 2.2 - Purge Mixed-Origin Calls (uses Worker proxy only)
 * Story D4 - Replace Admin Key with Cloudflare Access
 *
 * API client for the Admin surface (event management dashboard).
 *
 * Authentication:
 * - Primary: Cloudflare Access (automatic via Cf-Access-Jwt-Assertion header)
 * - /manage route is protected by Cloudflare Access Application
 * - Browser automatically includes Access JWT after authentication
 * - No manual token management needed for browser users
 *
 * Legacy Support:
 * - Token storage in sessionStorage maintained for backward compatibility
 * - Will be removed in future versions
 *
 * All API calls go through the Cloudflare Worker proxy using relative paths.
 * No direct calls to script.google.com or external origins.
 *
 * @module frontend/apiClient/admin
 */

import {
  BaseApiClient,
  ApiClientConfig,
  ApiResponse,
  ApiErrorResponse,
  ErrorUIHandler,
  RequestOptions,
} from './base';

// =============================================================================
// Types
// =============================================================================

/**
 * Admin authentication context
 */
export interface AdminAuthContext {
  brandId: string;
  token: string;
}

/**
 * Template definition
 */
export interface AdminTemplate {
  id: string;
  name: string;
  description?: string;
  sections?: string[];
}

/**
 * Admin brand configuration
 */
export interface AdminBrandConfig {
  brandId: string;
  appTitle?: string;
  logoUrl?: string;
  templates?: AdminTemplate[];
}

/**
 * Event diagnostics
 */
export interface EventDiagnostics {
  hasPublicUrl: boolean;
  hasDisplayUrl: boolean;
  hasPosterUrl: boolean;
  qrGenerated?: boolean;
  lastModified?: string;
}

/**
 * Admin sponsor data (includes all tiers)
 */
export interface AdminSponsor {
  id: string;
  name: string;
  logoUrl?: string;
  linkUrl?: string;
  placement?: string;
  tier?: string;
  enabled?: boolean;
}

/**
 * Event CTA
 */
export interface EventCTA {
  label: string;
  url: string;
}

/**
 * Event CTAs
 */
export interface EventCTAs {
  primary?: EventCTA;
  secondary?: EventCTA;
}

/**
 * Event settings
 */
export interface EventSettings {
  showSchedule?: boolean;
  showStandings?: boolean;
  showBracket?: boolean;
  showSponsors?: boolean;
  showVideo?: boolean;
  showMap?: boolean;
  showGallery?: boolean;
  showSponsorBanner?: boolean;
}

/**
 * Schedule item
 */
export interface ScheduleItem {
  time?: string;
  title?: string;
  description?: string;
}

/**
 * Standings item
 */
export interface StandingsItem {
  rank?: number;
  team?: string;
  wins?: number;
  losses?: number;
  points?: number;
}

/**
 * Bracket match
 */
export interface BracketMatch {
  team1?: string;
  team2?: string;
  score1?: number;
  score2?: number;
  winner?: string;
}

/**
 * Bracket round
 */
export interface BracketRound {
  name: string;
  matches: BracketMatch[];
}

/**
 * Bracket data
 */
export interface Bracket {
  rounds: BracketRound[];
}

/**
 * Media data
 */
export interface EventMedia {
  videoUrl?: string;
  mapUrl?: string;
  gallery?: string[];
}

/**
 * External data URLs
 */
export interface ExternalData {
  scheduleUrl?: string;
  standingsUrl?: string;
  bracketUrl?: string;
}

/**
 * Payment information
 */
export interface PaymentInfo {
  enabled: boolean;
  provider?: string;
  checkoutUrl?: string;
  price?: number;
  currency?: string;
}

/**
 * Event links
 */
export interface EventLinks {
  publicUrl?: string;
  displayUrl?: string;
  posterUrl?: string;
  adminUrl?: string;
}

/**
 * Lifecycle phase information
 */
export interface LifecyclePhase {
  phase: 'pre-event' | 'event-day' | 'post-event';
  label: string;
  isLive: boolean;
}

/**
 * Full event data for admin view
 */
export interface AdminEvent {
  id: string;
  name: string;
  startDateISO?: string;
  venue?: string;
  templateId?: string;
  ctas?: EventCTAs;
  settings?: EventSettings;
  links?: EventLinks;
  schedule?: ScheduleItem[];
  standings?: StandingsItem[];
  bracket?: Bracket;
  sponsors?: AdminSponsor[];
  media?: EventMedia;
  externalData?: ExternalData;
  payments?: PaymentInfo;
  diagnostics?: EventDiagnostics;
}

/**
 * Admin bundle response
 */
export interface AdminBundleValue {
  event: AdminEvent;
  config?: AdminBrandConfig;
  lifecyclePhase?: LifecyclePhase;
  templates?: AdminTemplate[];
}

/**
 * Event list response
 */
export interface EventListResponse {
  items: Array<{
    id: string;
    name: string;
    startDateISO?: string;
    venue?: string;
  }>;
}

/**
 * Create event request body
 */
export interface CreateEventRequest {
  name: string;
  startDateISO?: string;
  venue?: string;
  templateId?: string;
}

/**
 * Create event response
 */
export interface CreateEventResponse {
  event: AdminEvent;
  links?: EventLinks;
}

/**
 * Save event request body (partial update)
 */
export interface SaveEventRequest {
  id: string;
  name?: string;
  startDateISO?: string;
  venue?: string;
  templateId?: string;
  ctas?: EventCTAs;
  settings?: EventSettings;
  schedule?: ScheduleItem[];
  standings?: StandingsItem[];
  bracket?: Bracket;
  sponsors?: AdminSponsor[];
  media?: EventMedia;
  externalData?: ExternalData;
  payments?: PaymentInfo;
}

/**
 * Record result request body
 */
export interface RecordResultRequest {
  eventId: string;
  schedule?: ScheduleItem[];
  standings?: StandingsItem[];
  bracket?: Bracket;
}

/**
 * Record result response
 */
export interface RecordResultResponse {
  success: boolean;
  event?: AdminEvent;
}

// =============================================================================
// Token Storage (LEGACY - Cloudflare Access handles auth automatically)
// =============================================================================

/**
 * @deprecated Story D4 - Admin auth now handled by Cloudflare Access.
 * Browser users are authenticated via Access Application on /manage route.
 * Token storage maintained for backward compatibility only.
 */
const TOKEN_STORAGE_PREFIX = 'ADMIN_TOKEN:';

/**
 * @deprecated Use Cloudflare Access instead.
 */
const LEGACY_KEY_PREFIX = 'ADMIN_KEY:';

/**
 * Get admin token from storage
 * @deprecated Cloudflare Access handles authentication automatically.
 * This function is maintained for legacy compatibility only.
 */
function getStoredToken(brandId: string): string | null {
  // Try new storage key first
  let token = sessionStorage.getItem(TOKEN_STORAGE_PREFIX + brandId);
  if (token) return token;

  // Fall back to legacy key for migration
  token = sessionStorage.getItem(LEGACY_KEY_PREFIX + brandId);
  if (token) {
    // Migrate to new key
    sessionStorage.setItem(TOKEN_STORAGE_PREFIX + brandId, token);
    return token;
  }

  return null;
}

/**
 * Set admin token in storage
 * @deprecated Cloudflare Access handles authentication automatically.
 * This function is maintained for legacy compatibility only.
 */
function setStoredToken(brandId: string, token: string): void {
  sessionStorage.setItem(TOKEN_STORAGE_PREFIX + brandId, token);
  // Also set legacy key for backward compatibility
  sessionStorage.setItem(LEGACY_KEY_PREFIX + brandId, token);
}

/**
 * Clear admin token from storage
 * @deprecated Cloudflare Access handles authentication automatically.
 * This function is maintained for legacy compatibility only.
 */
function clearStoredToken(brandId: string): void {
  sessionStorage.removeItem(TOKEN_STORAGE_PREFIX + brandId);
  sessionStorage.removeItem(LEGACY_KEY_PREFIX + brandId);
}

// =============================================================================
// AdminApiClient Class
// =============================================================================

/**
 * API client for the Admin surface
 *
 * Story D4: Authentication is handled by Cloudflare Access.
 * - Browser users: Automatic via Cf-Access-Jwt-Assertion header
 * - /manage route is protected by Cloudflare Access Application
 * - Legacy Bearer token support maintained for backward compatibility
 *
 * Story 2.2: All API calls go through the Cloudflare Worker proxy.
 * Uses relative paths (/api/*) - no direct GAS calls.
 */
export class AdminApiClient extends BaseApiClient {
  private brandId: string;
  private scope: string;
  private token: string | null = null;
  private onAuthRequired?: () => void;

  constructor(
    brandId: string,
    scope: string = 'event',
    config?: ApiClientConfig,
    onError?: ErrorUIHandler,
    onAuthRequired?: () => void
  ) {
    super(config, onError);
    this.brandId = brandId;
    this.scope = scope;
    this.token = getStoredToken(brandId);
    this.onAuthRequired = onAuthRequired;
  }

  /**
   * Set the authentication token
   */
  setToken(token: string): void {
    this.token = token;
    setStoredToken(this.brandId, token);
  }

  /**
   * Clear the authentication token
   */
  clearToken(): void {
    this.token = null;
    clearStoredToken(this.brandId);
  }

  /**
   * Check if we have a token
   */
  hasToken(): boolean {
    return !!this.token;
  }

  /**
   * Get the current token
   */
  getToken(): string | null {
    return this.token;
  }

  /**
   * Override request to add authentication
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    // Add Authorization header if we have a token
    if (this.token) {
      options.headers = {
        ...options.headers,
        Authorization: `Bearer ${this.token}`,
      };
    }

    const result = await super.request<T>(path, options);

    // Handle 401 - clear token and trigger auth callback
    if (!result.ok && result.code === 'UNAUTHORIZED') {
      this.clearToken();
      if (this.onAuthRequired) {
        this.onAuthRequired();
      }
    }

    return result;
  }

  /**
   * Get list of events (admin view)
   */
  async getEventList(): Promise<ApiResponse<EventListResponse>> {
    return this.post<EventListResponse>('api_list', {
      brandId: this.brandId,
      scope: this.scope,
      adminKey: this.token, // Legacy compatibility
    });
  }

  /**
   * Get admin bundle for a specific event
   */
  async getAdminBundle(eventId: string): Promise<ApiResponse<AdminBundleValue>> {
    return this.post<AdminBundleValue>('api_getAdminBundle', {
      brandId: this.brandId,
      scope: this.scope,
      id: eventId,
      adminKey: this.token, // Legacy compatibility
    });
  }

  /**
   * Create a new event
   */
  async createEvent(data: CreateEventRequest): Promise<ApiResponse<CreateEventResponse>> {
    return this.post<CreateEventResponse>('events/create', {
      brandId: this.brandId,
      ...data,
    });
  }

  /**
   * Save/update an event
   */
  async saveEvent(data: SaveEventRequest): Promise<ApiResponse<AdminEvent>> {
    return this.post<AdminEvent>('api_adminSaveEvent', {
      brandId: this.brandId,
      scope: this.scope,
      adminKey: this.token, // Legacy compatibility
      event: data,
    });
  }

  /**
   * Record event results (schedule, standings, bracket updates)
   */
  async recordResult(data: RecordResultRequest): Promise<ApiResponse<RecordResultResponse>> {
    return this.post<RecordResultResponse>(`events/${data.eventId}/result`, {
      schedule: data.schedule,
      standings: data.standings,
      bracket: data.bracket,
    });
  }

  /**
   * Delete an event
   */
  async deleteEvent(eventId: string): Promise<ApiResponse<{ success: boolean }>> {
    return this.post<{ success: boolean }>('api_adminDeleteEvent', {
      brandId: this.brandId,
      scope: this.scope,
      id: eventId,
      adminKey: this.token, // Legacy compatibility
    });
  }

  /**
   * Get templates available for this brand
   */
  async getTemplates(): Promise<ApiResponse<{ templates: AdminTemplate[] }>> {
    return this.post<{ templates: AdminTemplate[] }>('api_getTemplates', {
      brandId: this.brandId,
    });
  }

  /**
   * Regenerate QR code for an event
   */
  async regenerateQR(eventId: string): Promise<ApiResponse<{ qrUrl: string }>> {
    return this.post<{ qrUrl: string }>('api_regenerateQR', {
      brandId: this.brandId,
      id: eventId,
      adminKey: this.token, // Legacy compatibility
    });
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an Admin API client instance
 */
export function createAdminApiClient(
  brandId: string,
  scope?: string,
  config?: ApiClientConfig,
  onError?: ErrorUIHandler,
  onAuthRequired?: () => void
): AdminApiClient {
  return new AdminApiClient(brandId, scope, config, onError, onAuthRequired);
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export { isSuccess, isError } from './base';
export type { ApiResponse, ApiErrorResponse } from './base';

export default AdminApiClient;
