/**
 * Request ID Middleware for Cloudflare Worker
 *
 * SEC-9.2: Provides correlation IDs for structured logging.
 *
 * Request ID Priority:
 * 1. CF-Ray header from Cloudflare (enables edge log correlation)
 * 2. Generated unique ID (fallback for local development)
 *
 * Usage:
 * ```ts
 * import { getRequestId, createRequestContext } from './middleware/requestId';
 *
 * const reqId = getRequestId(request);
 * logger.setRequestId(reqId);
 * ```
 *
 * @module middleware/requestId
 * @see docs/security/LOGGING_STANDARD.md
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Request context with correlation ID and decision tracking
 */
export interface RequestContext {
  /** Unique request identifier for correlation */
  reqId: string;
  /** Request start time for latency calculation */
  startTime: number;
  /** Request route/path */
  route: string;
  /** HTTP method */
  method: string;
  /** Access decision (allow/deny/error/skip) */
  decision: 'allow' | 'deny' | 'error' | 'skip';
  /** HTTP status code */
  status: number;
}

/**
 * Decision log entry conforming to SEC-9.2 standard
 */
export interface DecisionLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  reqId: string;
  route: string;
  method: string;
  decision: 'allow' | 'deny' | 'error' | 'skip';
  status: number;
  latency: number;
  reason?: string;
  handler?: string;
  brand?: string;
}

// =============================================================================
// Request ID Generation
// =============================================================================

/**
 * Extract or generate a request ID for correlation
 *
 * Priority:
 * 1. CF-Ray header from Cloudflare (preferred - enables edge log correlation)
 * 2. Generated unique ID (fallback)
 *
 * @param request - Incoming HTTP request
 * @returns Unique request identifier
 */
export function getRequestId(request: Request): string {
  // Prefer Cloudflare Ray ID for edge log correlation
  const cfRay = request.headers.get('cf-ray');
  if (cfRay) {
    return cfRay;
  }

  // Fallback: timestamp + random suffix
  return generateRequestId();
}

/**
 * Generate a unique request ID
 *
 * Format: {timestamp_base36}-{random_9_chars}
 * Example: "lxyz123-abc456789"
 *
 * @returns Generated request ID
 */
export function generateRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;
}

// =============================================================================
// Request Context
// =============================================================================

/**
 * Create a request context for tracking the request lifecycle
 *
 * @param request - Incoming HTTP request
 * @returns Request context with correlation ID
 */
export function createRequestContext(request: Request): RequestContext {
  const url = new URL(request.url);

  return {
    reqId: getRequestId(request),
    startTime: Date.now(),
    route: url.pathname,
    method: request.method.toUpperCase(),
    decision: 'allow', // Default, updated during processing
    status: 200, // Default, updated during processing
  };
}

/**
 * Calculate latency in milliseconds
 *
 * @param ctx - Request context with start time
 * @returns Latency in milliseconds
 */
export function getLatency(ctx: RequestContext): number {
  return Date.now() - ctx.startTime;
}

// =============================================================================
// Decision Logging
// =============================================================================

/**
 * Create a decision log entry conforming to SEC-9.2 standard
 *
 * @param ctx - Request context
 * @param extras - Additional fields (reason, handler, brand)
 * @returns Decision log entry
 */
export function createDecisionLog(
  ctx: RequestContext,
  extras?: { reason?: string; handler?: string; brand?: string }
): DecisionLogEntry {
  const level = ctx.decision === 'error' ? 'error' : ctx.decision === 'deny' ? 'warn' : 'info';

  return {
    timestamp: new Date().toISOString(),
    level,
    reqId: ctx.reqId,
    route: ctx.route,
    method: ctx.method,
    decision: ctx.decision,
    status: ctx.status,
    latency: getLatency(ctx),
    ...extras,
  };
}

/**
 * Log a decision entry (console.log with JSON)
 *
 * SEC-9.2: All production logs use JSON format.
 *
 * @param entry - Decision log entry
 */
export function logDecision(entry: DecisionLogEntry): void {
  console.log(JSON.stringify(entry));
}

// =============================================================================
// Response Headers
// =============================================================================

/**
 * Add request ID to response headers
 *
 * Enables client-side correlation for debugging.
 *
 * @param response - Original response
 * @param reqId - Request ID to add
 * @returns Response with X-Request-Id header
 */
export function addRequestIdHeader(response: Response, reqId: string): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Request-Id', reqId);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// =============================================================================
// Middleware Factory
// =============================================================================

/**
 * Create a request ID middleware wrapper
 *
 * Usage:
 * ```ts
 * const middleware = createRequestIdMiddleware();
 *
 * export default {
 *   async fetch(request, env, ctx) {
 *     return middleware(request, env, ctx, async (reqCtx) => {
 *       // Handle request with reqCtx.reqId
 *       return new Response('OK');
 *     });
 *   }
 * };
 * ```
 *
 * @returns Middleware function
 */
export function createRequestIdMiddleware() {
  return async function middleware<E>(
    request: Request,
    env: E,
    execCtx: ExecutionContext,
    handler: (reqCtx: RequestContext, env: E, execCtx: ExecutionContext) => Promise<Response>
  ): Promise<Response> {
    const ctx = createRequestContext(request);

    try {
      const response = await handler(ctx, env, execCtx);
      ctx.status = response.status;
      ctx.decision = response.status >= 500 ? 'error' : response.status >= 400 ? 'deny' : 'allow';

      // Log decision
      logDecision(createDecisionLog(ctx));

      // Add request ID to response
      return addRequestIdHeader(response, ctx.reqId);
    } catch (error) {
      ctx.status = 500;
      ctx.decision = 'error';

      // Log decision with error
      logDecision(
        createDecisionLog(ctx, {
          reason: error instanceof Error ? error.message : 'Unknown error',
        })
      );

      // Re-throw to let outer handler deal with it
      throw error;
    }
  };
}
