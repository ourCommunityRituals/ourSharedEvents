/**
 * TemplateManagementService.gs
 *
 * V2 Event Template Management System
 *
 * ===============================================================================
 * [V2] SERVICE CONTRACT - Hidden from early bar pilots
 * ===============================================================================
 *
 * PURPOSE: Allow SEM staff and bar owners to tweak templates themselves
 *
 * FEATURE FLAG: TEMPLATE_MANAGEMENT_V2 (disabled by default)
 *
 * CRUD OPERATIONS:
 *   - listTemplatesV2: List all templates (built-in + custom)
 *   - getTemplateV2: Get a specific template by ID
 *   - createTemplateV2: Create a new custom template
 *   - updateTemplateV2: Update an existing custom template
 *   - deleteTemplateV2: Delete a custom template
 *   - cloneTemplateV2: Clone an existing template
 *   - validateTemplateV2: Validate template against schema constraints
 *
 * STORAGE: Custom templates stored in TemplatesV2 sheet
 * PROPAGATION: Changes propagate safely via TemplateService and event.schema.json
 *
 * SCHEMA COMPLIANCE: Templates MUST only produce fields defined in
 * /schemas/event.schema.json. Validation ensures this.
 *
 * @version 1.0.0
 * @since 2025-11-29
 */

// ============================================================================
// [V2] TEMPLATE MANAGEMENT CONSTANTS
// ============================================================================

/**
 * Valid section keys that templates can control
 * These map to event.settings.show* fields in event.schema.json
 */
const VALID_TEMPLATE_SECTIONS = [
  'video',      // → settings.showVideo
  'map',        // → settings.showMap
  'schedule',   // → settings.showSchedule
  'sponsors',   // → settings.showSponsors
  'gallery',    // → settings.showGallery
  'notes'       // → Legacy, not in schema (for internal template use only)
];

/**
 * Mapping from template sections to event.settings fields
 * Used for validation and propagation
 */
const SECTION_TO_SETTING_MAP = {
  video: 'showVideo',
  map: 'showMap',
  schedule: 'showSchedule',
  sponsors: 'showSponsors',
  gallery: 'showGallery'
  // notes: Not mapped - legacy field
};

/**
 * Required fields for a valid template
 */
const REQUIRED_TEMPLATE_FIELDS = ['id', 'label'];

/**
 * Template field constraints
 */
const TEMPLATE_CONSTRAINTS = {
  id: { maxLength: 64, pattern: /^[a-z_]+$/ },
  label: { maxLength: 100 },
  description: { maxLength: 500 },
  exampleName: { maxLength: 200 },
  icon: { maxLength: 10 },
  defaultCtas: { maxItems: 5, itemMaxLength: 50 }
};

/**
 * Sheet name for custom templates storage
 */
const TEMPLATES_V2_SHEET = 'TemplatesV2';

// ============================================================================
// [V2] TEMPLATE MANAGEMENT API ENDPOINTS
// ============================================================================

/**
 * API endpoint: List all templates (built-in + custom)
 *
 * @param {Object} params - Request parameters
 * @param {string} params.brandId - Brand ID for filtering
 * @param {boolean} [params.includeBuiltIn=true] - Include built-in templates
 * @param {boolean} [params.includeCustom=true] - Include custom templates
 * @returns {Object} Result envelope with templates array
 */
function api_listTemplatesV2(params) {
  // Gate by feature flag
  const featureGate = requireFeature_('TEMPLATE_MANAGEMENT_V2');
  if (featureGate) return featureGate;

  try {
    params = params || {};
    const brandId = params.brandId || 'root';
    const includeBuiltIn = params.includeBuiltIn !== false;
    const includeCustom = params.includeCustom !== false;

    const templates = [];

    // Add built-in templates (from TemplateService.gs)
    if (includeBuiltIn) {
      const builtInTemplates = getTemplatesForBrand_(brandId);
      builtInTemplates.forEach(t => {
        templates.push({
          ...t,
          source: 'built-in',
          editable: false
        });
      });
    }

    // Add custom templates (from TemplatesV2 sheet)
    if (includeCustom) {
      const customTemplates = listCustomTemplates_(brandId);
      customTemplates.forEach(t => {
        templates.push({
          ...t,
          source: 'custom',
          editable: true
        });
      });
    }

    Logger.log(`Listed ${templates.length} templates for brand ${brandId}`);

    return Ok({
      templates: templates,
      count: templates.length
    });

  } catch (err) {
    Logger.log('api_listTemplatesV2 error: ' + err);
    return Err('INTERNAL_ERROR', 'Failed to list templates: ' + err.message);
  }
}

