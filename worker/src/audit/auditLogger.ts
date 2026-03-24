/**
 * Audit Logger Module
 *
 * SEC-IAC-06: Append immutable audit rows for all admin and denied actions.
 *
 * Security Requirements:
 * - All admin actions are logged with full context
 * - All denied access attempts are logged
 * - Logs are immutable (append-only to Google Sheets)
 * - No log modification or deletion permitted
 *
 * Audit Event Fields:
 * - timestamp: ISO 8601 timestamp
 * - requestId: Unique request identifier (CF-Ray or generated)
 * - actorEmail: Email of the actor (if authenticated)
 * - actorSub: Subject/ID of the actor (if available)
 * - ip: Client IP address
 * - action: The action being performed
 * - target: The resource being accessed
 * - diff: JSON diff or hash of changes (for mutations)
 * - outcome: 'ok' | 'deny' | 'error'
 *
 * @module audit/auditLogger
 * @see SEC-IAC-06 - Audit Logging
 */

import { appendRow, isConfigured, type SheetsEnv } from '../sheetsClient';

// =============================================================================
// Types
// =============================================================================

/**
 * Audit event outcome types
 */
export type AuditOutcome = 'ok' | 'deny' | 'error';

/**
 * Audit event structure with all required fields
 */
export interface AuditEvent {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Unique request identifier */
  requestId: string;
  /** Email of the actor (if authenticated) */
  actorEmail: string | null;
  /** Subject/ID of the actor (from JWT sub claim or session) */
  actorSub: string | null;
  /** Client IP address */
  ip: string;
  /** The action being performed */
  action: string;
  /** The resource being accessed (path or resource ID) */
  target: string;
  /** JSON diff or hash of changes (for mutations) */
  diff: string | null;
  /** Outcome of the action */
  outcome: AuditOutcome;
  /** Optional error message for error/deny outcomes */
  errorMessage?: string;
  /** Optional denial reason code */
  denyReason?: string;
}

/**
 * Environment bindings for audit logger
 */
export interface AuditLoggerEnv extends SheetsEnv {
  /**
   * Sheet name for audit logs (default: 'AUDIT_LOGS')
   */
  AUDIT_SHEET_NAME?: string;

  /**
   * Enable/disable audit logging (default: true)
   */
  AUDIT_ENABLED?: string;
}

/**
 * Context for creating audit events
 */
export interface AuditContext {
  /** Request object for extracting IP and headers */
  request: Request;
  /** Request ID */
  requestId: string;
  /** Actor email (from session/token) */
  actorEmail?: string | null;
  /** Actor subject ID (from JWT) */
  actorSub?: string | null;
}

/**
 * Result of audit log operation
 */
export interface AuditLogResult {
  /** Whether the log was successfully written */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Whether audit logging is enabled */
  enabled: boolean;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Default sheet name for audit logs
 */
export const DEFAULT_AUDIT_SHEET_NAME = 'AUDIT_LOGS';

/**
 * Audit log column headers (for documentation)
 */
export const AUDIT_COLUMNS = [
  'TIMESTAMP',
  'REQUEST_ID',
  'ACTOR_EMAIL',
  'ACTOR_SUB',
  'IP',
  'ACTION',
  'TARGET',
  'DIFF',
  'OUTCOME',
  'ERROR_MESSAGE',
] as const;

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Extract client IP address from request
 *
 * Priority:
 * 1. CF-Connecting-IP (Cloudflare)
 * 2. X-Real-IP
 * 3. X-Forwarded-For (first IP)
 * 4. 'unknown'
 */
export function extractClientIp(request: Request): string {
  // Cloudflare's connecting IP header
  const cfIp = request.headers.get('CF-Connecting-IP');
  if (cfIp) {
    return cfIp;
  }

  // X-Real-IP
  const realIp = request.headers.get('X-Real-IP');
  if (realIp) {
    return realIp;
  }

  // X-Forwarded-For (first IP in chain)
  const forwardedFor = request.headers.get('X-Forwarded-For');
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0].trim();
    if (firstIp) {
      return firstIp;
    }
  }

  return 'unknown';
}

/**
 * Compute SHA-256 hash of data for diff field
 *
 * @param data - Data to hash
 * @returns Hex-encoded SHA-256 hash
 */
