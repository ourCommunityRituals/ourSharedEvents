/**
 * Display Surface Error States Module
 *
 * Story E3: Public Failure States (Never Blank / Never Broken)
 *
 * This module ensures the Display (TV/Kiosk) surface always shows meaningful content,
 * even when the backend fails or data is unavailable.
 *
 * INVARIANT: No blank screens, no infinite spinners, no JS stack traces.
 *
 * TV MODE SPECIFICS:
 *   - Larger text for viewing from distance
 *   - High contrast colors
 *   - Full-screen error states
 *   - Auto-retry for transient errors
 *
 * Error State Mapping:
 *   - Event not found (404)     → "Event not available"
 *   - Event not ACTIVE          → "Event coming soon"
 *   - Backend error (5xx)       → "Temporarily unavailable"
 *   - Network down              → "Check connection"
 *
 * @module display/errorStates
 * @version 1.0.0
 * @see Story E3 - Public Failure States
 */

// =============================================================================
// Types
// =============================================================================

export type ErrorType =
  | 'NOT_FOUND'
  | 'NOT_ACTIVE'
  | 'BACKEND_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

export interface ErrorConfig {
  type: ErrorType;
  title: string;
  message: string;
  icon: string;
  autoRetry?: boolean;
  retryDelayMs?: number;
}

export interface RenderOptions {
  container: HTMLElement;
  tvMode?: boolean;
  autoRetry?: boolean;
  retryDelayMs?: number;
  retryCallback?: () => void;
}

// =============================================================================
// Constants
// =============================================================================

const VERSION = '1.0.0';

/** Default auto-retry delay for TV mode (30 seconds) */
const DEFAULT_RETRY_DELAY_MS = 30000;

/**
 * Error configurations for each error type
 * Story E3: User-friendly messages per failure state
 * TV-optimized: Concise messages for display viewing
 */
const ERROR_CONFIGS: Record<ErrorType, ErrorConfig> = {
  NOT_FOUND: {
    type: 'NOT_FOUND',
    title: 'Event Not Available',
    message: 'The requested event could not be found.',
    icon: '🔍',
    autoRetry: false,
  },
  NOT_ACTIVE: {
    type: 'NOT_ACTIVE',
    title: 'Event Coming Soon',
    message: 'This event is not yet available.',
    icon: '🗓️',
    autoRetry: true,
    retryDelayMs: 60000, // Check every minute
  },
  BACKEND_ERROR: {
    type: 'BACKEND_ERROR',
    title: 'Temporarily Unavailable',
    message: 'Please wait while we reconnect...',
    icon: '⚙️',
    autoRetry: true,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
  },
  NETWORK_ERROR: {
    type: 'NETWORK_ERROR',
    title: 'Check Connection',
    message: 'Unable to connect. Retrying automatically...',
    icon: '📡',
    autoRetry: true,
    retryDelayMs: 10000, // Retry every 10 seconds for network issues
  },
  UNKNOWN: {
    type: 'UNKNOWN',
    title: 'Display Error',
    message: 'An error occurred. Retrying...',
    icon: '⚠️',
    autoRetry: true,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
  },
};

// =============================================================================
// State
// =============================================================================

let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
let countdownIntervalId: ReturnType<typeof setInterval> | null = null;

// =============================================================================
// Error Classification
// =============================================================================

/**
 * Classify an error response into an error type
 *
 * @param response - API response or error object
 * @returns ErrorType classification
 */
export function classifyError(response: {
  ok?: boolean;
  code?: string;
  status?: number;
  message?: string;
} | null | undefined): ErrorType {
  if (!response) {
    return 'UNKNOWN';
  }

  // Check for specific error codes from API
  const code = response.code?.toUpperCase();
  if (code === 'NOT_FOUND' || response.status === 404) {
    return 'NOT_FOUND';
  }

  if (code === 'ASSET_NOT_RENDERABLE' || code === 'FORBIDDEN') {
    return 'NOT_ACTIVE';
  }

  // Check for network errors
  if (code === 'NETWORK_ERROR' || code === 'TIMEOUT') {
    return 'NETWORK_ERROR';
  }

  // Check for backend/server errors (5xx)
  if (response.status && response.status >= 500) {
    return 'BACKEND_ERROR';
  }

  if (code === 'SERVICE_UNAVAILABLE' || code === 'INTERNAL') {
    return 'BACKEND_ERROR';
  }

  return 'UNKNOWN';
}

/**
 * Check if HTTP status indicates an error that needs fallback UI
 *
 * @param status - HTTP status code
 * @returns ErrorType if error, null if OK
 */
export function classifyHttpStatus(status: number): ErrorType | null {
  if (status >= 200 && status < 400) {
    return null; // OK
  }

  if (status === 404) {
    return 'NOT_FOUND';
  }

  if (status === 403) {
    return 'NOT_ACTIVE';
  }

  if (status >= 500) {
    return 'BACKEND_ERROR';
  }

  return 'UNKNOWN';
}

// =============================================================================
// HTML Generation
// =============================================================================

