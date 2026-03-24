/**
 * Unit Tests for Story 3.3 - Result Writer
 *
 * Tests the result writer implementation.
 * Validates:
 * - Event loading (findEventById)
 * - Result merging (mergeResultUpdates)
 * - Event saving (saveEventRow)
 * - Load-merge-save pattern (recordResult)
 * - Convenience functions (updateSchedule, updateStandings, updateBracket)
 *
 * @see worker/src/sheets/resultWriter.ts
 * @see Story 3.3 - Port recordResult to Worker
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Test Setup - Read Source Files
// =============================================================================

const resultWriterPath = path.join(__dirname, '../../../worker/src/sheets/resultWriter.ts');
const sheetsIndexPath = path.join(__dirname, '../../../worker/src/sheets/index.ts');
const mainIndexPath = path.join(__dirname, '../../../worker/src/index.ts');

let resultWriterSource = '';
let sheetsIndexSource = '';
let mainIndexSource = '';

beforeAll(() => {
  try {
    resultWriterSource = fs.readFileSync(resultWriterPath, 'utf8');
    sheetsIndexSource = fs.readFileSync(sheetsIndexPath, 'utf8');
    mainIndexSource = fs.readFileSync(mainIndexPath, 'utf8');
  } catch (error) {
    console.error('Failed to read source files:', error.message);
  }
});

// =============================================================================
// Module Structure Tests
// =============================================================================

describe('Result Writer Structure (Story 3.3)', () => {

  describe('Function Exports', () => {
    it('should export findEventById function', () => {
      expect(resultWriterSource).toContain('export async function findEventById(');
    });

    it('should export mergeResultUpdates function', () => {
      expect(resultWriterSource).toContain('export function mergeResultUpdates(');
    });

    it('should export saveEventRow function', () => {
      expect(resultWriterSource).toContain('export async function saveEventRow(');
    });

    it('should export recordResult function', () => {
      expect(resultWriterSource).toContain('export async function recordResult(');
    });

    it('should export updateSchedule function', () => {
      expect(resultWriterSource).toContain('export async function updateSchedule(');
    });

    it('should export updateStandings function', () => {
      expect(resultWriterSource).toContain('export async function updateStandings(');
    });

    it('should export updateBracket function', () => {
      expect(resultWriterSource).toContain('export async function updateBracket(');
    });
  });

  describe('Type Exports', () => {
    it('should export ScheduleItem interface', () => {
      expect(resultWriterSource).toContain('export interface ScheduleItem');
    });

    it('should export StandingsItem interface', () => {
      expect(resultWriterSource).toContain('export interface StandingsItem');
    });

    it('should export BracketMatch interface', () => {
      expect(resultWriterSource).toContain('export interface BracketMatch');
    });

    it('should export Bracket interface', () => {
      expect(resultWriterSource).toContain('export interface Bracket');
    });

    it('should export RecordResultInput interface', () => {
      expect(resultWriterSource).toContain('export interface RecordResultInput');
    });

    it('should export EventData interface', () => {
      expect(resultWriterSource).toContain('export interface EventData');
    });

    it('should export LoadEventResult interface', () => {
      expect(resultWriterSource).toContain('export interface LoadEventResult');
    });

    it('should export RecordResultResult interface', () => {
      expect(resultWriterSource).toContain('export interface RecordResultResult');
    });
  });
});

// =============================================================================
// Constants Tests
// =============================================================================

describe('Constants (Story 3.3)', () => {

  it('should define EVENTS_SHEET constant', () => {
    expect(resultWriterSource).toContain("EVENTS_SHEET = 'EVENTS'");
  });

  it('should define EVENTS_RANGE constant', () => {
    expect(resultWriterSource).toContain("EVENTS_RANGE = 'A:G'");
  });
});

// =============================================================================
// Schedule Item Interface Tests
// =============================================================================

describe('ScheduleItem Interface (Story 3.3)', () => {

  it('should have time property', () => {
    // Look for time: string in ScheduleItem context
    expect(resultWriterSource).toContain('time: string');
  });

  it('should have activity property', () => {
    expect(resultWriterSource).toContain('activity: string');
  });

  it('should have optional notes property', () => {
    expect(resultWriterSource).toContain('notes?: string');
  });
});

// =============================================================================
// Standings Item Interface Tests
// =============================================================================

describe('StandingsItem Interface (Story 3.3)', () => {

  it('should have rank property', () => {
    expect(resultWriterSource).toContain('rank: number');
  });

  it('should have name property', () => {
    expect(resultWriterSource).toContain('name: string');
  });

  it('should have score property', () => {
    expect(resultWriterSource).toContain('score: number');
  });

  it('should have optional stats property', () => {
    expect(resultWriterSource).toContain('stats?: Record<string, unknown>');
  });
});

// =============================================================================
// Bracket Interface Tests
// =============================================================================

describe('Bracket Interface (Story 3.3)', () => {

  it('should have optional type property', () => {
    expect(resultWriterSource).toContain('type?: string');
  });

  it('should have optional rounds property', () => {
    expect(resultWriterSource).toContain('rounds?: number');
  });

  it('should have optional matches property', () => {
    expect(resultWriterSource).toContain('matches?: BracketMatch[]');
  });
});

// =============================================================================
// BracketMatch Interface Tests
// =============================================================================

describe('BracketMatch Interface (Story 3.3)', () => {

  it('should have id property', () => {
    expect(resultWriterSource).toContain('id: string');
  });

  it('should have round property', () => {
    expect(resultWriterSource).toContain('round: number');
  });

  it('should have position property', () => {
    expect(resultWriterSource).toContain('position: number');
  });

  it('should have optional team1 property', () => {
    expect(resultWriterSource).toContain('team1?: string');
  });

  it('should have optional team2 property', () => {
    expect(resultWriterSource).toContain('team2?: string');
  });

  it('should have optional score properties', () => {
    expect(resultWriterSource).toContain('score1?: number');
    expect(resultWriterSource).toContain('score2?: number');
  });

  it('should have optional winner property', () => {
    expect(resultWriterSource).toContain('winner?: string');
  });
});

// =============================================================================
// Event Loading Tests
// =============================================================================

describe('Event Loading (Story 3.3)', () => {

  it('should use getSheetValues to load events', () => {
    expect(resultWriterSource).toContain('getSheetValues(env, EVENTS_SHEET, EVENTS_RANGE)');
  });

  it('should skip header row', () => {
    expect(resultWriterSource).toContain('rows.slice(1)');
  });

  it('should match event by ID', () => {
    expect(resultWriterSource).toContain('row[EVENT_COL.ID] === eventId');
  });

  it('should parse DATA_JSON column', () => {
    expect(resultWriterSource).toContain('JSON.parse(dataJson)');
  });

  it('should return row index for updates', () => {
    expect(resultWriterSource).toContain('rowIndex: i + 2');
  });

  it('should return error for invalid event ID', () => {
    expect(resultWriterSource).toContain("'Invalid event ID'");
  });

  it('should return error for event not found', () => {
    expect(resultWriterSource).toContain("'Event not found'");
  });

  it('should return error for missing data', () => {
    expect(resultWriterSource).toContain("'Event has no data'");
  });
});

// =============================================================================
// Result Merging Tests
// =============================================================================

describe('Result Merging (Story 3.3)', () => {

  it('should merge schedule if provided', () => {
    expect(resultWriterSource).toContain('merged.schedule = updates.schedule');
  });

  it('should merge standings if provided', () => {
    expect(resultWriterSource).toContain('merged.standings = updates.standings');
  });

  it('should merge bracket if provided', () => {
    expect(resultWriterSource).toContain('merged.bracket = updates.bracket');
  });

  it('should track what was updated', () => {
    expect(resultWriterSource).toContain('updated.schedule = true');
    expect(resultWriterSource).toContain('updated.standings = true');
    expect(resultWriterSource).toContain('updated.bracket = true');
  });

  it('should update timestamp', () => {
    expect(resultWriterSource).toContain('merged.updatedAtISO = new Date().toISOString()');
  });

  it('should auto-enable showSchedule when schedule has items', () => {
    expect(resultWriterSource).toContain('merged.settings.showSchedule = true');
  });

  it('should auto-enable showStandings when standings has items', () => {
    expect(resultWriterSource).toContain('merged.settings.showStandings = true');
  });

  it('should auto-enable showBracket when bracket has matches', () => {
    expect(resultWriterSource).toContain('merged.settings.showBracket = true');
  });
});

// =============================================================================
// Event Saving Tests
// =============================================================================

describe('Event Saving (Story 3.3)', () => {

  it('should use updateRow to save events', () => {
    expect(resultWriterSource).toContain('updateRow(env, EVENTS_SHEET, rowIndex, row)');
  });

  it('should validate row index', () => {
    expect(resultWriterSource).toContain('rowIndex < 2');
    expect(resultWriterSource).toContain("'Invalid row index'");
  });

  it('should verify update succeeded', () => {
    expect(resultWriterSource).toContain('result.updatedRows !== 1');
    expect(resultWriterSource).toContain("'Event row was not updated correctly'");
  });

  it('should build event row for saving', () => {
    expect(resultWriterSource).toContain('buildEventRow(event)');
  });

  it('should serialize event to JSON', () => {
    expect(resultWriterSource).toContain('JSON.stringify(event)');
  });
});

// =============================================================================
// Load-Merge-Save Pattern Tests
// =============================================================================

describe('Load-Merge-Save Pattern (Story 3.3)', () => {

  it('should validate eventId', () => {
    expect(resultWriterSource).toContain("'Missing required field: eventId'");
  });

  it('should validate at least one update is provided', () => {
    expect(resultWriterSource).toContain("'No updates provided (schedule, standings, or bracket required)'");
  });

  it('should load existing event first', () => {
    expect(resultWriterSource).toContain('await findEventById(env, eventId)');
  });

  it('should merge updates', () => {
    expect(resultWriterSource).toContain('mergeResultUpdates(loadResult.event, input)');
  });

  it('should save updated event', () => {
    expect(resultWriterSource).toContain('await saveEventRow(env, loadResult.rowIndex, merged)');
  });

  it('should return success with updated event', () => {
    expect(resultWriterSource).toContain('success: true');
    expect(resultWriterSource).toContain('event: merged');
    expect(resultWriterSource).toContain('updated,');
  });
});

// =============================================================================
// Convenience Function Tests
// =============================================================================

describe('Convenience Functions (Story 3.3)', () => {

  it('should have updateSchedule that calls recordResult', () => {
    expect(resultWriterSource).toContain('return recordResult(env, eventId, { schedule })');
  });

  it('should have updateStandings that calls recordResult', () => {
    expect(resultWriterSource).toContain('return recordResult(env, eventId, { standings })');
  });

  it('should have updateBracket that calls recordResult', () => {
    expect(resultWriterSource).toContain('return recordResult(env, eventId, { bracket })');
  });
});

// =============================================================================
// RecordResultInput Interface Tests
// =============================================================================

describe('RecordResultInput Interface (Story 3.3)', () => {

  it('should have optional schedule', () => {
    expect(resultWriterSource).toContain('schedule?: ScheduleItem[]');
  });

  it('should have optional standings', () => {
    expect(resultWriterSource).toContain('standings?: StandingsItem[]');
  });

  it('should have optional bracket', () => {
    expect(resultWriterSource).toContain('bracket?: Bracket');
  });
});

// =============================================================================
// Barrel Export Tests
// =============================================================================

describe('Barrel Exports (Story 3.3)', () => {

  describe('Sheets Index Exports', () => {
    it('should export findEventById', () => {
      expect(sheetsIndexSource).toContain('findEventById');
    });

    it('should export mergeResultUpdates', () => {
      expect(sheetsIndexSource).toContain('mergeResultUpdates');
    });

    it('should export saveEventRow', () => {
      expect(sheetsIndexSource).toContain('saveEventRow');
    });

    it('should export recordResult', () => {
      expect(sheetsIndexSource).toContain('recordResult');
    });

    it('should export updateSchedule', () => {
      expect(sheetsIndexSource).toContain('updateSchedule');
    });

    it('should export updateStandings', () => {
      expect(sheetsIndexSource).toContain('updateStandings');
    });

    it('should export updateBracket', () => {
      expect(sheetsIndexSource).toContain('updateBracket');
    });

    it('should export type ScheduleItem', () => {
      expect(sheetsIndexSource).toContain('type ScheduleItem');
    });

    it('should export type StandingsItem', () => {
      expect(sheetsIndexSource).toContain('type StandingsItem');
    });

    it('should export type Bracket', () => {
      expect(sheetsIndexSource).toContain('type Bracket');
    });

    it('should include Story 3.3 reference', () => {
      expect(sheetsIndexSource).toContain('Story 3.3');
    });
  });

  describe('Main Index Exports', () => {
    it('should export recordResult', () => {
      expect(mainIndexSource).toContain('recordResult');
    });

    it('should export type ScheduleItem', () => {
      expect(mainIndexSource).toContain('type ScheduleItem');
    });

    it('should include Story 3.3 reference', () => {
      expect(mainIndexSource).toContain('Story 3.3');
    });
  });
});

// =============================================================================
// Documentation Tests
// =============================================================================

describe('Documentation (Story 3.3)', () => {

  it('should have module-level JSDoc', () => {
    expect(resultWriterSource).toContain('@module sheets/resultWriter');
  });

  it('should reference Story 3.3', () => {
    expect(resultWriterSource).toContain('Story 3.3');
  });

  it('should document load-merge-save pattern', () => {
    expect(resultWriterSource).toContain('load-merge-save pattern');
  });
});

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('Error Handling (Story 3.3)', () => {

  it('should handle JSON parse errors', () => {
    expect(resultWriterSource).toContain("'Failed to parse event data'");
  });

  it('should handle save errors', () => {
    expect(resultWriterSource).toContain("'Failed to save event'");
  });

  it('should handle load errors', () => {
    expect(resultWriterSource).toContain("'Failed to load event'");
  });

  it('should propagate errors from loadResult', () => {
    expect(resultWriterSource).toContain('loadResult.error');
  });

  it('should propagate errors from saveResult', () => {
    expect(resultWriterSource).toContain('saveResult.error');
  });
});