/**
 * API endpoint: Get a specific template by ID
 *
 * @param {Object} params - Request parameters
 * @param {string} params.templateId - Template ID
 * @param {string} [params.brandId] - Brand ID for custom templates
 * @returns {Object} Result envelope with template
 */
function api_getTemplateV2(params) {
  // Gate by feature flag
  const featureGate = requireFeature_('TEMPLATE_MANAGEMENT_V2');
  if (featureGate) return featureGate;

  try {
    if (!params || !params.templateId) {
      return Err('BAD_INPUT', 'Missing required parameter: templateId');
    }

    const templateId = params.templateId;
    const brandId = params.brandId || 'root';

    // First check custom templates
    const customTemplate = getCustomTemplate_(brandId, templateId);
    if (customTemplate) {
      return Ok({
        template: {
          ...customTemplate,
          source: 'custom',
          editable: true
        }
      });
    }

    // Fall back to built-in templates
    const builtInTemplate = getEventTemplate_(templateId);
    if (builtInTemplate && builtInTemplate.id !== 'custom') {
      return Ok({
        template: {
          ...builtInTemplate,
          source: 'built-in',
          editable: false
        }
      });
    }

    return Err('NOT_FOUND', `Template not found: ${templateId}`);

  } catch (err) {
    Logger.log('api_getTemplateV2 error: ' + err);
    return Err('INTERNAL_ERROR', 'Failed to get template: ' + err.message);
  }
}

/**
 * API endpoint: Create a new custom template
 *
 * @param {Object} params - Request parameters
 * @param {string} params.brandId - Brand ID
 * @param {Object} params.template - Template data
 * @returns {Object} Result envelope with created template
 */
function api_createTemplateV2(params) {
  // Gate by feature flag
  const featureGate = requireFeature_('TEMPLATE_MANAGEMENT_V2');
  if (featureGate) return featureGate;

  try {
    if (!params || !params.template) {
      return Err('BAD_INPUT', 'Missing required parameter: template');
    }

    const brandId = params.brandId || 'root';
    const template = params.template;

    // Validate template
    const validation = validateTemplateV2_(template);
    if (!validation.ok) {
      return validation;
    }

    // Check for duplicate ID
    const existing = getCustomTemplate_(brandId, template.id);
    if (existing) {
      return Err('CONFLICT', `Template with ID '${template.id}' already exists`);
    }

    // Check if ID conflicts with built-in template
    if (isValidTemplate_(template.id)) {
      return Err('CONFLICT', `Cannot use built-in template ID '${template.id}'`);
    }

    // Create the template
    const created = createCustomTemplate_(brandId, template);

    Logger.log(`Created custom template: ${created.id} for brand ${brandId}`);

    return Ok({
      template: {
        ...created,
        source: 'custom',
        editable: true
      }
    });

  } catch (err) {
    Logger.log('api_createTemplateV2 error: ' + err);
    return Err('INTERNAL_ERROR', 'Failed to create template: ' + err.message);
  }
}

/**
 * API endpoint: Update an existing custom template
 *
 * @param {Object} params - Request parameters
 * @param {string} params.templateId - Template ID to update
 * @param {string} params.brandId - Brand ID
 * @param {Object} params.updates - Fields to update
 * @returns {Object} Result envelope with updated template
 */
