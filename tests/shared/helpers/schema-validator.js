/**
 * Schema Validator Utility (Story 3.1)
 *
 * Centralized AJV-based schema validation for API responses.
 * Validates responses against JSON schemas in /schemas directory.
 *
 * Features:
 * - Loads and caches JSON schemas
 * - AJV validation with format support
 * - Jest-friendly assertion helpers
 * - Strict mode (additionalProperties: false)
 *
 * Usage:
 *   const { validateResponse, validateAgainstSchema } = require('./schema-validator');
 *   validateResponse(response, 'api-envelope');
 *   validateAgainstSchema(event, 'event');
 *
 * @see schemas/*.schema.json
 * @see API_CONTRACT.md
 */

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURATION
// ============================================================================

const SCHEMAS_DIR = path.resolve(__dirname, '../../../schemas');

/**
 * Schema registry mapping schema IDs to file names
 * This allows flexible naming while maintaining strict schema IDs
 */
const SCHEMA_REGISTRY = {
  // API Response Schemas
  'api-envelope': 'api-envelope.schema.json',
  'list-response': 'list-response.schema.json',
  'bundle-response': 'bundle-response.schema.json',
  'get-response': 'get-response.schema.json',
  'save-response': 'save-response.schema.json',
  'delete-response': 'delete-response.schema.json',
  'analytics-response': 'analytics-response.schema.json',

  // Entity Schemas
  'event': 'event.schema.json',
  'sponsor': 'sponsor.schema.json',
  'shared-analytics': 'shared-analytics.schema.json',

  // Status Schemas (Flat Format)
  'status': 'status.schema.json',
  'status-envelope': 'status-envelope.schema.json',
  'status-mvp': 'status-mvp.schema.json',

  // Utility Schemas
  'sponsor-report-qr': 'sponsor-report-qr.schema.json',
  'setupcheck': 'setupcheck.schema.json',
  'checkpermissions': 'checkpermissions.schema.json',
  'form-config': 'form-config.schema.json',
  'deploy-manifest': 'deploy-manifest.schema.json',
  'sponsor-portfolio-v2': 'sponsor-portfolio-v2.schema.json'
};

// ============================================================================
// AJV INSTANCE
// ============================================================================

/**
 * Create and configure AJV instance with strict validation
 * Note: Uses draft-07 compatible settings due to AJV's limited 2020-12 support
 */
const createAjvInstance = () => {
  const ajv = new Ajv({
    strict: false,  // Allow draft 2020-12 schemas (AJV has limited support)
    allErrors: true,
    verbose: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
    validateSchema: false  // Skip meta-schema validation for 2020-12 compatibility
  });

  // Add format validators (date-time, uri, email, etc.)
  addFormats(ajv);

  return ajv;
};

// Singleton AJV instance
let ajvInstance = null;

/**
 * Get singleton AJV instance
 * @returns {Ajv} AJV validator instance
 */
const getAjv = () => {
  if (!ajvInstance) {
    ajvInstance = createAjvInstance();
  }
  return ajvInstance;
};

// ============================================================================
// SCHEMA LOADING
// ============================================================================

/**
 * Schema cache for compiled validators
 * @type {Map<string, Function>}
 */
const schemaCache = new Map();

/**
 * Load a JSON schema file
 * @param {string} schemaId - Schema identifier from SCHEMA_REGISTRY
 * @returns {Object} Parsed JSON schema
 * @throws {Error} If schema file not found or invalid JSON
 */
const loadSchema = (schemaId) => {
  const fileName = SCHEMA_REGISTRY[schemaId];

  if (!fileName) {
    throw new Error(`Unknown schema ID: ${schemaId}. Available: ${Object.keys(SCHEMA_REGISTRY).join(', ')}`);
  }

  const schemaPath = path.join(SCHEMAS_DIR, fileName);

  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema file not found: ${schemaPath}`);
  }

  try {
    const content = fs.readFileSync(schemaPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse schema ${schemaId}: ${error.message}`);
  }
};

/**
 * Get compiled validator for a schema
 * @param {string} schemaId - Schema identifier
 * @returns {Function} Compiled AJV validator function
 */
const getValidator = (schemaId) => {
  if (schemaCache.has(schemaId)) {
    return schemaCache.get(schemaId);
  }

  const schema = loadSchema(schemaId);
  const ajv = getAjv();
  const validate = ajv.compile(schema);

  schemaCache.set(schemaId, validate);
  return validate;
};

/**
 * Clear schema cache (useful for testing)
 */
