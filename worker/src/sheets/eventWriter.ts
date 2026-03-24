/**
 * Event Writer for Google Sheets
 *
 * Handles creating and writing event data to the EVENTS sheet.
 * Provides slug generation with collision handling, eventTag generation,
 * and idempotent event creation.
 *
 * @module sheets/eventWriter
 * @see Story 3.2 - Port createEvent to Worker
 */

import {
  getSheetValues,
  appendRow,
  type SheetsEnv,
  type AppendResult,
} from '../sheetsClient';

// =============================================================================
// Constants
// =============================================================================

const EVENTS_SHEET = 'EVENTS';
const EVENTS_RANGE = 'A:G';

/**
 * Column indices for EVENTS sheet (0-based)
 */
export const EVENT_COL = {
  ID: 0,
  BRAND_ID: 1,
  TEMPLATE_ID: 2,
  DATA_JSON: 3,
  CREATED_AT: 4,
  SLUG: 5,
  UPDATED_AT: 6,
} as const;

/**
 * Maximum slug length (truncated from event name)
 */
const MAX_SLUG_LENGTH = 50;

/**
 * Maximum counter attempts for slug collision resolution
 */
const MAX_SLUG_COUNTER = 100;

// =============================================================================
// Types
// =============================================================================

/**
 * Input for creating a new event
 */
export interface CreateEventInput {
  /** Event name (required) */
  name: string;
  /** Event start date in YYYY-MM-DD format (required) */
  startDateISO: string;
  /** Event venue (required) */
  venue: string;
  /** Brand ID (required) */
  brandId: string;
  /** Template ID (optional) */
  templateId?: string;
  /** Signup URL (optional) */
  signupUrl?: string;
  /** Additional event data (optional) */
  [key: string]: unknown;
}

/**
 * Created event with generated fields
 */
export interface CreatedEvent {
  /** Unique event ID */
  id: string;
  /** URL-friendly slug */
  slug: string;
  /** Event tag for tracking */
  eventTag: string;
  /** Event name */
  name: string;
  /** Start date in YYYY-MM-DD format */
  startDateISO: string;
  /** Event venue */
  venue: string;
  /** Brand ID */
  brandId: string;
  /** Template ID */
  templateId: string | null;
  /** Links object */
  links: {
    publicUrl: string;
    displayUrl: string;
    posterUrl: string;
    signupUrl: string;
  };
  /** QR codes (placeholder for now) */
  qr: {
    public: string;
    signup: string;
  };
  /** CTAs */
  ctas: {
    primary: { label: string; url: string };
    secondary: null;
  };
  /** Settings */
  settings: {
    showSchedule: boolean;
    showStandings: boolean;
    showBracket: boolean;
    showSponsors: boolean;
  };
  /** Creation timestamp */
  createdAtISO: string;
  /** Last update timestamp */
  updatedAtISO: string;
}

/**
 * Result of event creation
 */
export interface CreateEventResult {
  /** Whether creation succeeded */
  success: boolean;
  /** Created event data (if success) */
  event?: CreatedEvent;
  /** Error message (if failure) */
  error?: string;
  /** Whether this was a duplicate (idempotent) */
  duplicate?: boolean;
}

// =============================================================================
// ID Generation
// =============================================================================

/**
 * Generate a unique event ID
 *
 * Format: evt-{timestamp36}-{random}
 * Example: evt-m5abc123-x7y8z9
 *
 * @returns Unique event ID
 */
export function generateEventId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `evt-${timestamp}-${random}`;
}

/**
 * Generate an event tag for tracking/reference
 *
 * Format: {BRAND}-{SLUG}-{DATE}
 * Example: ABC-TRIVIA-NIGHT-2025-12-01
 *
 * @param brandId - Brand ID
 * @param slug - Event slug
 * @param startDateISO - Event start date
 * @returns Event tag
 */
export function generateEventTag(
  brandId: string,
  slug: string,
  startDateISO: string
): string {
  const brandPart = brandId.toUpperCase();
  const slugPart = slug.toUpperCase().replace(/-/g, '-');
  const datePart = startDateISO;
  return `${brandPart}-${slugPart}-${datePart}`;
}

// =============================================================================
// Slug Generation
// =============================================================================

/**
 * Convert a string to a URL-friendly slug
 *
 * - Converts to lowercase
 * - Replaces non-alphanumeric characters with hyphens
 * - Removes leading/trailing hyphens
 * - Truncates to MAX_SLUG_LENGTH
 *
 * @param text - Text to convert to slug
 * @returns URL-friendly slug
 */
