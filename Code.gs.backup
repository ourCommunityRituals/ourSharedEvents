// === Zeventbook Production-Grade Backend ===
// Build: triangle-prod-v1.2

// === Constants / Envelopes / Errors =======================================
const ERR = Object.freeze({
  BAD_INPUT:   'BAD_INPUT',
  NOT_FOUND:   'NOT_FOUND',
  RATE_LIMITED:'RATE_LIMITED',
  INTERNAL:    'INTERNAL',
  CONTRACT:    'CONTRACT'
});
const Ok  = (value={}) => ({ ok:true,  value });
const Err = (code, message) => ({ ok:false, code, message: message||code });

// Fixed: Bug #48 - Sanitize error messages to prevent information disclosure
/**
 * Creates a user-friendly error response while logging detailed information internally
 * @param {string} code - Error code (ERR.*)
 * @param {string} internalMessage - Detailed internal message (logged, not shown to user)
 * @param {object} logDetails - Additional details to log
 * @param {string} where - Function name for logging context
 * @returns {object} Error envelope with sanitized message
 */
function UserFriendlyErr_(code, internalMessage, logDetails = {}, where = 'API') {
  // Log full details internally
  diag_('error', where, internalMessage, logDetails);

  // Map error codes to generic user-facing messages
  const userMessages = {
    'BAD_INPUT': 'Invalid request. Please check your input and try again.',
    'NOT_FOUND': 'The requested resource was not found.',
    'UNAUTHORIZED': 'Authentication failed. Please verify your credentials.',
    'RATE_LIMITED': 'Too many requests. Please try again later.',
    'INTERNAL': 'An internal error occurred. Please try again later.',
    'CONTRACT': 'An unexpected error occurred. Please contact support.'
  };

  // Return sanitized error to user
  const sanitizedMessage = userMessages[code] || 'An error occurred. Please try again.';
  return Err(code, sanitizedMessage);
}

// === Schema validation (runtime contracts) =================================
function schemaCheck(schema, obj, where='') {
  if (schema.type === 'object' && obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(schema.props || {})) {
      if (v.required && !(k in obj)) {
        diag_('error', where||'schemaCheck', 'Missing required field', {field: k});
        throw new Error(`Missing required field: ${k}`);
      }
      if (k in obj && v.type && typeof obj[k] !== v.type) {
        diag_('error', where||'schemaCheck', 'Type mismatch', {field: k, expected: v.type, got: typeof obj[k]});
        throw new Error(`Type mismatch for ${k}: expected ${v.type}, got ${typeof obj[k]}`);
      }
    }
  } else if (schema.type === 'array' && Array.isArray(obj)) {
    // Arrays are valid
  } else if (schema.type && typeof obj !== schema.type) {
    diag_('error', where||'schemaCheck', 'Schema type mismatch', {expected: schema.type, got: typeof obj});
    throw new Error(`Schema type mismatch: expected ${schema.type}, got ${typeof obj}`);
  }
  return true;
}

// Response schemas
const SC_OK = {type: 'object', props: {ok: {type: 'boolean', required: true}}};
const SC_LIST = {type: 'object', props: {ok: {type: 'boolean', required: true}, value: {type: 'object'}}};
const SC_GET = {type: 'object', props: {ok: {type: 'boolean', required: true}, value: {type: 'object'}}};
const SC_STATUS = {type: 'object', props: {ok: {type: 'boolean', required: true}, value: {type: 'object'}}};

// Fixed: Bug #26 - Check if obj is error response before schema validation
function _ensureOk_(label, schema, obj) {
  // If already an error envelope, return as-is without validation
  if (obj && obj.ok === false) {
    return obj;
  }

  try {
    schemaCheck(schema, obj, label);
    return obj;
  } catch(e) {
    diag_('error', label, 'Contract violation', {error: String(e), obj});
    return Err(ERR.CONTRACT, `Contract violation in ${label}: ${e.message}`);
  }
}

// === Logger (append-only with caps) =======================================
const DIAG_SHEET='DIAG', DIAG_MAX=3000, DIAG_PER_DAY=800;

/**
 * Diagnostic logging with spreadsheet ID support for web app context
 * @param {string} level - Log level (error, warn, info, debug)
 * @param {string} where - Function/location name
 * @param {string} msg - Log message
 * @param {object} meta - Optional metadata object
 * @param {string} spreadsheetId - Optional spreadsheet ID (uses root tenant if not provided)
 */
// Fixed: Bug #17 - Sanitize sensitive data from metadata before logging
function sanitizeMetaForLogging_(meta) {
  if (!meta || typeof meta !== 'object') return meta;

  const sanitized = { ...meta };
  const sensitiveKeys = ['adminkey', 'token', 'password', 'secret', 'authorization', 'bearer', 'csrf', 'csrftoken'];

  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
      sanitized[key] = '[REDACTED]';
    }
  }

  return sanitized;
}

function diag_(level, where, msg, meta, spreadsheetId){
  try{
    // If spreadsheet ID not provided, try to get from root tenant
    if (!spreadsheetId) {
      const rootTenant = findTenant_('root');
      if (rootTenant && rootTenant.store && rootTenant.store.spreadsheetId) {
        spreadsheetId = rootTenant.store.spreadsheetId;
      }
    }

    // Fall back to getActive() only if no spreadsheet ID available (UI context)
    const ss = spreadsheetId
      ? SpreadsheetApp.openById(spreadsheetId)
      : SpreadsheetApp.getActive();

    let sh = ss.getSheetByName(DIAG_SHEET);
    if(!sh){
      sh = ss.insertSheet(DIAG_SHEET);
      sh.appendRow(['ts','level','where','msg','meta']);
      sh.setFrozenRows(1);
    }

    // Fixed: Bug #17 - Sanitize metadata before logging
    const sanitizedMeta = sanitizeMetaForLogging_(meta);
    sh.appendRow([new Date().toISOString(), level, where, msg, sanitizedMeta ? JSON.stringify(sanitizedMeta) : '']);

    // Fixed: Bug #47 - Add error handling for cleanup operations
    try {
      // Hard cap cleanup - Fixed: Bug #8
      const last = sh.getLastRow();
      if(last > DIAG_MAX){
        const rowsToDelete = last - DIAG_MAX;
        if (rowsToDelete > 0) {
          sh.deleteRows(2, rowsToDelete);
        }
      }

      // Fixed: Bug #42 - Use counter instead of random for deterministic cleanup
      // Run cleanup every 50 log entries instead of random 10% chance
      const cache = CacheService.getScriptCache();
      const cleanupCounterKey = 'diag_cleanup_counter';
      const counter = parseInt(cache.get(cleanupCounterKey) || '0', 10) + 1;
      cache.put(cleanupCounterKey, String(counter), 3600);

      const shouldCleanup = (counter % 50 === 0); // Every 50th log entry
      if(shouldCleanup && last > DIAG_PER_DAY){
        const today = (new Date()).toISOString().slice(0,10);
        const lastRow = sh.getLastRow();
        // Fixed: Bug #23 - Check if sheet has more than just header
        if (lastRow > 1) {
          const ts = sh.getRange(2, 1, lastRow - 1, 1).getValues().flat();
          const idx = ts.map((t, i) => String(t).startsWith(today) ? i + 2 : null).filter(Boolean);
          if(idx.length > DIAG_PER_DAY){
            const rowsToDelete = idx.length - DIAG_PER_DAY;
            if (rowsToDelete > 0) {
              sh.deleteRows(idx[0], rowsToDelete);
            }
          }
        }
      }
    } catch (cleanupErr) {
      console.error('Diagnostic cleanup failed:', cleanupErr);
      // Continue execution - don't fail logging due to cleanup error
    }
  } catch(e) {
    console.error('diag_ failed:', e, {level, where, msg, meta});
  }
}

function runSafe(where, fn){
  try{ return fn(); }
  catch(e){
    diag_('error',where,'Exception',{err:String(e),stack:e&&e.stack});
    return Err(ERR.INTERNAL,'Unexpected error');
  }
}

// === CSRF Protection =======================================================
// Fixed: Bug #4 - Add CSRF token generation and validation

function generateCSRFToken_() {
  const token = Utilities.getUuid();
  const cache = CacheService.getUserCache();
  cache.put('csrf_' + token, '1', 3600); // 1 hour expiry
  return token;
}

function validateCSRFToken_(token) {
  if (!token || typeof token !== 'string') return false;

  // Fixed: Bug #4 - Use LockService for atomic check-and-remove to prevent race condition
  const lock = LockService.getUserLock();
  try {
    // Acquire lock with 5 second timeout
    if (!lock.tryLock(5000)) {
      diag_('warn', 'validateCSRFToken_', 'Failed to acquire lock', { token: token.substring(0, 8) + '...' });
      return false;
    }

    const cache = CacheService.getUserCache();
    const valid = cache.get('csrf_' + token);

    if (valid) {
      cache.remove('csrf_' + token); // One-time use (now atomic)
      return true;
    }
    return false;
  } finally {
    // Always release lock
    try {
      lock.releaseLock();
    } catch (e) {
      // Lock might have expired, ignore
    }
  }
}