const clearSchemaCache = () => {
  schemaCache.clear();
  ajvInstance = null;
};

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate data against a schema
 * @param {*} data - Data to validate
 * @param {string} schemaId - Schema identifier
 * @returns {{ valid: boolean, errors: Array|null }} Validation result
 */
const validateAgainstSchema = (data, schemaId) => {
  const validate = getValidator(schemaId);
  const valid = validate(data);

  return {
    valid,
    errors: valid ? null : validate.errors
  };
};

/**
 * Validate API response against a schema (throws on failure)
 * @param {Object} response - API response object
 * @param {string} schemaId - Schema identifier
 * @throws {Error} If validation fails
 */
const validateResponse = (response, schemaId) => {
  const { valid, errors } = validateAgainstSchema(response, schemaId);

  if (!valid) {
    const errorDetails = formatValidationErrors(errors, schemaId);
    throw new Error(`Schema validation failed for ${schemaId}:\n${errorDetails}`);
  }
};

/**
 * Format AJV validation errors for readable output
 * @param {Array} errors - AJV error objects
 * @param {string} schemaId - Schema identifier
 * @returns {string} Formatted error message
 */
const formatValidationErrors = (errors, schemaId) => {
  if (!errors || errors.length === 0) {
    return 'No error details available';
  }

  return errors.map((err, index) => {
    const path = err.instancePath || '(root)';
    const message = err.message || 'Unknown error';
    const params = err.params ? JSON.stringify(err.params) : '';

    return `  [${index + 1}] ${path}: ${message} ${params}`;
  }).join('\n');
};

// ============================================================================
// JEST ASSERTION HELPERS
// ============================================================================

/**
 * Jest matcher: expect response to match schema
 * Usage: expect(response).toMatchSchema('api-envelope')
 *
 * @param {Object} received - Response to validate
 * @param {string} schemaId - Schema identifier
 * @returns {{ pass: boolean, message: Function }}
 */
const toMatchSchema = (received, schemaId) => {
  const { valid, errors } = validateAgainstSchema(received, schemaId);

  if (valid) {
    return {
      pass: true,
      message: () => `Expected response NOT to match schema '${schemaId}', but it did`
    };
  }

  return {
    pass: false,
    message: () => {
      const errorDetails = formatValidationErrors(errors, schemaId);
      return `Expected response to match schema '${schemaId}':\n${errorDetails}\n\nReceived:\n${JSON.stringify(received, null, 2)}`;
    }
  };
};

/**
 * Extend Jest with custom schema matchers
 * Call in test setup: extendJestWithSchemaMatchers()
 */
const extendJestWithSchemaMatchers = () => {
  if (typeof expect !== 'undefined' && expect.extend) {
    expect.extend({ toMatchSchema });
  }
};

// ============================================================================
// CONVENIENCE VALIDATORS
// ============================================================================

/**
 * Validate success envelope structure
 * @param {Object} response - API response
 * @returns {{ valid: boolean, errors: Array|null }}
 */
const validateSuccessEnvelope = (response) => {
  // Quick structural check
  if (!response || typeof response !== 'object') {
    return { valid: false, errors: [{ message: 'Response must be an object' }] };
  }

  if (response.ok !== true) {
    return { valid: false, errors: [{ message: 'Success envelope must have ok: true' }] };
  }

  if (!response.notModified && !('value' in response)) {
    return { valid: false, errors: [{ message: 'Success envelope must have value (unless notModified)' }] };
  }

  return validateAgainstSchema(response, 'api-envelope');
};

/**
 * Validate error envelope structure
 * @param {Object} response - API response
 * @returns {{ valid: boolean, errors: Array|null }}
 */
const validateErrorEnvelope = (response) => {
  if (!response || typeof response !== 'object') {
    return { valid: false, errors: [{ message: 'Response must be an object' }] };
  }

  if (response.ok !== false) {
    return { valid: false, errors: [{ message: 'Error envelope must have ok: false' }] };
  }

  if (!response.code || !response.message) {
    return { valid: false, errors: [{ message: 'Error envelope must have code and message' }] };
  }

  return validateAgainstSchema(response, 'api-envelope');
};

/**
 * Validate flat status response (not envelope-wrapped)
 * @param {Object} response - Status response
 * @returns {{ valid: boolean, errors: Array|null }}
 */
const validateFlatStatus = (response) => {
  return validateAgainstSchema(response, 'status');
};

/**
 * Validate event entity
 * @param {Object} event - Event object
 * @returns {{ valid: boolean, errors: Array|null }}
 */