function api_updateTemplateV2(params) {
  // Gate by feature flag
  const featureGate = requireFeature_('TEMPLATE_MANAGEMENT_V2');
  if (featureGate) return featureGate;

  try {
    if (!params || !params.templateId || !params.updates) {
      return Err('BAD_INPUT', 'Missing required parameters: templateId, updates');
    }

    const templateId = params.templateId;
    const brandId = params.brandId || 'root';
    const updates = params.updates;

    // Check if template exists
    const existing = getCustomTemplate_(brandId, templateId);
    if (!existing) {
      // Check if it's a built-in template (not editable)
      if (isValidTemplate_(templateId)) {
        return Err('FORBIDDEN', 'Cannot modify built-in templates. Clone it first.');
      }
      return Err('NOT_FOUND', `Template not found: ${templateId}`);
    }

    // Merge updates with existing
    const merged = { ...existing, ...updates };

    // Don't allow changing the ID
    merged.id = existing.id;

    // Validate merged template
    const validation = validateTemplateV2_(merged);
    if (!validation.ok) {
      return validation;
    }

    // Update the template
    const updated = updateCustomTemplate_(brandId, templateId, merged);

    Logger.log(`Updated custom template: ${updated.id} for brand ${brandId}`);

    return Ok({
      template: {
        ...updated,
        source: 'custom',
        editable: true
      }
    });

  } catch (err) {
    Logger.log('api_updateTemplateV2 error: ' + err);
    return Err('INTERNAL_ERROR', 'Failed to update template: ' + err.message);
  }
}

/**
 * API endpoint: Delete a custom template
 *
 * @param {Object} params - Request parameters
 * @param {string} params.templateId - Template ID to delete
 * @param {string} params.brandId - Brand ID
 * @returns {Object} Result envelope
 */
function api_deleteTemplateV2(params) {
  // Gate by feature flag
  const featureGate = requireFeature_('TEMPLATE_MANAGEMENT_V2');
  if (featureGate) return featureGate;

  try {
    if (!params || !params.templateId) {
      return Err('BAD_INPUT', 'Missing required parameter: templateId');
    }

    const templateId = params.templateId;
    const brandId = params.brandId || 'root';

    // Check if template exists
    const existing = getCustomTemplate_(brandId, templateId);
    if (!existing) {
      // Check if it's a built-in template
      if (isValidTemplate_(templateId)) {
        return Err('FORBIDDEN', 'Cannot delete built-in templates');
      }
      return Err('NOT_FOUND', `Template not found: ${templateId}`);
    }

    // Delete the template
    deleteCustomTemplate_(brandId, templateId);

    Logger.log(`Deleted custom template: ${templateId} for brand ${brandId}`);

    return Ok({
      deleted: true,
      templateId: templateId
    });

  } catch (err) {
    Logger.log('api_deleteTemplateV2 error: ' + err);
    return Err('INTERNAL_ERROR', 'Failed to delete template: ' + err.message);
  }
}

/**
 * API endpoint: Clone an existing template
 *
 * @param {Object} params - Request parameters
 * @param {string} params.sourceTemplateId - Template ID to clone
 * @param {string} params.newTemplateId - New template ID
 * @param {string} params.newLabel - New template label
 * @param {string} params.brandId - Brand ID
 * @returns {Object} Result envelope with cloned template
 */
