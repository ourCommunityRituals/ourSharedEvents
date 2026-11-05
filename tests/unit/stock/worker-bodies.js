/**
 * The success bodies the stock tests' fake Worker answers with, one per admin or
 * public call the stock scripts make. Every fake in tests/unit/stock uses these,
 * and handler-shapes.test.js holds each one to the handler it stands in for: its
 * top-level keys must all be in that handler's success literal, and must include
 * every key the stock code reads.
 */

// POST /api/v2/admin/events (handlers/events.ts handleCreateEvent)
const eventCreate = ({ id, shortcode = null, warnings = [] }) => ({
  ok: true,
  status: 201,
  id,
  shortcode,
  warnings,
});

// POST /api/v2/admin/events/:id/poster-deployments (handleAdminCreatePosterDeployment)
const posterCreate = ({ id, qr_token }) => ({ ok: true, status: 201, id, qr_token });

// POST /api/v2/admin/events/:id/short-links (handlers/event-code.ts handleAdminEventCode)
const shortLinks = ({ code = 'ABC234' } = {}) => ({
  ok: true,
  code,
  links: { share: `/e/${code}` },
});

// POST /api/v2/admin/events/:id/uploads (handlers/upload.ts ok201)
const upload = ({ key, url }) => ({
  ok: true,
  status: 201,
  file: { key, url, filename: 'art', contentType: 'image/png', size: 3 },
  requestId: 'req-test',
});

// POST /api/v2/admin/sponsors (handlers/sponsors.ts handleAdminCreateSponsor)
const sponsorCreate = ({ id }) => ({
  ok: true,
  status: 201,
  id,
  placement_id: null,
  event_id: null,
});

// GET /api/v2/admin/sponsors?eventId= (handleAdminListSponsors)
const sponsorList = (items) => ({ ok: true, status: 200, items, scopedTo: null });

// GET /api/v2/events (handlers/events.ts handleListEvents)
const publicEvents = (items) => ({ ok: true, status: 200, items, sponsor_titles: {} });

module.exports = {
  eventCreate,
  posterCreate,
  shortLinks,
  upload,
  sponsorCreate,
  sponsorList,
  publicEvents,
};
