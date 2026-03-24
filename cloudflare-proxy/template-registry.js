/**
 * Template Registry - Template Sanity Helpers
 *
 * Story 3: Ensure Admin/Public/Display/Poster Templates Are Bundled & Accessible
 *
 * This module provides template validation and retrieval helpers to guarantee
 * that the Worker has all templates it needs. If a template is missing or empty,
 * these functions throw descriptive errors rather than silently failing.
 *
 * Usage:
 *   const { getTemplate, validateTemplate, TEMPLATE_NAMES } = require('./template-registry');
 *   const html = await getTemplate('admin', env);
 *
 * Templates are loaded from Cloudflare KV storage (TEMPLATES_KV binding).
 * In development/testing, templates can be loaded from the file system.
 */

/**
 * Canonical template names - the ONLY valid template identifiers
 * Maps to files in cloudflare-proxy/templates/<name>.html
 */
const TEMPLATE_NAMES = Object.freeze({
  admin: 'admin',
  public: 'public',
  display: 'display',
  poster: 'poster',
  report: 'report'
});

/**
 * Get all valid template names as an array
 * @returns {string[]} Array of valid template names
 */
function getTemplateNames() {
  return Object.keys(TEMPLATE_NAMES);
}

/**
 * Check if a template name is valid
 * @param {string} name - Template name to check
 * @returns {boolean} True if valid
 */
function isValidTemplateName(name) {
  return name && Object.hasOwn(TEMPLATE_NAMES, name.toLowerCase());
}

/**
 * Template validation error - thrown when template is missing or empty
 */
class TemplateError extends Error {
  /**
   * @param {string} templateName - Name of the template that failed
   * @param {string} reason - Reason for failure
   */
  constructor(templateName, reason) {
    super(`Template '${templateName}' error: ${reason}`);
    this.name = 'TemplateError';
    this.templateName = templateName;
    this.reason = reason;
  }
}

/**
 * Validate template content
 *
 * Throws TemplateError if:
 * - Template name is not valid
 * - Content is null, undefined, or not a string
 * - Content is empty or whitespace-only
 * - Content doesn't look like HTML (basic sanity check)
 *
 * @param {string} templateName - Template name
 * @param {*} content - Template content to validate
 * @throws {TemplateError} If validation fails
 * @returns {string} The validated content (trimmed)
 */
function validateTemplate(templateName, content) {
  // Validate template name
  if (!isValidTemplateName(templateName)) {
    throw new TemplateError(templateName, `Invalid template name. Valid names: ${getTemplateNames().join(', ')}`);
  }

  // Check for null/undefined
  if (content == null) {
    throw new TemplateError(templateName, 'Template content is null or undefined');
  }

  // Check for string type
  if (typeof content !== 'string') {
    throw new TemplateError(templateName, `Template content must be string, got ${typeof content}`);
  }

  // Check for empty content
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new TemplateError(templateName, 'Template content is empty');
  }

  // Basic HTML sanity check - should contain doctype or html tag
  const lowerContent = trimmed.toLowerCase();
  if (!lowerContent.includes('<!doctype html') && !lowerContent.includes('<html')) {
    throw new TemplateError(templateName, 'Template content does not appear to be valid HTML');
  }

  // Check minimum length (HTML templates should be reasonably sized)
  const MIN_TEMPLATE_SIZE = 100; // bytes
  if (trimmed.length < MIN_TEMPLATE_SIZE) {
    throw new TemplateError(templateName, `Template content too small (${trimmed.length} bytes, min ${MIN_TEMPLATE_SIZE})`);
  }

  return trimmed;
}

/**
 * Get and validate template content from KV storage
 *
 * This is the primary template retrieval function. It:
 * 1. Validates the template name
 * 2. Fetches from KV storage
 * 3. Validates the content is non-empty HTML
 * 4. Throws TemplateError if any step fails
 *
 * @param {string} templateName - Template name (admin, public, display, poster, report)
 * @param {Object} env - Worker environment with TEMPLATES_KV binding
 * @throws {TemplateError} If template is missing, empty, or invalid
 * @returns {Promise<string>} Template HTML content
 */
async function getTemplate(templateName, env) {
  // Normalize template name
  const name = templateName?.toLowerCase();

  // Validate template name first
  if (!isValidTemplateName(name)) {
    throw new TemplateError(templateName, `Invalid template name. Valid names: ${getTemplateNames().join(', ')}`);
  }

  const templateFile = `${name}.html`;

  // Try KV storage first (for production deployments)
  if (env?.TEMPLATES_KV) {
    try {
      const content = await env.TEMPLATES_KV.get(templateFile);

      if (content) {
        // Validate and return
        return validateTemplate(name, content);
      }

      // Content was null - template not in KV
      throw new TemplateError(name, `Template file '${templateFile}' not found in KV storage`);
    } catch (e) {
      // Re-throw TemplateError, wrap others
      if (e instanceof TemplateError) {
        throw e;
      }
      throw new TemplateError(name, `KV fetch error: ${e.message}`);
    }
  }

  // No KV binding - cannot load templates
  throw new TemplateError(name, 'TEMPLATES_KV binding not available - templates cannot be loaded');
}

/**
 * Check if all required templates are available
 *
 * This function validates that all core templates are present and valid.
 * Useful for health checks and startup validation.
 *
 * @param {Object} env - Worker environment with TEMPLATES_KV binding
 * @returns {Promise<Object>} Validation result with status and details
 */
async function validateAllTemplates(env) {
  const result = {
    valid: true,
    templates: {},
    errors: [],
    timestamp: new Date().toISOString()
  };

  for (const name of getTemplateNames()) {
    try {
      const content = await getTemplate(name, env);
      result.templates[name] = {
        valid: true,
        size: content.length,
        hasDoctype: content.toLowerCase().includes('<!doctype html')
      };
    } catch (e) {
      result.valid = false;
      result.templates[name] = {
        valid: false,
        error: e.message
      };
      result.errors.push(`${name}: ${e.message}`);
    }
  }

  return result;
}

/**
 * Get template manifest from KV storage
 *
 * @param {Object} env - Worker environment with TEMPLATES_KV binding
 * @returns {Promise<Object|null>} Manifest object or null if not found
 */
async function getManifest(env) {
  if (!env?.TEMPLATES_KV) {
    return null;
  }

  try {
    const manifestStr = await env.TEMPLATES_KV.get('manifest.json');
    if (manifestStr) {
      return JSON.parse(manifestStr);
    }
  } catch (e) {
    console.error('[EventAngle] Failed to load template manifest:', e.message);
  }

  return null;
}

// Export for use in Worker and tests
module.exports = {
  TEMPLATE_NAMES,
  TemplateError,
  getTemplateNames,
  isValidTemplateName,
  validateTemplate,
  getTemplate,
  validateAllTemplates,
  getManifest
};
