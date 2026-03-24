/**
 * Unit Tests for Story 2.2 - Admin Bundle Handler & Mapper
 *
 * Tests the adminBundle handler and mapper implementation.
 * Validates:
 * - Response shapes match GAS api_getAdminBundle contract
 * - Lifecycle phase computation (shared with public)
 * - Brand config with templates for admin
 * - All sponsors mapping (no filtering)
 * - Event diagnostics
 * - ETag generation and 304 Not Modified
 * - Authentication checking
 * - Error handling (EVENT_NOT_FOUND, UNAUTHORIZED, BAD_INPUT)
 *
 * @see worker/src/handlers/adminBundle.ts
 * @see worker/src/mappers/adminBundleMapper.ts
 * @see Story 2.2 - Worker getAdminBundle from Sheets
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Test Setup - Read Source Files
// =============================================================================

const adminBundleHandlerPath = path.join(__dirname, '../../../worker/src/handlers/adminBundle.ts');
const adminBundleMapperPath = path.join(__dirname, '../../../worker/src/mappers/adminBundleMapper.ts');
const mappersIndexPath = path.join(__dirname, '../../../worker/src/mappers/index.ts');
const handlersIndexPath = path.join(__dirname, '../../../worker/src/handlers/index.ts');
const mainIndexPath = path.join(__dirname, '../../../worker/src/index.ts');

let handlerSource = '';
let mapperSource = '';
let mappersIndexSource = '';
let handlersIndexSource = '';
let mainIndexSource = '';

beforeAll(() => {
  try {
    handlerSource = fs.readFileSync(adminBundleHandlerPath, 'utf8');
    mapperSource = fs.readFileSync(adminBundleMapperPath, 'utf8');
    mappersIndexSource = fs.readFileSync(mappersIndexPath, 'utf8');
    handlersIndexSource = fs.readFileSync(handlersIndexPath, 'utf8');
    mainIndexSource = fs.readFileSync(mainIndexPath, 'utf8');
  } catch (error) {
    console.error('Failed to read source files:', error.message);
  }
});

// =============================================================================
// Admin Bundle Mapper Contract Tests
// =============================================================================

describe('Admin Bundle Mapper (Story 2.2)', () => {

  describe('Module Structure', () => {
    it('should export AdminTemplate type', () => {
      expect(mapperSource).toContain('export interface AdminTemplate');
    });

    it('should export AdminBrandConfig type', () => {
      expect(mapperSource).toContain('export interface AdminBrandConfig');
    });

    it('should export EventDiagnostics type', () => {
      expect(mapperSource).toContain('export interface EventDiagnostics');
    });

    it('should export AdminSponsor type', () => {
      expect(mapperSource).toContain('export interface AdminSponsor');
    });

    it('should export AdminBundleValue type', () => {
      expect(mapperSource).toContain('export interface AdminBundleValue');
    });

    it('should export AdminBundleResponse type', () => {
      expect(mapperSource).toContain('export interface AdminBundleResponse');
    });

    it('should export AdminBundleNotModifiedResponse type', () => {
      expect(mapperSource).toContain('export interface AdminBundleNotModifiedResponse');
    });
  });

  describe('Template Configuration', () => {
    it('should export TEMPLATES constant', () => {
      expect(mapperSource).toContain('export const TEMPLATES');
    });

    it('should include standard templates', () => {
      expect(mapperSource).toContain("id: 'event'");
      expect(mapperSource).toContain("id: 'tournament'");
      expect(mapperSource).toContain("id: 'league'");
      expect(mapperSource).toContain("id: 'rec_league'");
    });

    it('should export BRAND_TEMPLATE_CONFIG', () => {
      expect(mapperSource).toContain('export const BRAND_TEMPLATE_CONFIG');
    });

    it('should have template config for all brands', () => {
      expect(mapperSource).toContain("root:");
      expect(mapperSource).toContain("abc:");
      expect(mapperSource).toContain("cbc:");
      expect(mapperSource).toContain("cbl:");
    });

    it('should export getAdminBrandConfig function', () => {
      expect(mapperSource).toContain('export function getAdminBrandConfig(');
    });

    it('should export getTemplatesForBrand function', () => {
      expect(mapperSource).toContain('export function getTemplatesForBrand(');
    });
  });

  describe('AdminBrandConfig Shape (GAS Parity)', () => {
    it('should include brandId', () => {
      expect(mapperSource).toContain('brandId: string');
    });

    it('should include allowedTemplates array', () => {
      expect(mapperSource).toContain('allowedTemplates: string[]');
    });

    it('should include defaultTemplateId', () => {
      expect(mapperSource).toContain('defaultTemplateId: string | null');
    });
  });

  describe('Event Diagnostics', () => {
    it('should export buildEventDiagnostics function', () => {
      expect(mapperSource).toContain('export function buildEventDiagnostics(');
    });

    it('should include formStatus field', () => {
      expect(mapperSource).toContain("formStatus:");
    });

    it('should include shortlinksCount field', () => {
      expect(mapperSource).toContain('shortlinksCount:');
    });

    it('should check for missing signup URL', () => {
      expect(mapperSource).toContain('signupUrl');
      expect(mapperSource).toContain('not_configured');
    });

    it('should return warnings for issues', () => {
      expect(mapperSource).toContain('warnings');
    });
  });

  describe('Sponsor Mapping for Admin', () => {
    it('should export mapSponsorsForAdmin function', () => {
      expect(mapperSource).toContain('export function mapSponsorsForAdmin(');
    });

    it('should return empty array for null sponsors', () => {
      expect(mapperSource).toContain('if (!sponsors || !Array.isArray(sponsors))');
      expect(mapperSource).toContain('return []');
    });

    it('should map all sponsors without filtering', () => {
      // Unlike public bundle, admin doesn't filter by placement
      expect(mapperSource).toContain('return sponsors.map(');
    });

    it('should include admin-specific sponsor fields', () => {
      expect(mapperSource).toContain('website:');
      expect(mapperSource).toContain('tier:');
      expect(mapperSource).toContain('entity:');
    });
  });

  describe('ETag Generation', () => {
    it('should export generateAdminBundleEtag function', () => {
      expect(mapperSource).toContain('export async function generateAdminBundleEtag');
    });

    it('should use SHA-256 for content hashing', () => {
      expect(mapperSource).toContain("crypto.subtle.digest('SHA-256', data)");
    });
  });

  describe('Admin Bundle Builder', () => {
    it('should export buildAdminBundleValue function', () => {
      expect(mapperSource).toContain('export function buildAdminBundleValue(');
    });

    it('should export buildAdminBundleResponse function', () => {
      expect(mapperSource).toContain('export async function buildAdminBundleResponse(');
    });

    it('should include all admin bundle fields in builder', () => {
      expect(mapperSource).toContain('brandConfig');
      expect(mapperSource).toContain('templates');
      expect(mapperSource).toContain('diagnostics');
      expect(mapperSource).toContain('allSponsors');
      expect(mapperSource).toContain('lifecyclePhase');
    });
  });

  describe('Re-exports from publicBundleMapper', () => {
    it('should re-export computeLifecyclePhase', () => {
      expect(mapperSource).toContain('computeLifecyclePhase,');
    });

    it('should re-export parseEventRow', () => {
      expect(mapperSource).toContain('parseEventRow,');
    });

    it('should re-export isValidBrand', () => {
      expect(mapperSource).toContain('isValidBrand,');
    });

    it('should re-export EVENT_COL', () => {
      expect(mapperSource).toContain('EVENT_COL,');
    });
  });
});

// =============================================================================
// Admin Bundle Handler Contract Tests
// =============================================================================

describe('Admin Bundle Handler (Story 2.2)', () => {

  describe('Module Structure', () => {
    it('should export handleGetAdminBundle function', () => {
      expect(handlerSource).toContain('export async function handleGetAdminBundle(');
    });

    it('should export parseAdminEventIdFromPath function', () => {
      expect(handlerSource).toContain('export function parseAdminEventIdFromPath(');
    });

    it('should export AdminBundleEnv type', () => {
      expect(handlerSource).toContain('export interface AdminBundleEnv');
    });

    it('should export AdminBundleErrorResponse type', () => {
      expect(handlerSource).toContain('export interface AdminBundleErrorResponse');
    });
  });

  describe('Response Shapes (GAS Parity)', () => {
    it('should include ok: true in success response', () => {
      expect(handlerSource).toContain('ok: true');
    });

    it('should include etag in success response', () => {
      expect(handlerSource).toContain('etag');
      expect(handlerSource).toContain("ETag: bundle.etag");
    });

    it('should build admin bundle value', () => {
      expect(handlerSource).toContain('buildAdminBundleValue(event, brandId)');
    });

    it('should support 304 Not Modified response', () => {
      expect(handlerSource).toContain('notModified: true');
      expect(handlerSource).toContain('createNotModifiedResponse');
      expect(handlerSource).toContain('status: 304');
    });
  });

  describe('Authentication (AC Required)', () => {
    it('should check authentication', () => {
      expect(handlerSource).toContain('checkAuth(request, env)');
    });

    it('should return 401 UNAUTHORIZED for missing auth', () => {
      expect(handlerSource).toContain("'UNAUTHORIZED'");
      expect(handlerSource).toContain('Missing or invalid authentication');
      expect(handlerSource).toContain('401');
    });

    it('should support Bearer token authentication', () => {
      expect(handlerSource).toContain("Authorization");
      expect(handlerSource).toContain("Bearer");
    });

    it('should support adminKey query param (legacy)', () => {
      expect(handlerSource).toContain("adminKey");
    });

    it('should allow access if no ADMIN_TOKEN configured (dev mode)', () => {
      expect(handlerSource).toContain('if (!env.ADMIN_TOKEN)');
      expect(handlerSource).toContain('return true');
    });
  });

  describe('Error Handling (AC Negative Paths)', () => {
    it('should return 404 EVENT_NOT_FOUND for missing event', () => {
      expect(handlerSource).toContain("'EVENT_NOT_FOUND'");
      expect(handlerSource).toContain('status: 404');
      expect(handlerSource).toContain('Event not found');
    });

    it('should return 400 BAD_INPUT for invalid brand', () => {
      expect(handlerSource).toContain("'BAD_INPUT'");
      expect(handlerSource).toContain('Invalid brand:');
      expect(handlerSource).toMatch(/createErrorResponse\(['"]BAD_INPUT['"],.*,\s*400\)/);
    });

    it('should return 503 NOT_CONFIGURED when Sheets not configured', () => {
      expect(handlerSource).toContain("'NOT_CONFIGURED'");
      expect(handlerSource).toContain('Google Sheets API not configured');
      expect(handlerSource).toContain('503');
    });

    it('should return 500 INTERNAL with corrId for errors', () => {
      expect(handlerSource).toContain("'INTERNAL'");
      expect(handlerSource).toContain('corrId');
      expect(handlerSource).toMatch(/createErrorResponse\(['"]INTERNAL['"],.*,\s*500/);
    });
  });

  describe('Event Lookup', () => {
    it('should try to find event by ID first', () => {
      expect(handlerSource).toContain('findEventById(dataRows, eventId, brandId)');
    });

    it('should fall back to slug lookup if ID not found', () => {
      expect(handlerSource).toContain('findEventBySlug(dataRows, eventId, brandId)');
    });
  });

  describe('Query Parameters', () => {
    it('should read brand from query params', () => {
      expect(handlerSource).toContain("url.searchParams.get('brand')");
    });

    it('should default brand to root', () => {
      expect(handlerSource).toContain('|| DEFAULT_BRAND');
    });

    it('should read ifNoneMatch from headers and query params', () => {
      expect(handlerSource).toContain("request.headers.get('If-None-Match')");
      expect(handlerSource).toContain("url.searchParams.get('ifNoneMatch')");
    });
  });

  describe('Cache Headers', () => {
    it('should set Cache-Control to private, no-cache for admin data', () => {
      expect(handlerSource).toContain("'Cache-Control'");
      expect(handlerSource).toContain('private, no-cache');
    });

    it('should set ETag header in response', () => {
      expect(handlerSource).toContain('ETag: bundle.etag');
    });
  });

  describe('Error Logging', () => {
    it('should generate correlation ID for errors', () => {
      expect(handlerSource).toContain('generateCorrId()');
      expect(handlerSource).toContain("adm-${Date.now()");
    });

    it('should log SheetsError with context', () => {
      expect(handlerSource).toContain('logSheetsClientError(error,');
      expect(handlerSource).toContain('/api/events/:id/adminBundle');
    });

    it('should log structured error for non-Sheets errors', () => {
      expect(handlerSource).toContain('ADMIN_BUNDLE_ERROR');
      expect(handlerSource).toContain('timestamp:');
    });
  });

  describe('Path Parsing', () => {
    it('should parse eventId from /api/events/:id/adminBundle', () => {
      expect(handlerSource).toContain("segments[3] === 'adminBundle'");
      expect(handlerSource).toContain('return segments[2]');
    });

    it('should parse eventId from /api/events/:id/bundle/admin', () => {
      expect(handlerSource).toContain("segments[3] === 'bundle'");
      expect(handlerSource).toContain("segments[4] === 'admin'");
    });
  });
});

// =============================================================================
// Barrel Export Tests
// =============================================================================

describe('Module Exports (Story 2.2)', () => {

  describe('Mappers Index', () => {
    it('should export AdminTemplate type', () => {
      expect(mappersIndexSource).toContain('type AdminTemplate');
    });

    it('should export AdminBrandConfig type', () => {
      expect(mappersIndexSource).toContain('type AdminBrandConfig');
    });

    it('should export EventDiagnostics type', () => {
      expect(mappersIndexSource).toContain('type EventDiagnostics');
    });

    it('should export AdminSponsor type', () => {
      expect(mappersIndexSource).toContain('type AdminSponsor');
    });

    it('should export AdminBundleValue type', () => {
      expect(mappersIndexSource).toContain('type AdminBundleValue');
    });

    it('should export TEMPLATES constant', () => {
      expect(mappersIndexSource).toContain('TEMPLATES');
    });

    it('should export BRAND_TEMPLATE_CONFIG constant', () => {
      expect(mappersIndexSource).toContain('BRAND_TEMPLATE_CONFIG');
    });

    it('should export getAdminBrandConfig function', () => {
      expect(mappersIndexSource).toContain('getAdminBrandConfig');
    });

    it('should export getTemplatesForBrand function', () => {
      expect(mappersIndexSource).toContain('getTemplatesForBrand');
    });

    it('should export buildAdminBundleValue function', () => {
      expect(mappersIndexSource).toContain('buildAdminBundleValue');
    });

    it('should include Story 2.2 reference in comment', () => {
      expect(mappersIndexSource).toContain('Story 2.2');
    });
  });

  describe('Handlers Index', () => {
    it('should export handleGetAdminBundle', () => {
      expect(handlersIndexSource).toContain('handleGetAdminBundle');
    });

    it('should export parseAdminEventIdFromPath', () => {
      expect(handlersIndexSource).toContain('parseAdminEventIdFromPath');
    });

    it('should export AdminBundleEnv type', () => {
      expect(handlersIndexSource).toContain('type AdminBundleEnv');
    });

    it('should export AdminBundleResponse type', () => {
      expect(handlersIndexSource).toContain('type AdminBundleResponse');
    });

    it('should include Story 2.2 reference in comment', () => {
      expect(handlersIndexSource).toContain('Story 2.2');
    });
  });

  describe('Main Index', () => {
    it('should export handleGetAdminBundle from handlers', () => {
      expect(mainIndexSource).toContain('handleGetAdminBundle');
    });

    it('should export AdminBundleEnv type', () => {
      expect(mainIndexSource).toContain('type AdminBundleEnv');
    });

    it('should export AdminTemplate type', () => {
      expect(mainIndexSource).toContain('type AdminTemplate');
    });

    it('should export getAdminBrandConfig function', () => {
      expect(mainIndexSource).toContain('getAdminBrandConfig');
    });

    it('should export TEMPLATES constant', () => {
      expect(mainIndexSource).toContain('TEMPLATES');
    });

    it('should include Story 2.2 reference in comment', () => {
      expect(mainIndexSource).toContain('Story 2.2');
    });
  });
});

// =============================================================================
// Contract Tests - Admin Bundle Shape
// =============================================================================

describe('Admin Bundle Contract Shape', () => {

  describe('Success Response Envelope', () => {
    it('should match GAS api_getAdminBundle response shape', () => {
      // GAS returns: { ok: true, etag: string, value: { event, brandConfig, templates, diagnostics, allSponsors, lifecyclePhase } }
      expect(mapperSource).toContain('export interface AdminBundleResponse');
      expect(mapperSource).toContain('ok: true');
      expect(mapperSource).toContain('etag: string');
      expect(mapperSource).toContain('value: AdminBundleValue');
    });
  });

  describe('AdminBundleValue Shape', () => {
    it('should include event field', () => {
      expect(mapperSource).toContain('event: PublicEvent');
    });

    it('should include brandConfig field', () => {
      expect(mapperSource).toContain('brandConfig: AdminBrandConfig');
    });

    it('should include templates field', () => {
      expect(mapperSource).toContain('templates: AdminTemplate[]');
    });

    it('should include diagnostics field', () => {
      expect(mapperSource).toContain('diagnostics: EventDiagnostics');
    });

    it('should include allSponsors field', () => {
      expect(mapperSource).toContain('allSponsors: AdminSponsor[]');
    });

    it('should include lifecyclePhase field', () => {
      expect(mapperSource).toContain('lifecyclePhase: LifecyclePhaseInfo');
    });
  });

  describe('AdminTemplate Shape', () => {
    it('should include id field', () => {
      expect(mapperSource).toContain('id: string');
    });

    it('should include label field', () => {
      expect(mapperSource).toContain('label: string');
    });

    it('should include optional description field', () => {
      expect(mapperSource).toContain('description?: string');
    });
  });

  describe('EventDiagnostics Shape', () => {
    it('should include formStatus field with valid values', () => {
      expect(mapperSource).toContain("formStatus: 'ok' | 'error' | 'pending' | 'not_configured'");
    });

    it('should include shortlinksCount field', () => {
      expect(mapperSource).toContain('shortlinksCount: number');
    });

    it('should include optional lastSyncedAt field', () => {
      expect(mapperSource).toContain('lastSyncedAt?: string | null');
    });

    it('should include optional warnings field', () => {
      expect(mapperSource).toContain('warnings?: string[]');
    });
  });

  describe('AdminSponsor Shape', () => {
    it('should include id field', () => {
      // id is inherited from Sponsor but we should verify it's in admin sponsor
      expect(mapperSource).toContain('id: string');
    });

    it('should include name field', () => {
      expect(mapperSource).toContain('name: string');
    });

    it('should include optional logoUrl field', () => {
      expect(mapperSource).toContain('logoUrl?: string | null');
    });

    it('should include optional website field', () => {
      expect(mapperSource).toContain('website?: string | null');
    });

    it('should include optional tier field', () => {
      expect(mapperSource).toContain('tier?: string | null');
    });

    it('should include optional entity field', () => {
      expect(mapperSource).toContain('entity?: string | null');
    });
  });
});

// =============================================================================
// Negative Path Tests (AC: Error Toast)
// =============================================================================

describe('Negative Path Tests (Story 2.2 AC)', () => {

  describe('Sheets Call Failure Handling', () => {
    it('should handle SheetsError appropriately', () => {
      expect(handlerSource).toContain('if (error instanceof SheetsError)');
    });

    it('should return 500 with corrId for sheets failures', () => {
      // AC: "Red toast 'Cannot load events. Try again.'"
      // This is handled by frontend, but we return proper error shape
      expect(handlerSource).toContain("'INTERNAL'");
      expect(handlerSource).toContain("'Failed to load event data'");
      expect(handlerSource).toContain('corrId');
    });

    it('should not return partial or stale data on error', () => {
      // Error path returns error response, not partial data
      expect(handlerSource).toContain('return createErrorResponse');
    });
  });

  describe('Invalid Event ID', () => {
    it('should return 404 for invalid event ID', () => {
      expect(handlerSource).toContain("'EVENT_NOT_FOUND'");
      expect(handlerSource).toContain('Event not found');
    });

    it('should return 404 for missing event ID', () => {
      expect(handlerSource).toContain('if (!eventId || eventId.trim()');
      expect(handlerSource).toContain('Missing event ID');
    });
  });

  describe('Invalid Brand', () => {
    it('should return 400 for invalid brand', () => {
      expect(handlerSource).toContain('!isValidBrand(brandId)');
      expect(handlerSource).toContain("'BAD_INPUT'");
    });
  });

  describe('Authentication Failure', () => {
    it('should return 401 for missing authentication', () => {
      expect(handlerSource).toContain('!checkAuth(request, env)');
      expect(handlerSource).toContain("'UNAUTHORIZED'");
      expect(handlerSource).toContain('401');
    });
  });
});
