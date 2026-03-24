/**
 * Result Writer for Google Sheets
 *
 * Handles updating schedule, standings, and bracket data in the EVENTS sheet.
 * Implements load-merge-save pattern for partial event updates.
 *
 * @module sheets/resultWriter
 * @see Story 3.3 - Port recordResult to Worker
 */

import {
  getSheetValues,
  updateRow,
  type SheetsEnv,
  type UpdateResult,
} from '../sheetsClient';

import { EVENT_COL } from './eventWriter';

// =============================================================================
// Constants
// =============================================================================

const EVENTS_SHEET = 'EVENTS';
const EVENTS_RANGE = 'A:G';

// =============================================================================
// Types
// =============================================================================

/**
 * Schedule item structure
 */
export interface ScheduleItem {
  /** Time string (e.g., "7:00 PM") */
  time: string;
  /** Activity description */
  activity: string;
  /** Optional notes */
  notes?: string;
}

/**
 * Standings item structure
 */
export interface StandingsItem {
  /** Rank/position */
  rank: number;
  /** Team or participant name */
  name: string;
  /** Score or points */
  score: number;
  /** Optional additional stats */
  stats?: Record<string, unknown>;
}

/**
 * Bracket match structure
 */
export interface BracketMatch {
  /** Match ID */
  id: string;
  /** Round number */
  round: number;
  /** Position in round */
  position: number;
  /** Team/participant 1 */
  team1?: string;
  /** Team/participant 2 */
  team2?: string;
  /** Score for team 1 */
  score1?: number;
  /** Score for team 2 */
  score2?: number;
  /** Winner ID or name */
  winner?: string;
}

/**
 * Bracket structure
 */
export interface Bracket {
  /** Bracket type (single, double, round-robin) */
  type?: string;
  /** Bracket rounds */
  rounds?: number;
  /** Matches in the bracket */
  matches?: BracketMatch[];
}

/**
 * Input for recording results
 */
export interface RecordResultInput {
  /** Schedule items to update (optional) */
  schedule?: ScheduleItem[];
  /** Standings items to update (optional) */
  standings?: StandingsItem[];
  /** Bracket data to update (optional) */
  bracket?: Bracket;
}

/**
 * Event data structure (subset for result updates)
 */
export interface EventData {
  /** Event ID */
  id: string;
  /** Event name */
  name: string;
  /** Brand ID */
  brandId: string;
  /** Schedule items */
  schedule?: ScheduleItem[];
  /** Standings items */
  standings?: StandingsItem[];
  /** Bracket data */
  bracket?: Bracket;
  /** Settings */
  settings?: {
    showSchedule?: boolean;
    showStandings?: boolean;
    showBracket?: boolean;
    showSponsors?: boolean;
  };
  /** Updated timestamp */
  updatedAtISO?: string;
  /** Other properties */
  [key: string]: unknown;
}

/**
 * Result of loading an event
 */
export interface LoadEventResult {
  /** Whether load succeeded */
  success: boolean;
  /** Event data (if success) */
  event?: EventData;
  /** Row index in sheet (1-based, if success) */
  rowIndex?: number;
  /** Error message (if failure) */
  error?: string;
}

/**
 * Result of recording results
 */
export interface RecordResultResult {
  /** Whether recording succeeded */
  success: boolean;
  /** Updated event data (if success) */
  event?: EventData;
  /** What was updated */
  updated?: {
    schedule?: boolean;
    standings?: boolean;
    bracket?: boolean;
  };
  /** Error message (if failure) */
  error?: string;
}

// =============================================================================
// Event Loading
// =============================================================================

/**
 * Find an event by ID and return its data and row index
 *
 * @param env - Worker environment with Sheets credentials
 * @param eventId - Event ID to find
 * @returns Load result with event data and row index
 */
export async function findEventById(
  env: SheetsEnv,
  eventId: string
): Promise<LoadEventResult> {
  if (!eventId || typeof eventId !== 'string') {
    return { success: false, error: 'Invalid event ID' };
  }

  try {
    const rows = await getSheetValues(env, EVENTS_SHEET, EVENTS_RANGE);
    const dataRows = rows.slice(1); // Skip header

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (row[EVENT_COL.ID] === eventId) {
        const dataJson = row[EVENT_COL.DATA_JSON];
        if (!dataJson) {
          return { success: false, error: 'Event has no data' };
        }

        try {
          const event = JSON.parse(dataJson) as EventData;
          return {
            success: true,
            event: {
              ...event,
              id: row[EVENT_COL.ID],
              brandId: row[EVENT_COL.BRAND_ID],
            },
            rowIndex: i + 2, // +2 for 1-based index and header row
          };
        } catch {
          return { success: false, error: 'Failed to parse event data' };
        }
      }
    }

    return { success: false, error: 'Event not found' };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load event',
    };
  }
}

// =============================================================================
// Result Merging
// =============================================================================

/**
 * Merge result updates into existing event data
 *
 * @param existing - Existing event data
 * @param updates - Updates to apply
 * @returns Merged event data and what was updated
 */