function api_cloneTemplateV2(params) {
  // Gate by feature flag
  const featureGate = requireFeature_('TEMPLATE_MANAGEMENT_V2');
  if (featureGate) return featureGate;

  try {
    if (!params || !params.sourceTemplateId || !params.newTemplateId) {
      return Err('BAD_INPUT', 'Missing required parameters: sourceTemplateId, newTemplateId');
    }

    const sourceId = params.sourceTemplateId;
    const newId = params.newTemplateId;
    const newLabel = params.newLabel || `Copy of ${sourceId}`;
    const brandId = params.brandId || 'root';

    // Get source template (custom or built-in)
    let sourceTemplate = getCustomTemplate_(brandId, sourceId);
    if (!sourceTemplate) {
      sourceTemplate = getEventTemplate_(sourceId);
    }

    if (!sourceTemplate) {
      return Err('NOT_FOUND', `Source template not found: ${sourceId}`);
    }

    // Check if new ID already exists
    if (getCustomTemplate_(brandId, newId) || isValidTemplate_(newId)) {
      return Err('CONFLICT', `Template with ID '${newId}' already exists`);
    }

    // Validate new ID format
    if (!TEMPLATE_CONSTRAINTS.id.pattern.test(newId)) {
      return Err('BAD_INPUT', 'Template ID must be lowercase letters and underscores only');
    }

    // Create the cloned template
    const cloned = {
      ...sourceTemplate,
      id: newId,
      label: newLabel,
      clonedFrom: sourceId,
      createdAtISO: new Date().toISOString()
    };

    const created = createCustomTemplate_(brandId, cloned);

    Logger.log(`Cloned template ${sourceId} → ${newId} for brand ${brandId}`);

    return Ok({
      template: {
        ...created,
        source: 'custom',
        editable: true
      }
    });

  } catch (err) {
    Logger.log('api_cloneTemplateV2 error: ' + err);
    return Err('INTERNAL_ERROR', 'Failed to clone template: ' + err.message);
  }
}

/**
 * API endpoint: Validate a template
 *
 * @param {Object} params - Request parameters
 * @param {Object} params.template - Template to validate
 * @returns {Object} Result envelope with validation result
 */
function api_validateTemplateV2(params) {
  // Gate by feature flag
  const featureGate = requireFeature_('TEMPLATE_MANAGEMENT_V2');
  if (featureGate) return featureGate;

  try {
    if (!params || !params.template) {
      return Err('BAD_INPUT', 'Missing required parameter: template');
    }

    return validateTemplateV2_(params.template);

  } catch (err) {
    Logger.log('api_validateTemplateV2 error: ' + err);
    return Err('INTERNAL_ERROR', 'Failed to validate template: ' + err.message);
  }
}

/**
 * API endpoint: Get template schema (for UI form generation)
 *
 * @param {Object} params - Request parameters (unused)
 * @returns {Object} Result envelope with schema definition
 */
function api_getTemplateSchemaV2(params) {
  // Gate by feature flag
  const featureGate = requireFeature_('TEMPLATE_MANAGEMENT_V2');
  if (featureGate) return featureGate;

  return Ok({
    schema: {
      fields: [
        {
          id: 'id',
          label: 'Template ID',
          type: 'text',
          required: true,
          pattern: '^[a-z_]+$',
          maxLength: 64,
          helpText: 'Lowercase letters and underscores only (e.g., my_custom_template)'
        },
        {
          id: 'label',
          label: 'Display Name',
          type: 'text',
          required: true,
          maxLength: 100,
          helpText: 'Human-readable name shown in the template picker'
        },
        {
          id: 'description',
          label: 'Description',
          type: 'textarea',
          required: false,
          maxLength: 500,
          helpText: 'Brief description of when to use this template'
        },
        {
          id: 'icon',
          label: 'Icon',
          type: 'text',
          required: false,
          maxLength: 10,
          helpText: 'Emoji or character to display (e.g., 🎉)'
        },
        {
          id: 'exampleName',
          label: 'Example Event Name',
          type: 'text',
          required: false,
          maxLength: 200,
          helpText: 'Example event name for this template type'
        },
        {
          id: 'sections',
          label: 'Default Sections',
          type: 'section_toggles',
          required: false,
          options: VALID_TEMPLATE_SECTIONS.filter(s => s !== 'notes'),
          helpText: 'Which sections are enabled by default'
        },
        {
          id: 'defaultCtas',
          label: 'Default CTA Labels',
          type: 'array',
          required: false,
          maxItems: 5,
          itemMaxLength: 50,
          helpText: 'Suggested call-to-action button labels'
        },
        {
          id: 'defaults',
          label: 'Default Values',
          type: 'object',
          required: false,
          properties: {
            audience: { type: 'text', label: 'Target Audience' },
            notesLabel: { type: 'text', label: 'Notes Section Label' },
            sponsorStripLabel: { type: 'text', label: 'Sponsor Strip Label' }
          },
          helpText: 'Pre-filled values for events using this template'
        }
      ],
      sections: VALID_TEMPLATE_SECTIONS.map(s => ({
        id: s,
        label: s.charAt(0).toUpperCase() + s.slice(1),
        settingsField: SECTION_TO_SETTING_MAP[s] || null
      }))
    }
  });
}

