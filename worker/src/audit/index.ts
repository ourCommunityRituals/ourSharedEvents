/**
 * Audit Module Exports
 *
 * Barrel file for exporting audit logging functionality.
 *
 * @module audit
 * @see SEC-IAC-06 - Audit Logging
 */

export {
  // Main functions
  writeAuditLog,
  logAdminAction,
  logDeniedAccess,
  logOperationError,
  createAuditContext,

  // Event builders
  buildAuditEvent,
  buildAdminActionEvent,
  buildDenyEvent,
  buildErrorEvent,

  // Utilities
  extractClientIp,
  computeDiffHash,
  createDiff,
  isAuditEnabled,

  // Types
  type AuditEvent,
  type AuditOutcome,
  type AuditContext,
  type AuditLogResult,
  type AuditLoggerEnv,

  // Constants
  DEFAULT_AUDIT_SHEET_NAME,
  AUDIT_COLUMNS,
} from './auditLogger';