// === Router ================================================================
function doGet(e){
  const pageParam = (e?.parameter?.page || e?.parameter?.p || '').toString();
  const actionParam = (e?.parameter?.action || '').toString();
  const hostHeader = (e?.headers?.host || e?.parameter?.host || '').toString();
  let tenant = findTenantByHost_(hostHeader) || findTenant_('root');

  // Allow brand parameter to override tenant
  if (e?.parameter?.brand) {
    const brandTenant = findTenant_(e.parameter.brand);
    if (brandTenant) {
      tenant = brandTenant;
    }
  }

  // Demo mode detection (for testing, UAT, demos, and screenshots)
  const demoMode = (e?.parameter?.demo === 'true' || e?.parameter?.test === 'true');

  // ===== Customer-Friendly URL Routing =====
  // Supports patterns like:
  //   /abc/events → brand=abc, page=public
  //   /abc/manage → brand=abc, page=admin, mode=advanced
  //   /events → brand=root, page=public
  //   /display → brand=root, page=display
  const pathInfo = (e?.pathInfo || '').toString().replace(/^\/+|\/+$/g, '');

  if (pathInfo) {
    const pathParts = pathInfo.split('/').filter(p => p);

    // Check if first part is a tenant ID
    let tenantFromPath = null;
    let aliasFromPath = null;

    if (pathParts.length >= 2) {
      // Pattern: /{tenant}/{alias}
      const possibleTenant = findTenant_(pathParts[0]);
      if (possibleTenant) {
        tenantFromPath = possibleTenant;
        aliasFromPath = pathParts[1];
      }
    }

    if (!tenantFromPath && pathParts.length >= 1) {
      // Pattern: /{alias} (use default tenant)
      aliasFromPath = pathParts[0];
    }

    // Resolve alias to page configuration
    if (aliasFromPath) {
      const aliasConfig = resolveUrlAlias_(aliasFromPath, tenantFromPath?.id || tenant.id);

      if (aliasConfig) {
        // Override tenant if specified in path
        if (tenantFromPath) {
          tenant = tenantFromPath;
        }

        // Set page and mode from alias
        const resolvedPage = aliasConfig.page;
        const resolvedMode = aliasConfig.mode;

        // Continue routing with resolved values
        return routePage_(
          e,
          resolvedPage,
          tenant,
          demoMode,
          { mode: resolvedMode, fromAlias: true, alias: aliasFromPath }
        );
      }
    }
  }

  // REST API Routes (for custom frontends)
  if (actionParam) {
    return handleRestApiGet_(e, actionParam, tenant);
  }

  // Shortlink redirect route
  if (pageParam === 'r' || pageParam === 'redirect') {
    const token = (e?.parameter?.t || e?.parameter?.token || '').toString();
    return handleRedirect_(token);
  }

  // API Documentation page
  if (pageParam === 'docs' || pageParam === 'api') {
    // Fixed: Bug #31 - Add security headers
    return HtmlService.createHtmlOutputFromFile('ApiDocs')
      .setTitle('API Documentation - MVP Event Toolkit')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DENY);
  }

  // Status endpoint
  if (pageParam === 'status') {
    const tenantParam = (e?.parameter?.brand || 'root').toString();
    const status = api_status(tenantParam);
    return ContentService.createTextOutput(JSON.stringify(status, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Setup check endpoint - comprehensive diagnostics for first-time setup
  if (pageParam === 'setup' || pageParam === 'setupcheck') {
    const tenantParam = (e?.parameter?.brand || 'root').toString();
    const setupResult = api_setupCheck(tenantParam);
    return ContentService.createTextOutput(JSON.stringify(setupResult, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const path = (e?.pathInfo || '').toString().replace(/^\/+|\/+$/g,'');
  const scope = (e?.parameter?.p || e?.parameter?.scope || 'events').toString();
  const allowed = tenant.scopesAllowed?.length ? tenant.scopesAllowed : ['events','leagues','tournaments'];

  if (!allowed.includes(scope)){
    const first = allowed[0] || 'events';
    return HtmlService.createHtmlOutput(`<meta http-equiv="refresh" content="0;url=?p=${first}&brand=${tenant.id}">`);
  }

  // Admin mode selection: default to wizard for simplicity, allow advanced mode via URL parameter
  let page = (pageParam==='admin' || pageParam==='wizard' || pageParam==='planner' || pageParam==='poster' || pageParam==='test' || pageParam==='display' || pageParam==='report' || pageParam==='analytics' || pageParam==='diagnostics' || pageParam==='sponsor' || pageParam==='sponsor-roi' || pageParam==='signup' || pageParam==='config') ? pageParam : 'public';

  // Route using helper function
  return routePage_(e, page, tenant, demoMode, { mode: e?.parameter?.mode });
}

/**
 * Route to a specific page with tenant and options
 * Centralizes page routing logic for both query params and friendly URLs
 *
 * @param {object} e - Request event object
 * @param {string} page - Page to route to
 * @param {object} tenant - Tenant configuration
 * @param {boolean} demoMode - Demo mode flag
 * @param {object} options - Additional routing options (mode, fromAlias, etc.)
 * @returns {HtmlOutput} - Rendered page
 */
function routePage_(e, page, tenant, demoMode, options = {}) {
  // Route admin to wizard by default (simple mode), unless mode=advanced or mode=enhanced is specified
  if (page === 'admin') {
    const mode = options.mode || '';
    if (mode === 'enhanced') {
      // Use enhanced admin mode with components
      page = 'admin-enhanced';
    } else if (mode !== 'advanced') {
      page = 'wizard'; // Default to wizard (simple mode)
    }
  }

  const scope = (e?.parameter?.p || e?.parameter?.scope || 'events').toString();
  const allowed = tenant.scopesAllowed?.length ? tenant.scopesAllowed : ['events','leagues','tournaments'];

  if (!allowed.includes(scope) && page === 'public'){
    const first = allowed[0] || 'events';
    return HtmlService.createHtmlOutput(`<meta http-equiv="refresh" content="0;url=?p=${first}&brand=${tenant.id}">`);
  }

  const tpl = HtmlService.createTemplateFromFile(pageFile_(page));
  // Fixed: Bug #35 - Sanitize template variables to prevent injection
  tpl.appTitle = sanitizeInput_(`${tenant.name} · ${scope}`, 200);
  tpl.tenantId = sanitizeId_(tenant.id) || tenant.id;
  tpl.scope = sanitizeInput_(scope, 50);
  tpl.execUrl = ScriptApp.getService().getUrl();
  tpl.ZEB = ZEB;
  tpl.demoMode = demoMode; // Pass demo mode flag to templates

  // Pass friendly URL info if routed via alias
  if (options.fromAlias) {
    tpl.friendlyUrl = true;
    tpl.urlAlias = options.alias || '';
  }

  // Fixed: Bug #31 - Add security headers
  return tpl.evaluate()
    .setTitle(`${tpl.appTitle} · ${page}${demoMode ? ' (Demo)' : ''}`)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// === REST API Handler for POST requests ===================================
function doPost(e){
  // Fixed: Bug #22 - Separate try-catch blocks for better error reporting
  let body;
  try {
    body = JSON.parse(e.postData.contents || '{}');
  } catch(jsonErr) {
    return jsonResponse_(Err(ERR.BAD_INPUT, 'Invalid JSON body'));
  }

  try {
    // Fixed: Bug #16 - Validate request origin to prevent unauthorized access
    const origin = e.parameter?.origin || e.headers?.origin || e.headers?.referer;
    if (!isAllowedOrigin_(origin, e.headers)) {
      diag_('warn', 'doPost', 'Unauthorized origin or missing auth headers', {origin});
      return jsonResponse_(Err(ERR.BAD_INPUT, 'Unauthorized origin or missing authentication headers'));
    }

    const action = body.action || e.parameter?.action || '';
    const tenant = findTenantByHost_(e?.headers?.host) || findTenant_('root');

    // Fixed: Bug #4 - CSRF protection for state-changing operations
    const stateChangingActions = ['create', 'update', 'delete', 'updateEventData', 'createShortlink', 'createFormFromTemplate', 'generateFormShortlink'];
    if (stateChangingActions.includes(action)) {
      if (!validateCSRFToken_(body.csrfToken)) {
        return jsonResponse_(Err(ERR.BAD_INPUT, 'Invalid or missing CSRF token. Please refresh the page and try again.'));
      }
    }

    return handleRestApiPost_(e, action, body, tenant);
  } catch(err) {
    diag_('error', 'doPost', 'Request handler failed', {error: String(err), stack: err?.stack});
    return jsonResponse_(Err(ERR.INTERNAL, 'Request processing failed'));
  }
}

// === REST API GET Handler (read-only operations) ==========================
function handleRestApiGet_(e, action, tenant) {
  const tenantId = e.parameter.brand || tenant.id;
  const scope = e.parameter.scope || 'events';
  const etag = e.parameter.etag || '';
  const id = e.parameter.id || '';

  // Public endpoints (no auth required)
  if (action === 'status') {
    return jsonResponse_(api_status(tenantId));
  }

  // Fixed: Bug #4 - CSRF token generation endpoint
  if (action === 'generateCSRFToken') {
    const token = generateCSRFToken_();
    return jsonResponse_(Ok({ csrfToken: token }));
  }

  if (action === 'config') {
    return jsonResponse_(api_getConfig({tenantId, scope, ifNoneMatch: etag}));
  }

  if (action === 'list') {
    return jsonResponse_(api_list({tenantId, scope, ifNoneMatch: etag}));
  }

  if (action === 'get') {
    if (!id) return jsonResponse_(Err(ERR.BAD_INPUT, 'Missing id parameter'));
    return jsonResponse_(api_get({tenantId, scope, id, ifNoneMatch: etag}));
  }

  return jsonResponse_(Err(ERR.BAD_INPUT, `Unknown action: ${action}`));
}

// === REST API POST Handler (write operations, require auth) ===============
function handleRestApiPost_(e, action, body, tenant) {
  const tenantId = body.tenantId || e.parameter?.tenant || tenant.id;
  const scope = body.scope || e.parameter?.scope || 'events';

  // Special case: token generation uses old auth flow
  if (action === 'generateToken') {
    return jsonResponse_(api_generateToken({
      tenantId,
      adminKey: body.adminKey,
      expiresIn: body.expiresIn,
      scope
    }));
  }

  // Check authorization using multi-method authentication
  const authCheck = authenticateRequest_(e, body, tenantId);
  if (!authCheck.ok) {
    return jsonResponse_(authCheck);
  }

  const authenticatedTenant = authCheck.value.tenant;
  const adminKey = body.adminKey || getAdminSecret_(authenticatedTenant.id); // For backward compatibility

  // Route to appropriate API function
  if (action === 'create') {
    return jsonResponse_(api_create({
      tenantId,
      adminKey,
      scope,
      templateId: body.templateId,
      data: body.data
    }));
  }

  if (action === 'update') {
    return jsonResponse_(api_updateEventData({
      tenantId,
      adminKey,
      scope,
      id: body.id,
      data: body.data
    }));
  }

  if (action === 'logEvents') {
    return jsonResponse_(api_logEvents({
      items: body.items || []
    }));
  }

  if (action === 'getReport') {
    return jsonResponse_(api_getReport({
      tenantId,
      adminKey,
      id: body.eventId || '',  // Fixed: Changed eventId to id to match api_getReport
      startDate: body.startDate || '',
      endDate: body.endDate || ''
    }));
  }

  if (action === 'createShortlink') {
    return jsonResponse_(api_createShortlink({
      tenantId,
      adminKey,
      targetUrl: body.targetUrl,
      eventId: body.eventId || '',
      sponsorId: body.sponsorId || '',
      surface: body.surface || ''
    }));
  }

  if (action === 'listFormTemplates') {
    return jsonResponse_(api_listFormTemplates());
  }

  if (action === 'createFormFromTemplate') {
    return jsonResponse_(api_createFormFromTemplate({
      tenantId,
      adminKey,
      templateType: body.templateType,
      eventName: body.eventName || '',
      eventId: body.eventId || ''
    }));
  }

  if (action === 'generateFormShortlink') {
    return jsonResponse_(api_generateFormShortlink({
      tenantId,
      adminKey,
      formUrl: body.formUrl,
      formType: body.formType || '',
      eventId: body.eventId || ''
    }));
  }

  // Brand Portfolio Analytics (Parent Organizations)
  if (action === 'api_getPortfolioSponsorReport') {
    return jsonResponse_(api_getPortfolioSponsorReport({
      tenantId,
      adminKey,
      sponsorId: body.sponsorId || '',
      options: body.options || {}
    }));
  }

  if (action === 'api_getPortfolioSummary') {
    return jsonResponse_(api_getPortfolioSummary({
      tenantId,
      adminKey
    }));
  }

  if (action === 'api_getPortfolioSponsors') {
    return jsonResponse_(api_getPortfolioSponsors({
      tenantId,
      adminKey
    }));
  }

  // Sponsor Configuration Endpoints
  if (action === 'getSponsorSettings' || action === 'api_getSponsorSettings') {
    return jsonResponse_(api_getSponsorSettings({
      tenantId
    }));
  }

  if (action === 'validateSponsorPlacements' || action === 'api_validateSponsorPlacements') {
    return jsonResponse_(api_validateSponsorPlacements({
      tenantId,
      sponsors: body.sponsors || []
    }));
  }

  // Sponsor ROI Dashboard (High-Value Feature)
  if (action === 'getSponsorROI' || action === 'api_getSponsorROI') {
    return jsonResponse_(api_getSponsorROI({
      sponsorId: body.sponsorId || '',
      sponsorshipCost: body.sponsorshipCost || 0,
      costPerClick: body.costPerClick || 0,
      conversionRate: body.conversionRate || 0,
      avgTransactionValue: body.avgTransactionValue || 0,
      dateFrom: body.dateFrom || '',
      dateTo: body.dateTo || '',
      tenantId,
      adminKey
    }));
  }

  // Sponsor Analytics
  if (action === 'getSponsorAnalytics' || action === 'api_getSponsorAnalytics') {
    return jsonResponse_(api_getSponsorAnalytics({
      sponsorId: body.sponsorId || '',
      eventId: body.eventId || '',
      dateFrom: body.dateFrom || '',
      dateTo: body.dateTo || '',
      tenantId,
      adminKey
    }));
  }

  // Webhook Management Endpoints
  if (action === 'registerWebhook' || action === 'api_registerWebhook') {
    return jsonResponse_(WebhookService_register({
      tenantId,
      adminKey,
      eventType: body.eventType || '',
      url: body.url || '',
      secret: body.secret || '',
      enabled: body.enabled,
      filters: body.filters
    }));
  }

  if (action === 'unregisterWebhook' || action === 'api_unregisterWebhook') {
    return jsonResponse_(WebhookService_unregister({
      tenantId,
      adminKey,
      webhookId: body.webhookId || ''
    }));
  }

  if (action === 'listWebhooks' || action === 'api_listWebhooks') {
    return jsonResponse_(WebhookService_list({
      tenantId,
      adminKey
    }));
  }

  if (action === 'testWebhook' || action === 'api_testWebhook') {
    return jsonResponse_(WebhookService_test({
      tenantId,
      adminKey,
      webhookId: body.webhookId || ''
    }));
  }

  if (action === 'getWebhookDeliveries' || action === 'api_getWebhookDeliveries') {
    return jsonResponse_(WebhookService_getDeliveries({
      tenantId,
      adminKey,
      webhookId: body.webhookId || '',
      limit: body.limit || 50
    }));
  }

  // i18n (Internationalization) Endpoints
  if (action === 'translate' || action === 'api_translate') {
    return jsonResponse_(api_translate({
      key: body.key || '',
      locale: body.locale || '',
      params: body.params || {}
    }));
  }

  if (action === 'getSupportedLocales' || action === 'api_getSupportedLocales') {
    return jsonResponse_(i18n_getSupportedLocales());
  }

  if (action === 'setUserLocale' || action === 'api_setUserLocale') {
    return jsonResponse_(i18n_setUserLocale(body.locale || ''));
  }

  // Template Management Endpoints
  if (action === 'getTemplate' || action === 'api_getTemplate') {
    return jsonResponse_(api_getTemplate({
      templateId: body.templateId || '',
      locale: body.locale || ''
    }));
  }

  if (action === 'listTemplates' || action === 'api_listTemplates') {
    return jsonResponse_(api_listTemplates({
      category: body.category || '',
      locale: body.locale || '',
      includeDeprecated: body.includeDeprecated || false
    }));
  }

  if (action === 'validateTemplateData' || action === 'api_validateTemplateData') {
    return jsonResponse_(api_validateTemplateData({
      templateId: body.templateId || '',
      data: body.data || {},
      locale: body.locale || ''
    }));
  }

  return jsonResponse_(Err(ERR.BAD_INPUT, `Unknown action: ${action}`));
}

// === Origin Validation =====================================================
// Fixed: Bug #16 - Add origin validation to prevent unauthorized API access
function isAllowedOrigin_(origin, authHeaders) {
  // Fixed: Bug #16 Part 2 - Requests without origin (curl, Postman, server-to-server)
  // must have authentication headers (JWT token or Authorization header)
  if (!origin) {
    // Non-browser requests must provide authentication
    const hasAuth = authHeaders && (
      authHeaders.authorization ||
      authHeaders.Authorization ||
      authHeaders['x-api-key'] ||
      authHeaders['X-API-Key']
    );

    if (!hasAuth) {
      diag_('warn', 'isAllowedOrigin_', 'Non-browser request without auth headers', {});
      return false;
    }

    // Has auth headers, allow to proceed to authentication layer
    return true;
  }

  try {
    const originUrl = new URL(origin);
    const originHost = originUrl.hostname.toLowerCase();

    // Allow localhost for development
    if (originHost === 'localhost' || originHost === '127.0.0.1') {
      return true;
    }

    // Check against tenant hostnames
    for (const tenant of TENANTS) {
      if (tenant.hostnames && tenant.hostnames.some(h => h.toLowerCase() === originHost)) {
        return true;
      }
    }

    // Allow script.google.com for Apps Script frontends
    if (originHost.endsWith('.google.com')) {
      return true;
    }

    return false;
  } catch (e) {
    diag_('warn', 'isAllowedOrigin_', 'Invalid origin URL', {origin, error: String(e)});
    return false;
  }
}

// === JSON Response Helper with CORS =======================================
function jsonResponse_(data) {
  const output = ContentService.createTextOutput(JSON.stringify(data, null, 2))
    .setMimeType(ContentService.MimeType.JSON);

  // CORS headers are automatically handled by Apps Script
  // Origin validation is performed in doPost/doGet handlers
  return output;
}

function pageFile_(page){
  if (page==='admin') return 'Admin';
  if (page==='admin-enhanced') return 'AdminEnhanced';
  if (page==='wizard') return 'AdminWizard';
  if (page==='planner') return 'PlannerCards';
  if (page==='poster') return 'Poster';
  if (page==='test') return 'Test';
  if (page==='display') return 'Display';
  if (page==='report' || page==='analytics') return 'SharedReport';
  if (page==='diagnostics') return 'Diagnostics';
  if (page==='sponsor') return 'Sponsor';
  if (page==='sponsor-roi') return 'SponsorDashboard';
  if (page==='signup') return 'Signup';
  if (page==='config') return 'ConfigHtml';
  return 'Public';
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// === Shortlink redirect handler ============================================
function handleRedirect_(token) {
  if (!token) {
    return HtmlService.createHtmlOutput('<h1>Invalid shortlink</h1>');
  }

  // Use root tenant spreadsheet for shortlinks
  const rootTenant = findTenant_('root');
  if (!rootTenant || !rootTenant.store || !rootTenant.store.spreadsheetId) {
    return HtmlService.createHtmlOutput('<h1>Configuration error</h1>');
  }

  const spreadsheetId = rootTenant.store.spreadsheetId;
  const ss = SpreadsheetApp.openById(spreadsheetId);
  let sh = ss.getSheetByName('SHORTLINKS');
  if (!sh) {
    return HtmlService.createHtmlOutput('<h1>Shortlink not found</h1>');
  }

  const rows = sh.getDataRange().getValues().slice(1);
  const row = rows.find(r => r[0] === token);

  if (!row) {
    diag_('warn', 'handleRedirect_', 'Token not found', {token}, spreadsheetId);
    return HtmlService.createHtmlOutput('<h1>Shortlink not found</h1>');
  }

  // Fixed: Bug #53 - Extract tenantId for validation (7th column if present)
  const [tok, targetUrl, eventId, sponsorId, surface, createdAt, shortlinkTenantId] = row;

  // Fixed: Bug #52 - Validate URL before redirect to prevent XSS
  if (!isUrl(targetUrl)) {
    diag_('error', 'handleRedirect_', 'Invalid URL in shortlink', {token, targetUrl}, spreadsheetId);
    return HtmlService.createHtmlOutput('<h1>Invalid shortlink URL</h1>');
  }

  // Additional validation: ensure HTTP(S) only
  try {
    const url = new URL(targetUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      diag_('error', 'handleRedirect_', 'Non-HTTP protocol in shortlink', {token, protocol: url.protocol}, spreadsheetId);
      return HtmlService.createHtmlOutput('<h1>Invalid shortlink protocol</h1>');
    }
  } catch(e) {
    diag_('error', 'handleRedirect_', 'URL parsing failed', {token, targetUrl, error: String(e)}, spreadsheetId);
    return HtmlService.createHtmlOutput('<h1>Invalid shortlink URL</h1>');
  }

  // Log analytics
  try {
    api_logEvents({
      items: [{
        eventId: eventId || '',
        surface: surface || 'shortlink',
        metric: 'click',
        sponsorId: sponsorId || '',
        token: tok
      }]
    });
  } catch(e) {
    diag_('warn', 'handleRedirect_', 'Analytics log failed', {error: String(e)}, spreadsheetId);
  }

  diag_('info', 'handleRedirect_', 'Redirect', {token, targetUrl, eventId, sponsorId}, spreadsheetId);

  // Fixed: Bug #1 - Add warning page for external redirects to prevent phishing
  const url = new URL(targetUrl);
  const hostname = url.hostname.toLowerCase();

  // Check if this is an external domain (not a known tenant domain)
  let isExternal = true;
  for (const tenant of TENANTS) {
    if (tenant.hostnames && tenant.hostnames.some(h => h.toLowerCase() === hostname)) {
      isExternal = false;
      break;
    }
  }

  // Use sanitized URL - escape it for HTML context
  const escapedUrl = String(targetUrl)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

  // If external domain, show warning page
  if (isExternal) {
    return HtmlService.createHtmlOutput(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>External Link Warning</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
          .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 20px; border-radius: 5px; }
          .url { word-break: break-all; background: #f5f5f5; padding: 10px; margin: 10px 0; border-radius: 3px; }
          .buttons { margin-top: 20px; }
          button { padding: 10px 20px; margin-right: 10px; cursor: pointer; }
          .continue { background: #007bff; color: white; border: none; border-radius: 3px; }
          .cancel { background: #6c757d; color: white; border: none; border-radius: 3px; }
        </style>
      </head>
      <body>
        <div class="warning">
          <h2>⚠️ External Link Warning</h2>
          <p>You are about to leave this site and visit an external website:</p>
          <div class="url">${escapedUrl}</div>
          <p><strong>Warning:</strong> We cannot guarantee the safety or content of external websites. Proceed with caution.</p>
          <div class="buttons">
            <button class="continue" onclick="window.location.href='${escapedUrl}'">Continue to External Site</button>
            <button class="cancel" onclick="window.close()">Cancel</button>
          </div>
        </div>
      </body>
      </html>
    `);
  }

  // Internal redirect - proceed immediately
  return HtmlService.createHtmlOutput(`
    <meta http-equiv="refresh" content="0;url=${escapedUrl}">
    <p>Redirecting...</p>
  `);
}

// === Authentication & Authorization ========================================

/**
 * Multi-method authentication support:
 * 1. adminKey (legacy) - Simple secret key
 * 2. Bearer token (JWT) - Stateless token-based auth
 * 3. API Key (header) - X-API-Key header
 */
function authenticateRequest_(e, body, tenantId) {
  const tenant = findTenant_(tenantId);
  if (!tenant) {
    return Err(ERR.NOT_FOUND, 'Unknown tenant');
  }

  // Method 1: adminKey in body (legacy, backward compatible)
  const adminKey = body?.adminKey || e?.parameter?.adminKey || '';
  const tenantSecret = getAdminSecret_(tenant.id);
  if (adminKey && tenantSecret && adminKey === tenantSecret) {
    return Ok({ tenant, method: 'adminKey' });
  }

  // Method 2: Bearer token (JWT)
  const authHeader = e?.headers?.Authorization || e?.headers?.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const jwtResult = verifyJWT_(token, tenant);
    if (jwtResult.ok) {
      return Ok({ tenant, method: 'jwt', claims: jwtResult.value });
    }
  }

  // Method 3: API Key in header
  const apiKey = e?.headers?.['X-API-Key'] || e?.headers?.['x-api-key'] || '';
  const tenantApiSecret = getAdminSecret_(tenant.id);
  if (apiKey && tenantApiSecret && apiKey === tenantApiSecret) {
    return Ok({ tenant, method: 'apiKey' });
  }

  // No valid authentication found
  return Err(ERR.BAD_INPUT, 'Invalid authentication credentials');
}

/**
 * Simple JWT verification (for demonstration)
 * In production, use a proper JWT library or Google's OAuth
 */
// Fixed: Bug #2 - Add algorithm verification to prevent "none" algorithm attack
/**
 * Timing-safe string comparison to prevent timing attacks
 * Returns true if strings are equal, false otherwise
 * Always takes constant time regardless of where strings differ
 */
function timingSafeCompare_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  // Different lengths = not equal, but still compare all bytes to maintain constant time
  const aLen = a.length;
  const bLen = b.length;
  let result = aLen === bLen ? 0 : 1;

  // Compare all bytes, using modulo to handle different lengths
  const maxLen = Math.max(aLen, bLen);
  for (let i = 0; i < maxLen; i++) {
    const aChar = i < aLen ? a.charCodeAt(i) : 0;
    const bChar = i < bLen ? b.charCodeAt(i) : 0;
    result |= aChar ^ bChar;
  }

  return result === 0;
}

function verifyJWT_(token, tenant) {
  try {
    // Simple validation: decode base64 payload
    const parts = token.split('.');
    if (parts.length !== 3) {
      return Err(ERR.BAD_INPUT, 'Invalid JWT format');
    }

    // Verify algorithm in header (prevent "none" algorithm attack)
    let header;
    try {
      header = JSON.parse(Utilities.newBlob(Utilities.base64Decode(parts[0])).getDataAsString());
    } catch (e) {
      return Err(ERR.BAD_INPUT, 'Invalid JWT header');
    }

    // Only allow HS256 algorithm
    if (!header.alg || header.alg !== 'HS256') {
      diag_('error', 'verifyJWT_', 'Invalid algorithm', {alg: header.alg});
      return Err(ERR.BAD_INPUT, 'Invalid JWT algorithm');
    }

    const payload = JSON.parse(Utilities.newBlob(Utilities.base64Decode(parts[1])).getDataAsString());

    // Verify tenant
    if (payload.tenant !== tenant.id) {
      return Err(ERR.BAD_INPUT, 'Token tenant mismatch');
    }

    // Verify expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return Err(ERR.BAD_INPUT, 'Token expired');
    }

    // Verify signature (simplified - use proper crypto in production)
    const tenantSecret = getAdminSecret_(tenant.id);
    if (!tenantSecret) {
      return UserFriendlyErr_(ERR.INTERNAL, 'Tenant secret not configured', { tenantId: tenant.id }, 'verifyJWT_');
    }
    const expectedSignature = generateJWTSignature_(parts[0] + '.' + parts[1], tenantSecret);

    // Timing-safe comparison to prevent timing attacks
    if (!timingSafeCompare_(parts[2], expectedSignature)) {
      return Err(ERR.BAD_INPUT, 'Invalid token signature');
    }

    // Verify not-before if present
    if (payload.nbf && payload.nbf > now) {
      return Err(ERR.BAD_INPUT, 'Token not yet valid');
    }

    return Ok(payload);
  } catch (e) {
    return UserFriendlyErr_(ERR.BAD_INPUT, 'Invalid JWT verification', { error: e.message }, 'verifyJWT_');
  }
}

/**
 * Generate JWT token for a tenant (for demo/testing)
 */
function api_generateToken(req) {
  const authCheck = gate_(req.tenantId, req.adminKey);
  if (!authCheck.ok) return authCheck;

  const tenant = authCheck.value.tenant;
  const expiresIn = req.expiresIn || 3600; // 1 hour default

  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const payload = {
    tenant: tenant.id,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresIn,
    scope: req.scope || 'events'
  };

  const headerB64 = Utilities.base64EncodeWebSafe(JSON.stringify(header));
  const payloadB64 = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  const tenantSecret = getAdminSecret_(tenant.id);
  if (!tenantSecret) {
    return UserFriendlyErr_(ERR.INTERNAL, 'Tenant secret not configured', { tenantId: tenant.id }, 'api_generateToken');
  }
  const signature = generateJWTSignature_(headerB64 + '.' + payloadB64, tenantSecret);

  const token = headerB64 + '.' + payloadB64 + '.' + signature;

  return Ok({
    token,
    expiresIn,
    expiresAt: new Date((payload.exp * 1000)).toISOString(),
    usage: `Authorization: Bearer ${token}`
  });
}

function generateJWTSignature_(data, secret) {
  const signature = Utilities.computeHmacSha256Signature(data, secret);
  return Utilities.base64EncodeWebSafe(signature);
}

// === Guards / Helpers ======================================================
// Fixed: Bug #18 - Improved rate limiting with IP tracking and backoff
const RATE_MAX_PER_MIN = 10; // Reduced from 20
const RATE_LOCKOUT_MINS = 15;
const MAX_FAILED_AUTH = 5;

function gate_(tenantId, adminKey, ipAddress = null){
  const tenant=findTenant_(tenantId);
  if(!tenant) return Err(ERR.NOT_FOUND,'Unknown tenant');

  const tenantSecret = getAdminSecret_(tenant.id);
  const cache = CacheService.getScriptCache();

  // Track failed authentication attempts per IP
  if (tenantSecret && adminKey !== tenantSecret) {
    if (ipAddress) {
      const failKey = `auth_fail:${tenantId}:${ipAddress}`;
      const fails = Number(cache.get(failKey) || '0');

      if (fails >= MAX_FAILED_AUTH) {
        return Err(ERR.RATE_LIMITED, `Too many failed authentication attempts. Try again in ${RATE_LOCKOUT_MINS} minutes.`);
      }

      cache.put(failKey, String(fails + 1), RATE_LOCKOUT_MINS * 60); // 15 min lockout
    }
    return Err(ERR.BAD_INPUT,'Invalid admin key');
  }

  // Rate limiting per tenant AND per IP (if available)
  const identifier = ipAddress ? `${tenantId}:${ipAddress}` : tenantId;
  const rateKey = `rate:${identifier}:${new Date().toISOString().slice(0,16)}`;
  const n = Number(cache.get(rateKey)||'0');
  if (n >= RATE_MAX_PER_MIN) return Err(ERR.RATE_LIMITED,'Too many requests. Please try again later.');
  cache.put(rateKey, String(n+1), 60);

  return Ok({tenant});
}

function assertScopeAllowed_(tenant, scope){
  const allowed = (tenant.scopesAllowed && tenant.scopesAllowed.length)
    ? tenant.scopesAllowed : ['events','leagues','tournaments'];
  if (!allowed.includes(scope)) {
    return UserFriendlyErr_(ERR.BAD_INPUT, `Scope not enabled: ${scope}`, { scope, tenantId: tenant.id, allowedScopes: allowed }, 'assertScopeAllowed_');
  }
  return Ok();
}

// Fixed: Bug #32 - Comprehensive URL validation
function isUrl(s, maxLength = 2048) {
  if (!s || typeof s !== 'string') return false;

  const urlStr = String(s);

  // Length check
  if (urlStr.length > maxLength) return false;

  try {
    const url = new URL(urlStr);

    // Only allow http/https protocols
    if (!['http:', 'https:'].includes(url.protocol)) {
      return false;
    }

    // Blocklist dangerous patterns
    const dangerous = ['javascript:', 'data:', 'vbscript:', 'file:'];
    if (dangerous.some(d => urlStr.toLowerCase().includes(d))) {
      return false;
    }

    // Prevent SSRF - block private IPs and localhost
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.startsWith('127.') ||
        hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('172.16.') ||
        hostname.startsWith('172.17.') ||
        hostname.startsWith('172.18.') ||
        hostname.startsWith('172.19.') ||
        hostname.startsWith('172.20.') ||
        hostname.startsWith('172.21.') ||
        hostname.startsWith('172.22.') ||
        hostname.startsWith('172.23.') ||
        hostname.startsWith('172.24.') ||
        hostname.startsWith('172.25.') ||
        hostname.startsWith('172.26.') ||
        hostname.startsWith('172.27.') ||
        hostname.startsWith('172.28.') ||
        hostname.startsWith('172.29.') ||
        hostname.startsWith('172.30.') ||
        hostname.startsWith('172.31.') ||
        hostname.startsWith('169.254.')) { // Link-local
      return false;
    }

    return true;
  } catch(_) {
    return false;
  }
}

// Fixed: Bug #28 - Safe JSON parsing helper
function safeJSONParse_(jsonString, defaultValue = {}) {
  try {
    return JSON.parse(jsonString || '{}');
  } catch (e) {
    diag_('error', 'safeJSONParse_', 'JSON parse failed', {
      error: e.message,
      jsonString: String(jsonString).slice(0, 200)
    });
    return defaultValue;
  }
}

// Fixed: Bug #14 - Comprehensive input sanitization with context-aware escaping
function sanitizeInput_(input, maxLength = 1000) {
  if (!input || typeof input !== 'string') return '';

  let sanitized = String(input)
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width characters
    .trim();

  // Remove dangerous characters and patterns
  sanitized = sanitized
    .replace(/[<>"'`&]/g, '') // Remove HTML special chars and backticks
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/data:/gi, '') // Remove data: protocol
    .replace(/vbscript:/gi, ''); // Remove vbscript: protocol

  // Remove event handlers - use loop to prevent bypass via nesting (e.g., ononclick==)
  // This addresses CodeQL warning: Incomplete multi-character sanitization
  let previousLength;
  do {
    previousLength = sanitized.length;
    sanitized = sanitized.replace(/on\w+=/gi, '');
  } while (sanitized.length !== previousLength);

  // Remove encoding attempts
  sanitized = sanitized
    .replace(/&#/g, '') // Remove HTML entity encoding
    .replace(/\\x/g, '') // Remove hex encoding
    .replace(/\\u/g, ''); // Remove unicode encoding

  return sanitized.slice(0, maxLength);
}

// Fixed: Bug #19 - Add ID format validation
function sanitizeId_(id) {
  if (!id || typeof id !== 'string') return null;
  // Ensure ID is valid UUID format or safe alphanumeric string
  if (!/^[a-zA-Z0-9-_]{1,100}$/.test(id)) return null;
  return id;
}

// Fixed: Bug #29 - Sanitize spreadsheet values to prevent formula injection
function sanitizeSpreadsheetValue_(value) {
  if (!value) return '';

  const str = String(value);

  // Prevent formula injection: strip leading special chars
  const dangerous = ['=', '+', '-', '@', '\t', '\r', '\n'];
  let sanitized = str;

  // If starts with dangerous char, prefix with single quote to treat as text
  while (dangerous.some(char => sanitized.startsWith(char))) {
    sanitized = "'" + sanitized;
  }

  return sanitized;
}

function getStoreSheet_(tenant, scope){
  const ss = SpreadsheetApp.openById(tenant.store.spreadsheetId);
  const title = scope.toUpperCase();
  let sh = ss.getSheetByName(title);
  if (!sh){
    sh = ss.insertSheet(title);
    sh.appendRow(['id','tenantId','templateId','dataJSON','createdAt','slug']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function _ensureAnalyticsSheet_(spreadsheetId){
  // If no spreadsheet ID provided, use root tenant
  if (!spreadsheetId) {
    const rootTenant = findTenant_('root');
    if (rootTenant && rootTenant.store && rootTenant.store.spreadsheetId) {
      spreadsheetId = rootTenant.store.spreadsheetId;
    }
  }

  const ss = spreadsheetId
    ? SpreadsheetApp.openById(spreadsheetId)
    : SpreadsheetApp.getActive();

  let sh = ss.getSheetByName('ANALYTICS');
  if (!sh){
    sh = ss.insertSheet('ANALYTICS');
    sh.appendRow(['timestamp','eventId','surface','metric','sponsorId','value','token','userAgent']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function _ensureShortlinksSheet_(spreadsheetId){
  // If no spreadsheet ID provided, use root tenant
  if (!spreadsheetId) {
    const rootTenant = findTenant_('root');
    if (rootTenant && rootTenant.store && rootTenant.store.spreadsheetId) {
      spreadsheetId = rootTenant.store.spreadsheetId;
    }
  }

  const ss = spreadsheetId
    ? SpreadsheetApp.openById(spreadsheetId)
    : SpreadsheetApp.getActive();

  let sh = ss.getSheetByName('SHORTLINKS');
  if (!sh){
    sh = ss.insertSheet('SHORTLINKS');
    sh.appendRow(['token','targetUrl','eventId','sponsorId','surface','createdAt']);
    sh.setFrozenRows(1);
  }
  return sh;
}

// === APIs (uniform envelopes + SWR) =======================================

function api_status(tenantId){
  return runSafe('api_status', () => {
    try {
      // Get tenant info if provided
      const tenant = tenantId ? findTenant_(tenantId) : findTenant_('root');
      if (!tenant) {
        return Err(ERR.NOT_FOUND, `Tenant not found: ${tenantId}`);
      }

      const tenantInfo = tenant.id;

      // Use tenant's spreadsheet ID instead of getActive() for web app context
      const ss = SpreadsheetApp.openById(tenant.store.spreadsheetId);
      const id = ss.getId();
      const dbOk = !!id;

      return _ensureOk_('api_status', SC_STATUS, Ok({
        build: ZEB.BUILD_ID,
        contract: ZEB.CONTRACT_VER,
        tenant: tenantInfo,
        time: new Date().toISOString(),
        db: { ok: dbOk, id }
      }));
    } catch(e) {
      // Enhanced error handling with setup guidance
      const errorMsg = String(e.message || e);
      const setupUrl = ScriptApp.getService().getUrl() + '?p=setup';

      if (errorMsg.includes('not found') || errorMsg.includes('does not exist')) {
        return Err(ERR.INTERNAL,
          `Spreadsheet not found or inaccessible. Please check:\n` +
          `1. Spreadsheet ID is correct: ${tenant.store.spreadsheetId}\n` +
          `2. Script owner has access to the spreadsheet\n` +
          `3. Run setup check: ${setupUrl}`
        );
      }

      if (errorMsg.includes('permission') || errorMsg.includes('authorization')) {
        return Err(ERR.INTERNAL,
          `Permission denied accessing spreadsheet. Please:\n` +
          `1. Ensure script owner can edit the spreadsheet\n` +
          `2. Check OAuth scopes include spreadsheets access\n` +
          `3. Re-authorize the deployment if needed`
        );
      }

      return Err(ERR.INTERNAL,
        `Status check failed: ${errorMsg}\n` +
        `Run setup diagnostics: ${setupUrl}`
      );
    }
  });
}

/**
 * Comprehensive setup verification endpoint for first-time configuration
 * Checks all critical setup requirements and provides actionable guidance
 */
function api_setupCheck(tenantId) {
  return runSafe('api_setupCheck', () => {
    const checks = [];
    const issues = [];
    const warnings = [];
    const fixes = [];

    const tenant = tenantId ? findTenant_(tenantId) : findTenant_('root');
    if (!tenant) {
      return Err(ERR.NOT_FOUND, `Tenant not found: ${tenantId || 'root'}`);
    }

    // Check 1: Tenant Configuration
    checks.push({ name: 'Tenant Configuration', status: 'checking' });
    try {
      if (!tenant.id || !tenant.name || !tenant.store) {
        issues.push('Tenant configuration incomplete');
        fixes.push('Verify tenant configuration in Config.gs');
        checks[0].status = 'error';
      } else {
        checks[0].status = 'ok';
        checks[0].details = `Tenant: ${tenant.name} (${tenant.id})`;
      }
    } catch(e) {
      checks[0].status = 'error';
      checks[0].error = String(e.message);
    }

    // Check 2: Spreadsheet Access
    checks.push({ name: 'Spreadsheet Access', status: 'checking' });
    try {
      const spreadsheetId = tenant.store.spreadsheetId;
      if (!spreadsheetId) {
        issues.push('Spreadsheet ID not configured');
        fixes.push('Set spreadsheetId in Config.gs for tenant: ' + tenant.id);
        checks[1].status = 'error';
      } else {
        try {
          const ss = SpreadsheetApp.openById(spreadsheetId);
          const name = ss.getName();
          const id = ss.getId();
          checks[1].status = 'ok';
          checks[1].details = `Connected to: "${name}" (${id})`;

          // Verify ownership/edit access
          try {
            ss.getSheetByName('TEST_PERMISSIONS');
            const testSheet = ss.insertSheet('TEST_PERMISSIONS');
            ss.deleteSheet(testSheet);
            checks[1].permissions = 'owner/editor';
          } catch(permErr) {
            warnings.push('Limited spreadsheet permissions - may affect some operations');
            checks[1].permissions = 'viewer/limited';
          }

        } catch(accessErr) {
          const errMsg = String(accessErr.message);
          checks[1].status = 'error';
          checks[1].error = errMsg;

          if (errMsg.includes('not found')) {
            issues.push(`Spreadsheet not found: ${spreadsheetId}`);
            fixes.push('Update spreadsheetId in Config.gs with a valid Google Sheets ID');
            fixes.push('Ensure spreadsheet ID is from URL: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit');
          } else if (errMsg.includes('permission')) {
            issues.push('No permission to access spreadsheet');
            fixes.push('Share the spreadsheet with script owner (zeventbook@gmail.com)');
            fixes.push('Grant at least "Editor" access to the spreadsheet');
          } else {
            issues.push('Cannot access spreadsheet: ' + errMsg);
            fixes.push('Verify spreadsheet ID and permissions');
          }
        }
      }
    } catch(e) {
      checks[1].status = 'error';
      checks[1].error = String(e.message);
    }

    // Check 3: Admin Secrets
    checks.push({ name: 'Admin Secrets', status: 'checking' });
    try {
      const secret = getAdminSecret_(tenant.id);
      if (!secret) {
        warnings.push(`Admin secret not set for tenant: ${tenant.id}`);
        fixes.push(`Set admin secret via Script Properties: ADMIN_SECRET_${tenant.id.toUpperCase()}`);
        fixes.push('Go to: Project Settings > Script Properties > Add property');
        checks[2].status = 'warning';
        checks[2].details = 'Not configured (write operations will fail)';
      } else {
        checks[2].status = 'ok';
        checks[2].details = 'Configured (length: ' + secret.length + ' chars)';
      }
    } catch(e) {
      checks[2].status = 'error';
      checks[2].error = String(e.message);
    }

    // Check 4: Deployment Settings
    checks.push({ name: 'Deployment Configuration', status: 'checking' });
    try {
      const deploymentUrl = ScriptApp.getService().getUrl();
      if (!deploymentUrl) {
        issues.push('No active deployment found');
        fixes.push('Deploy as Web App: Deploy > New deployment');
        fixes.push('Set: Execute as = Me, Who has access = Anyone');
        checks[3].status = 'error';
      } else {
        checks[3].status = 'ok';
        checks[3].details = deploymentUrl;

        // Check if deployment is accessible
        try {
          const isAnonymous = ScriptApp.getService().isEnabled();
          checks[3].access = isAnonymous ? 'anonymous' : 'requires-auth';

          if (!isAnonymous) {
            warnings.push('Deployment may require authentication');
            fixes.push('Edit deployment: Who has access = Anyone');
          }
        } catch(e) {
          // Can't determine access level
        }
      }
    } catch(e) {
      checks[3].status = 'error';
      checks[3].error = String(e.message);
    }

    // Check 5: OAuth Scopes
    checks.push({ name: 'OAuth Scopes', status: 'checking' });
    try {
      // Try to access services to verify scopes
      const scopeTests = [];

      // Spreadsheets scope
      try {
        SpreadsheetApp.getActiveSpreadsheet();
        scopeTests.push({ scope: 'spreadsheets', ok: true });
      } catch(e) {
        if (tenant.store.spreadsheetId) {
          try {
            SpreadsheetApp.openById(tenant.store.spreadsheetId);
            scopeTests.push({ scope: 'spreadsheets', ok: true });
          } catch(e2) {
            scopeTests.push({ scope: 'spreadsheets', ok: false, error: 'Permission denied' });
          }
        }
      }

      // External requests scope
      try {
        UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
        scopeTests.push({ scope: 'external_request', ok: true });
      } catch(e) {
        scopeTests.push({ scope: 'external_request', ok: false, error: String(e.message) });
      }

      const failedScopes = scopeTests.filter(t => !t.ok);
      if (failedScopes.length > 0) {
        warnings.push('Some OAuth scopes may not be authorized');
        fixes.push('Re-authorize deployment to grant all permissions');
        checks[4].status = 'warning';
        checks[4].details = scopeTests;
      } else {
        checks[4].status = 'ok';
        checks[4].details = 'All required scopes authorized';
      }
    } catch(e) {
      checks[4].status = 'error';
      checks[4].error = String(e.message);
    }

    // Check 6: Required Sheets Structure
    checks.push({ name: 'Database Structure', status: 'checking' });
    try {
      if (checks[1].status === 'ok') {
        const ss = SpreadsheetApp.openById(tenant.store.spreadsheetId);
        const existingSheets = ss.getSheets().map(s => s.getName());

        const requiredSheets = ['EVENTS', 'SPONSORS', 'ANALYTICS', 'SHORTLINKS', 'DIAG'];
        const missingSheets = requiredSheets.filter(name => !existingSheets.includes(name));

        if (missingSheets.length > 0) {
          warnings.push('Some data sheets will be auto-created on first use');
          checks[5].status = 'warning';
          checks[5].details = `Missing sheets: ${missingSheets.join(', ')}`;
          checks[5].note = 'These will be created automatically when needed';
        } else {
          checks[5].status = 'ok';
          checks[5].details = 'All required sheets present';
        }
      } else {
        checks[5].status = 'skipped';
        checks[5].details = 'Spreadsheet not accessible';
      }
    } catch(e) {
      checks[5].status = 'warning';
      checks[5].error = String(e.message);
    }

    // Determine overall status
    const hasErrors = checks.some(c => c.status === 'error');
    const hasWarnings = checks.some(c => c.status === 'warning');

    let overallStatus = 'ok';
    let message = 'All setup checks passed! System is ready to use.';

    if (hasErrors) {
      overallStatus = 'error';
      message = `Setup incomplete. Found ${issues.length} critical issue(s) that must be fixed.`;
    } else if (hasWarnings) {
      overallStatus = 'warning';
      message = `Setup mostly complete. Found ${warnings.length} warning(s) that should be addressed.`;
    }

    return Ok({
      status: overallStatus,
      message,
      tenant: tenant.id,
      timestamp: new Date().toISOString(),
      checks,
      issues,
      warnings,
      fixes,
      nextSteps: fixes.length > 0 ? fixes : [
        'Your setup is complete!',
        'Test the API: ' + ScriptApp.getService().getUrl() + '?p=status&brand=' + tenant.id,
        'View documentation: ' + ScriptApp.getService().getUrl() + '?p=docs'
      ]
    });
  });
}

function api_healthCheck(){
  return runSafe('api_healthCheck', () => {
    diag_('info','health','ping',{build:ZEB.BUILD_ID});
    return Ok({ checks:[{ ok:true, message:'alive' }] });
  });
}

function api_getConfig(arg){
  return runSafe('api_getConfig', () => {
    const tenants = loadTenants_().map(t => ({
      id:t.id, name:t.name, scopesAllowed:t.scopesAllowed||['events','leagues','tournaments']
    }));
    const value = { tenants, templates:TEMPLATES, build:ZEB.BUILD_ID };
    const etag = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(value)));
    if (arg?.ifNoneMatch === etag) return { ok:true, notModified:true, etag };
    return { ok:true, etag, value };
  });
}

// Fixed: Bug #50 - Add pagination support to prevent loading all rows
function api_list(payload){
  return runSafe('api_list', () => {
    const { tenantId, scope, limit, offset } = payload||{};
    const tenant=findTenant_(tenantId); if(!tenant) return Err(ERR.NOT_FOUND,'Unknown tenant');
    const a=assertScopeAllowed_(tenant, scope); if(!a.ok) return a;

    // Pagination parameters (default: 100 items per page, max 1000)
    const pageLimit = Math.min(parseInt(limit) || 100, 1000);
    const pageOffset = Math.max(parseInt(offset) || 0, 0);

    const sh = getStoreSheet_(tenant, scope);
    // Fixed: Bug #24 - Check if sheet has more than just header before getRange
    const lastRow = sh.getLastRow();

    // Load and filter rows (Apps Script doesn't support query-level filtering)
    const allRows = lastRow > 1
      ? sh.getRange(2, 1, lastRow - 1, 6).getValues()
          .filter(r => r[1]===tenantId)
      : [];

    // Apply pagination after filtering
    const totalCount = allRows.length;
    const paginatedRows = allRows
      .slice(pageOffset, pageOffset + pageLimit)
      .map(r => ({ id:r[0], templateId:r[2], data:safeJSONParse_(r[3], {}), createdAt:r[4], slug:r[5] }));

    const value = {
      items: paginatedRows,
      pagination: {
        total: totalCount,
        limit: pageLimit,
        offset: pageOffset,
        hasMore: (pageOffset + pageLimit) < totalCount
      }
    };

    const etag = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(value)));
    if (payload?.ifNoneMatch === etag) return { ok:true, notModified:true, etag };
    return _ensureOk_('api_list', SC_LIST, { ok:true, etag, value });
  });
}

function api_get(payload){
  return runSafe('api_get', () => {
    const { tenantId, scope, id } = payload||{};

    // Fixed: Bug #19 - Validate ID format
    const sanitizedId = sanitizeId_(id);
    if (!sanitizedId) return Err(ERR.BAD_INPUT, 'Invalid ID format');

    const tenant=findTenant_(tenantId); if(!tenant) return Err(ERR.NOT_FOUND,'Unknown tenant');
    const a=assertScopeAllowed_(tenant, scope); if(!a.ok) return a;
    const sh = getStoreSheet_(tenant, scope);
    const r = sh.getDataRange().getValues().slice(1).find(row => row[0]===sanitizedId && row[1]===tenantId);
    if (!r) return Err(ERR.NOT_FOUND,'Not found');

    const base = ScriptApp.getService().getUrl();
    const value = {
      id:r[0], tenantId:r[1], templateId:r[2],
      data:safeJSONParse_(r[3], {}),
      createdAt:r[4], slug:r[5],
      links: {
        publicUrl: `${base}?p=events&brand=${tenantId}&id=${r[0]}`,
        posterUrl: `${base}?page=poster&p=events&brand=${tenantId}&id=${r[0]}`,
        displayUrl: `${base}?page=display&p=events&brand=${tenantId}&id=${r[0]}&tv=1`,
        reportUrl: `${base}?page=report&brand=${tenantId}&id=${r[0]}`
      }
    };
    const etag = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(value)));
    if (payload?.ifNoneMatch === etag) return { ok:true, notModified:true, etag };
    return _ensureOk_('api_get', SC_GET, { ok:true, etag, value });
  });
}

function api_create(payload){
  return runSafe('api_create', () => {
    if(!payload||typeof payload!=='object') return Err(ERR.BAD_INPUT,'Missing payload');
    const { tenantId, scope, templateId, data, adminKey, idemKey } = payload;

    const g=gate_(tenantId, adminKey); if(!g.ok) return g;
    const a=assertScopeAllowed_(findTenant_(tenantId), scope); if(!a.ok) return a;
    const tpl = findTemplate_(templateId); if(!tpl) return Err(ERR.BAD_INPUT,'Unknown template');

    // Validate required + simple types
    for (const f of tpl.fields){
      const v = data?.[f.id];
      if (f.required && (v===undefined || v==='')) return Err(ERR.BAD_INPUT,`Missing field: ${f.id}`);
      if (v!=null && f.type==='url' && !isUrl(v)) return Err(ERR.BAD_INPUT,`Invalid URL: ${f.id}`);
    }

    // Idempotency (10m) - Fixed: Bug #38 - Add LockService for race condition
    if (idemKey){
      // Validate idemKey format
      if (!/^[a-zA-Z0-9-]{1,128}$/.test(idemKey)) {
        return Err(ERR.BAD_INPUT, 'Invalid idempotency key format');
      }

      const lock = LockService.getScriptLock();
      try {
        lock.waitLock(5000); // Wait up to 5 seconds

        const c=CacheService.getScriptCache(), k=`idem:${tenantId}:${scope}:${idemKey}`;
        if (c.get(k)) {
          lock.releaseLock();
          return Err(ERR.BAD_INPUT,'Duplicate create');
        }
        c.put(k, JSON.stringify({ timestamp: Date.now(), status: 'processing' }), 86400); // 24 hours

      } finally {
        lock.releaseLock();
      }
    }

    // Sanitize data inputs
    const sanitizedData = {};
    for (const f of tpl.fields) {
      const val = data?.[f.id];
      if (val !== undefined && val !== null) {
        sanitizedData[f.id] = (f.type === 'url') ? String(val) : sanitizeInput_(String(val));
      }
    }

    // Write row with collision-safe slug - Fixed: Bug #12 - Add LockService
    const tenant = findTenant_(tenantId);
    const sh = getStoreSheet_(tenant, scope);
    const id = Utilities.getUuid();

    // Acquire lock for read-modify-write operation
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000); // Wait up to 10 seconds

      let slug = String((sanitizedData?.name || id)).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');

      // Handle slug collisions - INSIDE lock
      const existingSlugs = sh.getDataRange().getValues().slice(1).map(r => r[5]);
      let counter = 2;
      let originalSlug = slug;
      while (existingSlugs.includes(slug)) {
        slug = `${originalSlug}-${counter}`;
        counter++;
      }

      sh.appendRow([id, tenantId, templateId, JSON.stringify(sanitizedData), new Date().toISOString(), slug]);

    } finally {
      lock.releaseLock();
    }

    const base = ScriptApp.getService().getUrl();
    const links = {
      publicUrl: `${base}?p=events&brand=${tenantId}&id=${id}`,
      posterUrl: `${base}?page=poster&p=events&brand=${tenantId}&id=${id}`,
      displayUrl: `${base}?page=display&p=events&brand=${tenantId}&id=${id}&tv=1`,
      reportUrl: `${base}?page=report&brand=${tenantId}&id=${id}`
    };
    diag_('info','api_create','created',{id,tenantId,scope});
    return Ok({ id, links });
  });
}

function api_updateEventData(req){
  return runSafe('api_updateEventData', () => {
    if(!req||typeof req!=='object') return Err(ERR.BAD_INPUT,'Missing payload');
    const { tenantId, scope, id, data, adminKey } = req;

    // Fixed: Bug #19 - Validate ID format
    const sanitizedId = sanitizeId_(id);
    if (!sanitizedId) return Err(ERR.BAD_INPUT, 'Invalid ID format');

    const g=gate_(tenantId, adminKey); if(!g.ok) return g;
    const a=assertScopeAllowed_(findTenant_(tenantId), scope||'events'); if(!a.ok) return a;

    const tenant = findTenant_(tenantId);
    const sh = getStoreSheet_(tenant, scope||'events');

    // Fixed: Bug #13 - Add LockService for read-modify-write operation
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000); // Wait up to 10 seconds

      const rows = sh.getDataRange().getValues();
      const rowIdx = rows.findIndex((r, i) => i > 0 && r[0]===sanitizedId && r[1]===tenantId);

      if (rowIdx === -1) {
        lock.releaseLock();
        return Err(ERR.NOT_FOUND,'Event not found');
      }

      const existingData = safeJSONParse_(rows[rowIdx][3], {});
      const templateId = rows[rowIdx][2];
      const tpl = findTemplate_(templateId);

      if (!tpl) {
        lock.releaseLock();
        return Err(ERR.INTERNAL, 'Template not found');
      }

      // Fixed: Bug #27 - Validate update data against template schema
      for (const [key, value] of Object.entries(data || {})) {
        const field = tpl.fields.find(f => f.id === key);

        // Reject unknown fields
        if (!field) {
          lock.releaseLock();
          return Err(ERR.BAD_INPUT, `Unknown field: ${key}`);
        }

        // Validate field type
        if (value !== null && value !== undefined) {
          if (field.type === 'url' && !isUrl(value)) {
            lock.releaseLock();
            return Err(ERR.BAD_INPUT, `Invalid URL for field: ${key}`);
          }

          // Sanitize non-URL fields
          if (field.type !== 'url' && typeof value === 'string') {
            data[key] = sanitizeInput_(value);
          }
        }
      }

      const mergedData = Object.assign({}, existingData, data || {});

      sh.getRange(rowIdx + 1, 4).setValue(JSON.stringify(mergedData));

    } finally {
      lock.releaseLock();
    }

    diag_('info','api_updateEventData','updated',{id: sanitizedId,tenantId,scope,data});

    return api_get({ tenantId, scope: scope||'events', id: sanitizedId });
  });
}

function api_logEvents(req){
  return runSafe('api_logEvents', () => {
    const items = (req && req.items) || [];
    if (!items.length) return Ok({count:0});

    const sh = _ensureAnalyticsSheet_();
    const now = Date.now();

    // Fixed: Bug #29 - Sanitize all values for spreadsheet to prevent formula injection
    const rows = items.map(it => [
      new Date(it.ts || now),
      sanitizeSpreadsheetValue_(it.eventId || ''),
      sanitizeSpreadsheetValue_(it.surface || ''),
      sanitizeSpreadsheetValue_(it.metric || ''),
      sanitizeSpreadsheetValue_(it.sponsorId || ''),
      Number(it.value || 0),
      sanitizeSpreadsheetValue_(it.token || ''),
      sanitizeSpreadsheetValue_((it.ua || '').slice(0, 200))
    ]);
    sh.getRange(sh.getLastRow()+1, 1, rows.length, 8).setValues(rows);

    diag_('info','api_logEvents','logged',{count: rows.length});
    return Ok({count: rows.length});
  });
}

function api_getReport(req){
  return runSafe('api_getReport', () => {
    const { tenantId, adminKey } = req || {};

    // Fixed: Add authentication check - Bug #6
    const g = gate_(tenantId || 'root', adminKey);
    if (!g.ok) return g;

    const eventId = String(req && req.id || '');
    if (!eventId) return Err(ERR.BAD_INPUT,'missing id');

    // Fixed: Bug #30 - Verify event belongs to tenant before returning analytics
    const tenant = g.value.tenant;
    const eventSheet = SpreadsheetApp.openById(tenant.store.spreadsheetId)
      .getSheetByName(tenant.scopesAllowed.includes('events') ? 'EVENTS' : 'EVENTS');

    if (!eventSheet) {
      return Err(ERR.NOT_FOUND, 'Events sheet not found');
    }

    // Verify event exists and belongs to this tenant
    const eventRows = eventSheet.getDataRange().getValues().slice(1);
    const event = eventRows.find(r => r[0] === eventId && r[1] === tenantId);

    if (!event) {
      diag_('warn', 'api_getReport', 'Unauthorized analytics access attempt', { eventId, tenantId });
      return Err(ERR.NOT_FOUND, 'Event not found or unauthorized');
    }

    const sh = _ensureAnalyticsSheet_();
    const data = sh.getDataRange().getValues().slice(1)
      .filter(r => r[1] === eventId);

    const agg = {
      totals: { impressions:0, clicks:0, dwellSec:0 },
      bySurface: {},
      bySponsor: {},
      byToken: {}
    };

    // Fixed: Bug #39 - Use explicit null/undefined checks instead of || operator
    for (const r of data){
      const surface = r[2];
      const metric = r[3];
      const sponsorId = (r[4] !== null && r[4] !== undefined && r[4] !== '') ? r[4] : '-';
      const value = Number((r[5] !== null && r[5] !== undefined) ? r[5] : 0);
      const token = (r[6] !== null && r[6] !== undefined && r[6] !== '') ? r[6] : '-';

      if (!agg.bySurface[surface]) agg.bySurface[surface] = {impressions:0, clicks:0, dwellSec:0};
      if (!agg.bySponsor[sponsorId]) agg.bySponsor[sponsorId] = {impressions:0, clicks:0, dwellSec:0};
      if (!agg.byToken[token]) agg.byToken[token] = {impressions:0, clicks:0, dwellSec:0};
      const surf = agg.bySurface[surface];
      const spons = agg.bySponsor[sponsorId];
      const tok = agg.byToken[token];

      if (metric === 'impression'){
        agg.totals.impressions++; surf.impressions++; spons.impressions++; tok.impressions++;
      }
      if (metric === 'click'){
        agg.totals.clicks++; surf.clicks++; spons.clicks++; tok.clicks++;
      }
      if (metric === 'dwellSec'){
        agg.totals.dwellSec += value; surf.dwellSec += value; spons.dwellSec += value; tok.dwellSec += value;
      }
    }

    // Calculate CTR for sponsors and tokens
    for (const k in agg.bySponsor){
      const s = agg.bySponsor[k];
      s.ctr = s.impressions ? +(s.clicks / s.impressions).toFixed(4) : 0;
    }
    for (const k in agg.byToken){
      const t = agg.byToken[k];
      t.ctr = t.impressions ? +(t.clicks / t.impressions).toFixed(4) : 0;
    }

    return Ok(agg);
  });
}

function api_exportReport(req){
  return runSafe('api_exportReport', () => {
    const eventId = String(req && req.id || '');
    if (!eventId) return Err(ERR.BAD_INPUT,'missing id');

    const rep = api_getReport({id:eventId});
    if (!rep.ok) return rep;

    const ss = SpreadsheetApp.getActive();
    const name = `Report – ${eventId}`;
    let sh = ss.getSheetByName(name);
    if (sh) ss.deleteSheet(sh);
    sh = ss.insertSheet(name);

    // Totals
    sh.getRange(1,1,1,2).setValues([['Metric','Total']]).setFontWeight('bold');
    sh.getRange(2,1,3,2).setValues([
      ['Impressions', rep.value.totals.impressions],
      ['Clicks',      rep.value.totals.clicks],
      ['Dwell (sec)', rep.value.totals.dwellSec]
    ]);

    // By Surface
    sh.getRange(6,1,1,4).setValues([['Surface','Impressions','Clicks','Dwell (sec)']]).setFontWeight('bold');
    const srows = Object.entries(rep.value.bySurface).map(([k,v]) => [k,v.impressions,v.clicks,v.dwellSec]);
    if (srows.length) sh.getRange(7,1,srows.length,4).setValues(srows);

    // By Sponsor
    sh.getRange(6,6,1,5).setValues([['SponsorId','Impressions','Clicks','CTR','Dwell (sec)']]).setFontWeight('bold');
    const prows = Object.entries(rep.value.bySponsor).map(([k,v]) => [k,v.impressions,v.clicks,v.ctr,v.dwellSec]);
    if (prows.length) sh.getRange(7,6,prows.length,5).setValues(prows);

    // By Token
    sh.getRange(6,12,1,5).setValues([['Token','Impressions','Clicks','CTR','Dwell (sec)']]).setFontWeight('bold');
    const trows = Object.entries(rep.value.byToken).filter(([k]) => k !== '-').map(([k,v]) => [k,v.impressions,v.clicks,v.ctr,v.dwellSec]);
    if (trows.length) sh.getRange(7,12,trows.length,5).setValues(trows);

    sh.autoResizeColumns(1, 15);

    diag_('info','api_exportReport','exported',{eventId, sheetId: sh.getSheetId()});
    return Ok({sheetUrl: ss.getUrl() + '#gid=' + sh.getSheetId()});
  });
}

/**
 * Get sponsor-specific analytics data
 * Allows sponsors to view their performance metrics across events
 * @param {object} req - Request object with sponsorId, eventId (optional), dateFrom/dateTo (optional)
 * @returns {object} Sponsor analytics including impressions, clicks, CTR, ROI by surface
 */
function api_getSponsorAnalytics(req) {
  return runSafe('api_getSponsorAnalytics', () => {
    if (!req || typeof req !== 'object') return Err(ERR.BAD_INPUT, 'Missing payload');

    const { sponsorId, eventId, dateFrom, dateTo, tenantId, adminKey } = req;

    if (!sponsorId) return Err(ERR.BAD_INPUT, 'Missing sponsorId');

    // Optional authentication - sponsors can view their own data
    // Admin key allows viewing any sponsor's data
    if (adminKey) {
      const g = gate_(tenantId || 'root', adminKey);
      if (!g.ok) return g;
    }

    // Get analytics data
    const sh = _ensureAnalyticsSheet_();
    let data = sh.getDataRange().getValues().slice(1);

    // Filter by sponsor ID
    data = data.filter(r => r[4] === sponsorId);

    // Filter by event ID if provided
    if (eventId) {
      data = data.filter(r => r[1] === eventId);
    }

    // Filter by date range if provided
    if (dateFrom || dateTo) {
      const fromDate = dateFrom ? new Date(dateFrom) : new Date(0);
      const toDate = dateTo ? new Date(dateTo) : new Date();

      data = data.filter(r => {
        const rowDate = new Date(r[0]); // timestamp column
        return rowDate >= fromDate && rowDate <= toDate;
      });
    }

    // Aggregate metrics
    const agg = {
      sponsorId: sponsorId,
      totals: { impressions: 0, clicks: 0, dwellSec: 0, ctr: 0 },
      bySurface: {}, // poster, display, public, etc.
      byEvent: {},
      timeline: [] // Daily breakdown
    };

    // Process each analytics row
    for (const r of data) {
      const timestamp = r[0];
      const evtId = r[1];
      const surface = r[2];
      const metric = r[3];
      const value = Number((r[5] !== null && r[5] !== undefined) ? r[5] : 0);

      // Initialize surface if not exists
      if (!agg.bySurface[surface]) {
        agg.bySurface[surface] = { impressions: 0, clicks: 0, dwellSec: 0, ctr: 0 };
      }

      // Initialize event if not exists
      if (!agg.byEvent[evtId]) {
        agg.byEvent[evtId] = { impressions: 0, clicks: 0, dwellSec: 0, ctr: 0 };
      }

      const surf = agg.bySurface[surface];
      const evt = agg.byEvent[evtId];

      // Aggregate metrics
      if (metric === 'impression') {
        agg.totals.impressions++;
        surf.impressions++;
        evt.impressions++;
      }
      if (metric === 'click') {
        agg.totals.clicks++;
        surf.clicks++;
        evt.clicks++;
      }
      if (metric === 'dwellSec') {
        agg.totals.dwellSec += value;
        surf.dwellSec += value;
        evt.dwellSec += value;
      }

      // Track daily timeline
      const date = new Date(timestamp).toISOString().split('T')[0];
      let dayData = agg.timeline.find(d => d.date === date);
      if (!dayData) {
        dayData = { date, impressions: 0, clicks: 0, dwellSec: 0 };
        agg.timeline.push(dayData);
      }

      if (metric === 'impression') dayData.impressions++;
      if (metric === 'click') dayData.clicks++;
      if (metric === 'dwellSec') dayData.dwellSec += value;
    }

    // Calculate CTR (Click-Through Rate) for all aggregations
    agg.totals.ctr = agg.totals.impressions > 0
      ? +(agg.totals.clicks / agg.totals.impressions * 100).toFixed(2)
      : 0;

    for (const surface in agg.bySurface) {
      const s = agg.bySurface[surface];
      s.ctr = s.impressions > 0 ? +(s.clicks / s.impressions * 100).toFixed(2) : 0;
    }

    for (const evtId in agg.byEvent) {
      const e = agg.byEvent[evtId];
      e.ctr = e.impressions > 0 ? +(e.clicks / e.impressions * 100).toFixed(2) : 0;
    }

    for (const day of agg.timeline) {
      day.ctr = day.impressions > 0 ? +(day.clicks / day.impressions * 100).toFixed(2) : 0;
    }

    // Sort timeline by date
    agg.timeline.sort((a, b) => a.date.localeCompare(b.date));

    // Add engagement score (weighted average of CTR and dwell time)
    agg.totals.engagementScore = calculateEngagementScore_(
      agg.totals.ctr,
      agg.totals.dwellSec,
      agg.totals.impressions
    );

    // Add performance insights
    agg.insights = generateSponsorInsights_(agg);

    diag_('info', 'api_getSponsorAnalytics', 'Analytics retrieved', {
      sponsorId,
      eventId: eventId || 'all',
      totalImpressions: agg.totals.impressions
    });

    return Ok(agg);
  });
}

/**
 * Get Sponsor ROI Dashboard
 * High-value feature providing comprehensive ROI analysis for sponsors
 *
 * @param {object} req - Request object
 * @param {string} req.sponsorId - Sponsor ID
 * @param {number} [req.sponsorshipCost] - Total sponsorship investment
 * @param {number} [req.costPerClick] - Expected cost per click
 * @param {number} [req.conversionRate] - Conversion rate percentage
 * @param {number} [req.avgTransactionValue] - Average transaction value
 * @param {string} [req.dateFrom] - Start date (ISO)
 * @param {string} [req.dateTo] - End date (ISO)
 * @param {string} [req.tenantId] - Tenant ID
 * @param {string} [req.adminKey] - Admin key for authentication
 * @returns {object} ROI dashboard with metrics, financials, and insights
 */
function api_getSponsorROI(req) {
  return runSafe('api_getSponsorROI', () => {
    if (!req || typeof req !== 'object') {
      return Err(ERR.BAD_INPUT, 'Missing payload');
    }

    const { sponsorId, tenantId, adminKey } = req;

    if (!sponsorId) {
      return Err(ERR.BAD_INPUT, 'Missing sponsorId');
    }

    // Optional authentication - sponsors can view their own data
    // Admin key allows viewing any sponsor's data
    if (adminKey) {
      const g = gate_(tenantId || 'root', adminKey);
      if (!g.ok) return g;
    }

    // Use SponsorService to calculate ROI
    const roiResult = SponsorService_calculateROI({
      sponsorId: req.sponsorId,
      sponsorshipCost: req.sponsorshipCost || 0,
      costPerClick: req.costPerClick || 0,
      conversionRate: req.conversionRate || 0,
      avgTransactionValue: req.avgTransactionValue || 0,
      dateFrom: req.dateFrom,
      dateTo: req.dateTo
    });

    if (!roiResult.ok) {
      return roiResult;
    }

    diag_('info', 'api_getSponsorROI', 'ROI dashboard retrieved', {
      sponsorId,
      roi: roiResult.value.financials.roi
    });

    return roiResult;
  });
}

/**
 * Get sponsor placement settings and configurations
 *
 * Returns available placement positions, allowed positions per surface,
 * and upsell opportunities (e.g., dedicated TV pane).
 *
 * @param {object} req - Request parameters
 * @param {string} [req.tenantId] - Tenant ID for tenant-specific settings
 * @returns {object} Result envelope with sponsor settings
 */
function api_getSponsorSettings(req) {
  return runSafe('api_getSponsorSettings', () => {
    const { tenantId } = req || {};

    // Use SponsorService to get settings
    const settingsResult = SponsorService_getSettings({ tenantId });

    if (!settingsResult.ok) {
      return settingsResult;
    }

    diag_('info', 'api_getSponsorSettings', 'Settings retrieved', {
      tenantId: tenantId || 'default',
      placementsCount: Object.keys(settingsResult.value.placements).length
    });

    return settingsResult;
  });
}

/**
 * Validate sponsor placement configuration
 *
 * Ensures sponsors are assigned to valid placements and don't exceed limits.
 *
 * @param {object} req - Request parameters
 * @param {array} req.sponsors - Array of sponsor objects with placements
 * @param {string} [req.tenantId] - Tenant ID for settings lookup
 * @returns {object} Result envelope with validation results
 */
function api_validateSponsorPlacements(req) {
  return runSafe('api_validateSponsorPlacements', () => {
    const { sponsors, tenantId } = req || {};

    if (!Array.isArray(sponsors)) {
      return Err(ERR.BAD_INPUT, 'Sponsors must be an array');
    }

    // Use SponsorService to validate placements
    const validationResult = SponsorService_validatePlacements({
      sponsors,
      tenantId
    });

    if (!validationResult.ok) {
      return validationResult;
    }

    diag_('info', 'api_validateSponsorPlacements', 'Placements validated', {
      tenantId: tenantId || 'default',
      valid: validationResult.value.valid,
      totalSponsors: validationResult.value.totalSponsors,
      errorsCount: validationResult.value.errors.length,
      warningsCount: validationResult.value.warnings.length
    });

    return validationResult;
  });
}

/**
 * Calculate engagement score from CTR and dwell time
 * @param {number} ctr - Click-through rate (percentage)
 * @param {number} dwellSec - Total dwell time in seconds
 * @param {number} impressions - Total impressions
 * @returns {number} Engagement score (0-100)
 */
function calculateEngagementScore_(ctr, dwellSec, impressions) {
  if (impressions === 0) return 0;

  // Normalize dwell time (assuming 5 seconds is good engagement per impression)
  const avgDwellPerImpression = dwellSec / impressions;
  const normalizedDwell = Math.min(avgDwellPerImpression / 5 * 100, 100);

  // Weight: 60% CTR, 40% dwell time
  const score = (ctr * 0.6) + (normalizedDwell * 0.4);

  return +score.toFixed(2);
}

/**
 * Generate performance insights for sponsors
 * @param {object} agg - Aggregated analytics data
 * @returns {array} Array of insight objects
 */
function generateSponsorInsights_(agg) {
  const insights = [];

  // Insight 1: Best performing surface
  let bestSurface = null;
  let bestCTR = 0;

  for (const [surface, data] of Object.entries(agg.bySurface)) {
    if (data.ctr > bestCTR && data.impressions >= 10) { // Need at least 10 impressions for statistical relevance
      bestCTR = data.ctr;
      bestSurface = surface;
    }
  }

  if (bestSurface) {
    insights.push({
      type: 'success',
      title: 'Top Performing Surface',
      message: `Your ${bestSurface} ads have the highest CTR at ${bestCTR}%. Consider increasing investment in this channel.`,
      metric: { surface: bestSurface, ctr: bestCTR }
    });
  }

  // Insight 2: Low CTR warning
  if (agg.totals.impressions >= 100 && agg.totals.ctr < 1) {
    insights.push({
      type: 'warning',
      title: 'Low Click-Through Rate',
      message: `Your overall CTR is ${agg.totals.ctr}%. Consider refreshing your ad creative or targeting to improve engagement.`,
      metric: { ctr: agg.totals.ctr }
    });
  }

  // Insight 3: Surface comparison
  const surfaces = Object.keys(agg.bySurface);
  if (surfaces.length > 1) {
    const surfacePerformance = surfaces.map(s => ({
      name: s,
      ...agg.bySurface[s]
    })).sort((a, b) => b.ctr - a.ctr);

    if (surfacePerformance.length >= 2) {
      const top = surfacePerformance[0];
      const bottom = surfacePerformance[surfacePerformance.length - 1];

      if (top.ctr > bottom.ctr * 2 && bottom.impressions >= 10) {
        insights.push({
          type: 'info',
          title: 'Surface Performance Gap',
          message: `${top.name} performs ${(top.ctr / bottom.ctr).toFixed(1)}x better than ${bottom.name}. Consider reallocating budget.`,
          metric: { topSurface: top.name, topCTR: top.ctr, bottomSurface: bottom.name, bottomCTR: bottom.ctr }
        });
      }
    }
  }

  // Insight 4: Engagement quality
  if (agg.totals.impressions > 0) {
    const avgDwell = agg.totals.dwellSec / agg.totals.impressions;
    if (avgDwell > 5) {
      insights.push({
        type: 'success',
        title: 'High Engagement Quality',
        message: `Users spend an average of ${avgDwell.toFixed(1)} seconds viewing your ads, indicating strong interest.`,
        metric: { avgDwellSec: avgDwell }
      });
    } else if (avgDwell < 2 && agg.totals.impressions >= 50) {
      insights.push({
        type: 'warning',
        title: 'Short View Duration',
        message: `Average view time is only ${avgDwell.toFixed(1)} seconds. Your ad creative may not be capturing attention.`,
        metric: { avgDwellSec: avgDwell }
      });
    }
  }

  // Insight 5: Recent trend
  if (agg.timeline.length >= 7) {
    const recent = agg.timeline.slice(-7);
    const older = agg.timeline.slice(-14, -7);

    if (older.length >= 7) {
      const recentAvgCTR = recent.reduce((sum, d) => sum + d.ctr, 0) / recent.length;
      const olderAvgCTR = older.reduce((sum, d) => sum + d.ctr, 0) / older.length;

      if (recentAvgCTR > olderAvgCTR * 1.2) {
        insights.push({
          type: 'success',
          title: 'Improving Trend',
          message: `Your CTR has increased by ${((recentAvgCTR / olderAvgCTR - 1) * 100).toFixed(0)}% in the last week compared to the previous week.`,
          metric: { recentCTR: recentAvgCTR, previousCTR: olderAvgCTR, change: recentAvgCTR - olderAvgCTR }
        });
      } else if (olderAvgCTR > recentAvgCTR * 1.2) {
        insights.push({
          type: 'warning',
          title: 'Declining Performance',
          message: `Your CTR has decreased by ${((1 - recentAvgCTR / olderAvgCTR) * 100).toFixed(0)}% in the last week. Consider refreshing your ad creative.`,
          metric: { recentCTR: recentAvgCTR, previousCTR: olderAvgCTR, change: recentAvgCTR - olderAvgCTR }
        });
      }
    }
  }

  return insights;
}

function api_createShortlink(req){
  return runSafe('api_createShortlink', () => {
    if(!req||typeof req!=='object') return Err(ERR.BAD_INPUT,'Missing payload');
    const { targetUrl, eventId, sponsorId, surface, adminKey, tenantId } = req;

    if (!targetUrl) return Err(ERR.BAD_INPUT,'Missing targetUrl');

    // Fixed: Bug #45 & #51 - Validate targetUrl format and length
    if (!isUrl(targetUrl, 2048)) {
      diag_('warn', 'api_createShortlink', 'Invalid or too long URL', {targetUrl: targetUrl.substring(0, 100)});
      return Err(ERR.BAD_INPUT, 'Invalid or too long targetUrl (max 2048 characters)');
    }

    const g=gate_(tenantId||'root', adminKey); if(!g.ok) return g;

    const sh = _ensureShortlinksSheet_();

    // Fixed: Bug #34 - Use full UUID for secure token generation (128-bit entropy)
    // Previously used only first 8 chars which was guessable (~30-bit entropy)
    const token = Utilities.getUuid();

    // Fixed: Bug #53 - Store tenantId for validation on redirect
    sh.appendRow([
      token,
      targetUrl,
      eventId||'',
      sponsorId||'',
      surface||'',
      new Date().toISOString(),
      tenantId||'root' // Add tenantId for cross-tenant validation
    ]);

    const base = ScriptApp.getService().getUrl();
    const shortlink = `${base}?p=r&t=${token}`;

    diag_('info','api_createShortlink','created',{token, targetUrl, eventId, sponsorId});
    return Ok({ token, shortlink, targetUrl });
  });
}

// === Google Forms Template Creation ===

function api_listFormTemplates(){
  return runSafe('api_listFormTemplates', () => {
    const templates = listFormTemplates_();
    return Ok({ templates });
  });
}

function api_createFormFromTemplate(req){
  return runSafe('api_createFormFromTemplate', () => {
    if(!req||typeof req!=='object') return Err(ERR.BAD_INPUT,'Missing payload');
    const { templateType, eventName, eventId, adminKey, tenantId } = req;

    if (!templateType) return Err(ERR.BAD_INPUT,'Missing templateType');

    const g=gate_(tenantId||'root', adminKey); if(!g.ok) return g;

    const template = findFormTemplate_(templateType);
    if (!template) return Err(ERR.BAD_INPUT, `Unknown template type: ${templateType}`);

    try {
      // Create the form
      const formTitle = eventName ? `${eventName} - ${template.label}` : template.label;
      const form = FormApp.create(formTitle);

      form.setDescription(template.description);
      form.setCollectEmail(true);
      form.setLimitOneResponsePerUser(false);
      form.setShowLinkToRespondAgain(true);

      // Add questions from template
      template.questions.forEach(q => {
        let item;

        switch(q.type) {
          case 'TEXT':
            item = form.addTextItem();
            item.setTitle(q.title);
            if (q.required) item.setRequired(true);
            break;

          case 'PARAGRAPH_TEXT':
            item = form.addParagraphTextItem();
            item.setTitle(q.title);
            if (q.required) item.setRequired(true);
            break;

          case 'MULTIPLE_CHOICE':
            item = form.addMultipleChoiceItem();
            item.setTitle(q.title);
            if (q.choices && q.choices.length > 0) {
              item.setChoiceValues(q.choices);
            }
            if (q.required) item.setRequired(true);
            break;

          case 'SCALE':
            item = form.addScaleItem();
            item.setTitle(q.title);
            if (q.scaleMin && q.scaleMax) {
              item.setBounds(q.scaleMin, q.scaleMax);
            }
            if (q.scaleMinLabel) item.setLabels(q.scaleMinLabel, q.scaleMaxLabel || '');
            if (q.required) item.setRequired(true);
            break;

          default:
            // Default to text item
            item = form.addTextItem();
            item.setTitle(q.title);
            if (q.required) item.setRequired(true);
        }
      });

      // Create response spreadsheet
      const responseSheet = SpreadsheetApp.create(`${formTitle} - Responses`);
      form.setDestination(FormApp.DestinationType.SPREADSHEET, responseSheet.getId());

      const formId = form.getId();
      const editUrl = form.getEditUrl();
      const publishedUrl = form.getPublishedUrl();
      const responseSheetUrl = responseSheet.getUrl();

      diag_('info','api_createFormFromTemplate','created',{formId, templateType, eventId});

      return Ok({
        formId,
        editUrl,
        publishedUrl,
        responseSheetUrl,
        templateType,
        eventId: eventId || ''
      });

    } catch(e) {
      diag_('error','api_createFormFromTemplate','failed',{error: e.toString(), templateType});
      return Err(ERR.SERVER_ERROR, `Failed to create form: ${e.toString()}`);
    }
  });
}

function api_generateFormShortlink(req){
  return runSafe('api_generateFormShortlink', () => {
    if(!req||typeof req!=='object') return Err(ERR.BAD_INPUT,'Missing payload');
    const { formUrl, formType, eventId, adminKey, tenantId } = req;

    if (!formUrl) return Err(ERR.BAD_INPUT,'Missing formUrl');

    // Use existing shortlink API
    return api_createShortlink({
      targetUrl: formUrl,
      eventId: eventId || '',
      sponsorId: '',
      surface: `form-${formType || 'unknown'}`,
      adminKey,
      tenantId
    });
  });
}

// === Brand Portfolio Analytics API (Parent Organizations) =================

/**
 * Get consolidated sponsor report across brand portfolio
 * @param {object} req - Request with tenantId, adminKey, sponsorId, options
 * @returns {object} - Portfolio-wide sponsor analytics
 */
function api_getPortfolioSponsorReport(req) {
  return runSafe('api_getPortfolioSponsorReport', () => {
    const { tenantId, adminKey, sponsorId, options } = req;

    // Validate parent tenant
    const tenant = findTenant_(tenantId);
    if (!tenant) {
      return Err(ERR.NOT_FOUND, 'Tenant not found');
    }

    if (tenant.type !== 'parent') {
      return Err(ERR.BAD_INPUT, 'Only parent organizations can access portfolio reports');
    }

    // Verify admin access
    if (!isValidAdminKey_(adminKey, tenantId)) {
      return Err(ERR.BAD_INPUT, 'Invalid admin key');
    }

    // Get portfolio report
    const result = getPortfolioSponsorReport_(tenantId, sponsorId, options || {});

    if (!result.ok) {
      return Err(ERR.INTERNAL, result.error || 'Failed to generate portfolio report');
    }

    return Ok(result.value);
  });
}

/**
 * Get brand portfolio summary for parent organization
 * @param {object} req - Request with tenantId, adminKey
 * @returns {object} - Portfolio summary
 */
function api_getPortfolioSummary(req) {
  return runSafe('api_getPortfolioSummary', () => {
    const { tenantId, adminKey } = req;

    // Validate parent tenant
    const tenant = findTenant_(tenantId);
    if (!tenant) {
      return Err(ERR.NOT_FOUND, 'Tenant not found');
    }

    if (tenant.type !== 'parent') {
      return Err(ERR.BAD_INPUT, 'Only parent organizations can access portfolio summary');
    }

    // Verify admin access
    if (!isValidAdminKey_(adminKey, tenantId)) {
      return Err(ERR.BAD_INPUT, 'Invalid admin key');
    }

    // Get portfolio summary
    const result = getPortfolioSummary_(tenantId);

    if (!result.ok) {
      return Err(ERR.INTERNAL, result.error || 'Failed to generate portfolio summary');
    }

    return Ok(result.value);
  });
}

/**
 * Get list of all sponsors across brand portfolio
 * @param {object} req - Request with tenantId, adminKey
 * @returns {object} - Portfolio sponsors list
 */
function api_getPortfolioSponsors(req) {
  return runSafe('api_getPortfolioSponsors', () => {
    const { tenantId, adminKey } = req;

    // Validate parent tenant
    const tenant = findTenant_(tenantId);
    if (!tenant) {
      return Err(ERR.NOT_FOUND, 'Tenant not found');
    }

    if (tenant.type !== 'parent') {
      return Err(ERR.BAD_INPUT, 'Only parent organizations can access portfolio sponsors');
    }

    // Verify admin access
    if (!isValidAdminKey_(adminKey, tenantId)) {
      return Err(ERR.BAD_INPUT, 'Invalid admin key');
    }

    // Get portfolio sponsors
    const result = getPortfolioSponsors_(tenantId);

    if (!result.ok) {
      return Err(ERR.INTERNAL, result.error || 'Failed to get portfolio sponsors');
    }

    return Ok(result.value);
  });
}

function api_runDiagnostics(){
  return runSafe('api_runDiagnostics', () => {
    const steps = [];
    let eventId = null;
    let sheetUrl = null;

    try {
      // 1. Status check
      const st = api_status('root');
      steps.push({ name: 'status', ok: st.ok, error: st.ok ? null : st.message });
      if (!st.ok) return Ok({ steps, ok: false });

      // 2. Create temp event
      const create = api_create({
        tenantId: 'root',
        scope: 'events',
        templateId: 'event',
        adminKey: getAdminSecret_('root'),
        idemKey: `diag-${Date.now()}`,
        data: { name: 'Diagnostic Test Event', dateISO: '2025-12-31', signupUrl: '' }
      });
      steps.push({ name: 'create_event', ok: create.ok, error: create.ok ? null : create.message });
      if (!create.ok) return Ok({ steps, ok: false });
      eventId = create.value.id;

      // 3. Update display config
      const upd = api_updateEventData({
        tenantId: 'root',
        scope: 'events',
        id: eventId,
        adminKey: getAdminSecret_('root'),
        data: {
          display: { mode: 'static' },
          sponsors: [{ id: 'test-sp1', name: 'Test Sponsor', placements: { tvTop: true } }]
        }
      });
      steps.push({ name: 'update_config', ok: upd.ok, error: upd.ok ? null : upd.message });

      // 4. Log analytics
      const log = api_logEvents({
        items: [
          { eventId, surface: 'display', metric: 'impression', sponsorId: 'test-sp1' },
          { eventId, surface: 'display', metric: 'dwellSec', value: 10 }
        ]
      });
      steps.push({ name: 'log_analytics', ok: log.ok, error: log.ok ? null : log.message });

      // 5. Get report
      const rep = api_getReport({ id: eventId });
      steps.push({ name: 'get_report', ok: rep.ok, error: rep.ok ? null : rep.message });

      // 6. Export report
      const exp = api_exportReport({ id: eventId });
      steps.push({ name: 'export_report', ok: exp.ok, error: exp.ok ? null : exp.message });
      if (exp.ok) sheetUrl = exp.value.sheetUrl;

      // 7. Create shortlink
      const sl = api_createShortlink({
        tenantId: 'root',
        adminKey: findTenant_('root').adminSecret,
        targetUrl: create.value.links.publicUrl,
        eventId,
        surface: 'test'
      });
      steps.push({ name: 'create_shortlink', ok: sl.ok, error: sl.ok ? null : sl.message });

      const allOk = steps.every(s => s.ok);
      diag_('info', 'api_runDiagnostics', allOk ? 'All checks passed' : 'Some checks failed', { steps });

      return Ok({ steps, eventId, sheetUrl, ok: allOk });
    } catch(e) {
      steps.push({ name: 'exception', ok: false, error: String(e) });
      return Ok({ steps, ok: false });
    }
  });
}

// === Brand Portfolio Analytics =============================================
// Multi-brand sponsorship reporting for parent organizations

/**
 * Get consolidated sponsor report across brand portfolio
 *
 * @param {string} parentTenantId - Parent organization (e.g., 'abc')
 * @param {string} sponsorId - Sponsor ID to report on
 * @param {object} options - Optional filters (dateRange, etc.)
 * @returns {object} - Aggregated sponsor metrics
 */
function getPortfolioSponsorReport_(parentTenantId, sponsorId, options = {}) {
  const parentTenant = findTenant_(parentTenantId);

  if (!parentTenant || parentTenant.type !== 'parent') {
    return {
      ok: false,
      error: 'Invalid parent tenant or not a parent organization'
    };
  }

  const report = {
    parentOrg: {
      id: parentTenantId,
      name: parentTenant.name
    },
    sponsor: {
      id: sponsorId,
      name: null  // Will be populated from data
    },
    portfolioSummary: {
      totalImpressions: 0,
      totalClicks: 0,
      totalEvents: 0,
      portfolioCTR: 0,
      dateRange: options.dateRange || { start: null, end: null }
    },
    byBrand: {},
    topPerformingEvents: [],
    generatedAt: new Date().toISOString()
  };

  // Get sponsor data from parent tenant
  const parentData = getSponsorDataForTenant_(parentTenantId, sponsorId, options);
  if (parentData) {
    report.portfolioSummary.totalImpressions += parentData.impressions || 0;
    report.portfolioSummary.totalClicks += parentData.clicks || 0;
    report.portfolioSummary.totalEvents += parentData.events || 0;
    report.byBrand[parentTenantId] = {
      name: parentTenant.name,
      ...parentData
    };

    // Set sponsor name if found
    if (parentData.sponsorName) {
      report.sponsor.name = parentData.sponsorName;
    }
  }

  // Get sponsor data from child tenants
  const childTenantIds = parentTenant.childTenants || [];
  childTenantIds.forEach(childId => {
    const childTenant = findTenant_(childId);
    if (!childTenant) return;

    // Skip child tenants not included in portfolio reports
    if (childTenant.includeInPortfolioReports === false) return;

    const childData = getSponsorDataForTenant_(childId, sponsorId, options);
    if (childData) {
      report.portfolioSummary.totalImpressions += childData.impressions || 0;
      report.portfolioSummary.totalClicks += childData.clicks || 0;
      report.portfolioSummary.totalEvents += childData.events || 0;
      report.byBrand[childId] = {
        name: childTenant.name,
        ...childData
      };

      // Set sponsor name if not yet set
      if (!report.sponsor.name && childData.sponsorName) {
        report.sponsor.name = childData.sponsorName;
      }
    }
  });

  // Calculate portfolio CTR
  if (report.portfolioSummary.totalImpressions > 0) {
    report.portfolioSummary.portfolioCTR = (
      (report.portfolioSummary.totalClicks / report.portfolioSummary.totalImpressions) * 100
    ).toFixed(2);
  }

  // Aggregate top performing events across all brands
  report.topPerformingEvents = getTopPerformingEventsAcrossPortfolio_(
    parentTenantId,
    sponsorId,
    childTenantIds,
    5  // Top 5 events
  );

  return {
    ok: true,
    value: report
  };
}

/**
 * Get sponsor data for a specific tenant
 *
 * @param {string} tenantId - Tenant ID
 * @param {string} sponsorId - Sponsor ID
 * @param {object} options - Optional filters
 * @returns {object|null} - Sponsor data or null
 */
function getSponsorDataForTenant_(tenantId, sponsorId, options = {}) {
  try {
    // Get all events for this tenant
    const tenant = findTenant_(tenantId);
    if (!tenant) return null;

    const db = getDb_(tenant);
    const events = db.list('events') || [];

    // Get sponsors to find sponsor name
    const sponsors = db.list('sponsors') || [];
    const sponsor = sponsors.find(s => s.id === sponsorId);
    const sponsorName = sponsor ? sponsor.name : null;

    // Filter events that have this sponsor
    const sponsoredEvents = events.filter(event => {
      const eventSponsorIds = (event.sponsorIds || '').split(',').map(id => id.trim());
      return eventSponsorIds.includes(sponsorId);
    });

    if (sponsoredEvents.length === 0) {
      return {
        sponsorName: sponsorName,
        impressions: 0,
        clicks: 0,
        events: 0,
        ctr: 0,
        eventsList: []
      };
    }

    // Aggregate metrics
    let totalImpressions = 0;
    let totalClicks = 0;
    const eventsList = [];

    sponsoredEvents.forEach(event => {
      // Get analytics for this event (if available)
      const eventImpressions = event.analytics?.impressions || 0;
      const eventClicks = event.analytics?.clicks || 0;

      totalImpressions += eventImpressions;
      totalClicks += eventClicks;

      eventsList.push({
        id: event.id,
        name: event.name,
        date: event.dateISO,
        impressions: eventImpressions,
        clicks: eventClicks,
        ctr: eventImpressions > 0 ? ((eventClicks / eventImpressions) * 100).toFixed(2) : 0
      });
    });

    const ctr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : 0;

    return {
      sponsorName: sponsorName,
      impressions: totalImpressions,
      clicks: totalClicks,
      events: sponsoredEvents.length,
      ctr: ctr,
      eventsList: eventsList
    };

  } catch (error) {
    console.error(`Error getting sponsor data for tenant ${tenantId}:`, error);
    return null;
  }
}

/**
 * Get top performing events across brand portfolio
 *
 * @param {string} parentTenantId - Parent tenant ID
 * @param {string} sponsorId - Sponsor ID
 * @param {array} childTenantIds - Child tenant IDs
 * @param {number} limit - Number of top events to return
 * @returns {array} - Top performing events
 */
function getTopPerformingEventsAcrossPortfolio_(parentTenantId, sponsorId, childTenantIds, limit = 5) {
  const allEvents = [];

  // Collect events from parent
  const parentData = getSponsorDataForTenant_(parentTenantId, sponsorId);
  if (parentData && parentData.eventsList) {
    parentData.eventsList.forEach(event => {
      allEvents.push({
        ...event,
        tenantId: parentTenantId,
        tenantName: findTenant_(parentTenantId)?.name || parentTenantId
      });
    });
  }

  // Collect events from children
  childTenantIds.forEach(childId => {
    const childTenant = findTenant_(childId);
    // Skip child tenants not included in portfolio reports
    if (!childTenant || childTenant.includeInPortfolioReports === false) return;

    const childData = getSponsorDataForTenant_(childId, sponsorId);
    if (childData && childData.eventsList) {
      childData.eventsList.forEach(event => {
        allEvents.push({
          ...event,
          tenantId: childId,
          tenantName: childTenant.name || childId
        });
      });
    }
  });

  // Sort by impressions (descending) and return top N
  return allEvents
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit);
}

/**
 * Get brand portfolio summary for parent organization
 * Shows overall portfolio health and activity
 *
 * @param {string} parentTenantId - Parent tenant ID
 * @returns {object} - Portfolio summary
 */
function getPortfolioSummary_(parentTenantId) {
  const parentTenant = findTenant_(parentTenantId);

  if (!parentTenant || parentTenant.type !== 'parent') {
    return {
      ok: false,
      error: 'Invalid parent tenant or not a parent organization'
    };
  }

  const summary = {
    portfolio: {
      parent: {
        id: parentTenantId,
        name: parentTenant.name
      },
      children: []
    },
    metrics: {
      totalEvents: 0,
      totalSponsors: 0,
      totalImpressions: 0,
      activeSponsors: new Set()
    },
    byBrand: {}
  };

  // Get parent metrics
  const parentDb = getDb_(parentTenant);
  const parentEvents = parentDb.list('events') || [];
  const parentSponsors = parentDb.list('sponsors') || [];

  summary.metrics.totalEvents += parentEvents.length;
  summary.metrics.totalSponsors += parentSponsors.length;

  // Track active sponsors (sponsors with events)
  parentEvents.forEach(event => {
    const sponsorIds = (event.sponsorIds || '').split(',').map(id => id.trim()).filter(id => id);
    sponsorIds.forEach(sid => summary.metrics.activeSponsors.add(sid));

    const eventImpressions = event.analytics?.impressions || 0;
    summary.metrics.totalImpressions += eventImpressions;
  });

  summary.byBrand[parentTenantId] = {
    name: parentTenant.name,
    events: parentEvents.length,
    sponsors: parentSponsors.length
  };

  // Get child metrics
  const childTenantIds = parentTenant.childTenants || [];
  childTenantIds.forEach(childId => {
    const childTenant = findTenant_(childId);
    if (!childTenant) return;

    // Skip child tenants not included in portfolio reports
    if (childTenant.includeInPortfolioReports === false) return;

    summary.portfolio.children.push({
      id: childId,
      name: childTenant.name
    });

    const childDb = getDb_(childTenant);
    const childEvents = childDb.list('events') || [];
    const childSponsors = childDb.list('sponsors') || [];

    summary.metrics.totalEvents += childEvents.length;
    summary.metrics.totalSponsors += childSponsors.length;

    // Track active sponsors
    childEvents.forEach(event => {
      const sponsorIds = (event.sponsorIds || '').split(',').map(id => id.trim()).filter(id => id);
      sponsorIds.forEach(sid => summary.metrics.activeSponsors.add(sid));

      const eventImpressions = event.analytics?.impressions || 0;
      summary.metrics.totalImpressions += eventImpressions;
    });

    summary.byBrand[childId] = {
      name: childTenant.name,
      events: childEvents.length,
      sponsors: childSponsors.length
    };
  });

  // Convert Set to count
  summary.metrics.activeSponsors = summary.metrics.activeSponsors.size;

  return {
    ok: true,
    value: summary
  };
}

/**
 * Get list of all sponsors across brand portfolio
 * Useful for parent organizations to see all sponsors
 *
 * @param {string} parentTenantId - Parent tenant ID
 * @returns {object} - List of sponsors with brand breakdown
 */
function getPortfolioSponsors_(parentTenantId) {
  const parentTenant = findTenant_(parentTenantId);

  if (!parentTenant || parentTenant.type !== 'parent') {
    return {
      ok: false,
      error: 'Invalid parent tenant or not a parent organization'
    };
  }

  const sponsorsMap = new Map();

  // Helper to add sponsor to map
  const addSponsor = (sponsor, tenantId, tenantName) => {
    const key = sponsor.id;
    if (!sponsorsMap.has(key)) {
      sponsorsMap.set(key, {
        id: sponsor.id,
        name: sponsor.name,
        logoUrl: sponsor.logoUrl,
        website: sponsor.website,
        tier: sponsor.tier,
        brands: []
      });
    }
    sponsorsMap.get(key).brands.push({
      tenantId: tenantId,
      tenantName: tenantName
    });
  };

  // Get sponsors from parent
  const parentDb = getDb_(parentTenant);
  const parentSponsors = parentDb.list('sponsors') || [];
  parentSponsors.forEach(sponsor => {
    addSponsor(sponsor, parentTenantId, parentTenant.name);
  });

  // Get sponsors from children
  const childTenantIds = parentTenant.childTenants || [];
  childTenantIds.forEach(childId => {
    const childTenant = findTenant_(childId);
    if (!childTenant) return;

    // Skip child tenants not included in portfolio reports
    if (childTenant.includeInPortfolioReports === false) return;

    const childDb = getDb_(childTenant);
    const childSponsors = childDb.list('sponsors') || [];
    childSponsors.forEach(sponsor => {
      addSponsor(sponsor, childId, childTenant.name);
    });
  });

  return {
    ok: true,
    value: {
      sponsors: Array.from(sponsorsMap.values()),
      totalCount: sponsorsMap.size
    }
  };
}
