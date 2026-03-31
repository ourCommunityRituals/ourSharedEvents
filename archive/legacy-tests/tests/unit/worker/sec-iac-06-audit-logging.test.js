/**
 * Security Tests for SEC-IAC-06 - Audit Logging
 *
 * These tests ensure that all admin and denied actions are logged
 * to an immutable audit trail in Google Sheets.
 *
 * Critical Security Requirements:
 * - All admin actions logged with outcome=ok
 * - All denied attempts logged with outcome=deny
 * - All errors logged with outcome=error
 * - Required fields: timestamp, requestId, actorEmail, actorSub, ip, action, target, diff, outcome
 * - Append-only storage (no mutation/deletion)
 *
 * @see worker/src/audit/auditLogger.ts
 * @see worker/src/router.ts
 * @see SEC-IAC-06 - Audit Logging
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Test Setup - Read Source Files
// =============================================================================

const auditLoggerPath = path.join(__dirname, '../../../worker/src/audit/auditLogger.ts');
const auditIndexPath = path.join(__dirname, '../../../worker/src/audit/index.ts');
const routerPath = path.join(__dirname, '../../../worker/src/router.ts');
const wranglerPath = path.join(__dirname, '../../../cloudflare-proxy/wrangler.toml');

let auditLoggerSource = '';
let auditIndexSource = '';
let routerSource = '';
let wranglerSource = '';

beforeAll(() => {
  try {
    auditLoggerSource = fs.readFileSync(auditLoggerPath, 'utf8');
    auditIndexSource = fs.readFileSync(auditIndexPath, 'utf8');
    routerSource = fs.readFileSync(routerPath, 'utf8');
    wranglerSource = fs.readFileSync(wranglerPath, 'utf8');
  } catch (error) {
    console.error('Failed to read source files:', error.message);
  }
});

// =============================================================================
// SEC-IAC-06: Module Existence
// =============================================================================

describe('SEC-IAC-06: Module Structure', () => {
  it('MUST have auditLogger.ts module', () => {
    expect(fs.existsSync(auditLoggerPath)).toBe(true);
  });

  it('MUST have audit index.ts for exports', () => {
    expect(fs.existsSync(auditIndexPath)).toBe(true);
  });

  it('MUST export from audit index', () => {
    expect(auditIndexSource).toContain("from './auditLogger'");
    expect(auditIndexSource).toContain('writeAuditLog');
    expect(auditIndexSource).toContain('logAdminAction');
    expect(auditIndexSource).toContain('logDeniedAccess');
  });

  it('MUST integrate into router', () => {
    expect(routerSource).toContain("from './audit'");
    expect(routerSource).toContain('logAdminAction');
    expect(routerSource).toContain('logDeniedAccess');
    expect(routerSource).toContain('SEC-IAC-06');
  });

  it('router MUST extend AuditLoggerEnv', () => {
    expect(routerSource).toContain('AuditLoggerEnv');
    expect(routerSource).toMatch(/RouterEnv extends.*AuditLoggerEnv/);
  });

  it('router version MUST be 1.24.0 or higher', () => {
    const versionMatch = routerSource.match(/ROUTER_VERSION = ['"](\d+\.\d+\.\d+)['"]/);
    expect(versionMatch).toBeTruthy();
    const version = versionMatch[1];
    const [major, minor] = version.split('.').map(Number);
    expect(major * 100 + minor).toBeGreaterThanOrEqual(124);
  });
});

// =============================================================================
// SEC-IAC-06: Audit Event Fields
// =============================================================================

describe('SEC-IAC-06: Required Audit Fields', () => {
  describe('Timestamp', () => {
    it('MUST include timestamp field', () => {
      expect(auditLoggerSource).toContain('timestamp: string');
    });

    it('MUST use ISO 8601 format', () => {
      expect(auditLoggerSource).toContain('new Date().toISOString()');
    });
  });

  describe('Request ID', () => {
    it('MUST include requestId field', () => {
      expect(auditLoggerSource).toContain('requestId: string');
    });
  });

  describe('Actor Identity', () => {
    it('MUST include actorEmail field', () => {
      expect(auditLoggerSource).toContain('actorEmail: string | null');
    });

    it('MUST include actorSub field', () => {
      expect(auditLoggerSource).toContain('actorSub: string | null');
    });
  });

  describe('Client IP', () => {
    it('MUST include ip field', () => {
      expect(auditLoggerSource).toContain('ip: string');
    });

    it('MUST extract IP from CF-Connecting-IP header', () => {
      expect(auditLoggerSource).toContain('CF-Connecting-IP');
    });

    it('MUST have fallback to X-Forwarded-For', () => {
      expect(auditLoggerSource).toContain('X-Forwarded-For');
    });
  });

  describe('Action and Target', () => {
    it('MUST include action field', () => {
      expect(auditLoggerSource).toContain('action: string');
    });

    it('MUST include target field', () => {
      expect(auditLoggerSource).toContain('target: string');
    });
  });

  describe('Diff/Hash', () => {
    it('MUST include diff field', () => {
      expect(auditLoggerSource).toContain('diff: string | null');
    });

    it('MUST have SHA-256 hash function', () => {
      expect(auditLoggerSource).toContain('SHA-256');
      expect(auditLoggerSource).toContain('computeDiffHash');
    });
  });

  describe('Outcome', () => {
    it('MUST include outcome field', () => {
      expect(auditLoggerSource).toContain('outcome: AuditOutcome');
    });

    it('MUST support ok outcome', () => {
      expect(auditLoggerSource).toContain("'ok'");
    });

    it('MUST support deny outcome', () => {
      expect(auditLoggerSource).toContain("'deny'");
    });

    it('MUST support error outcome', () => {
      expect(auditLoggerSource).toContain("'error'");
    });
  });
});

// =============================================================================
// SEC-IAC-06: Storage Requirements
// =============================================================================

describe('SEC-IAC-06: Storage', () => {
  it('MUST use Google Sheets API', () => {
    expect(auditLoggerSource).toContain("from '../sheetsClient'");
    expect(auditLoggerSource).toContain('appendRow');
  });

  it('MUST be append-only (uses appendRow, not updateRow)', () => {
    expect(auditLoggerSource).toContain('appendRow');
    // Should NOT use updateRow for audit logs
    expect(auditLoggerSource).not.toMatch(/updateRow\s*\(/);
  });

  it('MUST have configurable sheet name', () => {
    expect(auditLoggerSource).toContain('AUDIT_SHEET_NAME');
    expect(auditLoggerSource).toContain('DEFAULT_AUDIT_SHEET_NAME');
  });

  it('MUST default to AUDIT_LOGS sheet', () => {
    expect(auditLoggerSource).toContain("'AUDIT_LOGS'");
  });

  it('MUST handle write failures gracefully', () => {
    expect(auditLoggerSource).toContain('try');
    expect(auditLoggerSource).toContain('catch');
    expect(auditLoggerSource).toContain('success: false');
  });
});

// =============================================================================
// SEC-IAC-06: Audit Functions
// =============================================================================

describe('SEC-IAC-06: Audit Functions', () => {
  describe('writeAuditLog', () => {
    it('MUST export writeAuditLog function', () => {
      expect(auditLoggerSource).toContain('export async function writeAuditLog');
    });

    it('MUST check if audit is enabled', () => {
      expect(auditLoggerSource).toContain('isAuditEnabled');
    });
  });

  describe('logAdminAction', () => {
    it('MUST export logAdminAction function', () => {
      expect(auditLoggerSource).toContain('export async function logAdminAction');
    });

    it('router MUST call logAdminAction for admin operations', () => {
      expect(routerSource).toContain("logAdminAction(env, auditCtx, 'v2_create_event'");
      expect(routerSource).toContain("logAdminAction(env, auditCtx, 'v2_update_event'");
      expect(routerSource).toContain("logAdminAction(env, auditCtx, 'v2_archive_event'");
      expect(routerSource).toContain("logAdminAction(env, auditCtx, 'v2_unarchive_event'");
    });
  });

  describe('logDeniedAccess', () => {
    it('MUST export logDeniedAccess function', () => {
      expect(auditLoggerSource).toContain('export async function logDeniedAccess');
    });

    it('router MUST call logDeniedAccess for security guard failures', () => {
      expect(routerSource).toContain('logDeniedAccess(env, auditCtx');
    });
  });

  describe('logOperationError', () => {
    it('MUST export logOperationError function', () => {
      expect(auditLoggerSource).toContain('export async function logOperationError');
    });
  });
});

// =============================================================================
// SEC-IAC-06: Event Builders
// =============================================================================

describe('SEC-IAC-06: Event Builders', () => {
  it('MUST have buildAuditEvent function', () => {
    expect(auditLoggerSource).toContain('export function buildAuditEvent');
  });

  it('MUST have buildAdminActionEvent function', () => {
    expect(auditLoggerSource).toContain('export function buildAdminActionEvent');
  });

  it('MUST have buildDenyEvent function', () => {
    expect(auditLoggerSource).toContain('export function buildDenyEvent');
  });

  it('MUST have buildErrorEvent function', () => {
    expect(auditLoggerSource).toContain('export function buildErrorEvent');
  });
});

// =============================================================================
// SEC-IAC-06: Router Integration - Admin Actions
// =============================================================================

describe('SEC-IAC-06: Router Integration - Admin Actions', () => {
  it('MUST log v2_create_event action', () => {
    expect(routerSource).toContain("'v2_create_event'");
  });

  it('MUST log v2_update_event action', () => {
    expect(routerSource).toContain("'v2_update_event'");
  });

  it('MUST log v2_archive_event action', () => {
    expect(routerSource).toContain("'v2_archive_event'");
  });

  it('MUST log v2_unarchive_event action', () => {
    expect(routerSource).toContain("'v2_unarchive_event'");
  });

  it('MUST log v2_set_default_event action', () => {
    expect(routerSource).toContain("'v2_set_default_event'");
  });

  it('MUST log v2_verify_qr action', () => {
    expect(routerSource).toContain("'v2_verify_qr'");
  });

  it('MUST log v2_unverify_qr action', () => {
    expect(routerSource).toContain("'v2_unverify_qr'");
  });

  it('MUST log legacy create_event action', () => {
    expect(routerSource).toContain("'create_event'");
  });

  it('MUST log record_result action', () => {
    expect(routerSource).toContain("'record_result'");
  });

  it('MUST only log on successful response (2xx)', () => {
    expect(routerSource).toContain('response.status >= 200 && response.status < 300');
  });
});

// =============================================================================
// SEC-IAC-06: Router Integration - Denied Access
// =============================================================================

describe('SEC-IAC-06: Router Integration - Denied Access', () => {
  it('MUST log signed mutation denial', () => {
    expect(routerSource).toContain('logDeniedAccess(env, auditCtx, `${method}:signed_mutation`');
  });

  it('MUST log public read-only denial', () => {
    expect(routerSource).toContain('logDeniedAccess(env, auditCtx, `${method}:public_read_only`');
  });

  it('MUST log V2 admin auth denial', () => {
    expect(routerSource).toContain('logDeniedAccess(env, auditCtx, `${method}:v2_admin_auth`');
  });

  it('MUST log legacy admin auth denial', () => {
    expect(routerSource).toContain('logDeniedAccess(env, auditCtx, `${method}:legacy_admin_auth`');
  });

  it('MUST log OAuth admin denial', () => {
    expect(routerSource).toContain('logDeniedAccess(env, auditCtx, `${method}:oauth_admin`');
  });

  it('MUST create audit context for each denial', () => {
    expect(routerSource).toContain('createAuditContext(request, logger.getRequestId()');
  });
});

// =============================================================================
// SEC-IAC-06: Types
// =============================================================================

describe('SEC-IAC-06: Types', () => {
  it('MUST define AuditEvent interface', () => {
    expect(auditLoggerSource).toContain('export interface AuditEvent');
  });

  it('MUST define AuditOutcome type', () => {
    expect(auditLoggerSource).toContain('export type AuditOutcome');
  });

  it('MUST define AuditContext interface', () => {
    expect(auditLoggerSource).toContain('export interface AuditContext');
  });

  it('MUST define AuditLogResult interface', () => {
    expect(auditLoggerSource).toContain('export interface AuditLogResult');
  });

  it('MUST define AuditLoggerEnv interface', () => {
    expect(auditLoggerSource).toContain('export interface AuditLoggerEnv');
  });
});

// =============================================================================
// SEC-IAC-06: Utility Functions
// =============================================================================

describe('SEC-IAC-06: Utilities', () => {
  it('MUST export extractClientIp function', () => {
    expect(auditLoggerSource).toContain('export function extractClientIp');
  });

  it('MUST export computeDiffHash function', () => {
    expect(auditLoggerSource).toContain('export async function computeDiffHash');
  });

  it('MUST export createDiff function', () => {
    expect(auditLoggerSource).toContain('export function createDiff');
  });

  it('MUST export isAuditEnabled function', () => {
    expect(auditLoggerSource).toContain('export function isAuditEnabled');
  });

  it('MUST export createAuditContext function', () => {
    expect(auditLoggerSource).toContain('export function createAuditContext');
  });
});

// =============================================================================
// SEC-IAC-06: Configuration
// =============================================================================

describe('SEC-IAC-06: Configuration', () => {
  it('MUST support AUDIT_ENABLED env var', () => {
    expect(auditLoggerSource).toContain('AUDIT_ENABLED');
  });

  it('MUST support AUDIT_SHEET_NAME env var', () => {
    expect(auditLoggerSource).toContain('AUDIT_SHEET_NAME');
  });

  it('MUST check AUDIT_ENABLED for false/0', () => {
    expect(auditLoggerSource).toContain("'false'");
    expect(auditLoggerSource).toContain("'0'");
  });

  it('MUST require sheets to be configured', () => {
    expect(auditLoggerSource).toContain('isConfigured');
  });
});

// =============================================================================
// SEC-IAC-06: Audit Column Schema
// =============================================================================

describe('SEC-IAC-06: Audit Column Schema', () => {
  it('MUST export AUDIT_COLUMNS constant', () => {
    expect(auditLoggerSource).toContain('export const AUDIT_COLUMNS');
  });

  it('MUST include TIMESTAMP column', () => {
    expect(auditLoggerSource).toContain("'TIMESTAMP'");
  });

  it('MUST include REQUEST_ID column', () => {
    expect(auditLoggerSource).toContain("'REQUEST_ID'");
  });

  it('MUST include ACTOR_EMAIL column', () => {
    expect(auditLoggerSource).toContain("'ACTOR_EMAIL'");
  });

  it('MUST include ACTOR_SUB column', () => {
    expect(auditLoggerSource).toContain("'ACTOR_SUB'");
  });

  it('MUST include IP column', () => {
    expect(auditLoggerSource).toContain("'IP'");
  });

  it('MUST include ACTION column', () => {
    expect(auditLoggerSource).toContain("'ACTION'");
  });

  it('MUST include TARGET column', () => {
    expect(auditLoggerSource).toContain("'TARGET'");
  });

  it('MUST include DIFF column', () => {
    expect(auditLoggerSource).toContain("'DIFF'");
  });

  it('MUST include OUTCOME column', () => {
    expect(auditLoggerSource).toContain("'OUTCOME'");
  });

  it('MUST include ERROR_MESSAGE column', () => {
    expect(auditLoggerSource).toContain("'ERROR_MESSAGE'");
  });
});