// ============================================================================
// [V2] TEMPLATE VALIDATION
// ============================================================================

/**
 * Validate a template against schema constraints
 *
 * @param {Object} template - Template to validate
 * @returns {Object} Result envelope with validation result
 * @private
 */
function validateTemplateV2_(template) {
  const errors = [];

  // Check required fields
  for (const field of REQUIRED_TEMPLATE_FIELDS) {
    if (!template[field]) {
      errors.push({
        field: field,
        message: `${field} is required`,
        code: 'REQUIRED_FIELD'
      });
    }
  }

  // Validate ID format
  if (template.id) {
    if (template.id.length > TEMPLATE_CONSTRAINTS.id.maxLength) {
      errors.push({
        field: 'id',
        message: `ID must be at most ${TEMPLATE_CONSTRAINTS.id.maxLength} characters`,
        code: 'MAX_LENGTH'
      });
    }
    if (!TEMPLATE_CONSTRAINTS.id.pattern.test(template.id)) {
      errors.push({
        field: 'id',
        message: 'ID must be lowercase letters and underscores only',
        code: 'INVALID_FORMAT'
      });
    }
  }

  // Validate label length
  if (template.label && template.label.length > TEMPLATE_CONSTRAINTS.label.maxLength) {
    errors.push({
      field: 'label',
      message: `Label must be at most ${TEMPLATE_CONSTRAINTS.label.maxLength} characters`,
      code: 'MAX_LENGTH'
    });
  }

  // Validate description length
  if (template.description && template.description.length > TEMPLATE_CONSTRAINTS.description.maxLength) {
    errors.push({
      field: 'description',
      message: `Description must be at most ${TEMPLATE_CONSTRAINTS.description.maxLength} characters`,
      code: 'MAX_LENGTH'
    });
  }

  // Validate sections (must be valid section keys)
  if (template.sections) {
    for (const key of Object.keys(template.sections)) {
      if (!VALID_TEMPLATE_SECTIONS.includes(key)) {
        errors.push({
          field: 'sections',
          message: `Invalid section key: ${key}. Valid keys: ${VALID_TEMPLATE_SECTIONS.join(', ')}`,
          code: 'INVALID_SECTION'
        });
      }
      if (typeof template.sections[key] !== 'boolean') {
        errors.push({
          field: `sections.${key}`,
          message: 'Section values must be boolean (true/false)',
          code: 'TYPE_MISMATCH'
        });
      }
    }
  }

  // Validate defaultCtas
  if (template.defaultCtas) {
    if (!Array.isArray(template.defaultCtas)) {
      errors.push({
        field: 'defaultCtas',
        message: 'defaultCtas must be an array',
        code: 'TYPE_MISMATCH'
      });
    } else {
      if (template.defaultCtas.length > TEMPLATE_CONSTRAINTS.defaultCtas.maxItems) {
        errors.push({
          field: 'defaultCtas',
          message: `Maximum ${TEMPLATE_CONSTRAINTS.defaultCtas.maxItems} CTA labels allowed`,
          code: 'MAX_ITEMS'
        });
      }
      template.defaultCtas.forEach((cta, index) => {
        if (typeof cta !== 'string') {
          errors.push({
            field: `defaultCtas[${index}]`,
            message: 'CTA labels must be strings',
            code: 'TYPE_MISMATCH'
          });
        } else if (cta.length > TEMPLATE_CONSTRAINTS.defaultCtas.itemMaxLength) {
          errors.push({
            field: `defaultCtas[${index}]`,
            message: `CTA label must be at most ${TEMPLATE_CONSTRAINTS.defaultCtas.itemMaxLength} characters`,
            code: 'MAX_LENGTH'
          });
        }
      });
    }
  }

  // Validate icon length
  if (template.icon && template.icon.length > TEMPLATE_CONSTRAINTS.icon.maxLength) {
    errors.push({
      field: 'icon',
      message: `Icon must be at most ${TEMPLATE_CONSTRAINTS.icon.maxLength} characters`,
      code: 'MAX_LENGTH'
    });
  }

  const valid = errors.length === 0;

  if (valid) {
    return Ok({
      valid: true,
      errors: [],
      templateId: template.id
    });
  } else {
    return Err('VALIDATION_FAILED', 'Template validation failed', { errors: errors });
  }
}

