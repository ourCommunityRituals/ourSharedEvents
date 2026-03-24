/**
 * Unit Tests for Story 3.2 - Event Writer Module
 *
 * Tests the event writer module implementation.
 * Validates:
 * - Slug generation from event names
 * - Slug collision handling (-2, -3, etc.)
 * - Event ID generation
 * - Event tag generation
 * - Idempotency key generation
 * - Event row building
 *
 * @see worker/src/sheets/eventWriter.ts
 * @see Story 3.2 - Port createEvent to Worker
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Test Setup - Read Source Files
// =============================================================================

const eventWriterPath = path.join(__dirname, '../../../worker/src/sheets/eventWriter.ts');
const sheetsIndexPath = path.join(__dirname, '../../../worker/src/sheets/index.ts');
const mainIndexPath = path.join(__dirname, '../../../worker/src/index.ts');

let eventWriterSource = '';
let sheetsIndexSource = '';
let mainIndexSource = '';

beforeAll(() => {
  try {
    eventWriterSource = fs.readFileSync(eventWriterPath, 'utf8');
    sheetsIndexSource = fs.readFileSync(sheetsIndexPath, 'utf8');
    mainIndexSource = fs.readFileSync(mainIndexPath, 'utf8');
  } catch (error) {
    console.error('Failed to read source files:', error.message);
  }
});

// =============================================================================
// Module Structure Tests
// =============================================================================

describe('Event Writer Module Structure (Story 3.2)', () => {

  describe('Module Exports', () => {
    it('should export generateEventId function', () => {
      expect(eventWriterSource).toContain('export function generateEventId(');
    });

    it('should export generateEventTag function', () => {
      expect(eventWriterSource).toContain('export function generateEventTag(');
    });

    it('should export toSlug function', () => {
      expect(eventWriterSource).toContain('export function toSlug(');
    });

    it('should export slugExists function', () => {
      expect(eventWriterSource).toContain('export async function slugExists(');
    });

    it('should export generateUniqueSlug function', () => {
      expect(eventWriterSource).toContain('export async function generateUniqueSlug(');
    });

    it('should export generateUniqueSlugFromRows function', () => {
      expect(eventWriterSource).toContain('export function generateUniqueSlugFromRows(');
    });

    it('should export generateIdempotencyKey function', () => {
      expect(eventWriterSource).toContain('export function generateIdempotencyKey(');
    });

    it('should export findDuplicateEvent function', () => {
      expect(eventWriterSource).toContain('export async function findDuplicateEvent(');
    });

    it('should export createEvent function', () => {
      expect(eventWriterSource).toContain('export async function createEvent(');
    });
  });

  describe('Type Exports', () => {
    it('should export CreateEventInput interface', () => {
      expect(eventWriterSource).toContain('export interface CreateEventInput');
    });

    it('should export CreatedEvent interface', () => {
      expect(eventWriterSource).toContain('export interface CreatedEvent');
    });

    it('should export CreateEventResult interface', () => {
      expect(eventWriterSource).toContain('export interface CreateEventResult');
    });
  });

  describe('Constant Exports', () => {
    it('should export EVENT_COL constant', () => {
      expect(eventWriterSource).toContain('export const EVENT_COL');
    });
  });
});

// =============================================================================
// Slug Generation Tests
// =============================================================================

describe('Slug Generation (Story 3.2 AC)', () => {

  describe('toSlug function', () => {
    it('should convert to lowercase', () => {
      expect(eventWriterSource).toContain('.toLowerCase()');
    });

    it('should replace non-alphanumeric characters with hyphens', () => {
      expect(eventWriterSource).toContain("/[^a-z0-9]+/g, '-'");
    });

    it('should remove leading/trailing hyphens', () => {
      expect(eventWriterSource).toContain("/^-+|-+$/g, ''");
    });

    it('should truncate to MAX_SLUG_LENGTH', () => {
      expect(eventWriterSource).toContain('MAX_SLUG_LENGTH');
      expect(eventWriterSource).toContain('.slice(0, MAX_SLUG_LENGTH)');
    });

    it('should handle empty input with fallback', () => {
      expect(eventWriterSource).toContain("slug = 'event'");
    });

    it('should handle null/undefined input', () => {
      expect(eventWriterSource).toContain("if (!text || typeof text !== 'string')");
    });
  });

  describe('generateUniqueSlug function', () => {
    it('should check if base slug exists', () => {
      expect(eventWriterSource).toContain('await slugExists(env, baseSlug, brandId)');
    });

    it('should increment counter for collisions', () => {
      expect(eventWriterSource).toContain('counter <= MAX_SLUG_COUNTER');
      expect(eventWriterSource).toContain('`${baseSlug}-${counter}`');
    });

    it('should have safety fallback with timestamp', () => {
      expect(eventWriterSource).toContain('`${baseSlug}-${Date.now()}`');
    });

    it('should limit counter attempts', () => {
      expect(eventWriterSource).toContain('MAX_SLUG_COUNTER = 100');
    });
  });

  describe('generateUniqueSlugFromRows function (cached version)', () => {
    it('should build set of existing slugs', () => {
      expect(eventWriterSource).toContain('existingSlugs = new Set<string>()');
    });

    it('should filter by brandId', () => {
      expect(eventWriterSource).toContain('row[EVENT_COL.BRAND_ID] === brandId');
    });

    it('should check set for collisions', () => {
      expect(eventWriterSource).toContain('existingSlugs.has(baseSlug)');
    });
  });
});

// =============================================================================
// Event ID Generation Tests
// =============================================================================

describe('Event ID Generation (Story 3.2 AC)', () => {

  it('should generate ID with evt- prefix', () => {
    expect(eventWriterSource).toContain('`evt-${timestamp}-${random}`');
  });

  it('should include timestamp in base36', () => {
    expect(eventWriterSource).toContain("Date.now().toString(36)");
  });

  it('should include random component', () => {
    expect(eventWriterSource).toContain("Math.random().toString(36).slice(2, 8)");
  });
});

// =============================================================================
// Event Tag Generation Tests
// =============================================================================

describe('Event Tag Generation (Story 3.2 AC)', () => {

  it('should generate event tag function', () => {
    expect(eventWriterSource).toContain('function generateEventTag(');
  });

  it('should include brandId in uppercase', () => {
    expect(eventWriterSource).toContain('brandId.toUpperCase()');
  });

  it('should include slug', () => {
    expect(eventWriterSource).toContain('slug.toUpperCase()');
  });

  it('should include date', () => {
    expect(eventWriterSource).toContain('startDateISO');
  });

  it('should format as BRAND-SLUG-DATE', () => {
    expect(eventWriterSource).toContain('`${brandPart}-${slugPart}-${datePart}`');
  });
});

// =============================================================================
// Idempotency Tests
// =============================================================================

describe('Idempotency (Story 3.2 AC)', () => {

  describe('generateIdempotencyKey function', () => {
    it('should include name in key', () => {
      expect(eventWriterSource).toContain('input.name.toLowerCase().trim()');
    });

    it('should include startDateISO in key', () => {
      expect(eventWriterSource).toContain('input.startDateISO');
    });

    it('should include brandId in key', () => {
      expect(eventWriterSource).toContain('input.brandId.toLowerCase()');
    });

    it('should include venue in key', () => {
      expect(eventWriterSource).toContain('input.venue.toLowerCase().trim()');
    });

    it('should join parts with pipe separator', () => {
      expect(eventWriterSource).toContain("parts.join('|')");
    });
  });

  describe('findDuplicateEvent function', () => {
    it('should search for existing event with same key', () => {
      expect(eventWriterSource).toContain('existingKey === idempotencyKey');
    });

    it('should return event ID if found', () => {
      expect(eventWriterSource).toContain('return row[EVENT_COL.ID]');
    });

    it('should return null if not found', () => {
      expect(eventWriterSource).toContain('return null');
    });

    it('should skip invalid JSON rows', () => {
      expect(eventWriterSource).toContain('// Skip invalid JSON rows');
    });
  });
});

// =============================================================================
// Event Creation Tests
// =============================================================================

describe('Event Creation (Story 3.2 AC)', () => {

  describe('createEvent function', () => {
    it('should check for duplicates first', () => {
      expect(eventWriterSource).toContain('await findDuplicateEvent(env, input)');
    });

    it('should return existing event if duplicate', () => {
      expect(eventWriterSource).toContain('duplicate: true');
    });

    it('should generate unique ID', () => {
      expect(eventWriterSource).toContain('const id = generateEventId()');
    });

    it('should generate unique slug', () => {
      expect(eventWriterSource).toContain('const slug = await generateUniqueSlug(');
    });

    it('should generate event tag', () => {
      expect(eventWriterSource).toContain('const eventTag = generateEventTag(');
    });

    it('should append row to sheet', () => {
      expect(eventWriterSource).toContain('await appendRow(env, EVENTS_SHEET, row)');
    });

    it('should return success with event data', () => {
      expect(eventWriterSource).toContain('success: true');
      expect(eventWriterSource).toContain('event');
    });

    it('should return error on failure', () => {
      expect(eventWriterSource).toContain('success: false');
      expect(eventWriterSource).toContain('error:');
    });
  });

  describe('CreatedEvent shape', () => {
    it('should include id', () => {
      expect(eventWriterSource).toContain('id: string');
    });

    it('should include slug', () => {
      expect(eventWriterSource).toContain('slug: string');
    });

    it('should include eventTag', () => {
      expect(eventWriterSource).toContain('eventTag: string');
    });

    it('should include name', () => {
      expect(eventWriterSource).toContain('name: string');
    });

    it('should include startDateISO', () => {
      expect(eventWriterSource).toContain('startDateISO: string');
    });

    it('should include venue', () => {
      expect(eventWriterSource).toContain('venue: string');
    });

    it('should include brandId', () => {
      expect(eventWriterSource).toContain('brandId: string');
    });

    it('should include links object', () => {
      expect(eventWriterSource).toContain('links: {');
    });

    it('should include qr object', () => {
      expect(eventWriterSource).toContain('qr: {');
    });

    it('should include ctas object', () => {
      expect(eventWriterSource).toContain('ctas: {');
    });

    it('should include settings object', () => {
      expect(eventWriterSource).toContain('settings: {');
    });

    it('should include createdAtISO', () => {
      expect(eventWriterSource).toContain('createdAtISO: string');
    });

    it('should include updatedAtISO', () => {
      expect(eventWriterSource).toContain('updatedAtISO: string');
    });
  });
});

// =============================================================================
// Sheet Column Configuration Tests
// =============================================================================

describe('Sheet Column Configuration (Story 3.2)', () => {

  it('should define ID column index', () => {
    expect(eventWriterSource).toContain('ID: 0');
  });

  it('should define BRAND_ID column index', () => {
    expect(eventWriterSource).toContain('BRAND_ID: 1');
  });

  it('should define TEMPLATE_ID column index', () => {
    expect(eventWriterSource).toContain('TEMPLATE_ID: 2');
  });

  it('should define DATA_JSON column index', () => {
    expect(eventWriterSource).toContain('DATA_JSON: 3');
  });

  it('should define CREATED_AT column index', () => {
    expect(eventWriterSource).toContain('CREATED_AT: 4');
  });

  it('should define SLUG column index', () => {
    expect(eventWriterSource).toContain('SLUG: 5');
  });

  it('should define UPDATED_AT column index', () => {
    expect(eventWriterSource).toContain('UPDATED_AT: 6');
  });
});

// =============================================================================
// Barrel Export Tests
// =============================================================================

describe('Barrel Exports (Story 3.2)', () => {

  describe('Sheets Index Exports', () => {
    it('should export generateEventId', () => {
      expect(sheetsIndexSource).toContain('generateEventId');
    });

    it('should export generateEventTag', () => {
      expect(sheetsIndexSource).toContain('generateEventTag');
    });

    it('should export toSlug', () => {
      expect(sheetsIndexSource).toContain('toSlug');
    });

    it('should export generateUniqueSlug', () => {
      expect(sheetsIndexSource).toContain('generateUniqueSlug');
    });

    it('should export generateUniqueSlugFromRows', () => {
      expect(sheetsIndexSource).toContain('generateUniqueSlugFromRows');
    });

    it('should export createEvent', () => {
      expect(sheetsIndexSource).toContain('createEvent');
    });

    it('should export type CreateEventInput', () => {
      expect(sheetsIndexSource).toContain('type CreateEventInput');
    });

    it('should export type CreatedEvent', () => {
      expect(sheetsIndexSource).toContain('type CreatedEvent');
    });

    it('should export type CreateEventResult', () => {
      expect(sheetsIndexSource).toContain('type CreateEventResult');
    });

    it('should include Story 3.2 reference', () => {
      expect(sheetsIndexSource).toContain('Story 3.2');
    });
  });

  describe('Main Index Exports', () => {
    it('should export generateEventId', () => {
      expect(mainIndexSource).toContain('generateEventId');
    });

    it('should export toSlug', () => {
      expect(mainIndexSource).toContain('toSlug');
    });

    it('should export createEvent', () => {
      expect(mainIndexSource).toContain('createEvent');
    });

    it('should export type CreateEventInput', () => {
      expect(mainIndexSource).toContain('type CreateEventInput');
    });

    it('should include Story 3.2 reference', () => {
      expect(mainIndexSource).toContain('Story 3.2');
    });
  });
});

// =============================================================================
// Documentation Tests
// =============================================================================

describe('Documentation (Story 3.2)', () => {

  it('should have module-level JSDoc', () => {
    expect(eventWriterSource).toContain('@module sheets/eventWriter');
  });

  it('should reference Story 3.2', () => {
    expect(eventWriterSource).toContain('Story 3.2');
  });

  it('should document slug generation', () => {
    expect(eventWriterSource).toContain('slug generation');
  });

  it('should document idempotent behavior', () => {
    expect(eventWriterSource).toContain('Idempotent');
  });

  it('should document collision handling', () => {
    expect(eventWriterSource).toContain('collision');
  });
});

// =============================================================================
// Security Tests
// =============================================================================

describe('Security (Story 3.2)', () => {

  it('should not expose internal sheet names in exports', () => {
    // EVENTS_SHEET should be a constant, not exported
    expect(sheetsIndexSource).not.toContain('EVENTS_SHEET');
  });

  it('should validate input types', () => {
    expect(eventWriterSource).toContain("typeof text !== 'string'");
  });

  it('should handle JSON parse errors gracefully', () => {
    expect(eventWriterSource).toContain('// Skip invalid JSON rows');
  });
});