/**
 * Escape HTML special characters
 */
function escapeHtml(str: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return String(str).replace(/[&<>"']/g, (m) => htmlEntities[m] || m);
}

/**
 * Generate error state HTML for TV/Display mode
 *
 * @param errorType - Type of error
 * @param options - Additional render options
 * @returns HTML string for error state
 */
export function generateErrorHtml(
  errorType: ErrorType,
  options: { tvMode?: boolean; showCountdown?: boolean } = {}
): string {
  const config = ERROR_CONFIGS[errorType] || ERROR_CONFIGS.UNKNOWN;
  const { tvMode = true, showCountdown = config.autoRetry } = options;

  const sizeClass = tvMode ? 'error-state--tv' : '';

  let html = `
    <div class="error-state ${sizeClass}" data-testid="error-state" data-error-type="${escapeHtml(errorType)}">
      <div class="error-state-content">
        <span class="error-state-icon" aria-hidden="true">${config.icon}</span>
        <h2 class="error-state-title">${escapeHtml(config.title)}</h2>
        <p class="error-state-message">${escapeHtml(config.message)}</p>
  `;

  // Show countdown for auto-retry errors
  if (showCountdown && config.autoRetry) {
    html += `
        <div class="error-state-countdown" data-testid="error-countdown">
          <span class="countdown-label">Retrying in </span>
          <span class="countdown-value" data-countdown></span>
          <span class="countdown-label"> seconds</span>
        </div>
    `;
  }

  html += `
      </div>
    </div>
  `;

  return html;
}

/**
 * Generate inline styles for TV/Display error state
 * Embedded to ensure error states display even if main CSS fails to load
 * TV-optimized: Large text, high contrast, full-screen
 */
export function generateErrorStyles(): string {
  return `
    <style data-error-styles>
      .error-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 40px 20px;
        min-height: 100vh;
        width: 100%;
        text-align: center;
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        color: white;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 9999;
      }

      .error-state-content {
        max-width: 800px;
      }

      .error-state-icon {
        font-size: 4rem;
        display: block;
        margin-bottom: 24px;
      }

      .error-state-title {
        font-size: 2rem;
        font-weight: 600;
        color: white;
        margin: 0 0 16px 0;
      }

      .error-state-message {
        font-size: 1.25rem;
        color: #94a3b8;
        margin: 0 0 32px 0;
        line-height: 1.6;
      }

      .error-state-countdown {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        font-size: 1.125rem;
        color: #64748b;
      }

      .countdown-value {
        font-size: 1.5rem;
        font-weight: 600;
        color: #3b82f6;
        min-width: 2ch;
      }

      /* TV Mode - Extra large for viewing from distance */
      .error-state--tv .error-state-icon {
        font-size: 6rem;
        margin-bottom: 32px;
      }

      .error-state--tv .error-state-title {
        font-size: 3rem;
        margin-bottom: 24px;
      }

      .error-state--tv .error-state-message {
        font-size: 1.75rem;
        margin-bottom: 48px;
      }

      .error-state--tv .error-state-countdown {
        font-size: 1.5rem;
      }

      .error-state--tv .countdown-value {
        font-size: 2rem;
      }

      /* Hide loading spinner when error state is shown */
      .error-state ~ .loading-spinner,
      .error-state ~ .loading,
      .error-state ~ .rotation-loading {
        display: none !important;
      }

      /* Ensure error state covers any content */
      body.has-error-state {
        overflow: hidden;
      }
    </style>
  `;
}

// =============================================================================
// Render Functions
// =============================================================================

/**
 * Clear any existing retry timers
 */
function clearRetryTimers(): void {
  if (retryTimeoutId) {
    clearTimeout(retryTimeoutId);
    retryTimeoutId = null;
  }
  if (countdownIntervalId) {
    clearInterval(countdownIntervalId);
    countdownIntervalId = null;
  }
}

/**
 * Start countdown display and auto-retry
 */
function startAutoRetry(
  container: HTMLElement,
  delayMs: number,
  callback: () => void
): void {
  clearRetryTimers();

  const countdownEl = container.querySelector('[data-countdown]');
  let remaining = Math.ceil(delayMs / 1000);

  // Update countdown display
  if (countdownEl) {
    countdownEl.textContent = String(remaining);

    countdownIntervalId = setInterval(() => {
      remaining -= 1;
      if (remaining >= 0) {
        countdownEl.textContent = String(remaining);
      }
    }, 1000);
  }

  // Schedule retry
  retryTimeoutId = setTimeout(() => {
    clearRetryTimers();
    callback();
  }, delayMs);
}

/**
 * Render error state into a container element
 *
 * Story E3 INVARIANT: This function ensures NO blank screens.
 * For TV/Display mode, errors are shown full-screen with auto-retry.
 *
 * @param options - Render options
 */
export function renderErrorState(options: RenderOptions & { errorType: ErrorType }): void {
  const {
    container,
    errorType,
    tvMode = true,
    autoRetry,
    retryDelayMs,
    retryCallback,
  } = options;

  if (!container) {
    console.error('[DisplayErrorStates] No container provided for error state');
    return;
  }

  const config = ERROR_CONFIGS[errorType] || ERROR_CONFIGS.UNKNOWN;

  // Determine if auto-retry should be enabled
  const shouldAutoRetry = autoRetry ?? config.autoRetry;
  const effectiveRetryDelay = retryDelayMs ?? config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  // Generate and inject error HTML with inline styles
  const stylesHtml = generateErrorStyles();
  const contentHtml = generateErrorHtml(errorType, {
    tvMode,
    showCountdown: shouldAutoRetry,
  });

  container.innerHTML = stylesHtml + contentHtml;

  // Add body class to prevent scroll
  document.body.classList.add('has-error-state');

  // Start auto-retry if enabled and callback provided
  if (shouldAutoRetry && retryCallback) {
    startAutoRetry(container, effectiveRetryDelay, retryCallback);
  }

  // Log for debugging/audit
  console.log('[DisplayErrorStates] Rendered error state:', {
    type: errorType,
    surface: 'display',
    tvMode,
    autoRetry: shouldAutoRetry,
    retryDelayMs: shouldAutoRetry ? effectiveRetryDelay : null,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Clear error state and restore normal display
 */
export function clearErrorState(container: HTMLElement): void {
  clearRetryTimers();
  document.body.classList.remove('has-error-state');

  const errorState = container.querySelector('.error-state');
  if (errorState) {
    errorState.remove();
  }

  const errorStyles = container.querySelector('[data-error-styles]');
  if (errorStyles) {
    errorStyles.remove();
  }
}

/**
 * Render error based on API response
 *
 * @param container - Target container element
 * @param response - API response object
 * @param options - Additional options
 */
export function renderFromApiResponse(
  container: HTMLElement,
  response: { ok?: boolean; code?: string; status?: number; message?: string } | null,
  options: { tvMode?: boolean; retryCallback?: () => void } = {}
): void {
  const errorType = classifyError(response);
  renderErrorState({
    container,
    errorType,
    ...options,
  });
}

/**
 * Render error based on HTTP status code
 *
 * @param container - Target container element
 * @param status - HTTP status code
 * @param options - Additional options
 */
export function renderFromHttpStatus(
  container: HTMLElement,
  status: number,
  options: { tvMode?: boolean; retryCallback?: () => void } = {}
): void {
  const errorType = classifyHttpStatus(status) || 'UNKNOWN';
  renderErrorState({
    container,
    errorType,
    ...options,
  });
}

// =============================================================================
// Global Error Handler
// =============================================================================

/**
 * Install global error handler to prevent blank screens on uncaught errors
 *
 * Story E3 INVARIANT: Even JS errors won't show blank screens
 * For Display mode, auto-retry is enabled by default
 */
export function installGlobalErrorHandler(options: {
  containerId?: string;
  tvMode?: boolean;
  retryCallback?: () => void;
} = {}): void {
  const { containerId = 'display-content', tvMode = true, retryCallback } = options;

  window.onerror = function (message, source, lineno, colno, error) {
    console.error('[DisplayErrorStates] Uncaught error:', { message, source, lineno, colno });

    const container = document.getElementById(containerId) || document.body;

    // Don't replace existing error state
    if (container.querySelector('.error-state')) {
      return false;
    }

    renderErrorState({
      container,
      errorType: 'UNKNOWN',
      tvMode,
      autoRetry: true,
      retryCallback: retryCallback || (() => window.location.reload()),
    });

    // Return true to prevent default browser error handling
    return true;
  };

  window.onunhandledrejection = function (event) {
    console.error('[DisplayErrorStates] Unhandled promise rejection:', event.reason);

    const container = document.getElementById(containerId) || document.body;

    if (container.querySelector('.error-state')) {
      return;
    }

    // Classify the rejection reason
    let errorType: ErrorType = 'UNKNOWN';
    if (event.reason?.code || event.reason?.status) {
      errorType = classifyError(event.reason);
    }

    renderErrorState({
      container,
      errorType,
      tvMode,
      autoRetry: true,
      retryCallback: retryCallback || (() => window.location.reload()),
    });
  };
}

// =============================================================================
// Export Module
// =============================================================================

/**
 * Display Error States Module
 * Story E3: Never Blank / Never Broken (TV/Kiosk Mode)
 */
export const DisplayErrorStates = {
  VERSION,

  // Error classification
  classifyError,
  classifyHttpStatus,

  // HTML generation
  generateErrorHtml,
  generateErrorStyles,

  // Rendering
  renderErrorState,
  clearErrorState,
  renderFromApiResponse,
  renderFromHttpStatus,

  // Global handler
  installGlobalErrorHandler,

  // Error configs for customization
  ERROR_CONFIGS,

  // Timer management
  clearRetryTimers,
};

// Also export as default for ES module usage
export default DisplayErrorStates;

// Export for CommonJS/IIFE compatibility
if (typeof window !== 'undefined') {
  (window as any).DisplayErrorStates = DisplayErrorStates;
}
