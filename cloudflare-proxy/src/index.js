/**
 * Module Index
 *
 * Exports all modules for easy import in worker.js
 */

// Sheets modules
export { getAccessToken, clearTokenCache, hasCredentials } from './sheets/auth.js';
export {
  readRange,
  writeRange,
  appendRows,
  getSpreadsheetMetadata,
  batchRead,
  healthCheck as sheetsHealthCheck,
  isConfigured as isSheetsConfigured,
  SheetsError,
  SHEETS_ERROR_CODES
} from './sheets/client.js';
export {
  listEvents,
  getEvent,
  getEventBySlug,
  createEvent,
  updateEvent,
  countEvents,
  eventExists,
  generateUniqueSlug
} from './sheets/events.js';

// API modules
export {
  handleStatusRequest,
  handleSheetsStatusRequest,
  handlePingRequest
} from './api/status.js';
export {
  handleListEvents,
  handleGetEvent,
  handleCreateEvent,
  handleUpdateEvent,
  routeEventsApi
} from './api/events.js';
export {
  handlePublicBundle,
  handleDisplayBundle,
  handlePosterBundle,
  handleAdminBundle,
  routeBundlesApi
} from './api/bundles.js';

// Utility modules
export { generateQrCode, generateEventQrCodes } from './utils/qr.js';
export {
  BRAND_CONFIG,
  VALID_BRANDS,
  DEFAULT_BRAND,
  isValidBrand,
  getBrandConfig,
  getBrandConfigForApi,
  extractBrandFromPath,
  generateEventUrls
} from './utils/brand.js';

// Middleware modules
export {
  checkAdminAuth,
  checkAdminKey,
  requireAdminAuth,
  authErrorResponse
} from './middleware/auth.js';
export {
  getCorsHeaders,
  handleCorsPreflightRequest,
  addCorsHeaders
} from './middleware/cors.js';
