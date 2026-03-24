/**
 * Bundle API Handler
 *
 * Handles bundle endpoints for different surfaces:
 * - Public bundle: Full event data for public page
 * - Display bundle: Event data for TV/kiosk display
 * - Poster bundle: Event data for printable poster
 *
 * GET /api/events/:id/bundle/public
 * GET /api/events/:id/bundle/display
 * GET /api/events/:id/bundle/poster
 */

import { getEvent, getEventBySlug } from '../sheets/events.js';
import { isConfigured } from '../sheets/client.js';
import { isValidBrand, DEFAULT_BRAND, getBrandConfigForApi } from '../utils/brand.js';

/**
 * Generate correlation ID
 */
function generateCorrId() {
  return `bnd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
function generateEtag(event, bundleType) {
  const hash = `${event.updatedAtISO || event.id}-${bundleType}`;
  return `W/"${hash}"`;
}

/**
 * Filter sponsors by placement
 *
 * @param {Object[]} sponsors - All sponsors
 * @param {string} placement - Placement type to filter
 * @returns {Object[]} Filtered sponsors
 */
function filterSponsorsByPlacement(sponsors, placement) {
  if (!sponsors || !Array.isArray(sponsors)) return [];

  return sponsors.filter(sponsor => {
    // Check legacy placement field
    if (sponsor.placement === placement) return true;

    // Check new placements object
    if (sponsor.placements) {
      switch (placement) {
        case 'poster':
          return sponsor.placements.posterTop === true;
        case 'display':
        case 'tv-banner':
          return sponsor.placements.tvTop === true || sponsor.placements.tvSide === true;
        case 'public':
          return sponsor.placements.mobileBanner === true;
        default:
          return false;
      }
    }

    return false;
  });
}

/**
 * Handle GET /api/events/:id/bundle/public
 *
 * Get public bundle for an event.
 * Includes full event data + brand config.
 *
 * @param {Request} request
 * @param {Object} env
 * @param {string} eventId
 * @returns {Promise<Response>}
 */
export async function handlePublicBundle(request, env, eventId) {
  const url = new URL(request.url);
  const brandId = url.searchParams.get('brand') || DEFAULT_BRAND;

  if (!eventId) {
    return errorResponse('BAD_INPUT', 'Missing event ID');
  }

  if (!isValidBrand(brandId)) {
    return errorResponse('BAD_INPUT', `Invalid brand: ${brandId}`);
  }

  if (!isConfigured(env)) {
    return errorResponse('NOT_CONFIGURED', 'Google Sheets API not configured', 503);
  }

  try {
    // Get event by ID or slug
    let event = await getEvent(env, eventId, brandId);
    if (!event) {
      event = await getEventBySlug(env, eventId, brandId);
    }

    if (!event) {
      return errorResponse('NOT_FOUND', `Event not found: ${eventId}`, 404);
    }

    // Check ETag
    const etag = generateEtag(event, 'public');
    const ifNoneMatch = request.headers.get('If-None-Match');

    if (ifNoneMatch === etag) {
      return new Response(JSON.stringify({
        ok: true,
        notModified: true,
        etag
      }), {
        status: 304,
        headers: { 'ETag': etag }
      });
    }

    // Filter sponsors for public display
    const publicSponsors = filterSponsorsByPlacement(event.sponsors, 'public');

    // Build bundle
    const bundle = {
      event: {
        ...event,
        sponsors: publicSponsors
      },
      config: getBrandConfigForApi(brandId)
    };

    return successResponse(bundle, {
      etag,
      cache: 'private, max-age=60, stale-while-revalidate=300'
    });
  } catch (error) {
    const corrId = generateCorrId();
    console.error(`[${corrId}] Error getting public bundle:`, error);

    return errorResponse('INTERNAL', 'Failed to get public bundle', 500, corrId);
  }
}

/**
 * Handle GET /api/events/:id/bundle/display
 *
 * Get display bundle for TV/kiosk.
 * Filters sponsors for display placement.
 *
 * @param {Request} request
 * @param {Object} env
 * @param {string} eventId
 * @returns {Promise<Response>}
 */
export async function handleDisplayBundle(request, env, eventId) {
  const url = new URL(request.url);
  const brandId = url.searchParams.get('brand') || DEFAULT_BRAND;

  if (!eventId) {
    return errorResponse('BAD_INPUT', 'Missing event ID');
  }

  if (!isValidBrand(brandId)) {
    return errorResponse('BAD_INPUT', `Invalid brand: ${brandId}`);
  }

  if (!isConfigured(env)) {
    return errorResponse('NOT_CONFIGURED', 'Google Sheets API not configured', 503);
  }

  try {
    let event = await getEvent(env, eventId, brandId);
    if (!event) {
      event = await getEventBySlug(env, eventId, brandId);
    }

    if (!event) {
      return errorResponse('NOT_FOUND', `Event not found: ${eventId}`, 404);
    }

    const etag = generateEtag(event, 'display');
    const ifNoneMatch = request.headers.get('If-None-Match');

    if (ifNoneMatch === etag) {
      return new Response(JSON.stringify({
        ok: true,
        notModified: true,
        etag
      }), {
        status: 304,
        headers: { 'ETag': etag }
      });
    }

    // Filter sponsors for display
    const displaySponsors = filterSponsorsByPlacement(event.sponsors, 'display');

    // Build display-specific bundle
    const bundle = {
      event: {
        id: event.id,
        slug: event.slug,
        name: event.name,
        startDateISO: event.startDateISO,
        venue: event.venue,
        links: event.links,
        schedule: event.schedule,
        standings: event.standings,
        bracket: event.bracket,
        sponsors: displaySponsors,
        settings: event.settings,
        createdAtISO: event.createdAtISO,
        updatedAtISO: event.updatedAtISO
      },
      config: getBrandConfigForApi(brandId)
    };

    return successResponse(bundle, {
      etag,
      cache: 'private, max-age=30, stale-while-revalidate=120'
    });
  } catch (error) {
    const corrId = generateCorrId();
    console.error(`[${corrId}] Error getting display bundle:`, error);

    return errorResponse('INTERNAL', 'Failed to get display bundle', 500, corrId);
  }
}

/**
 * Handle GET /api/events/:id/bundle/poster
 *
 * Get poster bundle for printable poster.
 * Includes QR codes and poster-specific sponsors.
 *
 * @param {Request} request
 * @param {Object} env
 * @param {string} eventId
 * @returns {Promise<Response>}
 */
export async function handlePosterBundle(request, env, eventId) {
  const url = new URL(request.url);
  const brandId = url.searchParams.get('brand') || DEFAULT_BRAND;

  if (!eventId) {
    return errorResponse('BAD_INPUT', 'Missing event ID');
  }

  if (!isValidBrand(brandId)) {
    return errorResponse('BAD_INPUT', `Invalid brand: ${brandId}`);
  }

  if (!isConfigured(env)) {
    return errorResponse('NOT_CONFIGURED', 'Google Sheets API not configured', 503);
  }

  try {
    let event = await getEvent(env, eventId, brandId);
    if (!event) {
      event = await getEventBySlug(env, eventId, brandId);
    }

    if (!event) {
      return errorResponse('NOT_FOUND', `Event not found: ${eventId}`, 404);
    }

    const etag = generateEtag(event, 'poster');
    const ifNoneMatch = request.headers.get('If-None-Match');

    if (ifNoneMatch === etag) {
      return new Response(JSON.stringify({
        ok: true,
        notModified: true,
        etag
      }), {
        status: 304,
        headers: { 'ETag': etag }
      });
    }

    // Filter sponsors for poster
    const posterSponsors = filterSponsorsByPlacement(event.sponsors, 'poster');

    // QR invariant check: "Never show a QR unless verified"
    const hasValidQr = event.qr &&
      event.qr.public &&
      event.qr.public.startsWith('data:image') &&
      event.links &&
      event.links.publicUrl;

    if (!hasValidQr) {
      console.warn(`[QR_INVARIANT] Event ${eventId} has invalid or missing QR codes`);
    }

    // Build poster-specific bundle
    const bundle = {
      event: {
        id: event.id,
        slug: event.slug,
        name: event.name,
        startDateISO: event.startDateISO,
        venue: event.venue,
        links: event.links,
        qr: hasValidQr ? event.qr : null, // Only include if valid
        ctas: event.ctas,
        sponsors: posterSponsors,
        settings: event.settings,
        createdAtISO: event.createdAtISO,
        updatedAtISO: event.updatedAtISO
      },
      config: getBrandConfigForApi(brandId),
      qrValid: hasValidQr
    };

    return successResponse(bundle, {
      etag,
      cache: 'private, max-age=300, stale-while-revalidate=600'
    });
  } catch (error) {
    const corrId = generateCorrId();
    console.error(`[${corrId}] Error getting poster bundle:`, error);

    return errorResponse('INTERNAL', 'Failed to get poster bundle', 500, corrId);
  }
}

/**
 * Handle GET /api/events/:id/bundle/admin
 *
 * Get admin bundle with full event data.
 * Requires authentication.
 *
 * @param {Request} request
 * @param {Object} env
 * @param {string} eventId
 * @returns {Promise<Response>}
 */
export async function handleAdminBundle(request, env, eventId) {
  const url = new URL(request.url);
  const brandId = url.searchParams.get('brand') || DEFAULT_BRAND;

  if (!eventId) {
    return errorResponse('BAD_INPUT', 'Missing event ID');
  }

  if (!isValidBrand(brandId)) {
    return errorResponse('BAD_INPUT', `Invalid brand: ${brandId}`);
  }

  if (!isConfigured(env)) {
    return errorResponse('NOT_CONFIGURED', 'Google Sheets API not configured', 503);
  }

  try {
    let event = await getEvent(env, eventId, brandId);
    if (!event) {
      event = await getEventBySlug(env, eventId, brandId);
    }

    if (!event) {
      return errorResponse('NOT_FOUND', `Event not found: ${eventId}`, 404);
    }

    const etag = generateEtag(event, 'admin');

    // Full bundle with all data
    const bundle = {
      event,
      config: getBrandConfigForApi(brandId)
    };

    return successResponse(bundle, {
      etag,
      cache: 'private, no-cache'
    });
  } catch (error) {
    const corrId = generateCorrId();
    console.error(`[${corrId}] Error getting admin bundle:`, error);

    return errorResponse('INTERNAL', 'Failed to get admin bundle', 500, corrId);
  }
}

/**
 * Route bundle API requests
 *
 * @param {Request} request
 * @param {Object} env
 * @param {string} eventId - Event ID from path
 * @param {string} bundleType - Bundle type (public, display, poster, admin)
 * @returns {Promise<Response>}
 */
export async function routeBundlesApi(request, env, eventId, bundleType) {
  if (request.method !== 'GET') {
    return errorResponse('BAD_INPUT', 'Bundle endpoints only support GET', 405);
  }

  switch (bundleType) {
    case 'public':
      return handlePublicBundle(request, env, eventId);
    case 'display':
      return handleDisplayBundle(request, env, eventId);
    case 'poster':
      return handlePosterBundle(request, env, eventId);
    case 'admin':
      return handleAdminBundle(request, env, eventId);
    default:
      return errorResponse('NOT_FOUND', `Unknown bundle type: ${bundleType}`, 404);
  }
}
