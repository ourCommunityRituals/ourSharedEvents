/**
 * Structured Logger for Cloudflare Worker Router
 *
 * Provides consistent, structured logging for route resolution,
 * API requests, and error tracking.
 *
 * Log Prefixes:
 * - [ROUTE] - Route resolution logs (HTML routes)
 * - [API] - API request logs
 * - [404] - Not found logs
 * - [ERROR] - Error logs
 * - [ROUTER] - Router lifecycle logs
 *
 * @module logger
 * @see Story 1.1 - Create Central Worker Router
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Log levels supported by the logger
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Log entry structure for structured logging
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  prefix: string;
  message: string;
  requestId?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  backend?: string;
  brand?: string;
  error?: string;
  stack?: string;
  [key: string]: unknown;
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  /** Minimum log level to output */
  minLevel: LogLevel;
  /** Whether to output as JSON (true) or human-readable (false) */
  jsonOutput: boolean;
  /** Environment identifier (prod, stg, dev) */
  environment: string;
}

// =============================================================================
// Constants
// =============================================================================

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_PREFIXES = {
  ROUTE: '[ROUTE]',
  API: '[API]',
  NOT_FOUND: '[404]',
  ERROR: '[ERROR]',
  ROUTER: '[ROUTER]',
} as const;

// =============================================================================
// Logger Class
// =============================================================================

/**
 * Structured logger for Worker router
 *
 * @example
 * ```ts
 * const logger = new RouterLogger({ minLevel: 'info', jsonOutput: true, environment: 'prod' });
 * logger.routeResolved('/api/status', 'status', 200, 45);
 * logger.notFound('/unknown/path');
 * ```
 */
export class RouterLogger {
  private config: LoggerConfig;
  private requestId: string;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      minLevel: config.minLevel || 'info',
      jsonOutput: config.jsonOutput ?? true,
      environment: config.environment || 'unknown',
    };
    this.requestId = this.generateRequestId();
  }

  /**
   * Generate a unique request ID for tracing
   */
  private generateRequestId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get the current request ID
   */
  getRequestId(): string {
    return this.requestId;
  }

  /**
   * Set a specific request ID (e.g., from cf-ray header)
   */
  setRequestId(id: string): void {
    this.requestId = id;
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[this.config.minLevel];
  }

  /**
   * Format and output a log entry
   */
  private log(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) {
      return;
    }

    const fullEntry: LogEntry = {
      ...entry,
      requestId: this.requestId,
      env: this.config.environment,
    };

    if (this.config.jsonOutput) {
      console.log(JSON.stringify(fullEntry));
    } else {
      const { timestamp, level, prefix, message, ...rest } = fullEntry;
      const extras = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
      console.log(`${timestamp} ${level.toUpperCase()} ${prefix} ${message}${extras}`);
    }
  }

  // ===========================================================================
  // Route Logging Methods
  // ===========================================================================

  /**
   * Log when a route is successfully resolved
   */
  routeResolved(
    path: string,
    handler: string,
    status: number,
    durationMs?: number,
    extras?: Record<string, unknown>
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      level: 'info',
      prefix: LOG_PREFIXES.ROUTE,
      message: `Route resolved: ${path} → ${handler}`,
      path,
      handler,
      status,
      durationMs,
      ...extras,
    });
  }

  /**
   * Log API request handling
   */
  apiRequest(
    method: string,
    path: string,
    status: number,
    durationMs?: number,
    extras?: Record<string, unknown>
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      level: 'info',
      prefix: LOG_PREFIXES.API,
      message: `${method} ${path} → ${status}`,
      method,
      path,
      status,
      durationMs,
      ...extras,
    });
  }

  /**
   * Log 404 not found
   */
  notFound(path: string, method?: string): void {
    this.log({
      timestamp: new Date().toISOString(),
      level: 'warn',
      prefix: LOG_PREFIXES.NOT_FOUND,
      message: `Route not found: ${method || 'GET'} ${path}`,
      path,
      method: method || 'GET',
      status: 404,
    });
  }

  /**
   * Log router initialization
   */
  routerInit(version: string): void {
    this.log({
      timestamp: new Date().toISOString(),
      level: 'debug',
      prefix: LOG_PREFIXES.ROUTER,
      message: `Router initialized v${version}`,
      version,
    });
  }

  /**
   * Log incoming request
   */
  incomingRequest(method: string, url: string, headers?: Record<string, string>): void {
    this.log({
      timestamp: new Date().toISOString(),
      level: 'debug',
      prefix: LOG_PREFIXES.ROUTER,
      message: `Incoming request: ${method} ${url}`,
      method,
      url,
      headers,
    });
  }

  // ===========================================================================
  // Error Logging Methods
  // ===========================================================================

  /**
   * Log an error
   */
  error(message: string, error?: Error | unknown, extras?: Record<string, unknown>): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    this.log({
      timestamp: new Date().toISOString(),
      level: 'error',
      prefix: LOG_PREFIXES.ERROR,
      message,
      error: errorMessage,
      stack,
      ...extras,
    });
  }

  /**
   * Log a warning
   */
  warn(message: string, extras?: Record<string, unknown>): void {
    this.log({
      timestamp: new Date().toISOString(),
      level: 'warn',
      prefix: LOG_PREFIXES.ROUTER,
      message,
      ...extras,
    });
  }

  /**
   * Log debug information
   */
  debug(message: string, extras?: Record<string, unknown>): void {
    this.log({
      timestamp: new Date().toISOString(),
      level: 'debug',
      prefix: LOG_PREFIXES.ROUTER,
      message,
      ...extras,
    });
  }

  /**
   * Log info
   */
  info(message: string, extras?: Record<string, unknown>): void {
    this.log({
      timestamp: new Date().toISOString(),
      level: 'info',
      prefix: LOG_PREFIXES.ROUTER,
      message,
      ...extras,
    });
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a logger instance from Worker environment
 */
export function createLogger(env: {
  DEBUG_LEVEL?: string;
  WORKER_ENV?: string;
}): RouterLogger {
  const minLevel = (env.DEBUG_LEVEL as LogLevel) || 'info';
  const environment = env.WORKER_ENV || 'unknown';

  // Use JSON output for production, human-readable for staging/dev
  const jsonOutput = environment === 'production' || environment === 'prod';

  return new RouterLogger({
    minLevel,
    jsonOutput,
    environment,
  });
}
