/**
 * Base API Client Module
 *
 * Story 4.1 - Extract Frontend API Adapter Layer
 *
 * Provides shared fetch wrapper with:
 * - JSON parsing
 * - Consistent error handling (maps {ok:false} to UI errors)
 * - Network failure handling (no stuck spinners)
 * - Retry logic with exponential backoff
 *
 * All surface-specific API clients extend this base.
 *
 * @module frontend/apiClient/base
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Standard API response envelope for success
 */
export interface ApiSuccessResponse<T> {
  ok: true;
  value: T;
  etag?: string;
  notModified?: boolean;
}

/**
 * Standard API error codes
 */
export type ApiErrorCode =
  | 'BAD_INPUT'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'INTERNAL'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'SERVICE_UNAVAILABLE'
  | 'PARSE_ERROR';

/**
 * Standard API response envelope for errors
 */
export interface ApiErrorResponse {
  ok: false;
  code: ApiErrorCode;
  message: string;
  status?: number;
  corrId?: string;
}

/**
 * Union type for all API responses
 */
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Configuration for the API client
 */
export interface ApiClientConfig {
  /** Base URL for API requests (default: '/api') */
  baseUrl?: string;
  /** Default timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Whether to include credentials (default: 'same-origin') */
  credentials?: RequestCredentials;
  /** Custom headers to include with all requests */
  headers?: Record<string, string>;
  /** Maximum retry attempts for transient errors (default: 3) */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms (default: 1000) */
  retryDelayMs?: number;
}

/**
 * Options for individual API requests
 */
export interface RequestOptions {
  /** HTTP method (default: 'POST') */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** Request body (will be JSON stringified) */
  body?: unknown;
  /** Additional headers for this request */
  headers?: Record<string, string>;
  /** Request timeout in ms (overrides config) */
  timeout?: number;
  /** Whether to retry on transient errors (default: true) */
  retry?: boolean;
  /** ETag for conditional requests */
  ifNoneMatch?: string;
  /** Signal for request cancellation */
  signal?: AbortSignal;
}

/**
 * Error UI callback type
 */
export type ErrorUIHandler = (error: ApiErrorResponse) => void;

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CONFIG: Required<ApiClientConfig> = {
  baseUrl: '/api',
  timeout: 30000,
  credentials: 'same-origin',
  headers: {},
  maxRetries: 3,
  retryDelayMs: 1000,
};

/**
 * HTTP status codes that indicate transient errors (safe to retry)
 */
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

/**
 * Error codes that indicate transient errors (safe to retry)
 */
const RETRYABLE_ERROR_CODES: ApiErrorCode[] = [
  'NETWORK_ERROR',
  'TIMEOUT',
  'SERVICE_UNAVAILABLE',
  'RATE_LIMITED',
];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Sleep for a given number of milliseconds
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calculate retry delay with exponential backoff and jitter
 */
const calculateRetryDelay = (attempt: number, baseDelay: number): number => {
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * 1000;
  return Math.min(exponentialDelay + jitter, 16000); // Cap at 16 seconds
};

/**
 * Check if an error is retryable
 */
const isRetryableError = (error: ApiErrorResponse): boolean => {
  if (error.status && RETRYABLE_STATUS_CODES.includes(error.status)) {
    return true;
  }
  return RETRYABLE_ERROR_CODES.includes(error.code);
};

/**
 * Map HTTP status code to error code
 */
const mapStatusToErrorCode = (status: number): ApiErrorCode => {
  if (status === 400) return 'BAD_INPUT';
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 408) return 'TIMEOUT';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 503) return 'SERVICE_UNAVAILABLE';
  if (status >= 500) return 'INTERNAL';
  return 'INTERNAL';
};

/**
 * Create a user-friendly error message
 */
const createUserFriendlyMessage = (code: ApiErrorCode, message?: string): string => {
  switch (code) {
    case 'NETWORK_ERROR':
      return 'Unable to connect. Please check your internet connection and try again.';
    case 'TIMEOUT':
      return 'The request took too long. Please try again.';
    case 'SERVICE_UNAVAILABLE':
      return 'The service is temporarily unavailable. Please try again in a moment.';
    case 'RATE_LIMITED':
      return 'Too many requests. Please wait a moment and try again.';
    case 'UNAUTHORIZED':
      return 'Please sign in to continue.';
    case 'FORBIDDEN':
      return 'You don\'t have permission to perform this action.';
    case 'NOT_FOUND':
      return message || 'The requested resource was not found.';
    case 'BAD_INPUT':
      return message || 'Invalid input. Please check your data and try again.';
    case 'PARSE_ERROR':
      return 'Received an unexpected response from the server.';
    default:
      return message || 'Something went wrong. Please try again.';
  }
};

// =============================================================================
// BaseApiClient Class
// =============================================================================

/**
 * Base API Client with fetch wrapper and error handling
 *
 * Provides:
 * - Automatic JSON parsing
 * - Consistent error envelope handling
 * - Network failure handling
 * - Retry logic with exponential backoff
 * - Timeout support
 */
export class BaseApiClient {
  protected config: Required<ApiClientConfig>;
  protected onError?: ErrorUIHandler;