export async function computeDiffHash(data: unknown): Promise<string> {
  const encoder = new TextEncoder();
  const jsonString = JSON.stringify(data);
  const dataBytes = encoder.encode(jsonString);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create diff representation for audit log
 *
 * For create operations: JSON of created data (truncated)
 * For update operations: JSON of changed fields with before/after
 * For delete operations: JSON of deleted resource ID
 *
 * @param operation - Type of operation
 * @param data - Operation data
 * @returns Diff string (JSON or hash)
 */
export function createDiff(operation: 'create' | 'update' | 'delete', data: unknown): string {
  const json = JSON.stringify(data);
  // Truncate long diffs to prevent sheet cell limits
  if (json.length > 1000) {
    return json.substring(0, 997) + '...';
  }
  return json;
}

/**
 * Check if audit logging is enabled
 */
export function isAuditEnabled(env: Partial<AuditLoggerEnv>): boolean {
  // Explicitly disabled
  if (env.AUDIT_ENABLED === 'false' || env.AUDIT_ENABLED === '0') {
    return false;
  }
  // Check if sheets are configured
  return isConfigured(env);
}

/**
 * Get the audit sheet name
 */
function getAuditSheetName(env: AuditLoggerEnv): string {
  return env.AUDIT_SHEET_NAME || DEFAULT_AUDIT_SHEET_NAME;
}

// =============================================================================
// Audit Event Builders
// =============================================================================

/**
 * Build an audit event with common fields
 */
export function buildAuditEvent(
  context: AuditContext,
  action: string,
  target: string,
  outcome: AuditOutcome,
  options?: {
    diff?: string | null;
    errorMessage?: string;
    denyReason?: string;
  }
): AuditEvent {
  return {
    timestamp: new Date().toISOString(),
    requestId: context.requestId,
    actorEmail: context.actorEmail || null,
    actorSub: context.actorSub || null,
    ip: extractClientIp(context.request),
    action,
    target,
    diff: options?.diff || null,
    outcome,
    errorMessage: options?.errorMessage,
    denyReason: options?.denyReason,
  };
}

/**
 * Build a success audit event for admin actions
 */
export function buildAdminActionEvent(
  context: AuditContext,
  action: string,
  target: string,
  diff?: string | null
): AuditEvent {
  return buildAuditEvent(context, action, target, 'ok', { diff });
}

/**
 * Build a deny audit event for blocked requests
 */
export function buildDenyEvent(
  context: AuditContext,
  action: string,
  target: string,
  denyReason: string
): AuditEvent {
  return buildAuditEvent(context, action, target, 'deny', {
    denyReason,
    errorMessage: `Access denied: ${denyReason}`,
  });
}

/**
 * Build an error audit event
 */
export function buildErrorEvent(
  context: AuditContext,
  action: string,
  target: string,
  errorMessage: string
): AuditEvent {
  return buildAuditEvent(context, action, target, 'error', { errorMessage });
}

// =============================================================================
// Main Audit Logger Functions
// =============================================================================

/**
 * Write an audit event to Google Sheets
 *
 * SEC-IAC-06: Append-only audit logging.
 *
 * This function:
 * 1. Checks if audit logging is enabled
 * 2. Formats the audit event as a row
 * 3. Appends to the AUDIT_LOGS sheet
 * 4. Returns success/failure (does not throw)
 *
 * @param env - Environment with sheets credentials
 * @param event - Audit event to log
 * @returns Result indicating success/failure
 */
export async function writeAuditLog(
  env: AuditLoggerEnv,
  event: AuditEvent
): Promise<AuditLogResult> {
  // Check if audit logging is enabled
  if (!isAuditEnabled(env)) {
    return {
      success: true,
      enabled: false,
    };
  }

  try {
    const sheetName = getAuditSheetName(env);

    // Format event as row
    const row = [
      event.timestamp,
      event.requestId,
      event.actorEmail || '',
      event.actorSub || '',
      event.ip,
      event.action,
      event.target,
      event.diff || '',
      event.outcome,
      event.errorMessage || event.denyReason || '',
    ];

    // Append to sheet (immutable - no update/delete)
    await appendRow(env, sheetName, row);

    return {
      success: true,
      enabled: true,
    };
  } catch (error) {
    // Log the error but don't throw - audit failures shouldn't break requests
    console.error('[AuditLogger] Failed to write audit log:', error);

    return {
      success: false,
      enabled: true,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Log an admin action (success)
 *
 * Convenience wrapper for logging successful admin operations.
 *
 * @param env - Environment with sheets credentials
 * @param context - Audit context
 * @param action - Action performed
 * @param target - Resource affected
 * @param diff - Optional diff data
 */
export async function logAdminAction(
  env: AuditLoggerEnv,
  context: AuditContext,
  action: string,
  target: string,
  diff?: unknown
): Promise<AuditLogResult> {
  const diffString = diff ? createDiff('update', diff) : null;
  const event = buildAdminActionEvent(context, action, target, diffString);
  return writeAuditLog(env, event);
}

/**
 * Log a denied access attempt
 *
 * SEC-IAC-06: All denied actions must be logged.
 *
 * @param env - Environment with sheets credentials
 * @param context - Audit context
 * @param action - Action attempted
 * @param target - Resource attempted to access
 * @param denyReason - Reason for denial
 */
export async function logDeniedAccess(
  env: AuditLoggerEnv,
  context: AuditContext,
  action: string,
  target: string,
  denyReason: string
): Promise<AuditLogResult> {
  const event = buildDenyEvent(context, action, target, denyReason);
  return writeAuditLog(env, event);
}

/**
 * Log an error during operation
 *
 * @param env - Environment with sheets credentials
 * @param context - Audit context
 * @param action - Action that failed
 * @param target - Resource affected
 * @param errorMessage - Error description
 */
export async function logOperationError(
  env: AuditLoggerEnv,
  context: AuditContext,
  action: string,
  target: string,
  errorMessage: string
): Promise<AuditLogResult> {
  const event = buildErrorEvent(context, action, target, errorMessage);
  return writeAuditLog(env, event);
}

/**
 * Create audit context from request
 *
 * Utility to create AuditContext with minimal info.
 * Actor details can be added later.
 */
export function createAuditContext(
  request: Request,
  requestId: string,
  actorEmail?: string | null,
  actorSub?: string | null
): AuditContext {
  return {
    request,
    requestId,
    actorEmail,
    actorSub,
  };
}