const validateEvent = (event) => {
  return validateAgainstSchema(event, 'event');
};

/**
 * Validate sponsor entity
 * @param {Object} sponsor - Sponsor object
 * @returns {{ valid: boolean, errors: Array|null }}
 */
const validateSponsor = (sponsor) => {
  return validateAgainstSchema(sponsor, 'sponsor');
};

/**
 * Validate shared analytics response
 * @param {Object} analytics - Shared analytics object
 * @returns {{ valid: boolean, errors: Array|null }}
 */
const validateSharedAnalytics = (analytics) => {
  return validateAgainstSchema(analytics, 'shared-analytics');
};

// ============================================================================
// ENDPOINT-SPECIFIC VALIDATORS
// ============================================================================

/**
 * Endpoint to schema mapping for automatic validation
 */
const ENDPOINT_SCHEMAS = {
  // Flat endpoints (status)
  'status': 'status',
  'statusmvp': 'status-mvp',

  // Envelope endpoints
  'statusFull': 'status-envelope',
  'list': 'list-response',
  'get': 'get-response',
  'saveEvent': 'save-response',
  'updateEventData': 'save-response',
  'create': 'save-response',
  'delete': 'delete-response',
  'getPublicBundle': 'bundle-response',
  'getDisplayBundle': 'bundle-response',
  'getPosterBundle': 'bundle-response',
  'getAdminBundle': 'bundle-response',
  'getSharedAnalytics': 'analytics-response',
  'getSponsorAnalytics': 'analytics-response',
  'getReport': 'analytics-response',
  'setupCheck': 'setupcheck',
  'checkPermissions': 'checkpermissions',
  'getSponsorReportQr': 'sponsor-report-qr'
};

/**
 * Validate API response based on endpoint
 * @param {Object} response - API response
 * @param {string} endpoint - Endpoint name (e.g., 'list', 'getPublicBundle')
 * @returns {{ valid: boolean, errors: Array|null }}
 */
const validateEndpointResponse = (response, endpoint) => {
  const schemaId = ENDPOINT_SCHEMAS[endpoint];

  if (!schemaId) {
    return {
      valid: false,
      errors: [{ message: `Unknown endpoint: ${endpoint}. Use validateAgainstSchema for custom validation.` }]
    };
  }

  return validateAgainstSchema(response, schemaId);
};

// ============================================================================
// SCHEMA INTROSPECTION
// ============================================================================

/**
 * Get list of available schema IDs
 * @returns {string[]} Array of schema identifiers
 */
const getAvailableSchemas = () => {
  return Object.keys(SCHEMA_REGISTRY);
};

/**
 * Check if a schema exists
 * @param {string} schemaId - Schema identifier
 * @returns {boolean}
 */
const schemaExists = (schemaId) => {
  return Object.prototype.hasOwnProperty.call(SCHEMA_REGISTRY, schemaId);
};

/**
 * Get schema file path
 * @param {string} schemaId - Schema identifier
 * @returns {string|null} File path or null if not found
 */
const getSchemaPath = (schemaId) => {
  const fileName = SCHEMA_REGISTRY[schemaId];
  return fileName ? path.join(SCHEMAS_DIR, fileName) : null;
};

/**
 * Load all schemas and validate them
 * @returns {{ success: boolean, loaded: string[], failed: Array<{id: string, error: string}> }}
 */
const validateAllSchemas = () => {
  const loaded = [];
  const failed = [];

  for (const schemaId of Object.keys(SCHEMA_REGISTRY)) {
    try {
      getValidator(schemaId);
      loaded.push(schemaId);
    } catch (error) {
      failed.push({ id: schemaId, error: error.message });
    }
  }

  return {
    success: failed.length === 0,
    loaded,
    failed
  };
};

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Core validation
  validateAgainstSchema,
  validateResponse,
  validateEndpointResponse,

  // Convenience validators
  validateSuccessEnvelope,
  validateErrorEnvelope,
  validateFlatStatus,
  validateEvent,
  validateSponsor,
  validateSharedAnalytics,

  // Schema loading
  loadSchema,
  getValidator,
  clearSchemaCache,

  // Jest integration
  toMatchSchema,
  extendJestWithSchemaMatchers,
  formatValidationErrors,

  // Introspection
  getAvailableSchemas,
  schemaExists,
  getSchemaPath,
  validateAllSchemas,

  // Constants
  SCHEMA_REGISTRY,
  ENDPOINT_SCHEMAS,
  SCHEMAS_DIR
};
