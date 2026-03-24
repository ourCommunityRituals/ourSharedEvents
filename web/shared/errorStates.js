/**
 * EventAngle Error States Module v1.0.0
 *
 * Story E3: Public Failure States (Never Blank / Never Broken)
 *
 * Unified error state rendering for all public surfaces (Public, Display, Poster).
 * This module ensures surfaces always show meaningful content, even when backend fails.
 *
 * INVARIANT: No blank screens, no infinite spinners, no JS stack traces.
 *
 * Error State Mapping:
 *   - Event not found (404)     → "Event not available"
 *   - Event not ACTIVE          → "Event coming soon"
 *   - Backend error (5xx)       → "Temporarily unavailable"
 *   - Network down              → "Check connection"
 *
 * Usage:
 *   <script src="/web/shared/errorStates.js"></script>
 *   <script>
 *     // Classify and render error
 *     const errorType = EA.ErrorStates.classifyError(response);
 *     EA.ErrorStates.render(container, errorType, { surface: 'public' });
 *
 *     // Or render from API response directly
 *     EA.ErrorStates.renderFromApiResponse(container, response, { surface: 'display' });
 *   </script>
 *
 * @module web/shared/errorStates
 * @version 1.0.0
 * @see Story E3 - Public Failure States
 */

(function(global) {
  'use strict';

  // =============================================================================
  // Constants
  // =============================================================================

  var VERSION = '1.0.0';

  /**
   * Error type constants
   */
  var ERROR_TYPES = Object.freeze({
    NOT_FOUND: 'NOT_FOUND',
    NOT_ACTIVE: 'NOT_ACTIVE',
    BACKEND_ERROR: 'BACKEND_ERROR',
    NETWORK_ERROR: 'NETWORK_ERROR',
    UNKNOWN: 'UNKNOWN',
  });

  /**
   * Surface types
   */
  var SURFACES = Object.freeze({
    PUBLIC: 'public',
    DISPLAY: 'display',
    POSTER: 'poster',
  });

  /**
   * Error configurations for each error type
   * Story E3: User-friendly messages per failure state
   */
  var ERROR_CONFIGS = Object.freeze({
    NOT_FOUND: {
      type: 'NOT_FOUND',
      title: 'Event Not Available',
      message: 'The event you are looking for could not be found.',
      icon: '🔍',
      autoRetry: false,
    },
    NOT_ACTIVE: {
      type: 'NOT_ACTIVE',
      title: 'Event Coming Soon',
      message: 'This event is not yet available for viewing.',
      icon: '🗓️',
      autoRetry: true,
      retryDelayMs: 60000,
    },
    BACKEND_ERROR: {
      type: 'BACKEND_ERROR',
      title: 'Temporarily Unavailable',
      message: 'We are experiencing technical difficulties. Please try again in a moment.',
      icon: '⚙️',
      autoRetry: true,
      retryDelayMs: 30000,
    },
    NETWORK_ERROR: {
      type: 'NETWORK_ERROR',
      title: 'Check Connection',
      message: 'Unable to connect. Please check your internet connection.',
      icon: '📡',
      autoRetry: true,
      retryDelayMs: 10000,
    },
    UNKNOWN: {
      type: 'UNKNOWN',
      title: 'Something Went Wrong',
      message: 'An unexpected error occurred. Please try again.',
      icon: '⚠️',
      autoRetry: true,
      retryDelayMs: 30000,
    },
  });

  // =============================================================================
  // State
  // =============================================================================

  var retryTimeoutId = null;
  var countdownIntervalId = null;

  // =============================================================================
  // Error Classification
  // =============================================================================

  /**
   * Classify an error response into an error type
   *
   * @param {Object} response - API response or error object
   * @returns {string} ErrorType classification
   */
  function classifyError(response) {
    if (!response) {
      return ERROR_TYPES.UNKNOWN;
    }

    // Check for specific error codes from API
    var code = (response.code || '').toUpperCase();

    if (code === 'NOT_FOUND' || response.status === 404) {
      return ERROR_TYPES.NOT_FOUND;
    }

    if (code === 'ASSET_NOT_RENDERABLE' || code === 'FORBIDDEN' || response.status === 403) {
      return ERROR_TYPES.NOT_ACTIVE;
    }

    // Check for network errors
    if (code === 'NETWORK_ERROR' || code === 'TIMEOUT') {
      return ERROR_TYPES.NETWORK_ERROR;
    }

    // Check for backend/server errors (5xx)
    if (response.status && response.status >= 500) {
      return ERROR_TYPES.BACKEND_ERROR;
    }

    if (code === 'SERVICE_UNAVAILABLE' || code === 'INTERNAL') {
      return ERROR_TYPES.BACKEND_ERROR;
    }

    return ERROR_TYPES.UNKNOWN;
  }

  /**
   * Check if HTTP status indicates an error that needs fallback UI
   *
   * @param {number} status - HTTP status code
   * @returns {string|null} ErrorType if error, null if OK
   */
  function classifyHttpStatus(status) {
    if (status >= 200 && status < 400) {
      return null; // OK
    }

    if (status === 404) {
      return ERROR_TYPES.NOT_FOUND;
    }

    if (status === 403) {
      return ERROR_TYPES.NOT_ACTIVE;
    }

    if (status >= 500) {
      return ERROR_TYPES.BACKEND_ERROR;
    }

    return ERROR_TYPES.UNKNOWN;
  }

  // =============================================================================
  // HTML Generation
  // =============================================================================

  /**
   * Escape HTML special characters
   * @param {string} str - String to escape
   * @returns {string} Escaped string
   */
  function escapeHtml(str) {
    var htmlEntities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return String(str).replace(/[&<>"']/g, function(m) {
      return htmlEntities[m] || m;
    });
  }

  /**
   * Generate CSS styles for error states
   * Embedded to ensure error states display even if main CSS fails to load
   *
   * @param {string} surface - Surface type (public, display, poster)
   * @returns {string} CSS styles
   */
  function generateStyles(surface) {
    var baseStyles = '\n' +
      '.error-state {\n' +
      '  display: flex;\n' +
      '  flex-direction: column;\n' +
      '  align-items: center;\n' +
      '  justify-content: center;\n' +
      '  text-align: center;\n' +
      '  min-height: 300px;\n' +
      '  padding: 40px 20px;\n' +
      '}\n' +
      '.error-state-content {\n' +
      '  max-width: 500px;\n' +
      '}\n' +
      '.error-state-icon {\n' +
      '  font-size: 3rem;\n' +
      '  display: block;\n' +
      '  margin-bottom: 16px;\n' +
      '}\n' +
      '.error-state-title {\n' +
      '  font-size: 1.5rem;\n' +
      '  font-weight: 600;\n' +
      '  margin: 0 0 12px 0;\n' +
      '}\n' +
      '.error-state-message {\n' +
      '  font-size: 1rem;\n' +
      '  margin: 0 0 24px 0;\n' +
      '  line-height: 1.6;\n' +
      '}\n' +
      '.error-state-actions {\n' +
      '  display: flex;\n' +
      '  flex-direction: column;\n' +
      '  gap: 12px;\n' +
      '  align-items: center;\n' +
      '}\n' +
      '.error-state-retry {\n' +
      '  display: inline-flex;\n' +
      '  align-items: center;\n' +
      '  justify-content: center;\n' +
      '  padding: 12px 24px;\n' +
      '  background: #3b82f6;\n' +
      '  color: white;\n' +
      '  border: none;\n' +
      '  border-radius: 8px;\n' +
      '  font-size: 1rem;\n' +
      '  font-weight: 500;\n' +
      '  cursor: pointer;\n' +
      '}\n' +
      '.error-state-retry:hover {\n' +
      '  background: #2563eb;\n' +
      '}\n' +
      '.error-state-back {\n' +
      '  display: inline-flex;\n' +
      '  align-items: center;\n' +
      '  padding: 8px 16px;\n' +
      '  color: #3b82f6;\n' +
      '  text-decoration: none;\n' +
      '  font-size: 0.875rem;\n' +
      '}\n' +
      '.error-state-back:hover {\n' +
      '  text-decoration: underline;\n' +
      '}\n' +
      '.error-state-countdown {\n' +
      '  display: flex;\n' +
      '  align-items: center;\n' +
      '  justify-content: center;\n' +
      '  gap: 8px;\n' +
      '  font-size: 0.875rem;\n' +
      '  color: #64748b;\n' +
      '  margin-top: 16px;\n' +
      '}\n' +
      '.countdown-value {\n' +
      '  font-weight: 600;\n' +
      '  color: #3b82f6;\n' +
      '}\n' +
      '.error-state ~ .loading-spinner,\n' +
      '.error-state ~ .loading {\n' +
      '  display: none !important;\n' +
      '}\n';

    // Surface-specific styles
    var surfaceStyles = '';

    if (surface === SURFACES.PUBLIC) {
      surfaceStyles = '\n' +
        '.error-state--public {\n' +
        '  background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);\n' +
        '  border-radius: 12px;\n' +
        '  margin: 20px;\n' +
        '}\n' +
        '.error-state--public .error-state-title {\n' +
        '  color: #1e293b;\n' +
        '}\n' +
        '.error-state--public .error-state-message {\n' +
        '  color: #64748b;\n' +
        '}\n';
    } else if (surface === SURFACES.DISPLAY) {
      surfaceStyles = '\n' +
        '.error-state--display {\n' +
        '  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);\n' +
        '  color: white;\n' +
        '  position: fixed;\n' +
        '  top: 0;\n' +
        '  left: 0;\n' +
        '  right: 0;\n' +
        '  bottom: 0;\n' +
        '  min-height: 100vh;\n' +
        '  z-index: 9999;\n' +
        '}\n' +
        '.error-state--display .error-state-icon {\n' +
        '  font-size: 5rem;\n' +
        '}\n' +
        '.error-state--display .error-state-title {\n' +
        '  font-size: 2.5rem;\n' +
        '  color: white;\n' +
        '}\n' +
        '.error-state--display .error-state-message {\n' +
        '  font-size: 1.5rem;\n' +
        '  color: #94a3b8;\n' +
        '}\n' +
        '.error-state--display .error-state-countdown {\n' +
        '  font-size: 1.25rem;\n' +
        '}\n' +
        '.error-state--display .countdown-value {\n' +
        '  font-size: 1.5rem;\n' +
        '}\n' +
        'body.has-error-state {\n' +
        '  overflow: hidden;\n' +
        '}\n';
    } else if (surface === SURFACES.POSTER) {
      surfaceStyles = '\n' +
        '.error-state--poster {\n' +
        '  background: #ffffff;\n' +
        '  min-height: 100vh;\n' +
        '}\n' +
        '.error-state--poster .error-state-content {\n' +
        '  border: 2px solid #e2e8f0;\n' +
        '  border-radius: 12px;\n' +
        '  padding: 48px;\n' +
        '  background: #f8fafc;\n' +
        '}\n' +
        '.error-state--poster .error-state-title {\n' +
        '  color: #1e293b;\n' +
        '}\n' +
        '.error-state--poster .error-state-message {\n' +
        '  color: #475569;\n' +
        '}\n' +
        '@media print {\n' +
        '  .error-state--poster {\n' +
        '    min-height: auto;\n' +
        '    padding: 20mm;\n' +
        '  }\n' +
        '  .error-state--poster .error-state-content {\n' +
        '    border: 1px solid #000;\n' +
        '  }\n' +
        '  .error-state--poster .error-state-actions {\n' +
        '    display: none;\n' +
        '  }\n' +
        '}\n';
    }

    return '<style data-error-styles>' + baseStyles + surfaceStyles + '</style>';
  }

  /**
   * Generate error state HTML
   *
   * @param {string} errorType - Type of error
   * @param {Object} options - Render options
   * @returns {string} HTML string
   */
  function generateHtml(errorType, options) {
    options = options || {};
    var config = ERROR_CONFIGS[errorType] || ERROR_CONFIGS.UNKNOWN;
    var surface = options.surface || SURFACES.PUBLIC;
    var backUrl = options.backUrl;
    var showRetry = options.showRetry !== false;
    var showCountdown = options.showCountdown && config.autoRetry;

    var surfaceClass = 'error-state--' + escapeHtml(surface);

    var html = '<div class="error-state ' + surfaceClass + '" ' +
      'data-testid="error-state" data-error-type="' + escapeHtml(errorType) + '">' +
      '<div class="error-state-content">' +
      '<span class="error-state-icon" aria-hidden="true">' + config.icon + '</span>' +
      '<h2 class="error-state-title">' + escapeHtml(config.title) + '</h2>' +
      '<p class="error-state-message">' + escapeHtml(config.message) + '</p>';

    // Show countdown for auto-retry errors (display surface)
    if (showCountdown) {
      html += '<div class="error-state-countdown" data-testid="error-countdown">' +
        '<span>Retrying in </span>' +
        '<span class="countdown-value" data-countdown></span>' +
        '<span> seconds</span>' +
        '</div>';
    }

    // Action buttons
    html += '<div class="error-state-actions">';

    // Retry button for recoverable errors
    if (showRetry && (errorType === ERROR_TYPES.BACKEND_ERROR || errorType === ERROR_TYPES.NETWORK_ERROR)) {
      html += '<button type="button" class="error-state-retry" data-testid="error-retry-btn">' +
        'Try Again</button>';
    }

    // Back link if URL provided
    if (backUrl) {
      html += '<a href="' + escapeHtml(backUrl) + '" class="error-state-back">' +
        '← Back to Events</a>';
    }

    html += '</div></div></div>';

    return html;
  }

  // =============================================================================
  // Render Functions
  // =============================================================================

  /**
   * Clear any existing retry timers
   */
  function clearRetryTimers() {
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
   *
   * @param {HTMLElement} container - Container element
   * @param {number} delayMs - Delay in milliseconds
   * @param {Function} callback - Retry callback
   */
  function startAutoRetry(container, delayMs, callback) {
    clearRetryTimers();

    var countdownEl = container.querySelector('[data-countdown]');
    var remaining = Math.ceil(delayMs / 1000);

    // Update countdown display
    if (countdownEl) {
      countdownEl.textContent = String(remaining);

      countdownIntervalId = setInterval(function() {
        remaining -= 1;
        if (remaining >= 0) {
          countdownEl.textContent = String(remaining);
        }
      }, 1000);
    }

    // Schedule retry
    retryTimeoutId = setTimeout(function() {
      clearRetryTimers();
      callback();
    }, delayMs);
  }

  /**
   * Render error state into a container element
   *
   * Story E3 INVARIANT: This function ensures NO blank screens.
   *
   * @param {HTMLElement} container - Target container
   * @param {string} errorType - Error type to render
   * @param {Object} options - Render options
   */
  function render(container, errorType, options) {
    options = options || {};

    if (!container) {
      console.error('[ErrorStates] No container provided for error state');
      return;
    }

    var surface = options.surface || SURFACES.PUBLIC;
    var config = ERROR_CONFIGS[errorType] || ERROR_CONFIGS.UNKNOWN;
    var autoRetry = options.autoRetry !== undefined ? options.autoRetry : config.autoRetry;
    var retryDelayMs = options.retryDelayMs || config.retryDelayMs || 30000;
    var retryCallback = options.retryCallback;

    // Generate and inject HTML with inline styles
    var stylesHtml = generateStyles(surface);
    var contentHtml = generateHtml(errorType, {
      surface: surface,
      backUrl: options.backUrl,
      showRetry: options.showRetry,
      showCountdown: autoRetry && surface === SURFACES.DISPLAY,
    });

    container.innerHTML = stylesHtml + contentHtml;

    // Add body class for display surface
    if (surface === SURFACES.DISPLAY) {
      document.body.classList.add('has-error-state');
    }

    // Attach retry click handler
    var retryBtn = container.querySelector('.error-state-retry');
    if (retryBtn) {
      retryBtn.addEventListener('click', function(e) {
        e.preventDefault();
        if (retryCallback) {
          retryCallback();
        } else {
          window.location.reload();
        }
      });
    }

    // Start auto-retry for display surface
    if (autoRetry && surface === SURFACES.DISPLAY && retryCallback) {
      startAutoRetry(container, retryDelayMs, retryCallback);
    }

    // Log for debugging/audit
    console.log('[ErrorStates] Rendered error state:', {
      type: errorType,
      surface: surface,
      autoRetry: autoRetry,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Clear error state from container
   *
   * @param {HTMLElement} container - Container element
   */
  function clear(container) {
    clearRetryTimers();
    document.body.classList.remove('has-error-state');

    if (!container) return;

    var errorState = container.querySelector('.error-state');
    if (errorState) {
      errorState.remove();
    }

    var errorStyles = container.querySelector('[data-error-styles]');
    if (errorStyles) {
      errorStyles.remove();
    }
  }

  /**
   * Render error based on API response
   *
   * @param {HTMLElement} container - Target container
   * @param {Object} response - API response object
   * @param {Object} options - Render options
   */
  function renderFromApiResponse(container, response, options) {
    var errorType = classifyError(response);
    render(container, errorType, options);
  }

  /**
   * Render error based on HTTP status code
   *
   * @param {HTMLElement} container - Target container
   * @param {number} status - HTTP status code
   * @param {Object} options - Render options
   */
  function renderFromHttpStatus(container, status, options) {
    var errorType = classifyHttpStatus(status) || ERROR_TYPES.UNKNOWN;
    render(container, errorType, options);
  }

  // =============================================================================
  // Global Error Handler
  // =============================================================================

  /**
   * Install global error handler to prevent blank screens on uncaught errors
   *
   * Story E3 INVARIANT: Even JS errors won't show blank screens
   *
   * @param {Object} options - Handler options
   */
  function installGlobalErrorHandler(options) {
    options = options || {};
    var containerId = options.containerId || 'content';
    var surface = options.surface || SURFACES.PUBLIC;
    var retryCallback = options.retryCallback || function() { window.location.reload(); };

    window.onerror = function(message, source, lineno, colno, _error) {
      console.error('[ErrorStates] Uncaught error:', { message: message, source: source, lineno: lineno, colno: colno });

      var container = document.getElementById(containerId) || document.body;

      // Don't replace existing error state
      if (container.querySelector('.error-state')) {
        return false;
      }

      render(container, ERROR_TYPES.UNKNOWN, {
        surface: surface,
        autoRetry: surface === SURFACES.DISPLAY,
        retryCallback: retryCallback,
      });

      // Return true to prevent default browser error handling
      return true;
    };

    window.onunhandledrejection = function(event) {
      console.error('[ErrorStates] Unhandled promise rejection:', event.reason);

      var container = document.getElementById(containerId) || document.body;

      if (container.querySelector('.error-state')) {
        return;
      }

      // Classify the rejection reason
      var errorType = ERROR_TYPES.UNKNOWN;
      if (event.reason && (event.reason.code || event.reason.status)) {
        errorType = classifyError(event.reason);
      }

      render(container, errorType, {
        surface: surface,
        autoRetry: surface === SURFACES.DISPLAY,
        retryCallback: retryCallback,
      });
    };
  }

  // =============================================================================
  // Export to Global Namespace
  // =============================================================================

  // Create EA namespace if it doesn't exist
  if (!global.EA) {
    global.EA = {};
  }

  /**
   * Error States Module
   * Story E3: Never Blank / Never Broken
   */
  global.EA.ErrorStates = Object.freeze({
    VERSION: VERSION,

    // Constants
    TYPES: ERROR_TYPES,
    SURFACES: SURFACES,
    CONFIGS: ERROR_CONFIGS,

    // Classification
    classifyError: classifyError,
    classifyHttpStatus: classifyHttpStatus,

    // Rendering
    render: render,
    clear: clear,
    renderFromApiResponse: renderFromApiResponse,
    renderFromHttpStatus: renderFromHttpStatus,

    // Global handler
    installGlobalErrorHandler: installGlobalErrorHandler,

    // Utilities
    clearRetryTimers: clearRetryTimers,
  });

  // Log initialization
  console.log('[ErrorStates] Module loaded v' + VERSION);

})(typeof window !== 'undefined' ? window : this);
