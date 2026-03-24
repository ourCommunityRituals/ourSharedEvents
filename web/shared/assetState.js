/**
 * EventAngle Asset State Module v1.0.0
 *
 * Story E1 - Asset State Model (Single Source of Truth)
 *
 * Provides asset lifecycle state validation for frontend surfaces.
 * This module ensures no page guesses whether it should render content.
 *
 * Asset States:
 *   DRAFT    - Event exists but not public-ready
 *   READY    - Event valid but QR not verified
 *   ACTIVE   - QR verified, safe to render on public surfaces
 *   ARCHIVED - Hidden everywhere (soft delete)
 *
 * Usage:
 *   <script src="/web/shared/assetState.js"></script>
 *   <script>
 *     // Check if event is renderable on this surface
 *     const result = EA.AssetState.assertRenderable(event.assetState, 'public');
 *     if (!result.allowed) {
 *       EA.AssetState.showBlockedState(container, event.assetState, 'public');
 *       return;
 *     }
 *     // Proceed with rendering...
 *   </script>
 *
 * @module web/shared/assetState
 * @version 1.0.0
 * @see Story E1 - Asset State Model
 */

(function(global) {
  'use strict';

  // =============================================================================
  // Constants
  // =============================================================================

  const VERSION = '1.0.0';

  /**
   * Valid asset states (LOCKED CONTRACT)
   */
  const ASSET_STATES = Object.freeze({
    DRAFT: 'DRAFT',
    READY: 'READY',
    ACTIVE: 'ACTIVE',
    ARCHIVED: 'ARCHIVED',
  });

  /**
   * Surface types that can render events
   */
  const SURFACES = Object.freeze({
    PUBLIC: 'public',
    DISPLAY: 'display',
    POSTER: 'poster',
    ADMIN: 'admin',
    REPORT: 'report',
  });

  /**
   * Human-readable labels for each state
   */
  const STATE_LABELS = Object.freeze({
    DRAFT: 'Draft',
    READY: 'Ready for Verification',
    ACTIVE: 'Active',
    ARCHIVED: 'Archived',
  });

  /**
   * Descriptions for each state
   */
  const STATE_DESCRIPTIONS = Object.freeze({
    DRAFT: 'Event is being created and is not ready for public display',
    READY: 'Event is complete but QR codes have not been verified',
    ACTIVE: 'Event is verified and safe to display on public surfaces',
    ARCHIVED: 'Event has been archived and is hidden from all surfaces',
  });

  /**
   * Surfaces that can render each state
   * INVARIANT: Only ACTIVE events render on public/display/poster
   */
  const RENDERABLE_SURFACES = Object.freeze({
    DRAFT: ['admin'],
    READY: ['admin'],
    ACTIVE: ['public', 'display', 'poster', 'admin', 'report'],
    ARCHIVED: ['admin'],
  });

  /**
   * Messages to show when rendering is blocked
   */
  const BLOCKED_MESSAGES = Object.freeze({
    DRAFT: {
      title: 'Event Not Ready',
      message: 'This event is still being configured.',
      icon: '📝',
    },
    READY: {
      title: 'Verification Required',
      message: 'This event needs QR code verification before it can be displayed.',
      icon: '🔐',
    },
    ARCHIVED: {
      title: 'Event Archived',
      message: 'This event has been archived and is no longer available.',
      icon: '📦',
    },
  });

  // =============================================================================
  // Core Functions
  // =============================================================================

  /**
   * Check if a value is a valid asset state
   *
   * @param {string} state - State to validate
   * @returns {boolean} true if valid
   */
  function isValidState(state) {
    return state && Object.values(ASSET_STATES).includes(state);
  }

  /**
   * Parse and normalize an asset state value
   *
   * @param {*} value - Value to parse
   * @returns {string} Normalized state (defaults to DRAFT)
   */
  function parseState(value) {
    if (!value || typeof value !== 'string') {
      return ASSET_STATES.DRAFT;
    }

    const normalized = value.toUpperCase().trim();
    return isValidState(normalized) ? normalized : ASSET_STATES.DRAFT;
  }

  /**
   * Resolve the asset state from event data
   *
   * Resolution priority:
   * 1. If status === 'archived' → ARCHIVED
   * 2. If explicit assetState is set → use that
   * 3. If qrVerified === true → ACTIVE
   * 4. If event has required fields → READY
   * 5. Otherwise → DRAFT
   *
   * @param {Object} event - Event data
   * @returns {Object} { state, isRenderable, label, description }
   */
  function resolveState(event) {
    if (!event) {
      return buildStateInfo(ASSET_STATES.DRAFT);
    }

    let state;

    // Priority 1: Check for archived status
    if (event.status === 'archived') {
      state = ASSET_STATES.ARCHIVED;
    }
    // Priority 2: Check explicit assetState
    else if (event.assetState && isValidState(event.assetState)) {
      state = event.assetState;
    }
    // Priority 3: Check qrVerified flag
    else if (event.qrVerified === true) {
      state = ASSET_STATES.ACTIVE;
    }
    // Priority 4: Check if event has minimum required fields
    else if (event.name && event.name.trim().length > 0) {
      state = ASSET_STATES.READY;
    }
    // Priority 5: Default to DRAFT
    else {
      state = ASSET_STATES.DRAFT;
    }

    return buildStateInfo(state);
  }

  /**
   * Build state info object
   *
   * @param {string} state - Asset state
   * @returns {Object} State info
   */
  function buildStateInfo(state) {
    return {
      state: state,
      isRenderable: state === ASSET_STATES.ACTIVE,
      label: STATE_LABELS[state] || 'Unknown',
      description: STATE_DESCRIPTIONS[state] || '',
    };
  }

  /**
   * Assert that an asset state is renderable on a given surface
   *
   * INVARIANT: Public/Display/Poster surfaces only render ACTIVE events
   * Admin surface can see all states
   *
   * @param {string} state - Asset state to check
   * @param {string} surface - Target render surface
   * @returns {Object} { allowed: boolean, reason?: string }
   */
  function assertRenderable(state, surface) {
    const normalizedState = parseState(state);
    const normalizedSurface = (surface || '').toLowerCase();

    const allowedSurfaces = RENDERABLE_SURFACES[normalizedState] || [];

    if (allowedSurfaces.includes(normalizedSurface)) {
      return { allowed: true };
    }

    // Build explanation for why rendering is blocked
    const reasons = {
      DRAFT: 'Event is still in draft mode and not ready for display',
      READY: 'Event is not yet verified for public display',
      ARCHIVED: 'Event has been archived and is no longer available',
    };

    return {
      allowed: false,
      reason: reasons[normalizedState] || 'Event cannot be displayed on this surface',
    };
  }

  /**
   * Check if rendering is allowed (convenience wrapper)
   *
   * @param {string} state - Asset state to check
   * @param {string} surface - Target render surface
   * @returns {boolean} true if rendering is allowed
   */
  function canRender(state, surface) {
    return assertRenderable(state, surface).allowed;
  }

  // =============================================================================
  // UI Functions
  // =============================================================================

  /**
   * Show blocked state UI in a container
   *
   * @param {HTMLElement} container - Target container
   * @param {string} state - Current asset state
   * @param {string} surface - Surface attempting to render
   * @param {Object} options - Additional options
   * @param {string} options.backUrl - URL for back button
   * @param {boolean} options.tvMode - Whether in TV/kiosk mode
   */
  function showBlockedState(container, state, surface, options = {}) {
    if (!container) {
      console.warn('[AssetState] No container provided for blocked state');
      return;
    }

    const normalizedState = parseState(state);
    const blockInfo = BLOCKED_MESSAGES[normalizedState] || {
      title: 'Cannot Display',
      message: 'This event is not available for viewing.',
      icon: '⚠️',
    };

    const { backUrl, tvMode = false } = options;

    // Build HTML - matches SharedUtils.StateRenderer pattern
    const fontSize = tvMode ? '1.5rem' : '1.1rem';
    const padding = tvMode ? '60px' : '40px';

    let html = `
      <div class="asset-state-blocked" style="
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: ${padding};
        text-align: center;
        min-height: 300px;
        background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
        border-radius: 12px;
      ">
        <span style="font-size: ${tvMode ? '4rem' : '3rem'}; margin-bottom: 16px;">
          ${blockInfo.icon}
        </span>
        <h2 style="
          font-size: ${tvMode ? '2rem' : '1.5rem'};
          font-weight: 600;
          color: #1e293b;
          margin: 0 0 12px 0;
        ">${blockInfo.title}</h2>
        <p style="
          font-size: ${fontSize};
          color: #64748b;
          margin: 0 0 24px 0;
          max-width: 400px;
        ">${blockInfo.message}</p>
    `;

    // Add state badge
    html += `
        <div style="
          display: inline-block;
          padding: 6px 12px;
          background: #e2e8f0;
          border-radius: 20px;
          font-size: 0.875rem;
          color: #475569;
        ">
          Status: ${STATE_LABELS[normalizedState] || 'Unknown'}
        </div>
    `;

    // Add back button if URL provided
    if (backUrl && !tvMode) {
      html += `
        <a href="${backUrl}" style="
          display: inline-flex;
          align-items: center;
          margin-top: 24px;
          padding: 12px 24px;
          background: #3b82f6;
          color: white;
          text-decoration: none;
          border-radius: 8px;
          font-weight: 500;
        ">
          ← Back to Events
        </a>
      `;
    }

    html += '</div>';

    container.innerHTML = html;
  }

  /**
   * Get state badge HTML for admin surfaces
   *
   * @param {string} state - Asset state
   * @returns {string} HTML for state badge
   */
  function getStateBadge(state) {
    const normalizedState = parseState(state);

    const colors = {
      DRAFT: { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
      READY: { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },
      ACTIVE: { bg: '#dcfce7', text: '#166534', border: '#86efac' },
      ARCHIVED: { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },
    };

    const style = colors[normalizedState] || colors.DRAFT;

    return `<span style="
      display: inline-block;
      padding: 4px 10px;
      background: ${style.bg};
      color: ${style.text};
      border: 1px solid ${style.border};
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 500;
    ">${STATE_LABELS[normalizedState] || 'Unknown'}</span>`;
  }

  // =============================================================================
  // Export to Global Namespace
  // =============================================================================

  // =============================================================================
  // Story E3: StateRenderer Integration (Never Blank / Never Broken)
  // =============================================================================

  /**
   * Error type constant for asset state issues
   * Used with SharedUtils.StateRenderer for consistent error display
   */
  const ERROR_TYPE_ASSET_NOT_RENDERABLE = 'asset_not_renderable';

  /**
   * Check if event bundle is renderable and show appropriate state
   *
   * Story E3: This is the main entry point for "Never Blank / Never Broken"
   * - If event is ACTIVE, returns true (proceed with rendering)
   * - If event is not ACTIVE, shows blocked state and returns false
   *
   * @param {Object} bundle - Event bundle from API
   * @param {HTMLElement} container - Container element
   * @param {string} surface - Surface type (public, display, poster)
   * @param {Object} options - Display options
   * @returns {boolean} true if event can be rendered, false if blocked
   */
  function guardRender(bundle, container, surface, options = {}) {
    if (!bundle) {
      showBlockedState(container, 'DRAFT', surface, {
        ...options,
        title: 'Event Not Found',
        message: 'The requested event could not be found.',
      });
      return false;
    }

    // Extract asset state from bundle (supports multiple shapes)
    const assetState = bundle.assetState ||
      bundle.value?.assetState ||
      bundle.event?.assetState ||
      'DRAFT';

    const assertion = assertRenderable(assetState, surface);

    if (assertion.allowed) {
      return true;
    }

    // Show blocked state using our built-in renderer
    showBlockedState(container, assetState, surface, options);

    // Also try to use SharedUtils.StateRenderer if available
    if (global.SharedUtils && global.SharedUtils.StateRenderer) {
      // Add our error type to the classifier if possible
      console.log('[AssetState] Event not renderable:', assetState, 'on', surface);
    }

    return false;
  }

  /**
   * Create an error response shape for asset state issues
   *
   * Story E3: Standardized error response for asset state problems
   * Compatible with existing error handling patterns
   *
   * @param {string} state - Current asset state
   * @param {string} surface - Target surface
   * @returns {Object} Error response object
   */
  function createAssetStateError(state, surface) {
    const assertion = assertRenderable(state, surface);

    return {
      ok: false,
      code: ERROR_TYPE_ASSET_NOT_RENDERABLE,
      errorCode: 'ASSET_NOT_RENDERABLE',
      status: 403,
      message: assertion.reason || 'Event is not renderable on this surface',
      assetState: parseState(state),
      surface: surface,
    };
  }

  /**
   * Wrapper for API responses that checks asset state
   *
   * Story E3: Ensures API responses are checked for renderability
   *
   * @param {Object} response - API response
   * @param {string} surface - Target surface
   * @returns {Object} Original response or error if not renderable
   */
  function validateApiResponse(response, surface) {
    if (!response || !response.ok) {
      return response; // Already an error
    }

    const assetState = response.assetState ||
      response.value?.assetState ||
      response.value?.event?.assetState;

    if (!assetState || canRender(assetState, surface)) {
      return response; // Renderable or no state info
    }

    // Return error response
    return createAssetStateError(assetState, surface);
  }

  // Create EA namespace if it doesn't exist
  if (!global.EA) {
    global.EA = {};
  }

  // Export AssetState module
  global.EA.AssetState = Object.freeze({
    // Version
    VERSION: VERSION,

    // Constants
    STATES: ASSET_STATES,
    SURFACES: SURFACES,
    LABELS: STATE_LABELS,
    DESCRIPTIONS: STATE_DESCRIPTIONS,
    ERROR_TYPE: ERROR_TYPE_ASSET_NOT_RENDERABLE,

    // Validation Functions
    isValidState: isValidState,
    parseState: parseState,
    resolveState: resolveState,

    // Renderability Functions
    assertRenderable: assertRenderable,
    canRender: canRender,

    // Story E3: Guard Functions (Never Blank / Never Broken)
    guardRender: guardRender,
    createAssetStateError: createAssetStateError,
    validateApiResponse: validateApiResponse,

    // UI Functions
    showBlockedState: showBlockedState,
    getStateBadge: getStateBadge,
  });

  // Log initialization
  console.log('[AssetState] Module loaded v' + VERSION);

})(typeof window !== 'undefined' ? window : this);
