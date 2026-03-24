/**
 * Event Operations for Google Sheets
 *
 * Handles reading/writing event data from the EVENTS sheet.
 * Event data is stored as JSON in the dataJSON column.
 *
 * Sheet Structure (EVENTS):
 * A: id
 * B: brandId
 * C: templateId
 * D: dataJSON (full event as JSON string)
 * E: createdAt
 * F: slug
 * G: updatedAt
 */

import { readRange, writeRange, appendRows } from './client.js';

// Sheet configuration
const EVENTS_SHEET = 'EVENTS';
const EVENTS_RANGE = `${EVENTS_SHEET}!A:G`;

// Column indices (0-based)
const COL = {
  ID: 0,
  BRAND_ID: 1,
  TEMPLATE_ID: 2,
  DATA_JSON: 3,
  CREATED_AT: 4,
  SLUG: 5,
  UPDATED_AT: 6
};

/**
 * Parse event row to event object
 * @param {string[]} row - Sheet row
 * @returns {Object|null} Event object or null if invalid
 */
function parseEventRow(row) {
  if (!row || row.length < 4) return null;

  const id = row[COL.ID];
  const dataJson = row[COL.DATA_JSON];

  if (!id || !dataJson) return null;

  try {
    const event = JSON.parse(dataJson);
    return {
      ...event,
      id: id, // Ensure ID from column matches
      brandId: row[COL.BRAND_ID] || event.brandId || 'root'
    };
  } catch (e) {
    console.error(`Failed to parse event ${id}:`, e.message);
    return null;
  }
}

/**
 * List all events for a brand
 *
 * @param {Object} env - Worker environment
 * @param {string} brandId - Brand ID to filter by
 * @param {Object} options - Options
 * @param {boolean} [options.includeData] - Include full event data (default: false, returns summary)
 * @returns {Promise<Object[]>} Array of events
 */
export async function listEvents(env, brandId, options = {}) {
  const rows = await readRange(env, EVENTS_RANGE);

  // Skip header row
  const dataRows = rows.slice(1);

  const events = [];
  for (const row of dataRows) {
    // Filter by brandId
    if (row[COL.BRAND_ID] !== brandId) continue;

    const event = parseEventRow(row);
    if (!event) continue;

    if (options.includeData) {
      events.push(event);
    } else {
      // Return summary only
      events.push({
        id: event.id,
        slug: event.slug,
        name: event.name,
        startDateISO: event.startDateISO,
        venue: event.venue,
        createdAtISO: event.createdAtISO,
        updatedAtISO: event.updatedAtISO
      });
    }
  }

  // Sort by date descending (most recent first)
  events.sort((a, b) => {
    const dateA = a.startDateISO || '';
    const dateB = b.startDateISO || '';
    return dateB.localeCompare(dateA);
  });

  return events;
}

/**
 * Get a single event by ID
 *
 * @param {Object} env - Worker environment
 * @param {string} eventId - Event ID
 * @param {string} [brandId] - Optional brand ID for validation
 * @returns {Promise<Object|null>} Event object or null if not found
 */
export async function getEvent(env, eventId, brandId = null) {
  const rows = await readRange(env, EVENTS_RANGE);

  // Skip header row
  const dataRows = rows.slice(1);

  for (const row of dataRows) {
    if (row[COL.ID] !== eventId) continue;

    // Optionally validate brandId
    if (brandId && row[COL.BRAND_ID] !== brandId) {
      return null; // Event exists but belongs to different brand
    }

    return parseEventRow(row);
  }

  return null;
}

/**
 * Get a single event by slug
 *
 * @param {Object} env - Worker environment
 * @param {string} slug - Event slug
 * @param {string} brandId - Brand ID
 * @returns {Promise<Object|null>} Event object or null if not found
 */
export async function getEventBySlug(env, slug, brandId) {
  const rows = await readRange(env, EVENTS_RANGE);

  // Skip header row
  const dataRows = rows.slice(1);

  for (const row of dataRows) {
    if (row[COL.BRAND_ID] !== brandId) continue;
    if (row[COL.SLUG] !== slug) continue;

    return parseEventRow(row);
  }

  return null;
}

/**
 * Find row index for an event ID
 *
 * @param {Object} env - Worker environment
 * @param {string} eventId - Event ID
 * @returns {Promise<number>} Row index (1-based) or -1 if not found
 */
async function findEventRowIndex(env, eventId) {
  const rows = await readRange(env, `${EVENTS_SHEET}!A:A`);

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === eventId) {
      return i + 1; // 1-based for Sheets API
    }
  }

  return -1;
}

