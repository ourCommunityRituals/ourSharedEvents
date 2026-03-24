/**
 * Poster Surface Error States Module
 *
 * Story E3: Public Failure States (Never Blank / Never Broken)
 *
 * This module ensures the Poster surface always shows meaningful content,
 * even when the backend fails or data is unavailable.
 *
 * INVARIANT: No blank screens, no infinite spinners, no JS stack traces.
 *
 * POSTER SPECIFICS:
 *   - Print-friendly styling
 *   - No animations or interactive elements
 *   - Clear, static messaging
 *   - Optimized for physical printout
 *
 * Error State Mapping:
 *   - Event not found (404)     → "Event not available"
 *   - Event not ACTIVE          → "Event coming soon"
 *   - Backend error (5xx)       → "Temporarily unavailable"
 *   - Network down              → "Check connection"
 *
 * @module poster/errorStates
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
  printMessage?: string;
}

export interface RenderOptions {
  container: HTMLElement;
  showPrintHint?: boolean;
  retryCallback?: () => void;
}

// =============================================================================
// Constants
// =============================================================================

const VERSION = '1.0.0';

/**
 * Error configurations for each error type
 * Story E3: User-friendly messages per failure state
 * Poster-optimized: Clear messages for print viewing
 */
const ERROR_CONFIGS: Record<ErrorType, ErrorConfig> = {
  NOT_FOUND: {
    type: 'NOT_FOUND',
    title: 'Event Not Available',
    message: 'The event you are looking for could not be found.',
    icon: '🔍',
    printMessage: 'Please contact the event organizer for more information.',
  },
  NOT_ACTIVE: {
    type: 'NOT_ACTIVE',
    title: 'Event Coming Soon',
    message: 'This event poster is not yet available.',
    icon: '🗓️',
    printMessage: 'The event details will be available soon.',
  },
  BACKEND_ERROR: {
    type: 'BACKEND_ERROR',
    title: 'Temporarily Unavailable',
    message: 'Unable to load event details at this time.',
    icon: '⚙️',
    printMessage: 'Please try again later or contact the organizer.',
  },
  NETWORK_ERROR: {
    type: 'NETWORK_ERROR',
    title: 'Check Connection',
    message: 'Unable to connect to load event details.',
    icon: '📡',
    printMessage: 'Please check your internet connection and reload.',
  },
  UNKNOWN: {
    type: 'UNKNOWN',
    title: 'Unable to Load Poster',
    message: 'An error occurred while loading the event poster.',
    icon: '⚠️',
    printMessage: 'Please try reloading the page.',
  },
};

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
 * Generate error state HTML for Poster mode
 *
 * @param errorType - Type of error
 * @param options - Additional render options
 * @returns HTML string for error state
 */