export function toSlug(text: string): string {
  if (!text || typeof text !== 'string') {
    return 'event';
  }

  let slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH);

  // Handle empty result
  if (!slug) {
    slug = 'event';
  }

  return slug;
}

/**
 * Check if a slug exists for a brand
 *
 * @param env - Worker environment
 * @param slug - Slug to check
 * @param brandId - Brand ID
 * @returns True if slug exists
 */
export async function slugExists(
  env: SheetsEnv,
  slug: string,
  brandId: string
): Promise<boolean> {
  const rows = await getSheetValues(env, EVENTS_SHEET, EVENTS_RANGE);
  const dataRows = rows.slice(1); // Skip header

  for (const row of dataRows) {
    if (row[EVENT_COL.BRAND_ID] === brandId && row[EVENT_COL.SLUG] === slug) {
      return true;
    }
  }

  return false;
}

/**
 * Generate a unique slug for an event
 *
 * If the base slug conflicts, appends -2, -3, etc.
 * Safety limit prevents infinite loops.
 *
 * @param env - Worker environment
 * @param name - Event name to derive slug from
 * @param brandId - Brand ID
 * @returns Unique slug
 */
export async function generateUniqueSlug(
  env: SheetsEnv,
  name: string,
  brandId: string
): Promise<string> {
  const baseSlug = toSlug(name);

  // Check if base slug is available
  if (!(await slugExists(env, baseSlug, brandId))) {
    return baseSlug;
  }

  // Try incrementing counter
  for (let counter = 2; counter <= MAX_SLUG_COUNTER; counter++) {
    const candidateSlug = `${baseSlug}-${counter}`;
    if (!(await slugExists(env, candidateSlug, brandId))) {
      return candidateSlug;
    }
  }

  // Safety fallback: use timestamp
  return `${baseSlug}-${Date.now()}`;
}

/**
 * Generate a unique slug using cached rows (for batch operations)
 *
 * More efficient when you already have the rows loaded.
 *
 * @param rows - All event rows from sheet
 * @param name - Event name to derive slug from
 * @param brandId - Brand ID
 * @returns Unique slug
 */
export function generateUniqueSlugFromRows(
  rows: string[][],
  name: string,
  brandId: string
): string {
  const baseSlug = toSlug(name);

  // Build set of existing slugs for this brand
  const existingSlugs = new Set<string>();
  const dataRows = rows.slice(1); // Skip header

  for (const row of dataRows) {
    if (row[EVENT_COL.BRAND_ID] === brandId) {
      existingSlugs.add(row[EVENT_COL.SLUG]);
    }
  }

  // Check if base slug is available
  if (!existingSlugs.has(baseSlug)) {
    return baseSlug;
  }

  // Try incrementing counter
  for (let counter = 2; counter <= MAX_SLUG_COUNTER; counter++) {
    const candidateSlug = `${baseSlug}-${counter}`;
    if (!existingSlugs.has(candidateSlug)) {
      return candidateSlug;
    }
  }

  // Safety fallback: use timestamp
  return `${baseSlug}-${Date.now()}`;
}

// =============================================================================
// Idempotency Check
// =============================================================================

/**
 * Generate an idempotency key for an event
 *
 * Uses name + startDateISO + brandId + venue to detect duplicates.
 *
 * @param input - Event input
 * @returns Idempotency key
 */
export function generateIdempotencyKey(input: CreateEventInput): string {
  const parts = [
    input.name.toLowerCase().trim(),
    input.startDateISO,
    input.brandId.toLowerCase(),
    input.venue.toLowerCase().trim(),
  ];
  return parts.join('|');
}

/**
 * Find an existing event with the same idempotency key
 *
 * @param env - Worker environment
 * @param input - Event input to check
 * @returns Existing event ID if found, null otherwise
 */
export async function findDuplicateEvent(
  env: SheetsEnv,
  input: CreateEventInput
): Promise<string | null> {
  const idempotencyKey = generateIdempotencyKey(input);

  const rows = await getSheetValues(env, EVENTS_SHEET, EVENTS_RANGE);
  const dataRows = rows.slice(1); // Skip header

  for (const row of dataRows) {
    // Only check events for the same brand
    if (row[EVENT_COL.BRAND_ID] !== input.brandId) continue;

    const dataJson = row[EVENT_COL.DATA_JSON];
    if (!dataJson) continue;

    try {
      const event = JSON.parse(dataJson);
      const existingKey = generateIdempotencyKey({
        name: event.name || '',
        startDateISO: event.startDateISO || '',
        brandId: row[EVENT_COL.BRAND_ID] || '',
        venue: event.venue || '',
      });

      if (existingKey === idempotencyKey) {
        return row[EVENT_COL.ID];
      }
    } catch {
      // Skip invalid JSON rows
      continue;
    }
  }

  return null;
}

