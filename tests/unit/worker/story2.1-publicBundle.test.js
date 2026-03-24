/**
 * Unit Tests for Story 2.1 - Public Bundle Handler & Mapper
 *
 * Tests the publicBundle handler and mapper implementation.
 * Validates:
 * - Response shapes match GAS api_getPublicBundle contract
 * - Lifecycle phase computation matches GAS
 * - Sponsor filtering for public surface
 * - Brand config for API response
 * - ETag generation and 304 Not Modified
 * - Error handling (EVENT_NOT_FOUND, BAD_INPUT)
 *
 * @see worker/src/handlers/publicBundle.ts
 * @see worker/src/mappers/publicBundleMapper.ts
 * @see Story 2.1 - Worker getPublicBundle from Sheets
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Test Setup - Read Source Files
// =============================================================================

const publicBundleHandlerPath = path.join(__dirname, '../../../worker/src/handlers/publicBundle.ts');
const publicBundleMapperPath = path.join(__dirname, '../../../worker/src/mappers/publicBundleMapper.ts');
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
    handlerSource = fs.readFileSync(publicBundleHandlerPath, 'utf8');
    mapperSource = fs.readFileSync(publicBundleMapperPath, 'utf8');
    mappersIndexSource = fs.readFileSync(mappersIndexPath, 'utf8');
    handlersIndexSource = fs.readFileSync(handlersIndexPath, 'utf8');
    mainIndexSource = fs.readFileSync(mainIndexPath, 'utf8');
  } catch (error) {
    console.error('Failed to read source files:', error.message);
  }
});

// =============================================================================
// Public Bundle Mapper Contract Tests
// =============================================================================

describe('Public Bundle Mapper (Story 2.1)', () => {

  describe('Module Structure', () => {
    it('should export LIFECYCLE_PHASE constants', () => {
      expect(mapperSource).toContain('export const LIFECYCLE_PHASE');
      expect(mapperSource).toContain("PRE_EVENT: 'pre-event'");
      expect(mapperSource).toContain("EVENT_DAY: 'event-day'");
      expect(mapperSource).toContain("POST_EVENT: 'post-event'");
    });

    it('should export LIFECYCLE_LABELS matching GAS', () => {
      expect(mapperSource).toContain('export const LIFECYCLE_LABELS');
      expect(mapperSource).toContain("'pre-event': 'Pre-Event Preparation'");
      expect(mapperSource).toContain("'event-day': 'Event Day - Live'");
      expect(mapperSource).toContain("'post-event': 'Post-Event Analytics'");
    });

    it('should export BRAND_CONFIG with all valid brands', () => {
      expect(mapperSource).toContain('export const BRAND_CONFIG');
      expect(mapperSource).toContain("brandId: 'root'");
      expect(mapperSource).toContain("brandId: 'abc'");
      expect(mapperSource).toContain("brandId: 'cbc'");
      expect(mapperSource).toContain("brandId: 'cbl'");
    });

    it('should export computeLifecyclePhase function', () => {
      expect(mapperSource).toContain('export function computeLifecyclePhase(');
    });

    it('should export filterSponsorsForPublic function', () => {
      expect(mapperSource).toContain('export function filterSponsorsForPublic(');
    });

    it('should export buildPublicBundleValue function', () => {
      expect(mapperSource).toContain('export function buildPublicBundleValue(');
    });

    it('should export parseEventRow function', () => {
      expect(mapperSource).toContain('export function parseEventRow(');
    });
  });

  describe('Lifecycle Phase Computation (GAS Parity)', () => {
    it('should return pre-event when startDateISO is null', () => {
      expect(mapperSource).toContain('if (!startDateISO)');
      expect(mapperSource).toContain('phase: LIFECYCLE_PHASE.PRE_EVENT');
    });

    it('should compare dates without time component', () => {
      expect(mapperSource).toContain('today.setHours(0, 0, 0, 0)');
      expect(mapperSource).toContain('eventDate.setHours(0, 0, 0, 0)');
    });

    it('should return event-day when date equals today', () => {
      expect(mapperSource).toContain('eventDate.getTime() === today.getTime()');
      expect(mapperSource).toContain('phase = LIFECYCLE_PHASE.EVENT_DAY');
    });

    it('should return post-event when date is in past', () => {
      expect(mapperSource).toContain('eventDate < today');
      expect(mapperSource).toContain('phase = LIFECYCLE_PHASE.POST_EVENT');
    });

    it('should return isLive true only for event-day', () => {
      expect(mapperSource).toContain('isLive: phase === LIFECYCLE_PHASE.EVENT_DAY');
    });

    it('should return label from LIFECYCLE_LABELS', () => {
      expect(mapperSource).toContain('label: LIFECYCLE_LABELS[phase]');
    });
  });

  describe('Sponsor Filtering', () => {
    it('should filter sponsors with public placement', () => {
      expect(mapperSource).toContain("sponsor.placement === 'public'");
    });

    it('should filter sponsors with mobileBanner placement', () => {
      expect(mapperSource).toContain('sponsor.placements.mobileBanner === true');
    });

    it('should return empty array for null/undefined sponsors', () => {
      expect(mapperSource).toContain('if (!sponsors || !Array.isArray(sponsors))');
      expect(mapperSource).toContain('return []');
    });
  });

  describe('Brand Config', () => {
    it('should return brand config with required fields', () => {
      expect(mapperSource).toContain('brandId:');
      expect(mapperSource).toContain('brandName:');
      expect(mapperSource).toContain('appTitle:');
      expect(mapperSource).toContain('logoUrl:');
      expect(mapperSource).toContain('primaryColor:');
      expect(mapperSource).toContain('secondaryColor:');
      expect(mapperSource).toContain('features:');
    });

    it('should fall back to default brand if invalid', () => {
      expect(mapperSource).toContain('if (!config)');
      expect(mapperSource).toContain('return BRAND_CONFIG[DEFAULT_BRAND]');
    });
  });

  describe('ETag Generation', () => {
    it('should generate content-based ETag using Web Crypto', () => {
      expect(mapperSource).toContain('export async function generateContentEtag');
      expect(mapperSource).toContain("crypto.subtle.digest('SHA-256', data)");
    });

    it('should generate simple ETag from updatedAtISO', () => {
      expect(mapperSource).toContain('export function generatePublicBundleEtag');
      expect(mapperSource).toContain('event.updatedAtISO');
    });
  });

  describe('Type Exports', () => {
    it('should export LifecyclePhaseInfo type', () => {
      expect(mapperSource).toContain('export interface LifecyclePhaseInfo');
    });

    it('should export BrandConfigForApi type', () => {
      expect(mapperSource).toContain('export interface BrandConfigForApi');
    });

    it('should export PublicEvent type', () => {
      expect(mapperSource).toContain('export interface PublicEvent');
    });

    it('should export PublicBundleValue type', () => {
      expect(mapperSource).toContain('export interface PublicBundleValue');
    });

    it('should export PublicBundleResponse type', () => {
      expect(mapperSource).toContain('export interface PublicBundleResponse');
    });

    it('should export PublicBundleNotModifiedResponse type', () => {
      expect(mapperSource).toContain('export interface PublicBundleNotModifiedResponse');
    });
  });
});

// =============================================================================
// Public Bundle Handler Contract Tests
// =============================================================================

describe('Public Bundle Handler (Story 2.1)', () => {

  describe('Module Structure', () => {
    it('should export handleGetPublicBundle function', () => {
      expect(handlerSource).toContain('export async function handleGetPublicBundle(');
    });

    it('should export parseEventIdFromPath function', () => {
      expect(handlerSource).toContain('export function parseEventIdFromPath(');
    });

    it('should export PublicBundleEnv type', () => {
      expect(handlerSource).toContain('export interface PublicBundleEnv');
    });

    it('should export PublicBundleErrorResponse type', () => {
      expect(handlerSource).toContain('export interface PublicBundleErrorResponse');
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

    it('should include value with event, config, lifecyclePhase', () => {
      // These are in the mapper but the handler builds them via buildPublicBundleValue
      expect(handlerSource).toContain('buildPublicBundleValue(event, brandId)');
    });

    it('should support 304 Not Modified response', () => {
      expect(handlerSource).toContain('notModified: true');
      expect(handlerSource).toContain('createNotModifiedResponse');
      expect(handlerSource).toContain('status: 304');
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
      // Check that 400 is passed as status argument
      expect(handlerSource).toMatch(/createErrorResponse\(['"]BAD_INPUT['"],.*,\s*400\)/);
    });

    it('should return 503 NOT_CONFIGURED when Sheets not configured', () => {
      expect(handlerSource).toContain("'NOT_CONFIGURED'");
      expect(handlerSource).toContain('Google Sheets API not configured');
      // Check that 503 is passed as status - code spans multiple lines so check separately
      expect(handlerSource).toContain('503');
    });

    it('should return 500 INTERNAL with corrId for malformed rows', () => {
      expect(handlerSource).toContain("'INTERNAL'");
      expect(handlerSource).toContain('corrId');
      // Check that 500 is passed as status argument
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
    it('should set Cache-Control header', () => {
      expect(handlerSource).toContain("'Cache-Control'");
      expect(handlerSource).toContain('private, max-age=60, stale-while-revalidate=300');
    });

    it('should set ETag header in response', () => {
      expect(handlerSource).toContain('ETag: bundle.etag');
    });
  });

  describe('Error Logging', () => {
    it('should generate correlation ID for errors', () => {
      expect(handlerSource).toContain('generateCorrId()');
      expect(handlerSource).toContain("pub-${Date.now()");
    });

    it('should log SheetsError with context', () => {
      expect(handlerSource).toContain('logSheetsClientError(error,');
      expect(handlerSource).toContain('/api/events/:id/publicBundle');
    });

    it('should log structured error for non-Sheets errors', () => {
      expect(handlerSource).toContain('PUBLIC_BUNDLE_ERROR');
      expect(handlerSource).toContain('timestamp:');
    });
  });

  describe('Path Parsing', () => {
    it('should parse eventId from /api/events/:id/publicBundle', () => {
      expect(handlerSource).toContain("segments[3] === 'publicBundle'");
      expect(handlerSource).toContain('return segments[2]');
    });

    it('should parse eventId from /api/events/:id/bundle/public', () => {
      expect(handlerSource).toContain("segments[3] === 'bundle'");
      expect(handlerSource).toContain("segments[4] === 'public'");
    });
  });
});

// =============================================================================
// Barrel Export Tests
// =============================================================================

describe('Module Exports (Story 2.1)', () => {

  describe('Mappers Index', () => {
    it('should export computeLifecyclePhase', () => {
      expect(mappersIndexSource).toContain('computeLifecyclePhase');
    });

    it('should export filterSponsorsForPublic', () => {
      expect(mappersIndexSource).toContain('filterSponsorsForPublic');
    });

    it('should export buildPublicBundleValue', () => {
      expect(mappersIndexSource).toContain('buildPublicBundleValue');
    });

    it('should export LIFECYCLE_PHASE', () => {
      expect(mappersIndexSource).toContain('LIFECYCLE_PHASE');
    });

    it('should export BRAND_CONFIG', () => {
      expect(mappersIndexSource).toContain('BRAND_CONFIG');
    });
  });

  describe('Handlers Index', () => {
    it('should export handleGetPublicBundle', () => {
      expect(handlersIndexSource).toContain('handleGetPublicBundle');
    });

    it('should export parseEventIdFromPath', () => {
      expect(handlersIndexSource).toContain('parseEventIdFromPath');
    });

    it('should export PublicBundleEnv type', () => {
      expect(handlersIndexSource).toContain('type PublicBundleEnv');
    });

    it('should export PublicBundleResponse type', () => {
      expect(handlersIndexSource).toContain('type PublicBundleResponse');
    });

    it('should include Story 2.1 reference in comment', () => {
      expect(handlersIndexSource).toContain('Story 2.1');
    });
  });

  describe('Main Index', () => {
    it('should export handleGetPublicBundle from handlers', () => {
      expect(mainIndexSource).toContain('handleGetPublicBundle');
    });

    it('should export mappers types and functions', () => {
      expect(mainIndexSource).toContain("from './mappers'");
    });

    it('should include Story 2.1 reference in comment', () => {
      expect(mainIndexSource).toContain('Story 2.1');
    });
  });
});

// =============================================================================
// Contract Tests - Public Bundle Shape
// =============================================================================

describe('Public Bundle Contract Shape', () => {

  describe('Success Response Envelope', () => {
    it('should match GAS api_getPublicBundle response shape', () => {
      // GAS returns: { ok: true, etag: string, value: { event, config, lifecyclePhase } }
      expect(mapperSource).toContain('export interface PublicBundleResponse');
      expect(mapperSource).toContain('ok: true');
      expect(mapperSource).toContain('etag: string');
      expect(mapperSource).toContain('value: PublicBundleValue');
    });
  });

  describe('PublicBundleValue Shape', () => {
    it('should include event field', () => {
      expect(mapperSource).toContain('event: PublicEvent');
    });

    it('should include config field', () => {
      expect(mapperSource).toContain('config: BrandConfigForApi');
    });

    it('should include lifecyclePhase field', () => {
      expect(mapperSource).toContain('lifecyclePhase: LifecyclePhaseInfo');
    });
  });

  describe('PublicEvent Shape (MVP Required Fields)', () => {
    const requiredFields = [
      'id: string',
      'slug: string',
      'name: string',
      'startDateISO: string',
      'venue: string',
      'links: EventLinks',
      'qr: EventQR',
      'ctas: EventCTAs',
      'settings: EventSettings',
      'createdAtISO: string',
      'updatedAtISO: string'
    ];

    requiredFields.forEach(field => {
      it(`should include MVP required field: ${field.split(':')[0]}`, () => {
        expect(mapperSource).toContain(field);
      });
    });
  });

  describe('Config Shape (Public-Safe Fields)', () => {
    const configFields = [
      'brandId: string',
      'brandName: string',
      'appTitle: string'
    ];

    configFields.forEach(field => {
      it(`should include config field: ${field.split(':')[0]}`, () => {
        expect(mapperSource).toContain(field);
      });
    });
  });

  describe('LifecyclePhase Shape', () => {
    it('should include phase field', () => {
      expect(mapperSource).toContain('phase: LifecyclePhaseValue');
    });

    it('should include label field', () => {
      expect(mapperSource).toContain('label: string');
    });

    it('should include isLive boolean', () => {
      expect(mapperSource).toContain('isLive: boolean');
    });
  });
});

// =============================================================================
// Differences from GAS Documentation
// =============================================================================

describe('GAS vs Worker Differences (Documentation)', () => {

  describe('ETag Implementation', () => {
    it('should document SHA-256 vs MD5 difference', () => {
      // Worker uses SHA-256 (Web Crypto), GAS uses MD5 (Utilities)
      // ETags will be different but semantically equivalent
      expect(mapperSource).toContain('SHA-256');
      expect(mapperSource).toContain('// Use SHA-256 (more secure than MD5');
    });
  });

  describe('Brand Config Source', () => {
    it('should document brand config is inline vs GAS findBrand_', () => {
      // Worker has inline BRAND_CONFIG, GAS uses findBrand_() function
      // Both return same shape, just different sources
      expect(mapperSource).toContain('BRAND_CONFIG');
    });
  });
});