export function generateErrorHtml(
  errorType: ErrorType,
  options: { showPrintHint?: boolean; showRetry?: boolean } = {}
): string {
  const config = ERROR_CONFIGS[errorType] || ERROR_CONFIGS.UNKNOWN;
  const { showPrintHint = true, showRetry = true } = options;

  let html = `
    <div class="error-state error-state--poster" data-testid="error-state" data-error-type="${escapeHtml(errorType)}">
      <div class="error-state-content">
        <span class="error-state-icon" aria-hidden="true">${config.icon}</span>
        <h2 class="error-state-title">${escapeHtml(config.title)}</h2>
        <p class="error-state-message">${escapeHtml(config.message)}</p>
  `;

  // Show print hint for certain errors
  if (showPrintHint && config.printMessage) {
    html += `
        <p class="error-state-print-hint">${escapeHtml(config.printMessage)}</p>
    `;
  }

  // Show retry button for recoverable errors (screen view only)
  if (showRetry && (errorType === 'BACKEND_ERROR' || errorType === 'NETWORK_ERROR')) {
    html += `
        <div class="error-state-actions print-hide">
          <button type="button" class="error-state-retry" data-testid="error-retry-btn" onclick="window.location.reload()">
            Reload Page
          </button>
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
 * Generate inline styles for Poster error state
 * Embedded to ensure error states display even if main CSS fails to load
 * Poster-optimized: Print-friendly, clean layout
 */
export function generateErrorStyles(): string {
  return `
    <style data-error-styles>
      .error-state--poster {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 60px 40px;
        min-height: 100vh;
        width: 100%;
        text-align: center;
        background: #ffffff;
        color: #1e293b;
      }

      .error-state-content {
        max-width: 500px;
        border: 2px solid #e2e8f0;
        border-radius: 12px;
        padding: 48px;
        background: #f8fafc;
      }

      .error-state-icon {
        font-size: 4rem;
        display: block;
        margin-bottom: 24px;
      }

      .error-state-title {
        font-size: 1.75rem;
        font-weight: 600;
        color: #1e293b;
        margin: 0 0 16px 0;
      }

      .error-state-message {
        font-size: 1.125rem;
        color: #475569;
        margin: 0 0 16px 0;
        line-height: 1.6;
      }

      .error-state-print-hint {
        font-size: 0.875rem;
        color: #64748b;
        margin: 0 0 24px 0;
        font-style: italic;
      }

      .error-state-actions {
        margin-top: 24px;
      }

      .error-state-retry {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 12px 24px;
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 1rem;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.2s;
      }

      .error-state-retry:hover {
        background: #2563eb;
      }

      /* Print styles */
      @media print {
        .error-state--poster {
          background: white;
          min-height: auto;
          padding: 20mm;
        }

        .error-state-content {
          border: 1px solid #000;
          padding: 30px;
        }

        .error-state-icon {
          font-size: 3rem;
        }

        .error-state-title {
          font-size: 1.5rem;
        }

        .error-state-message {
          font-size: 1rem;
        }

        .print-hide {
          display: none !important;
        }
      }

      /* Hide loading spinner when error state is shown */
      .error-state--poster ~ .loading-spinner,
      .error-state--poster ~ .loading,
      .error-state--poster ~ .poster-loading {
        display: none !important;
      }
    </style>
  `;
}

// =============================================================================
// Render Functions
// =============================================================================

/**
 * Render error state into a container element
 *
 * Story E3 INVARIANT: This function ensures NO blank screens.
 * For Poster mode, errors are print-friendly and clearly visible.
 *
 * @param options - Render options
 */
export function renderErrorState(options: RenderOptions & { errorType: ErrorType }): void {
  const {
    container,
    errorType,
    showPrintHint = true,
    retryCallback,
  } = options;

  if (!container) {
    console.error('[PosterErrorStates] No container provided for error state');
    return;
  }

  // Generate and inject error HTML with inline styles
  const stylesHtml = generateErrorStyles();
  const contentHtml = generateErrorHtml(errorType, {
    showPrintHint,
    showRetry: errorType === 'BACKEND_ERROR' || errorType === 'NETWORK_ERROR',
  });

  container.innerHTML = stylesHtml + contentHtml;

  // Attach retry callback if provided
  if (retryCallback) {
    const retryBtn = container.querySelector('.error-state-retry');
    if (retryBtn) {
      retryBtn.addEventListener('click', (e) => {
        e.preventDefault();
        retryCallback();
      });
    }
  }

  // Log for debugging/audit
  console.log('[PosterErrorStates] Rendered error state:', {
    type: errorType,
    surface: 'poster',
    timestamp: new Date().toISOString(),
  });
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
  options: { showPrintHint?: boolean; retryCallback?: () => void } = {}
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
  options: { showPrintHint?: boolean; retryCallback?: () => void } = {}
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
 */
export function installGlobalErrorHandler(containerId: string = 'poster-content'): void {
  window.onerror = function (message, source, lineno, colno, error) {
    console.error('[PosterErrorStates] Uncaught error:', { message, source, lineno, colno });

    const container = document.getElementById(containerId) || document.body;

    // Don't replace existing error state
    if (container.querySelector('.error-state')) {
      return false;
    }

    renderErrorState({
      container,
      errorType: 'UNKNOWN',
      showPrintHint: true,
    });

    // Return true to prevent default browser error handling (stack trace display)
    return true;
  };

  window.onunhandledrejection = function (event) {
    console.error('[PosterErrorStates] Unhandled promise rejection:', event.reason);

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
      showPrintHint: true,
    });
  };
}

// =============================================================================
// Export Module
// =============================================================================

/**
 * Poster Error States Module
 * Story E3: Never Blank / Never Broken (Print Mode)
 */
export const PosterErrorStates = {
  VERSION,

  // Error classification
  classifyError,
  classifyHttpStatus,

  // HTML generation
  generateErrorHtml,
  generateErrorStyles,

  // Rendering
  renderErrorState,
  renderFromApiResponse,
  renderFromHttpStatus,

  // Global handler
  installGlobalErrorHandler,

  // Error configs for customization
  ERROR_CONFIGS,
};

// Also export as default for ES module usage
export default PosterErrorStates;

// Export for CommonJS/IIFE compatibility
if (typeof window !== 'undefined') {
  (window as any).PosterErrorStates = PosterErrorStates;
}