// =============================================================================
// Event Creation
// =============================================================================

/**
 * Build the event links object
 *
 * @param eventId - Event ID
 * @param brandId - Brand ID
 * @param signupUrl - Optional signup URL
 * @returns Links object
 */
function buildEventLinks(
  eventId: string,
  brandId: string,
  signupUrl?: string
): CreatedEvent['links'] {
  // Base URL placeholder - will be replaced with actual Worker URL
  const baseUrl = `https://api.eventangle.com`;

  return {
    publicUrl: `${baseUrl}/events/${brandId}/${eventId}`,
    displayUrl: `${baseUrl}/events/${brandId}/${eventId}/display`,
    posterUrl: `${baseUrl}/events/${brandId}/${eventId}/poster`,
    signupUrl: signupUrl || '',
  };
}

/**
 * Build the full event object for storage
 *
 * @param input - Event input
 * @param id - Generated event ID
 * @param slug - Generated slug
 * @param eventTag - Generated event tag
 * @param now - Current timestamp
 * @returns Full event object
 */
function buildEventObject(
  input: CreateEventInput,
  id: string,
  slug: string,
  eventTag: string,
  now: string
): CreatedEvent {
  const links = buildEventLinks(id, input.brandId, input.signupUrl);

  return {
    id,
    slug,
    eventTag,
    name: input.name,
    startDateISO: input.startDateISO,
    venue: input.venue,
    brandId: input.brandId,
    templateId: input.templateId || null,
    links,
    qr: {
      public: '', // QR codes generated separately
      signup: '',
    },
    ctas: {
      primary: {
        label: 'Sign Up',
        url: links.signupUrl,
      },
      secondary: null,
    },
    settings: {
      showSchedule: false,
      showStandings: false,
      showBracket: false,
      showSponsors: false,
    },
    createdAtISO: now,
    updatedAtISO: now,
  };
}

/**
 * Build the row array for appending to the sheet
 *
 * @param event - Event object
 * @returns Row array for sheet
 */
function buildEventRow(event: CreatedEvent): (string | null)[] {
  return [
    event.id,
    event.brandId,
    event.templateId,
    JSON.stringify(event),
    event.createdAtISO,
    event.slug,
    event.updatedAtISO,
  ];
}

/**
 * Create a new event in the EVENTS sheet
 *
 * Handles:
 * - ID generation
 * - Slug generation with collision handling
 * - EventTag generation
 * - Idempotent behavior (returns existing event if duplicate)
 * - Sheet append
 *
 * @param env - Worker environment
 * @param input - Event creation input
 * @returns Creation result
 */
export async function createEvent(
  env: SheetsEnv,
  input: CreateEventInput
): Promise<CreateEventResult> {
  // Check for duplicate (idempotent behavior)
  const duplicateId = await findDuplicateEvent(env, input);
  if (duplicateId) {
    // Return existing event as duplicate
    const rows = await getSheetValues(env, EVENTS_SHEET, EVENTS_RANGE);
    const dataRows = rows.slice(1);

    for (const row of dataRows) {
      if (row[EVENT_COL.ID] === duplicateId) {
        try {
          const existingEvent = JSON.parse(row[EVENT_COL.DATA_JSON]) as CreatedEvent;
          return {
            success: true,
            event: {
              ...existingEvent,
              id: row[EVENT_COL.ID],
              brandId: row[EVENT_COL.BRAND_ID],
            },
            duplicate: true,
          };
        } catch {
          // If we can't parse, continue to create new
          break;
        }
      }
    }
  }

  // Generate unique ID
  const id = generateEventId();

  // Generate unique slug
  const slug = await generateUniqueSlug(env, input.name, input.brandId);

  // Generate event tag
  const eventTag = generateEventTag(input.brandId, slug, input.startDateISO);

  // Build event object
  const now = new Date().toISOString();
  const event = buildEventObject(input, id, slug, eventTag, now);

  // Build row for sheet
  const row = buildEventRow(event);

  // Append to sheet
  let appendResult: AppendResult;
  try {
    appendResult = await appendRow(env, EVENTS_SHEET, row);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to append event to sheet',
    };
  }

  // Verify append succeeded
  if (appendResult.updatedRows !== 1) {
    return {
      success: false,
      error: 'Event row was not appended correctly',
    };
  }

  return {
    success: true,
    event,
    duplicate: false,
  };
}