export function mergeResultUpdates(
  existing: EventData,
  updates: RecordResultInput
): { merged: EventData; updated: { schedule?: boolean; standings?: boolean; bracket?: boolean } } {
  const merged: EventData = { ...existing };
  const updated: { schedule?: boolean; standings?: boolean; bracket?: boolean } = {};

  // Update schedule if provided
  if (updates.schedule !== undefined) {
    merged.schedule = updates.schedule;
    updated.schedule = true;

    // Auto-enable showSchedule if schedule has items
    if (merged.settings && updates.schedule.length > 0) {
      merged.settings.showSchedule = true;
    }
  }

  // Update standings if provided
  if (updates.standings !== undefined) {
    merged.standings = updates.standings;
    updated.standings = true;

    // Auto-enable showStandings if standings has items
    if (merged.settings && updates.standings.length > 0) {
      merged.settings.showStandings = true;
    }
  }

  // Update bracket if provided
  if (updates.bracket !== undefined) {
    merged.bracket = updates.bracket;
    updated.bracket = true;

    // Auto-enable showBracket if bracket has matches
    if (merged.settings && updates.bracket.matches && updates.bracket.matches.length > 0) {
      merged.settings.showBracket = true;
    }
  }

  // Update timestamp
  merged.updatedAtISO = new Date().toISOString();

  return { merged, updated };
}

// =============================================================================
// Event Saving
// =============================================================================

/**
 * Build the row array for updating the sheet
 *
 * @param event - Event object to save
 * @returns Row array for sheet
 */
function buildEventRow(event: EventData): (string | null)[] {
  return [
    event.id,
    event.brandId,
    (event as Record<string, unknown>).templateId as string | null || null,
    JSON.stringify(event),
    (event as Record<string, unknown>).createdAtISO as string || new Date().toISOString(),
    (event as Record<string, unknown>).slug as string || '',
    event.updatedAtISO || new Date().toISOString(),
  ];
}

/**
 * Save updated event data to the sheet
 *
 * @param env - Worker environment with Sheets credentials
 * @param rowIndex - Row index to update (1-based)
 * @param event - Event data to save
 * @returns Update result
 */
export async function saveEventRow(
  env: SheetsEnv,
  rowIndex: number,
  event: EventData
): Promise<{ success: boolean; error?: string }> {
  if (rowIndex < 2) {
    return { success: false, error: 'Invalid row index' };
  }

  const row = buildEventRow(event);

  try {
    const result: UpdateResult = await updateRow(env, EVENTS_SHEET, rowIndex, row);

    if (result.updatedRows !== 1) {
      return { success: false, error: 'Event row was not updated correctly' };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save event',
    };
  }
}

// =============================================================================
// Main Record Result Function
// =============================================================================

/**
 * Record results for an event (load-merge-save pattern)
 *
 * @param env - Worker environment with Sheets credentials
 * @param eventId - Event ID to update
 * @param input - Result data to record
 * @returns Record result
 *
 * @example
 * await recordResult(env, 'evt-123', {
 *   standings: [
 *     { rank: 1, name: 'Team A', score: 100 },
 *     { rank: 2, name: 'Team B', score: 85 },
 *   ],
 * });
 */
export async function recordResult(
  env: SheetsEnv,
  eventId: string,
  input: RecordResultInput
): Promise<RecordResultResult> {
  // Validate input
  if (!eventId || typeof eventId !== 'string') {
    return { success: false, error: 'Missing required field: eventId' };
  }

  // Check if any updates provided
  const hasSchedule = input.schedule !== undefined;
  const hasStandings = input.standings !== undefined;
  const hasBracket = input.bracket !== undefined;

  if (!hasSchedule && !hasStandings && !hasBracket) {
    return { success: false, error: 'No updates provided (schedule, standings, or bracket required)' };
  }

  // Step 1: Load existing event
  const loadResult = await findEventById(env, eventId);
  if (!loadResult.success || !loadResult.event || !loadResult.rowIndex) {
    return {
      success: false,
      error: loadResult.error || 'Failed to load event',
    };
  }

  // Step 2: Merge updates
  const { merged, updated } = mergeResultUpdates(loadResult.event, input);

  // Step 3: Save updated event
  const saveResult = await saveEventRow(env, loadResult.rowIndex, merged);
  if (!saveResult.success) {
    return {
      success: false,
      error: saveResult.error || 'Failed to save event',
    };
  }

  return {
    success: true,
    event: merged,
    updated,
  };
}

/**
 * Update only schedule for an event
 */
export async function updateSchedule(
  env: SheetsEnv,
  eventId: string,
  schedule: ScheduleItem[]
): Promise<RecordResultResult> {
  return recordResult(env, eventId, { schedule });
}

/**
 * Update only standings for an event
 */
export async function updateStandings(
  env: SheetsEnv,
  eventId: string,
  standings: StandingsItem[]
): Promise<RecordResultResult> {
  return recordResult(env, eventId, { standings });
}

/**
 * Update only bracket for an event
 */
export async function updateBracket(
  env: SheetsEnv,
  eventId: string,
  bracket: Bracket
): Promise<RecordResultResult> {
  return recordResult(env, eventId, { bracket });
}