// ============================================================================
// [V2] CUSTOM TEMPLATE STORAGE (Sheet-based)
// ============================================================================

/**
 * Get or create the TemplatesV2 sheet
 *
 * @param {string} brandId - Brand ID
 * @returns {Sheet} The TemplatesV2 sheet
 * @private
 */
function getTemplatesV2Sheet_(brandId) {
  const spreadsheetId = getSpreadsheetId_(brandId);
  const ss = SpreadsheetApp.openById(spreadsheetId);

  let sheet = ss.getSheetByName(TEMPLATES_V2_SHEET);
  if (!sheet) {
    // Create sheet with headers
    sheet = ss.insertSheet(TEMPLATES_V2_SHEET);
    sheet.getRange(1, 1, 1, 8).setValues([[
      'id', 'brandId', 'label', 'description', 'icon', 'sectionsJson', 'defaultsJson', 'createdAtISO'
    ]]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

/**
 * List all custom templates for a brand
 *
 * @param {string} brandId - Brand ID
 * @returns {Array} Array of custom template objects
 * @private
 */
function listCustomTemplates_(brandId) {
  const sheet = getTemplatesV2Sheet_(brandId);
  const data = sheet.getDataRange().getValues();

  if (data.length <= 1) return []; // Only headers

  const headers = data[0];
  const templates = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const template = {};

    for (let j = 0; j < headers.length; j++) {
      template[headers[j]] = row[j];
    }

    // Filter by brand
    if (template.brandId !== brandId) continue;

    // Parse JSON fields
    if (template.sectionsJson) {
      try {
        template.sections = JSON.parse(template.sectionsJson);
      } catch (e) {
        template.sections = {};
      }
    }

    if (template.defaultsJson) {
      try {
        template.defaults = JSON.parse(template.defaultsJson);
        // Also parse defaultCtas if stored in defaults
        if (template.defaults.defaultCtas) {
          template.defaultCtas = template.defaults.defaultCtas;
        }
      } catch (e) {
        template.defaults = {};
      }
    }

    // Clean up JSON fields
    delete template.sectionsJson;
    delete template.defaultsJson;
    delete template.brandId;

    templates.push(template);
  }

  return templates;
}

/**
 * Get a specific custom template by ID
 *
 * @param {string} brandId - Brand ID
 * @param {string} templateId - Template ID
 * @returns {Object|null} Template object or null
 * @private
 */
function getCustomTemplate_(brandId, templateId) {
  const templates = listCustomTemplates_(brandId);
  return templates.find(t => t.id === templateId) || null;
}

/**
 * Create a new custom template
 *
 * @param {string} brandId - Brand ID
 * @param {Object} template - Template data
 * @returns {Object} Created template
 * @private
 */
function createCustomTemplate_(brandId, template) {
  const sheet = getTemplatesV2Sheet_(brandId);

  const now = new Date().toISOString();
  const defaults = { ...(template.defaults || {}) };
  if (template.defaultCtas) {
    defaults.defaultCtas = template.defaultCtas;
  }
  if (template.exampleName) {
    defaults.exampleName = template.exampleName;
  }

  const row = [
    template.id,
    brandId,
    template.label || '',
    template.description || '',
    template.icon || '',
    JSON.stringify(template.sections || {}),
    JSON.stringify(defaults),
    template.createdAtISO || now
  ];

  sheet.appendRow(row);

  return {
    id: template.id,
    label: template.label,
    description: template.description,
    icon: template.icon,
    sections: template.sections || {},
    defaults: template.defaults || {},
    defaultCtas: template.defaultCtas || [],
    exampleName: template.exampleName,
    createdAtISO: template.createdAtISO || now
  };
}

/**
 * Update an existing custom template
 *
 * @param {string} brandId - Brand ID
 * @param {string} templateId - Template ID
 * @param {Object} updates - Updated template data
 * @returns {Object} Updated template
 * @private
 */
function updateCustomTemplate_(brandId, templateId, updates) {
  const sheet = getTemplatesV2Sheet_(brandId);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const idCol = headers.indexOf('id');
    const brandCol = headers.indexOf('brandId');
    if (row[idCol] === templateId && row[brandCol] === brandId) {
      rowIndex = i + 1; // 1-indexed for sheet
      break;
    }
  }

  if (rowIndex === -1) {
    throw new Error('Template not found');
  }

  const defaults = { ...(updates.defaults || {}) };
  if (updates.defaultCtas) {
    defaults.defaultCtas = updates.defaultCtas;
  }
  if (updates.exampleName) {
    defaults.exampleName = updates.exampleName;
  }

  const row = [
    updates.id,
    brandId,
    updates.label || '',
    updates.description || '',
    updates.icon || '',
    JSON.stringify(updates.sections || {}),
    JSON.stringify(defaults),
    updates.createdAtISO || new Date().toISOString()
  ];

  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);

  return {
    id: updates.id,
    label: updates.label,
    description: updates.description,
    icon: updates.icon,
    sections: updates.sections || {},
    defaults: updates.defaults || {},
    defaultCtas: updates.defaultCtas || [],
    exampleName: updates.exampleName,
    createdAtISO: updates.createdAtISO
  };
}

