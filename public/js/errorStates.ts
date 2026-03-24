/**
 * Public Surface Error States Module
 *
 * Story E3: Public Failure States (Never Blank / Never Broken)
 *
 * This module ensures the Public surface always shows meaningful content,
 * even when the backend fails or data is unavailable.
 *
 * INVARIANT: No blank screens, no infinite spinners, no JS stack traces.
 *
 * Error State Mapping:
 *   - Event not found (404)     → "Event not available"
 *   - Event not ACTIVE          → "Event coming soon"
 *   - Backend error (5xx)       → "Temporarily unavailable"
 *   - Network down              → "Check connection"
 *
 * @module public/errorStates
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
  actionLabel?: string;
  actionUrl?: string;
}

export interface RenderOptions {
  container: HTMLElement;
  backUrl?: string;
  retryCallback?: () => void;
  showRetry?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const VERSION = '1.0.0';

/**
 * Error configurations for each error type
 * Story E3: User-friendly messages per failure state
 */
const ERROR_CONFIGS: Record<ErrorType, ErrorConfig> = {
  NOT_FOUND: {
    type: 'NOT_FOUND',
    title: 'Event Not Available',
    message: 'The event you are looking for could not be found.',
    icon: '🔍',
  },
  NOT_ACTIVE: {
    type: 'NOT_ACTIVE',
    title: 'Event Coming Soon',
    message: 'This event is not yet available for viewing. Please check back later.',
    icon: '🗓️',
  },
  BACKEND_ERROR: {
    type: 'BACKEND_ERROR',
    title: 'Temporarily Unavailable',
    message: 'We are experiencing technical difficulties. Please try again in a moment.',
    icon: '⚙️',
  },
  NETWORK_ERROR: {
    type: 'NETWORK_ERROR',
    title: 'Check Connection',
    message: 'Unable to connect. Please check your internet connection and try again.',
    icon: '📡',
  },
  UNKNOWN: {
    type: 'UNKNOWN',
    title: 'Something Went Wrong',
    message: 'An unexpected error occurred. Please try again.',
    icon: '⚠️',
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
 * Generate error state HTML
 *
 * @param errorType - Type of error
 * @param options - Additional render options
 * @returns HTML string for error state
 */
export function generateErrorHtml(
  errorType: ErrorType,
  options: { backUrl?: string; showRetry?: boolean } = {}
): string {
  const config = ERROR_CONFIGS[errorType] || ERROR_CONFIGS.UNKNOWN;
  const { backUrl, showRetry = true } = options;

  let html = `
    <div class="error-state" data-testid="error-state" data-error-type="${escapeHtml(errorType)}">
      <div class="error-state-content">
        <span class="error-state-icon" aria-hidden="true">${config.icon}</span>
        <h2 class="error-state-title">${escapeHtml(config.title)}</h2>
        <p class="error-state-message">${escapeHtml(config.message)}</p>
        <div class="error-state-actions">
  `;

  // Add retry button for recoverable errors
  if (showRetry && (errorType === 'BACKEND_ERROR' || errorType === 'NETWORK_ERROR')) {
    html += `
          <button type="button" class="error-state-retry" data-testid="error-retry-btn" onclick="window.location.reload()">
            Try Again
          </button>
    `;
  }

  // Add back link if provided
  if (backUrl) {
    html += `
          <a href="${escapeHtml(backUrl)}" class="error-state-back">
            ← Back to Events
          </a>
    `;
  }

  html += `
        </div>
      </div>
    </div>
  `;

  return html;
}

/**
 * Generate inline styles for error state
 * Embedded to ensure error states display even if main CSS fails to load
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
        min-height: 300px;
        text-align: center;
        background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
        border-radius: 12px;
        margin: 20px;
      }

      .error-state-content {
        max-width: 400px;
      }

      .error-state-icon {
        font-size: 3rem;
        display: block;
        margin-bottom: 16px;
      }

      .error-state-title {
        font-size: 1.5rem;
        font-weight: 600;
        color: #1e293b;
        margin: 0 0 12px 0;
      }

      .error-state-message {
        font-size: 1rem;
        color: #64748b;
        margin: 0 0 24px 0;
        line-height: 1.6;
      }

      .error-state-actions {
        display: flex;
        flex-direction: column;
        gap: 12px;
        align-items: center;
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

      .error-state-back {
        display: inline-flex;
        align-items: center;
        padding: 8px 16px;
        color: #3b82f6;
        text-decoration: none;
        font-size: 0.875rem;
      }

      .error-state-back:hover {
        text-decoration: underline;
      }

      /* Hide loading spinner when error state is shown */
      .error-state ~ .loading-spinner,
      .error-state ~ .loading {
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
 * Even if everything else fails, this will show a meaningful message.
 *
 * @param options - Render options
 */
export function renderErrorState(options: RenderOptions & { errorType: ErrorType }): void {
  const { container, errorType, backUrl, retryCallback, showRetry = true } = options;

  if (!container) {
    console.error('[ErrorStates] No container provided for error state');
    return;
  }

  // Generate and inject error HTML with inline styles
  const stylesHtml = generateErrorStyles();
  const contentHtml = generateErrorHtml(errorType, { backUrl, showRetry });

  container.innerHTML = stylesHtml + contentHtml;

  // Attach retry callback if provided
  if (retryCallback && showRetry) {
    const retryBtn = container.querySelector('.error-state-retry');
    if (retryBtn) {
      retryBtn.addEventListener('click', (e) => {
        e.preventDefault();
        retryCallback();
      });
    }
  }

  // Log for debugging/audit
  console.log('[ErrorStates] Rendered error state:', {
    type: errorType,
    surface: 'public',
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
  options: { backUrl?: string; retryCallback?: () => void } = {}
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
  options: { backUrl?: string; retryCallback?: () => void } = {}
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
export function installGlobalErrorHandler(containerId: string = 'content'): void {
  window.onerror = function (message, source, lineno, colno, error) {
    console.error('[ErrorStates] Uncaught error:', { message, source, lineno, colno });

    const container = document.getElementById(containerId) || document.body;

    // Don't replace existing error state
    if (container.querySelector('.error-state')) {
      return false;
    }

    renderErrorState({
      container,
      errorType: 'UNKNOWN',
      showRetry: true,
    });

    // Return true to prevent default browser error handling (stack trace display)
    return true;
  };

  window.onunhandledrejection = function (event) {
    console.error('[ErrorStates] Unhandled promise rejection:', event.reason);

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
      showRetry: true,
    });
  };
}

// =============================================================================
// Export Module
// =============================================================================

/**
 * Public Error States Module
 * Story E3: Never Blank / Never Broken
 */
export const PublicErrorStates = {
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
export default PublicErrorStates;

// Export for CommonJS/IIFE compatibility
if (typeof window !== 'undefined') {
  (window as any).PublicErrorStates = PublicErrorStates;
}
