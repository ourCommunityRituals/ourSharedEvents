/**
 * Events API Handler
 *
 * Handles event CRUD operations via Google Sheets.
 *
 * GET /api/v2/events - List events
 * GET /api/v2/events/:id - Get single event
 * POST /api/v2/events - Create event (requires auth)
 * PUT /api/v2/events/:id - Update event (requires auth)
 * DELETE /api/v2/events/:id - Delete event (requires auth)
 */

import { listEvents, getEvent, getEventBySlug, createEvent, updateEvent, deleteEvent, generateUniqueSlug, countEvents } from '../sheets/events.js';
import { isConfigured } from '../sheets/client.js';
import { isValidBrand, DEFAULT_BRAND, generateEventUrls } from '../utils/brand.js';
import { generateEventQrCodes } from '../utils/qr.js';

/**
 * Generate correlation ID
 */
function generateCorrId() {
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create success response
 */
function successResponse(value, options = {}) {
  const body = {
    ok: true,
    value,
    ...(options.etag ? { etag: options.etag } : {})
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...(options.etag ? { 'ETag': options.etag } : {}),
      'Cache-Control': options.cache || 'private, max-age=60'
    }
  });
}

/**
 * Create error response
 */
function errorResponse(code, message, status = 400, corrId = null) {
  const body = {
    ok: false,
    code,
    message,
    ...(corrId ? { corrId } : {})
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Generate ETag from event data
 */
function generateEtag(event) {
  const hash = event.updatedAtISO || event.id;
  return `W/"${hash}"`;
}

/**
 * Handle GET /api/events
 *
 * List all events for a brand.
 *
 * Query params:
 * - brand (required): Brand ID
 * - full (optional): Include full event data
 *
 * @param {Request} request
 * @param {Object} env
 * @returns {Promise<Response>}
 */
export async function handleListEvents(request, env) {
  const url = new URL(request.url);
  const brandId = url.searchParams.get('brand') || DEFAULT_BRAND;
  const includeFull = url.searchParams.get('full') === 'true';

  // Validate brand
  if (!isValidBrand(brandId)) {
    return errorResponse('BAD_INPUT', `Invalid brand: ${brandId}`);
  }

  // Check if Sheets is configured
  if (!isConfigured(env)) {
    return errorResponse(
      'NOT_CONFIGURED',
      'Google Sheets API not configured',
      503
    );
  }

  try {
    const events = await listEvents(env, brandId, { includeData: includeFull });

    return successResponse(events, {
      cache: 'private, max-age=60, stale-while-revalidate=300'
    });
  } catch (error) {
    const corrId = generateCorrId();
    console.error(`[${corrId}] Error listing events:`, error);

    return errorResponse(
      'INTERNAL',
      'Failed to list events',
      500,
      corrId
    );
  }
}

/**
 * Handle GET /api/events/:id
 *
 * Get a single event by ID or slug.
 *
 * @param {Request} request
 * @param {Object} env
 * @param {string} eventId - Event ID from path
 * @returns {Promise<Response>}
 */
export async function handleGetEvent(request, env, eventId) {
  const url = new URL(request.url);
  const brandId = url.searchParams.get('brand') || DEFAULT_BRAND;

  if (!eventId) {
    return errorResponse('BAD_INPUT', 'Missing event ID');
  }

  // Validate brand
  if (!isValidBrand(brandId)) {
    return errorResponse('BAD_INPUT', `Invalid brand: ${brandId}`);
  }

  // Check if Sheets is configured
  if (!isConfigured(env)) {
    return errorResponse(
      'NOT_CONFIGURED',
      'Google Sheets API not configured',
      503
    );
  }

  try {
    // Try by ID first, then by slug
    let event = await getEvent(env, eventId, brandId);

    if (!event) {
      event = await getEventBySlug(env, eventId, brandId);
    }

    if (!event) {
      return errorResponse('NOT_FOUND', `Event not found: ${eventId}`, 404);
    }

    // Check ETag for conditional request
    const etag = generateEtag(event);
    const ifNoneMatch = request.headers.get('If-None-Match');

    if (ifNoneMatch === etag) {
      return new Response(null, {
        status: 304,
        headers: { 'ETag': etag }
      });
    }

    return successResponse(event, {
      etag,
      cache: 'private, max-age=60, stale-while-revalidate=300'
    });
  } catch (error) {
    const corrId = generateCorrId();
    console.error(`[${corrId}] Error getting event ${eventId}:`, error);

    return errorResponse(
      'INTERNAL',
      'Failed to get event',
      500,
      corrId
    );
  }
}

/**
 * Handle POST /api/events
 *
 * Create a new event.
 * Requires admin authentication.
 *
 * @param {Request} request
 * @param {Object} env
 * @returns {Promise<Response>}
 */
export async function handleCreateEvent(request, env) {
  // Check if Sheets is configured
  if (!isConfigured(env)) {
    return errorResponse(
      'NOT_CONFIGURED',
      'Google Sheets API not configured',
      503
    );
  }

  try {
    const body = await request.json();

    // Validate required fields
    if (!body.name) {
      return errorResponse('BAD_INPUT', 'Missing required field: name');
    }
    if (!body.startDateISO) {
      return errorResponse('BAD_INPUT', 'Missing required field: startDateISO');
    }
    if (!body.venue) {
      return errorResponse('BAD_INPUT', 'Missing required field: venue');
    }

    const brandId = body.brandId || DEFAULT_BRAND;

    if (!isValidBrand(brandId)) {
      return errorResponse('BAD_INPUT', `Invalid brand: ${brandId}`);
    }

    // Generate ID and slug
    const eventId = `EVT_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const slug = await generateUniqueSlug(env, body.name, brandId);

    // Generate links
    const links = generateEventUrls(brandId, slug, env);
    links.signupUrl = body.signupUrl || links.publicUrl;

    // Build event object
    const now = new Date().toISOString();
    const event = {
      id: eventId,
      slug,
      name: body.name,
      startDateISO: body.startDateISO,
      venue: body.venue,
      brandId,
      templateId: body.templateId || null,
      links,
      qr: { public: '', signup: '' }, // Will be generated below
      schedule: body.schedule || null,
      standings: body.standings || null,
      bracket: body.bracket || null,
      ctas: body.ctas || {
        primary: { label: 'Learn More', url: links.publicUrl }
      },
      sponsors: body.sponsors || null,
      media: body.media || null,
      settings: body.settings || {
        showSchedule: !!body.schedule,
        showStandings: !!body.standings,
        showBracket: !!body.bracket,
        showSponsors: !!body.sponsors
      },
      createdAtISO: now,
      updatedAtISO: now
    };

    // Generate QR codes
    try {
      event.qr = generateEventQrCodes(event);
    } catch (qrError) {
      console.error('QR generation failed:', qrError);
      // Continue without QR codes - can be regenerated
    }

    // Save to Sheets
    const created = await createEvent(env, event);

    return new Response(JSON.stringify({
      ok: true,
      value: created
    }), {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'Location': `/api/events/${eventId}`
      }
    });
  } catch (error) {
    const corrId = generateCorrId();
    console.error(`[${corrId}] Error creating event:`, error);

    if (error.message.includes('parse')) {
      return errorResponse('BAD_INPUT', 'Invalid JSON in request body');
    }

    return errorResponse(
      'INTERNAL',
      'Failed to create event',
      500,
      corrId
    );
  }
}

/**
 * Handle PUT /api/events/:id
 *
 * Update an existing event.
 * Requires admin authentication.
 *
 * @param {Request} request
 * @param {Object} env
 * @param {string} eventId - Event ID from path
 * @returns {Promise<Response>}
 */
export async function handleUpdateEvent(request, env, eventId) {
  if (!eventId) {
    return errorResponse('BAD_INPUT', 'Missing event ID');
  }

  // Check if Sheets is configured
  if (!isConfigured(env)) {
    return errorResponse(
      'NOT_CONFIGURED',
      'Google Sheets API not configured',
      503
    );
  }

  try {
    const body = await request.json();

    // Get existing event
    const existing = await getEvent(env, eventId);

    if (!existing) {
      return errorResponse('NOT_FOUND', `Event not found: ${eventId}`, 404);
    }

    // Prepare updates (don't allow changing ID or brandId)
    const updates = { ...body };
    delete updates.id;
    delete updates.brandId;
    delete updates.createdAtISO;

    // Regenerate QR codes if links changed
    if (updates.links || updates.signupUrl) {
      const newLinks = updates.links || existing.links;
      if (updates.signupUrl && newLinks) {
        newLinks.signupUrl = updates.signupUrl;
      }

      try {
        const tempEvent = { ...existing, links: newLinks };
        updates.qr = generateEventQrCodes(tempEvent);
      } catch (qrError) {
        console.error('QR regeneration failed:', qrError);
      }
    }

    // Save updates
    const updated = await updateEvent(env, eventId, updates);

    const etag = generateEtag(updated);

    return successResponse(updated, { etag });
  } catch (error) {
    const corrId = generateCorrId();
    console.error(`[${corrId}] Error updating event ${eventId}:`, error);

    if (error.message.includes('parse')) {
      return errorResponse('BAD_INPUT', 'Invalid JSON in request body');
    }

    return errorResponse(
      'INTERNAL',
      'Failed to update event',
      500,
      corrId
    );
  }
}

/**
 * Handle DELETE /api/events/:id
 *
 * Delete an event by ID.
 * Requires admin authentication.
 *
 * @param {Request} request
 * @param {Object} env
 * @param {string} eventId - Event ID from path
 * @returns {Promise<Response>}
 */
export async function handleDeleteEvent(request, env, eventId) {
  if (!eventId) {
    return errorResponse('BAD_INPUT', 'Missing event ID');
  }

  // Check if Sheets is configured
  if (!isConfigured(env)) {
    return errorResponse(
      'NOT_CONFIGURED',
      'Google Sheets API not configured',
      503
    );
  }

  try {
    const url = new URL(request.url);
    const brandId = url.searchParams.get('brand') || DEFAULT_BRAND;

    const deleted = await deleteEvent(env, eventId, brandId);

    if (!deleted) {
      return errorResponse('NOT_FOUND', `Event not found: ${eventId}`, 404);
    }

    return new Response(JSON.stringify({
      ok: true,
      value: null,
      message: `Event ${eventId} deleted`
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    const corrId = generateCorrId();
    console.error(`[${corrId}] Error deleting event ${eventId}:`, error);

    return errorResponse(
      'INTERNAL',
      'Failed to delete event',
      500,
      corrId
    );
  }
}

/**
 * Route event API requests
 *
 * @param {Request} request
 * @param {Object} env
 * @param {string} path - Path after /api/events
 * @returns {Promise<Response>}
 */
export async function routeEventsApi(request, env, path) {
  const method = request.method;

  // GET /api/events - List events
  if (method === 'GET' && !path) {
    return handleListEvents(request, env);
  }

  // GET /api/events/:id - Get event
  if (method === 'GET' && path && !path.includes('/')) {
    return handleGetEvent(request, env, path);
  }

  // POST /api/events - Create event
  if (method === 'POST' && !path) {
    return handleCreateEvent(request, env);
  }

  // PUT /api/events/:id - Update event
  if (method === 'PUT' && path && !path.includes('/')) {
    return handleUpdateEvent(request, env, path);
  }

  // DELETE /api/events/:id - Delete event
  if (method === 'DELETE' && path && !path.includes('/')) {
    return handleDeleteEvent(request, env, path);
  }

  // Unknown route
  return errorResponse('NOT_FOUND', 'Event API endpoint not found', 404);
}