  constructor(config: ApiClientConfig = {}, onError?: ErrorUIHandler) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.onError = onError;
  }

  /**
   * Set the error UI handler
   */
  setErrorHandler(handler: ErrorUIHandler): void {
    this.onError = handler;
  }

  /**
   * Make an API request with automatic retry and error handling
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    const {
      method = 'POST',
      body,
      headers = {},
      timeout = this.config.timeout,
      retry = true,
      ifNoneMatch,
      signal,
    } = options;

    const maxAttempts = retry ? this.config.maxRetries : 1;
    let lastError: ApiErrorResponse | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const result = await this.executeRequest<T>(path, {
          method,
          body,
          headers,
          timeout,
          ifNoneMatch,
          signal,
        });

        // If successful or non-retryable error, return immediately
        if (result.ok || !isRetryableError(result)) {
          return result;
        }

        lastError = result;

        // Don't retry if we're on the last attempt
        if (attempt < maxAttempts - 1) {
          const delay = calculateRetryDelay(attempt, this.config.retryDelayMs);
          await sleep(delay);
        }
      } catch (error) {
        // Unexpected error (should not happen with proper error handling)
        lastError = {
          ok: false,
          code: 'INTERNAL',
          message: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }

    // All retries exhausted, notify UI and return last error
    if (lastError && this.onError) {
      this.onError(lastError);
    }

    return lastError || {
      ok: false,
      code: 'INTERNAL',
      message: 'Request failed after retries',
    };
  }

  /**
   * Execute a single request (no retry)
   */
  private async executeRequest<T>(
    path: string,
    options: Omit<RequestOptions, 'retry'>
  ): Promise<ApiResponse<T>> {
    const { method = 'POST', body, headers = {}, timeout, ifNoneMatch, signal } = options;

    // Build URL
    const url = path.startsWith('http')
      ? path
      : `${this.config.baseUrl}/${path.replace(/^\//, '')}`;

    // Build headers
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...this.config.headers,
      ...headers,
    };

    if (ifNoneMatch) {
      requestHeaders['If-None-Match'] = ifNoneMatch;
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = timeout
      ? setTimeout(() => controller.abort(), timeout)
      : undefined;

    try {
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
        credentials: this.config.credentials,
        signal: signal || controller.signal,
      });

      // Clear timeout on response
      if (timeoutId) clearTimeout(timeoutId);

      // Handle 304 Not Modified
      if (response.status === 304) {
        return {
          ok: true,
          value: undefined as unknown as T,
          notModified: true,
        };
      }

      // Handle HTTP errors
      if (!response.ok) {
        return this.handleHttpError<T>(response);
      }

      // Parse JSON response
      return this.parseJsonResponse<T>(response);
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);

      // Handle abort/timeout
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          ok: false,
          code: 'TIMEOUT',
          message: createUserFriendlyMessage('TIMEOUT'),
        };
      }

      // Handle network errors
      return {
        ok: false,
        code: 'NETWORK_ERROR',
        message: createUserFriendlyMessage('NETWORK_ERROR'),
      };
    }
  }

  /**
   * Handle HTTP error responses
   */
  private async handleHttpError<T>(response: Response): Promise<ApiResponse<T>> {
    const status = response.status;
    let errorData: Partial<ApiErrorResponse> = {};

    try {
      errorData = await response.json();
    } catch {
      // If JSON parsing fails, use status-based error
    }

    const code = (errorData.code as ApiErrorCode) || mapStatusToErrorCode(status);
    const message = errorData.message || createUserFriendlyMessage(code);

    return {
      ok: false,
      code,
      message,
      status,
      corrId: errorData.corrId,
    };
  }

  /**
   * Parse JSON response
   */
  private async parseJsonResponse<T>(response: Response): Promise<ApiResponse<T>> {
    try {
      const data = await response.json();

      // Handle error envelope
      if (data.ok === false) {
        return {
          ok: false,
          code: data.code || 'INTERNAL',
          message: data.message || createUserFriendlyMessage(data.code || 'INTERNAL'),
          status: data.status,
          corrId: data.corrId,
        };
      }

      // Handle success envelope
      return {
        ok: true,
        value: data.value !== undefined ? data.value : data,
        etag: data.etag,
        notModified: data.notModified,
      };
    } catch {
      return {
        ok: false,
        code: 'PARSE_ERROR',
        message: createUserFriendlyMessage('PARSE_ERROR'),
      };
    }
  }

  /**
   * Convenience method for GET requests
   */
  async get<T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<ApiResponse<T>> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  /**
   * Convenience method for POST requests
   */
  async post<T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<ApiResponse<T>> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  /**
   * Convenience method for PUT requests
   */
  async put<T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<ApiResponse<T>> {
    return this.request<T>(path, { ...options, method: 'PUT', body });
  }

  /**
   * Convenience method for DELETE requests
   */
  async delete<T>(path: string, options: Omit<RequestOptions, 'method'> = {}): Promise<ApiResponse<T>> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a configured API client instance
 */
export function createApiClient(
  config?: ApiClientConfig,
  onError?: ErrorUIHandler
): BaseApiClient {
  return new BaseApiClient(config, onError);
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if response is successful
 */
export function isSuccess<T>(response: ApiResponse<T>): response is ApiSuccessResponse<T> {
  return response.ok === true;
}

/**
 * Type guard to check if response is an error
 */
export function isError<T>(response: ApiResponse<T>): response is ApiErrorResponse {
  return response.ok === false;
}

// =============================================================================
// Exports
// =============================================================================

export default BaseApiClient;