/**
 * Create a new event
 *
 * @param {Object} env - Worker environment
 * @param {Object} event - Event data (must include id, brandId)
 * @returns {Promise<Object>} Created event
 */
export async function createEvent(env, event) {
  if (!event.id) {
    throw new Error('Event must have an id');
  }
  if (!event.brandId) {
    throw new Error('Event must have a brandId');
  }

  const now = new Date().toISOString();

  // Ensure required timestamps
  const eventWithTimestamps = {
    ...event,
    createdAtISO: event.createdAtISO || now,
    updatedAtISO: now
  };

  const row = [
    event.id,
    event.brandId,
    event.templateId || '',
    JSON.stringify(eventWithTimestamps),
    eventWithTimestamps.createdAtISO,
    event.slug || '',
    eventWithTimestamps.updatedAtISO
  ];

  await appendRows(env, EVENTS_RANGE, [row]);

  return eventWithTimestamps;
}

/**
 * Update an existing event
 *
 * @param {Object} env - Worker environment
 * @param {string} eventId - Event ID to update
 * @param {Object} updates - Partial event data to merge
 * @returns {Promise<Object>} Updated event
 */
export async function updateEvent(env, eventId, updates) {
  const existing = await getEvent(env, eventId);

  if (!existing) {
    throw new Error(`Event not found: ${eventId}`);
  }

  const rowIndex = await findEventRowIndex(env, eventId);
  if (rowIndex < 0) {
    throw new Error(`Event row not found: ${eventId}`);
  }

  const now = new Date().toISOString();

  // Merge updates
  const updated = {
    ...existing,
    ...updates,
    id: eventId, // Preserve original ID
    brandId: existing.brandId, // Preserve brand
    updatedAtISO: now
  };

  const row = [
    updated.id,
    updated.brandId,
    updated.templateId || '',
    JSON.stringify(updated),
    updated.createdAtISO,
    updated.slug || '',
    updated.updatedAtISO
  ];

  await writeRange(env, `${EVENTS_SHEET}!A${rowIndex}:G${rowIndex}`, [row]);

  return updated;
}

/**
 * Get events count for a brand
 *
 * @param {Object} env - Worker environment
 * @param {string} brandId - Brand ID
 * @returns {Promise<number>} Event count
 */
export async function countEvents(env, brandId) {
  const rows = await readRange(env, `${EVENTS_SHEET}!A:B`);

  let count = 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] === brandId) {
      count++;
    }
  }

  return count;
}

/**
 * Check if an event exists
 *
 * @param {Object} env - Worker environment
 * @param {string} eventId - Event ID
 * @returns {Promise<boolean>}
 */
export async function eventExists(env, eventId) {
  const rowIndex = await findEventRowIndex(env, eventId);
  return rowIndex > 0;
}

/**
 * Delete an event by ID
 *
 * @param {Object} env - Worker environment
 * @param {string} eventId - Event ID to delete
 * @param {string} [brandId] - Optional brand ID for validation
 * @returns {Promise<boolean>} True if deleted
 */
export async function deleteEvent(env, eventId, brandId = null) {
  const existing = await getEvent(env, eventId, brandId);

  if (!existing) {
    return false; // Event not found or wrong brand
  }

  const rowIndex = await findEventRowIndex(env, eventId);
  if (rowIndex < 0) {
    return false;
  }

  // Clear the row (set all cells to empty strings)
  // This effectively "deletes" the event since parseEventRow requires valid data
  const emptyRow = ['', '', '', '', '', '', ''];
  await writeRange(env, `${EVENTS_SHEET}!A${rowIndex}:G${rowIndex}`, [emptyRow]);

  return true;
}

/**
 * Generate a unique slug for an event
 *
 * @param {Object} env - Worker environment
 * @param {string} name - Event name
 * @param {string} brandId - Brand ID
 * @returns {Promise<string>} Unique slug
 */
export async function generateUniqueSlug(env, name, brandId) {
  // Convert name to slug
  let baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);

  if (!baseSlug) {
    baseSlug = 'event';
  }

  // Check if slug exists
  let slug = baseSlug;
  let counter = 1;

  while (await getEventBySlug(env, slug, brandId)) {
    slug = `${baseSlug}-${counter}`;
    counter++;

    if (counter > 100) {
      // Safety limit
      slug = `${baseSlug}-${Date.now()}`;
      break;
    }
  }

  return slug;
}