/**
 * Delete a custom template
 *
 * @param {string} brandId - Brand ID
 * @param {string} templateId - Template ID
 * @private
 */
function deleteCustomTemplate_(brandId, templateId) {
  const sheet = getTemplatesV2Sheet_(brandId);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const idCol = headers.indexOf('id');
    const brandCol = headers.indexOf('brandId');
    if (row[idCol] === templateId && row[brandCol] === brandId) {
      sheet.deleteRow(i + 1); // 1-indexed
      return;
    }
  }

  throw new Error('Template not found');
}

// ============================================================================
// [V2] TEMPLATE PROPAGATION HELPERS
// ============================================================================

/**
 * Get effective template for an event (custom or built-in)
 * Used by TemplateService when applying templates to events
 *
 * @param {string} brandId - Brand ID
 * @param {string} templateId - Template ID
 * @returns {Object} Template object
 */
function getEffectiveTemplate_(brandId, templateId) {
  // First check custom templates
  const customTemplate = getCustomTemplate_(brandId, templateId);
  if (customTemplate) {
    return customTemplate;
  }

  // Fall back to built-in
  return getEventTemplate_(templateId);
}

/**
 * Get all available templates for a brand (custom + built-in)
 * Used by Admin.html template picker when V2 feature is enabled
 *
 * @param {string} brandId - Brand ID
 * @returns {Array} Array of template objects
 */
function getAllTemplatesForBrand_(brandId) {
  // Check if feature is enabled
  if (!isFeatureEnabled_('TEMPLATE_MANAGEMENT_V2')) {
    return getTemplatesForBrand_(brandId);
  }

  const templates = [];

  // Add built-in templates
  const builtIn = getTemplatesForBrand_(brandId);
  builtIn.forEach(t => {
    templates.push({
      ...t,
      source: 'built-in',
      editable: false
    });
  });

  // Add custom templates
  const custom = listCustomTemplates_(brandId);
  custom.forEach(t => {
    templates.push({
      ...t,
      source: 'custom',
      editable: true
    });
  });

  return templates;
}
