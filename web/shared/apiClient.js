/**
 * EventAngle API Client v1.0.0
 *
 * Story 4.2 - Shared API Client Module
 *
 * Fetch-based API client for all EventAngle surfaces.
 * Provides a clean interface for Worker API communication with:
 * - Automatic retry with exponential backoff
 * - Consistent error handling
 * - Response envelope parsing
 * - Stale-while-revalidate caching
 * - Request deduplication
 * - Logging and diagnostics
 *
 * IMPORTANT: This module is served from /web/shared/apiClient.js
 * All surfaces should load this script instead of embedding NUSDK.
 *
 * Usage:
 *   <script src="/web/shared/apiClient.js"></script>
 *   <script>
 *     // Initialize (auto-configures based on environment)
 *     EA.init({ brand: 'abc' });
 *
 *     // Make API calls
 *     const res = await EA.api.events.list();
 *     const bundle = await EA.api.events.getPublicBundle('event123');
 *   </script>
 *
 * Response Envelope (all endpoints follow this pattern):
 *   Success: { ok: true, value: {...}, etag?: string }
 *   Error:   { ok: false, code: string, message: string }
 *
 * @module web/shared/apiClient
 * @version 1.0.0
 */

(function(global) {
  'use strict';

  // =============================================================================
  // Constants
  // =============================================================================

  const VERSION = '1.0.0';
  const DEFAULT_API_BASE = '/api';
  const DEFAULT_TIMEOUT = 30000;
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1000;
  const MAX_LOGS = 100;
  const DEDUPE_WINDOW_MS = 5000;

  // HTTP status codes that are safe to retry
  const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

  // Error codes
  const ERROR_CODES = {
    BAD_INPUT: 'BAD_INPUT',
    NOT_FOUND: 'NOT_FOUND',
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    RATE_LIMITED: 'RATE_LIMITED',
    TIMEOUT: 'TIMEOUT',
    NETWORK_ERROR: 'NETWORK_ERROR',
    PARSE_ERROR: 'PARSE_ERROR',
    INTERNAL: 'INTERNAL',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  };

  // =============================================================================
  // State
  // =============================================================================

  /** @type {Array<{timestamp: string, level: string, type: string, [key: string]: any}>} */
  const logs = [];

  /** @type {Map<string, number>} */
  const errorDedupeMap = new Map();

  /** @type {Array<{path: string, requestId: string, startTime: number}>} */
  const pendingRequests = [];

  /** @type {{initialized: boolean, apiBase: string, brand: string, logLevel: 'debug'|'error'|'none', isStaging: boolean, isProduction: boolean}} */
  const state = {
    initialized: false,
    apiBase: DEFAULT_API_BASE,
    brand: 'root',
    logLevel: 'debug',
    isStaging: false,
    isProduction: false,
  };

  // =============================================================================
  // Utility Functions
  // =============================================================================

  /**
   * Sleep for a given number of milliseconds
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate a short request ID
   * @returns {string}
   */
  function generateRequestId() {
    return Math.random().toString(36).slice(2, 10);
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   * @param {number} attempt
   * @returns {number}
   */
  function calculateRetryDelay(attempt) {
    const exponentialDelay = RETRY_DELAY_MS * Math.pow(2, attempt);
    const jitter = Math.random() * 1000;
    return Math.min(exponentialDelay + jitter, 16000); // Cap at 16 seconds
  }

  /**
   * Check if an error is retryable based on status code
   * @param {number} status
   * @returns {boolean}
   */
  function isRetryableStatus(status) {
    return RETRYABLE_STATUS_CODES.includes(status);
  }

  /**
   * Map HTTP status code to error code
   * @param {number} status
   * @returns {string}
   */
  function mapStatusToErrorCode(status) {
    if (status === 400) return ERROR_CODES.BAD_INPUT;
    if (status === 401) return ERROR_CODES.UNAUTHORIZED;
    if (status === 403) return ERROR_CODES.FORBIDDEN;
    if (status === 404) return ERROR_CODES.NOT_FOUND;
    if (status === 408) return ERROR_CODES.TIMEOUT;
    if (status === 429) return ERROR_CODES.RATE_LIMITED;
    if (status === 503) return ERROR_CODES.SERVICE_UNAVAILABLE;
    if (status >= 500) return ERROR_CODES.INTERNAL;
    return ERROR_CODES.INTERNAL;
  }

  /**
   * Create user-friendly error message
   * @param {string} code
   * @param {string} [message]
   * @returns {string}
   */
  function createUserFriendlyMessage(code, message) {
    switch (code) {
      case ERROR_CODES.NETWORK_ERROR:
        return 'Unable to connect. Please check your internet connection and try again.';
      case ERROR_CODES.TIMEOUT:
        return 'The request took too long. Please try again.';
      case ERROR_CODES.SERVICE_UNAVAILABLE:
        return 'The service is temporarily unavailable. Please try again in a moment.';
      case ERROR_CODES.RATE_LIMITED:
        return 'Too many requests. Please wait a moment and try again.';
      case ERROR_CODES.UNAUTHORIZED:
        return 'Please sign in to continue.';
      case ERROR_CODES.FORBIDDEN:
        return "You don't have permission to perform this action.";
      case ERROR_CODES.NOT_FOUND:
        return message || 'The requested resource was not found.';
      case ERROR_CODES.BAD_INPUT:
        return message || 'Invalid input. Please check your data and try again.';
      case ERROR_CODES.PARSE_ERROR:
        return 'Received an unexpected response from the server.';
      default:
        return message || 'Something went wrong. Please try again.';
    }
  }

  /**
   * Escape HTML special characters
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    const htmlEntities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return String(str).replace(/[&<>"']/g, m => htmlEntities[m]);
  }

  // =============================================================================
  // Logging
  // =============================================================================

  /**
   * Log levels
   * @type {{none: number, error: number, debug: number}}
   */
  const LOG_LEVELS = { none: 0, error: 1, debug: 2 };

  /**
   * Internal logging with rolling buffer
   * @param {'debug'|'error'} level
   * @param {string} type
   * @param {object} [data]
   */
  function log(level, type, data = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      type,
      ...data,
    };

    // Add timing if startTime provided
    if (data.startTime) {
      entry.durationMs = Date.now() - data.startTime;
      delete entry.startTime;
    }

    // Add to rolling buffer
    logs.push(entry);
    if (logs.length > MAX_LOGS) {
      logs.shift();
    }

    // Console output based on log level
    const currentLevel = LOG_LEVELS[state.logLevel] || 0;
    const entryLevel = LOG_LEVELS[level] || 0;

    if (entryLevel <= currentLevel) {
      const prefix = '[EA]';
      const logData = { ...entry };
      delete logData.timestamp;
      delete logData.level;

      if (level === 'error') {
        // Deduplicate error console output to prevent log spam
        const path = data.path || type;
        const code = data.code || 'error';
        if (!isDuplicateError(path, code)) {
          console.error(prefix, type, JSON.stringify(logData));
        }
      } else {
        console.debug(prefix, type, JSON.stringify(logData));
      }
    }
  }

  /**
   * Check for duplicate error (deduplication within time window)
   * @param {string} path
   * @param {string} code
   * @returns {boolean}
   */
  function isDuplicateError(path, code) {
    const key = `${path}:${code}`;
    const now = Date.now();
    const lastTime = errorDedupeMap.get(key);

    if (lastTime && (now - lastTime) < DEDUPE_WINDOW_MS) {
      return true;
    }

    errorDedupeMap.set(key, now);

    // Clean old entries periodically
    if (errorDedupeMap.size > 100) {
      for (const [k, t] of errorDedupeMap.entries()) {
        if (now - t > DEDUPE_WINDOW_MS) {
          errorDedupeMap.delete(k);
        }
      }
    }

    return false;
  }

  // =============================================================================
  // Core Request Function
  // =============================================================================

  /**
   * Make an API request with automatic retry and error handling
   *
   * @param {string} path - API path (e.g., 'events', 'events/123/publicBundle')
   * @param {object} [options]
   * @param {'GET'|'POST'|'PUT'|'DELETE'} [options.method='GET']
   * @param {object} [options.body]
   * @param {object} [options.headers]
   * @param {number} [options.timeout]
   * @param {boolean} [options.retry=true]
   * @param {string} [options.ifNoneMatch]
   * @returns {Promise<{ok: boolean, value?: any, code?: string, message?: string, etag?: string, notModified?: boolean}>}
   */
  async function request(path, options = {}) {
    const {
      method = 'GET',
      body,
      headers = {},
      timeout = DEFAULT_TIMEOUT,
      retry = true,
      ifNoneMatch,
    } = options;

    const maxAttempts = retry ? MAX_RETRIES : 1;
    let lastError = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await executeRequest(path, { method, body, headers, timeout, ifNoneMatch });

      // If successful or non-retryable error, return immediately
      if (result.ok) {
        return result;
      }

      // Check if error is retryable
      if (result.status && !isRetryableStatus(result.status)) {
        return result;
      }

      lastError = result;

      // Don't retry on last attempt
      if (attempt < maxAttempts - 1) {
        const delay = calculateRetryDelay(attempt);
        log('debug', 'retry', { path, attempt: attempt + 1, delayMs: delay });
        await sleep(delay);
      }
    }

    return lastError || {
      ok: false,
      code: ERROR_CODES.INTERNAL,
      message: 'Request failed after retries',
    };
  }

  /**
   * Execute a single request (no retry)
   * @private
   */
  async function executeRequest(path, options) {
    const { method, body, headers, timeout, ifNoneMatch } = options;
    const requestId = generateRequestId();
    const startTime = Date.now();

    // Build URL
    const url = path.startsWith('http')
      ? path
      : `${state.apiBase}/${path.replace(/^\//, '')}`;

    // Build headers
    const requestHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Request-Id': requestId,
      ...headers,
    };

    if (ifNoneMatch) {
      requestHeaders['If-None-Match'] = ifNoneMatch;
    }

    // Track pending request
    const pendingEntry = { path, requestId, startTime };
    pendingRequests.push(pendingEntry);

    log('debug', 'start', { path, requestId, method });

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = timeout ? setTimeout(() => controller.abort(), timeout) : undefined;

    try {
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
        signal: controller.signal,
      });

      // Clear timeout
      if (timeoutId) clearTimeout(timeoutId);

      // Handle 304 Not Modified
      if (response.status === 304) {
        log('debug', 'not_modified', { path, requestId, startTime });
        return { ok: true, notModified: true };
      }

      // Handle HTTP errors
      if (!response.ok) {
        return await handleHttpError(response, path, requestId, startTime);
      }

      // Parse JSON response
      return await parseJsonResponse(response, path, requestId, startTime);

    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);

      // Handle abort/timeout
      if (error.name === 'AbortError') {
        log('error', 'timeout', { path, requestId, startTime });
        return {
          ok: false,
          code: ERROR_CODES.TIMEOUT,
          message: createUserFriendlyMessage(ERROR_CODES.TIMEOUT),
        };
      }

      // Handle network errors
      log('error', 'network_error', { path, requestId, error: error.message, startTime });
      return {
        ok: false,
        code: ERROR_CODES.NETWORK_ERROR,
        message: createUserFriendlyMessage(ERROR_CODES.NETWORK_ERROR),
      };

    } finally {
      // Remove from pending
      const idx = pendingRequests.indexOf(pendingEntry);
      if (idx > -1) pendingRequests.splice(idx, 1);
    }
  }

  /**
   * Handle HTTP error responses
   * @private
   */
  async function handleHttpError(response, path, requestId, startTime) {
    const status = response.status;
    let errorData = {};

    try {
      errorData = await response.json();
    } catch {
      // If JSON parsing fails, use status-based error
    }

    const code = errorData.code || mapStatusToErrorCode(status);
    const message = errorData.message || createUserFriendlyMessage(code);

    log('error', 'http_error', { path, requestId, status, code, startTime });

    return {
      ok: false,
      code,
      message,
      status,
    };
  }

  /**
   * Parse JSON response
   * @private
   */
  async function parseJsonResponse(response, path, requestId, startTime) {
    try {
      const data = await response.json();

      // Handle error envelope
      if (data.ok === false) {
        log('error', 'api_error', { path, requestId, code: data.code, startTime });
        return {
          ok: false,
          code: data.code || ERROR_CODES.INTERNAL,
          message: data.message || createUserFriendlyMessage(data.code || ERROR_CODES.INTERNAL),
          status: data.status,
        };
      }

      // Handle success envelope
      log('debug', 'ok', { path, requestId, hasValue: !!data.value, startTime });
      return {
        ok: true,
        value: data.value !== undefined ? data.value : data,
        etag: data.etag,
        notModified: data.notModified,
      };

    } catch {
      log('error', 'parse_error', { path, requestId, startTime });
      return {
        ok: false,
        code: ERROR_CODES.PARSE_ERROR,
        message: createUserFriendlyMessage(ERROR_CODES.PARSE_ERROR),
      };
    }
  }

  // =============================================================================
  // Legacy RPC Support
  // =============================================================================

  /**
   * Make an RPC call (legacy support for api_* methods)
   *
   * This provides backward compatibility with NUSDK's NU.rpc() interface.
   * New code should use the typed API methods instead.
   *
   * @param {string} path - API method name (e.g., 'events/list', 'api_saveEvent')
   * @param {object} [payload]
   * @returns {Promise<{ok: boolean, value?: any, code?: string, message?: string}>}
   */
  async function rpc(path, payload = {}) {
    // Legacy api_* methods go through /api/rpc endpoint
    const isLegacyMethod = path.startsWith('api_');

    if (isLegacyMethod) {
      return request('rpc', {
        method: 'POST',
        body: { method: path, payload },
      });
    }

    // Modern endpoints use direct paths
    return request(path, {
      method: 'POST',
      body: payload,
    });
  }

  // =============================================================================
  // Stale-While-Revalidate Cache
  // =============================================================================

  /**
   * Fetch with stale-while-revalidate pattern
   *
   * Returns cached data immediately, then fetches fresh data in background.
   *
   * @param {string} path - API path
   * @param {object} [payload]
   * @param {object} [options]
   * @param {number} [options.staleMs=120000] - Max age for stale data
   * @param {function} [options.onUpdate] - Called when fresh data arrives
   */
  function swr(path, payload, options = {}) {
    const { staleMs = 120000, onUpdate } = options;
    const key = `ea:swr:${path}:${JSON.stringify(payload || {})}`;

    try {
      const cached = JSON.parse(localStorage.getItem(key) || '{}');

      // Check if cached data is stale (beyond staleMs threshold)
      const isStale = cached.t && (Date.now() - cached.t > staleMs);

      if (cached.data) {
        // Return stale data immediately (even if stale)
        setTimeout(() => onUpdate && onUpdate(cached.data), 0);
      }

      // Always revalidate if stale or no cached data, otherwise use conditional request
      const shouldRevalidate = isStale || !cached.data;
      rpc(path, { ...(payload || {}), ifNoneMatch: shouldRevalidate ? undefined : cached.etag }).then(res => {
        if (res?.notModified) return;
        if (res?.ok && res.value) {
          localStorage.setItem(key, JSON.stringify({
            etag: res.etag,
            data: res.value,
            t: Date.now(),
          }));
          onUpdate && onUpdate(res.value);
        }
      });
    } catch (e) {
      // localStorage unavailable, just fetch
      rpc(path, payload).then(res => {
        if (res?.ok && res.value && onUpdate) {
          onUpdate(res.value);
        }
      });
    }
  }

  // =============================================================================
  // Typed API Methods
  // =============================================================================

  /**
   * Events API
   */
  const eventsApi = {
    /**
     * List all events
     * @param {object} [options]
     * @param {string} [options.brand]
     * @returns {Promise<{ok: boolean, value?: {events: Array}, code?: string, message?: string}>}
     */
    list(options = {}) {
      const params = new URLSearchParams();
      if (options.brand || state.brand !== 'root') {
        params.set('brand', options.brand || state.brand);
      }
      const query = params.toString();
      return request(`events${query ? '?' + query : ''}`, { method: 'GET' });
    },

    /**
     * Get a single event
     * @param {string} eventId
     * @returns {Promise<{ok: boolean, value?: object, code?: string, message?: string}>}
     */
    get(eventId) {
      return request(`events/${eventId}`, { method: 'GET' });
    },

    /**
     * Get public bundle for an event
     * @param {string} eventId
     * @param {object} [options]
     * @param {string} [options.ifNoneMatch] - ETag for conditional request
     * @returns {Promise<{ok: boolean, value?: object, code?: string, message?: string, etag?: string}>}
     */
    getPublicBundle(eventId, options = {}) {
      return request(`events/${eventId}/publicBundle`, {
        method: 'GET',
        ifNoneMatch: options.ifNoneMatch,
      });
    },

    /**
     * Get admin bundle for an event
     * @param {string} eventId
     * @param {object} [options]
     * @param {string} [options.ifNoneMatch]
     * @returns {Promise<{ok: boolean, value?: object, code?: string, message?: string, etag?: string}>}
     */
    getAdminBundle(eventId, options = {}) {
      return request(`events/${eventId}/adminBundle`, {
        method: 'GET',
        ifNoneMatch: options.ifNoneMatch,
      });
    },

    /**
     * Get display bundle for an event
     * @param {string} eventId
     * @param {object} [options]
     * @param {string} [options.ifNoneMatch]
     * @returns {Promise<{ok: boolean, value?: object, code?: string, message?: string, etag?: string}>}
     */
    getDisplayBundle(eventId, options = {}) {
      return request(`events/${eventId}/displayBundle`, {
        method: 'GET',
        ifNoneMatch: options.ifNoneMatch,
      });
    },

    /**
     * Get poster bundle for an event
     * @param {string} eventId
     * @param {object} [options]
     * @param {string} [options.ifNoneMatch]
     * @returns {Promise<{ok: boolean, value?: object, code?: string, message?: string, etag?: string}>}
     */
    getPosterBundle(eventId, options = {}) {
      return request(`events/${eventId}/posterBundle`, {
        method: 'GET',
        ifNoneMatch: options.ifNoneMatch,
      });
    },
  };

  /**
   * Admin API
   */
  const adminApi = {
    /**
     * Create a new event
     * @param {object} eventData
     * @returns {Promise<{ok: boolean, value?: {eventId: string}, code?: string, message?: string}>}
     */
    createEvent(eventData) {
      return request('admin/events', {
        method: 'POST',
        body: eventData,
      });
    },

    /**
     * Record a result for an event
     * @param {string} eventId
     * @param {object} resultData
     * @returns {Promise<{ok: boolean, value?: object, code?: string, message?: string}>}
     */
    recordResult(eventId, resultData) {
      return request(`admin/events/${eventId}/results`, {
        method: 'POST',
        body: resultData,
      });
    },

    /**
     * Save event (legacy RPC)
     * @param {object} eventData
     * @returns {Promise<{ok: boolean, value?: object, code?: string, message?: string}>}
     */
    saveEvent(eventData) {
      return rpc('api_saveEvent', eventData);
    },

    /**
     * Create form from template (legacy RPC)
     * @param {object} params
     * @returns {Promise<{ok: boolean, value?: object, code?: string, message?: string}>}
     */
    createFormFromTemplate(params) {
      return rpc('api_createFormFromTemplate', params);
    },

    /**
     * Generate form shortlink (legacy RPC)
     * @param {object} params
     * @returns {Promise<{ok: boolean, value?: object, code?: string, message?: string}>}
     */
    generateFormShortlink(params) {
      return rpc('api_generateFormShortlink', params);
    },

    /**
     * Get sponsor report QR (legacy RPC)
     * @param {object} params
     * @returns {Promise<{ok: boolean, value?: object, code?: string, message?: string}>}
     */
    getSponsorReportQr(params) {
      return rpc('getSponsorReportQr', params);
    },
  };

  /**
   * Status API
   */
  const statusApi = {
    /**
     * Health check
     * @returns {Promise<{ok: boolean, value?: object, code?: string, message?: string}>}
     */
    check() {
      return request('status', { method: 'GET' });
    },
  };

  // =============================================================================
  // Public API
  // =============================================================================

  /**
   * EventAngle API Client
   * @namespace EA
   */
  const EA = {
    /** Client version */
    VERSION,

    /**
     * Initialize the API client
     *
     * Call this early in page initialization.
     *
     * @param {object} [config]
     * @param {string} [config.brand='root'] - Brand identifier
     * @param {string} [config.apiBase='/api'] - API base URL
     * @param {'debug'|'error'|'none'} [config.logLevel] - Log level (auto-detected if not set)
     */
    init(config = {}) {
      // Auto-detect environment
      const hostname = window.location?.hostname || '';
      const isDomain = (host, domain) =>
        host === domain || host.endsWith('.' + domain);

      state.isStaging = isDomain(hostname, 'stg.eventangle.com') ||
                        hostname === 'localhost' ||
                        hostname === '127.0.0.1';
      state.isProduction = isDomain(hostname, 'eventangle.com') && !state.isStaging;

      // Apply configuration
      if (config.brand) state.brand = config.brand;
      if (config.apiBase) state.apiBase = config.apiBase;

      // Set log level (auto-detect based on environment)
      if (config.logLevel) {
        state.logLevel = config.logLevel;
      } else {
        state.logLevel = state.isProduction ? 'error' : 'debug';
      }

      state.initialized = true;

      log('debug', 'init', {
        version: VERSION,
        brand: state.brand,
        apiBase: state.apiBase,
        logLevel: state.logLevel,
        isStaging: state.isStaging,
        isProduction: state.isProduction,
      });
    },

    /**
     * Check if client is initialized
     * @returns {boolean}
     */
    isInitialized() {
      return state.initialized;
    },

    /**
     * Check if running in staging environment
     * @returns {boolean}
     */
    isStaging() {
      return state.isStaging;
    },

    /**
     * Check if running in production environment
     * @returns {boolean}
     */
    isProduction() {
      return state.isProduction;
    },

    /**
     * Raw request function for custom API calls
     */
    request,

    /**
     * Legacy RPC function (backward compatibility with NU.rpc)
     */
    rpc,

    /**
     * Stale-while-revalidate cache helper
     */
    swr,

    /**
     * HTML escape utility
     */
    esc: escapeHtml,

    /**
     * Get diagnostic logs
     * @returns {Array}
     */
    getLogs() {
      return [...logs];
    },

    /**
     * Get pending requests
     * @returns {Array}
     */
    getPending() {
      return [...pendingRequests];
    },

    /**
     * Flush all pending requests
     * @returns {Promise<void>}
     */
    async flush() {
      if (pendingRequests.length === 0) {
        log('debug', 'flush', { message: 'No pending requests' });
        return;
      }

      log('debug', 'flush', { pendingCount: pendingRequests.length });

      const timeout = 5000;
      const startTime = Date.now();

      while (pendingRequests.length > 0 && (Date.now() - startTime) < timeout) {
        await sleep(100);
      }

      if (pendingRequests.length > 0) {
        log('error', 'flush', { message: 'Timeout waiting for pending requests', remaining: pendingRequests.length });
      } else {
        log('debug', 'flush', { message: 'All requests completed' });
      }
    },

    /**
     * Typed API endpoints
     */
    api: {
      events: eventsApi,
      admin: adminApi,
      status: statusApi,
    },

    /**
     * Error codes constant (for error handling)
     */
    ERROR_CODES,
  };

  // =============================================================================
  // Backward Compatibility with NUSDK
  // =============================================================================

  /**
   * NU namespace for backward compatibility
   * @deprecated Use EA instead
   */
  const NU = {
    VERSION,
    init: EA.init,
    isInitialized: EA.isInitialized,
    isStaging: EA.isStaging,
    isProduction: EA.isProduction,
    rpc: EA.rpc,
    swr: EA.swr,
    esc: EA.esc,
    flush: EA.flush,

    // Environment flags
    get _env() {
      return {
        isStaging: state.isStaging,
        isProduction: state.isProduction,
        hostname: window.location?.hostname || '',
      };
    },
  };

  // =============================================================================
  // Exports
  // =============================================================================

  // Expose on global object
  global.EA = EA;
  global.NU = NU; // Backward compatibility

  // Expose logs for diagnostics
  global.__EA_LOGS__ = logs;
  global.__NU_LOGS__ = logs; // Backward compatibility

  // Auto-initialize on load
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        // Auto-detect brand from meta tag or URL
        const brandMeta = document.querySelector('meta[name="ea-brand"]');
        const brandId = brandMeta?.content || 'root';
        EA.init({ brand: brandId });
      });
    } else {
      // DOM already loaded
      const brandMeta = document.querySelector('meta[name="ea-brand"]');
      const brandId = brandMeta?.content || 'root';
      EA.init({ brand: brandId });
    }
  }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
