/**
 * Asset State Domain Model
 *
 * Single source of truth for event asset lifecycle states.
 * This module defines when events are safe to render on public surfaces.
 *
 * State Machine:
 *   DRAFT    → Event exists but not public-ready
 *   READY    → Event valid but QR not verified
 *   ACTIVE   → QR verified, safe to render on public surfaces
 *   ARCHIVED → Hidden everywhere (soft delete)
 *
 * @module domain/assetState
 * @see Story E1 - Asset State Model (Single Source of Truth)
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Asset lifecycle states
 *
 * LOCKED CONTRACT - Do not modify without version bump
 */
export type AssetState = 'DRAFT' | 'READY' | 'ACTIVE' | 'ARCHIVED';

/**
 * Surface types that can render events
 */
export type RenderSurface = 'public' | 'display' | 'poster' | 'admin' | 'report';

/**
 * Result of asset state resolution
 */
export interface AssetStateInfo {
  /** The resolved asset state */
  state: AssetState;
  /** Whether the asset is renderable on public surfaces */
  isRenderable: boolean;
  /** Human-readable label for the state */
  label: string;
  /** Description of the state */
  description: string;
}

/**
 * Event shape expected by resolveAssetState
 */
export interface AssetStateEvent {
  /** Event ID */
  id?: string;
  /** Event name */
  name?: string;
  /** Start date in ISO format */
  startDateISO?: string;
  /** Venue/location */
  venue?: string;
  /** Explicit asset state from sheet column */
  assetState?: AssetState | string;
  /** Legacy status column (active/archived) */
  status?: 'active' | 'archived' | string;
  /** Whether QR codes have been verified */
  qrVerified?: boolean;
  /** QR code data */
  qr?: {
    public?: string;
    signup?: string;
  };
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Column index for assetState field (0-based)
 * Column J = index 9
 */
export const ASSET_STATE_COLUMN_INDEX = 9;

/**
 * Valid asset state values (for validation)
 */
export const VALID_ASSET_STATES: readonly AssetState[] = [
  'DRAFT',
  'READY',
  'ACTIVE',
  'ARCHIVED',
] as const;

/**
 * Asset state labels for UI display
 */
export const ASSET_STATE_LABELS: Record<AssetState, string> = {
  DRAFT: 'Draft',
  READY: 'Ready for Verification',
  ACTIVE: 'Active',
  ARCHIVED: 'Archived',
} as const;

/**
 * Asset state descriptions
 */
export const ASSET_STATE_DESCRIPTIONS: Record<AssetState, string> = {
  DRAFT: 'Event is being created and is not ready for public display',
  READY: 'Event is complete but QR codes have not been verified',
  ACTIVE: 'Event is verified and safe to display on public surfaces',
  ARCHIVED: 'Event has been archived and is hidden from all surfaces',
} as const;

/**
 * Surfaces that can render each state
 *
 * INVARIANT: Only ACTIVE events can render on public/display/poster
 * Admin can see all states for management purposes
 */
export const RENDERABLE_SURFACES: Record<AssetState, readonly RenderSurface[]> = {
  DRAFT: ['admin'],
  READY: ['admin'],
  ACTIVE: ['public', 'display', 'poster', 'admin', 'report'],
  ARCHIVED: ['admin'],
} as const;

// =============================================================================
// Validation
// =============================================================================

/**
 * Check if a value is a valid AssetState
 */
export function isValidAssetState(value: unknown): value is AssetState {
  return typeof value === 'string' && VALID_ASSET_STATES.includes(value as AssetState);
}

/**
 * Parse and normalize an asset state value from sheet data
 *
 * Handles:
 * - Valid state strings (case-insensitive)
 * - Empty/null values (defaults to DRAFT)
 * - Invalid values (defaults to DRAFT with warning)
 */
export function parseAssetState(value: unknown): AssetState {
  if (!value || value === '') {
    return 'DRAFT';
  }

  if (typeof value !== 'string') {
    console.warn(`[AssetState] Invalid type for assetState: ${typeof value}, defaulting to DRAFT`);
    return 'DRAFT';
  }

  const normalized = value.toUpperCase().trim();

  if (isValidAssetState(normalized)) {
    return normalized;
  }

  console.warn(`[AssetState] Unknown assetState value: "${value}", defaulting to DRAFT`);
  return 'DRAFT';
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Resolve the asset state for an event
 *
 * Resolution priority:
 * 1. If status === 'archived' → ARCHIVED
 * 2. If explicit assetState column is set → use that
 * 3. If qrVerified === true → ACTIVE
 * 4. If event has required fields (name, startDateISO, venue) → READY
 * 5. Otherwise → DRAFT
 *
 * @param event - Event data to analyze
 * @returns AssetStateInfo with resolved state and metadata
 *
 * @example
 * const info = resolveAssetState({ name: 'Test', qrVerified: true });
 * // info.state === 'ACTIVE'
 * // info.isRenderable === true
 */
export function resolveAssetState(event: AssetStateEvent): AssetStateInfo {
  let state: AssetState;

  // Priority 1: Check for archived status (legacy column)
  if (event.status === 'archived') {
    state = 'ARCHIVED';
  }
  // Priority 2: Check explicit assetState column
  else if (event.assetState && isValidAssetState(event.assetState)) {
    state = event.assetState;
  }
  // Priority 3: Legacy migration - check qrVerified flag
  else if (event.qrVerified === true) {
    state = 'ACTIVE';
  }
  // Priority 4: Check if event has minimum required fields
  else if (hasRequiredFields(event)) {
    state = 'READY';
  }
  // Priority 5: Default to DRAFT
  else {
    state = 'DRAFT';
  }

  return {
    state,
    isRenderable: isStateRenderable(state),
    label: ASSET_STATE_LABELS[state],
    description: ASSET_STATE_DESCRIPTIONS[state],
  };
}

/**
 * Check if an event has the minimum required fields for READY state
 */
function hasRequiredFields(event: AssetStateEvent): boolean {
  return !!(
    event.name &&
    event.name.trim().length > 0
  );
}

/**
 * Check if a state allows rendering on public surfaces
 */
function isStateRenderable(state: AssetState): boolean {
  return state === 'ACTIVE';
}

/**
 * Assert that an asset state is renderable on a given surface
 *
 * Returns a result object with:
 * - allowed: boolean indicating if rendering is permitted
 * - reason: explanation if not allowed
 *
 * INVARIANT: Public/Display/Poster surfaces only render ACTIVE events
 * Admin surface can see all states
 *
 * @param state - Asset state to check
 * @param surface - Target render surface
 * @returns Object with allowed flag and optional reason
 *
 * @example
 * const result = assertRenderable('READY', 'public');
 * // result.allowed === false
 * // result.reason === 'Event is not yet verified for public display'
 */
export function assertRenderable(
  state: AssetState,
  surface: RenderSurface
): { allowed: boolean; reason?: string } {
  const allowedSurfaces = RENDERABLE_SURFACES[state];

  if (allowedSurfaces.includes(surface)) {
    return { allowed: true };
  }

  // Build explanation for why rendering is blocked
  const reasons: Record<AssetState, string> = {
    DRAFT: 'Event is still in draft mode and not ready for display',
    READY: 'Event is not yet verified for public display',
    ACTIVE: '', // Should never reach here for ACTIVE
    ARCHIVED: 'Event has been archived and is no longer available',
  };

  return {
    allowed: false,
    reason: reasons[state] || `State "${state}" is not allowed on surface "${surface}"`,
  };
}

/**
 * Check if rendering is allowed (convenience wrapper)
 *
 * @param state - Asset state to check
 * @param surface - Target render surface
 * @returns true if rendering is allowed
 */
export function canRender(state: AssetState, surface: RenderSurface): boolean {
  return assertRenderable(state, surface).allowed;
}

// =============================================================================
// State Transitions
// =============================================================================

/**
 * Valid state transitions
 *
 * State machine transitions:
 *   DRAFT → READY (when event data is complete)
 *   READY → ACTIVE (when QR is verified)
 *   ACTIVE → ARCHIVED (when archived)
 *   ARCHIVED → ACTIVE (when unarchived)
 *   Any → DRAFT (reset)
 */
export const VALID_TRANSITIONS: Record<AssetState, readonly AssetState[]> = {
  DRAFT: ['READY', 'ARCHIVED'],
  READY: ['ACTIVE', 'DRAFT', 'ARCHIVED'],
  ACTIVE: ['ARCHIVED', 'READY'],
  ARCHIVED: ['ACTIVE', 'DRAFT'],
} as const;

/**
 * Check if a state transition is valid
 *
 * @param from - Current state
 * @param to - Target state
 * @returns true if transition is allowed
 */
export function isValidTransition(from: AssetState, to: AssetState): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/**
 * Get allowed transitions from a state
 *
 * @param from - Current state
 * @returns Array of allowed target states
 */
export function getAllowedTransitions(from: AssetState): readonly AssetState[] {
  return VALID_TRANSITIONS[from];
}

// =============================================================================
// API Response Helpers
// =============================================================================

/**
 * Build asset state data for API response
 *
 * Includes all state information needed by frontends
 */
export function buildAssetStateResponse(event: AssetStateEvent): {
  assetState: AssetState;
  assetStateInfo: AssetStateInfo;
} {
  const info = resolveAssetState(event);

  return {
    assetState: info.state,
    assetStateInfo: info,
  };
}

/**
 * Create a non-renderable response for blocked surfaces
 *
 * Used when a surface requests an event that isn't ACTIVE
 */
export function createNonRenderableResponse(
  state: AssetState,
  surface: RenderSurface
): {
  ok: false;
  renderable: false;
  assetState: AssetState;
  reason: string;
} {
  const assertion = assertRenderable(state, surface);

  return {
    ok: false,
    renderable: false,
    assetState: state,
    reason: assertion.reason || 'Event is not renderable on this surface',
  };
}
