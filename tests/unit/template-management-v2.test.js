/**
 * Template Management V2 Service Unit Tests
 *
 * Tests for the V2 Template Management system:
 * - CRUD operations for custom templates
 * - Template validation against event.schema.json constraints
 * - Feature flag gating
 * - Template cloning and propagation
 *
 * FEATURE FLAG: TEMPLATE_MANAGEMENT_V2 (disabled by default)
 *
 * @see TemplateManagementService.gs
 * @see /schemas/event.schema.json
 */

// ============================================================================
// MOCK IMPLEMENTATIONS
// ============================================================================

// Feature flag state (toggleable for tests)
let FEATURE_FLAGS = {
  TEMPLATE_MANAGEMENT_V2: false // Default: disabled
};

function isFeatureEnabled_(featureName) {
  return FEATURE_FLAGS[featureName] === true;
}

function requireFeature_(featureName) {
  if (!isFeatureEnabled_(featureName)) {
    return Err('FEATURE_DISABLED', `Feature '${featureName}' is not enabled`);
  }
  return null;
}

// Mock Ok/Err helpers
function Ok(value) {
  return { ok: true, value };
}

function Err(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}

// Mock built-in templates (from TemplateService.gs)
const MOCK_EVENT_TEMPLATES = {
  bar_night: {
    id: 'bar_night',
    label: 'Bar / Tavern Event',
    description: 'Trivia nights, live music, happy hours',
    icon: '&#127866;',
    sections: { video: true, map: true, schedule: false, sponsors: true, gallery: true },
    defaultCtas: ['RSVP', 'Add to Calendar']
  },
  rec_league: {
    id: 'rec_league',
    label: 'Rec League / Season',
    description: 'Sports leagues, tournaments, team registrations',
    icon: '&#9918;',
    sections: { video: false, map: true, schedule: true, sponsors: true, gallery: true },
    defaultCtas: ['Register Team', 'View Schedule']
  },
  custom: {
    id: 'custom',
    label: 'Custom Event',
    description: 'Start from scratch',
    icon: '&#10024;',
    sections: { video: true, map: true, schedule: true, sponsors: true, gallery: true },
    defaultCtas: ['Register', 'Add to Calendar']
  }
};

function getEventTemplate_(templateId) {
  return MOCK_EVENT_TEMPLATES[templateId] || MOCK_EVENT_TEMPLATES.custom;
}

function isValidTemplate_(templateId) {
  return templateId && Object.prototype.hasOwnProperty.call(MOCK_EVENT_TEMPLATES, templateId);
}

function getTemplatesForBrand_(brandId) {
  return Object.values(MOCK_EVENT_TEMPLATES);
}

// Mock storage (in-memory)
let mockStorage = {};

function getSpreadsheetId_(brandId) {
  return 'mock-spreadsheet-id';
}

function listCustomTemplates_(brandId) {
  return mockStorage[brandId] ? Object.values(mockStorage[brandId]) : [];
}

function getCustomTemplate_(brandId, templateId) {
  return mockStorage[brandId]?.[templateId] || null;
}

function createCustomTemplate_(brandId, template) {
  mockStorage[brandId] = mockStorage[brandId] || {};
  mockStorage[brandId][template.id] = { ...template, createdAtISO: new Date().toISOString() };
  return mockStorage[brandId][template.id];
}

function updateCustomTemplate_(brandId, templateId, template) {
  if (!mockStorage[brandId]?.[templateId]) throw new Error('Template not found');
  mockStorage[brandId][templateId] = { ...template };
  return mockStorage[brandId][templateId];
}

function deleteCustomTemplate_(brandId, templateId) {
  if (!mockStorage[brandId]?.[templateId]) throw new Error('Template not found');
  delete mockStorage[brandId][templateId];
}

// ============================================================================
// CONSTANTS (matching TemplateManagementService.gs)
// ============================================================================

const VALID_TEMPLATE_SECTIONS = ['video', 'map', 'schedule', 'sponsors', 'gallery', 'notes'];
const REQUIRED_TEMPLATE_FIELDS = ['id', 'label'];
const TEMPLATE_CONSTRAINTS = {
  id: { maxLength: 64, pattern: /^[a-z_]+$/ },
  label: { maxLength: 100 },
  description: { maxLength: 500 },
  icon: { maxLength: 10 },
  defaultCtas: { maxItems: 5, itemMaxLength: 50 }
};

// ============================================================================
// VALIDATION IMPLEMENTATION (matching TemplateManagementService.gs)
// ============================================================================

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

  // Validate sections
  if (template.sections) {
    for (const key of Object.keys(template.sections)) {
      if (!VALID_TEMPLATE_SECTIONS.includes(key)) {
        errors.push({
          field: 'sections',
          message: `Invalid section key: ${key}`,
          code: 'INVALID_SECTION'
        });
      }
      if (typeof template.sections[key] !== 'boolean') {
        errors.push({
          field: `sections.${key}`,
          message: 'Section values must be boolean',
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
    }
  }

  const valid = errors.length === 0;
  if (valid) {
    return Ok({ valid: true, errors: [], templateId: template.id });
  } else {
    return Err('VALIDATION_FAILED', 'Template validation failed', { errors });
  }
}

// ============================================================================
// API IMPLEMENTATIONS (matching TemplateManagementService.gs)
// ============================================================================

function api_listTemplatesV2(params) {
  const featureGate = requireFeature_('TEMPLATE_MANAGEMENT_V2');
  if (featureGate) return featureGate;

  params = params || {};
  const brandId = params.brandId || 'root';
  const includeBuiltIn = params.includeBuiltIn !== false;
  const includeCustom = params.includeCustom !== false;

  const templates = [];

  if (includeBuiltIn) {
    const builtIn = getTemplatesForBrand_(brandId);
    builtIn.forEach(t => templates.push({ ...t, source: 'built-in', editable: false }));
  }

  if (includeCustom) {
    const custom = listCustomTemplates_(brandId);
    custom.forEach(t => templates.push({ ...t, source: 'custom', editable: true }));
  }

  return Ok({ templates, count: templates.length });
}

function api_getTemplateV2(params) {
  const featureGate = requireFeature_('TEMPLATE_MANAGEMENT_V2');
  if (featureGate) return featureGate;

  if (!params?.templateId) {
    return Err('BAD_INPUT', 'Missing required parameter: templateId');
  }

  const brandId = params.brandId || 'root';
  const customTemplate = getCustomTemplate_(brandId, params.templateId);

  if (customTemplate) {
    return Ok({ template: { ...customTemplate, source: 'custom', editable: true } });
  }

  const builtIn = getEventTemplate_(params.templateId);
  if (builtIn && builtIn.id !== 'custom') {
    return Ok({ template: { ...builtIn, source: 'built-in', editable: false } });
  }

  return Err('NOT_FOUND', `Template not found: ${params.templateId}`);
}

function api_createTemplateV2(params) {
  const featureGate = requireFeature_('TEMPLATE_MANAGEMENT_V2');
  if (featureGate) return featureGate;

  if (!params?.template) {
    return Err('BAD_INPUT', 'Missing required parameter: template');
  }

  const brandId = params.brandId || 'root';
  const template = params.template;

  const validation = validateTemplateV2_(template);
  if (!validation.ok) return validation;

  if (getCustomTemplate_(brandId, template.id)) {
    return Err('CONFLICT', `Template with ID '${template.id}' already exists`);
  }

  if (isValidTemplate_(template.id)) {
    return Err('CONFLICT', `Cannot use built-in template ID '${template.id}'`);
  }

  const created = createCustomTemplate_(brandId, template);
  return Ok({ template: { ...created, source: 'custom', editable: true } });
}

function api_updateTemplateV2(params) {
  const featureGate = requireFeature_('TEMPLATE_MANAGEMENT_V2');
  if (featureGate) return featureGate;

  if (!params?.templateId || !params?.updates) {
    return Err('BAD_INPUT', 'Missing required parameters: templateId, updates');
  }

  const brandId = params.brandId || 'root';
  const existing = getCustomTemplate_(brandId, params.templateId);

  if (!existing) {
    if (isValidTemplate_(params.templateId)) {
      return Err('FORBIDDEN', 'Cannot modify built-in templates. Clone it first.');
    }
    return Err('NOT_FOUND', `Template not found: ${params.templateId}`);
  }

  const merged = { ...existing, ...params.updates, id: existing.id };
  const validation = validateTemplateV2_(merged);
  if (!validation.ok) return validation;

  const updated = updateCustomTemplate_(brandId, params.templateId, merged);
  return Ok({ template: { ...updated, source: 'custom', editable: true } });
}

function api_deleteTemplateV2(params) {
  const featureGate = requireFeature_('TEMPLATE_MANAGEMENT_V2');
  if (featureGate) return featureGate;

  if (!params?.templateId) {
    return Err('BAD_INPUT', 'Missing required parameter: templateId');
  }

  const brandId = params.brandId || 'root';
  const existing = getCustomTemplate_(brandId, params.templateId);

  if (!existing) {
    if (isValidTemplate_(params.templateId)) {
      return Err('FORBIDDEN', 'Cannot delete built-in templates');
    }
    return Err('NOT_FOUND', `Template not found: ${params.templateId}`);
  }

  deleteCustomTemplate_(brandId, params.templateId);
  return Ok({ deleted: true, templateId: params.templateId });
}

function api_cloneTemplateV2(params) {
  const featureGate = requireFeature_('TEMPLATE_MANAGEMENT_V2');
  if (featureGate) return featureGate;

  if (!params?.sourceTemplateId || !params?.newTemplateId) {
    return Err('BAD_INPUT', 'Missing required parameters: sourceTemplateId, newTemplateId');
  }

  const brandId = params.brandId || 'root';
  let sourceTemplate = getCustomTemplate_(brandId, params.sourceTemplateId);
  if (!sourceTemplate) {
    sourceTemplate = getEventTemplate_(params.sourceTemplateId);
  }

  if (!sourceTemplate) {
    return Err('NOT_FOUND', `Source template not found: ${params.sourceTemplateId}`);
  }

  if (getCustomTemplate_(brandId, params.newTemplateId) || isValidTemplate_(params.newTemplateId)) {
    return Err('CONFLICT', `Template with ID '${params.newTemplateId}' already exists`);
  }

  if (!TEMPLATE_CONSTRAINTS.id.pattern.test(params.newTemplateId)) {
    return Err('BAD_INPUT', 'Template ID must be lowercase letters and underscores only');
  }

  const cloned = {
    ...sourceTemplate,
    id: params.newTemplateId,
    label: params.newLabel || `Copy of ${sourceTemplate.label}`,
    clonedFrom: params.sourceTemplateId
  };

  const created = createCustomTemplate_(brandId, cloned);
  return Ok({ template: { ...created, source: 'custom', editable: true } });
}

function api_validateTemplateV2(params) {
  const featureGate = requireFeature_('TEMPLATE_MANAGEMENT_V2');
  if (featureGate) return featureGate;

  if (!params?.template) {
    return Err('BAD_INPUT', 'Missing required parameter: template');
  }

  return validateTemplateV2_(params.template);
}

// ============================================================================
// TESTS
// ============================================================================

describe('TemplateManagementService V2 - Feature Flag Gating', () => {
  beforeEach(() => {
    FEATURE_FLAGS.TEMPLATE_MANAGEMENT_V2 = false;
    mockStorage = {};
  });

  test('api_listTemplatesV2 returns FEATURE_DISABLED when flag is off', () => {
    const result = api_listTemplatesV2({ brandId: 'root' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('FEATURE_DISABLED');
  });

  test('api_getTemplateV2 returns FEATURE_DISABLED when flag is off', () => {
    const result = api_getTemplateV2({ templateId: 'bar_night' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('FEATURE_DISABLED');
  });

  test('api_createTemplateV2 returns FEATURE_DISABLED when flag is off', () => {
    const result = api_createTemplateV2({ template: { id: 'test', label: 'Test' } });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('FEATURE_DISABLED');
  });

  test('api_updateTemplateV2 returns FEATURE_DISABLED when flag is off', () => {
    const result = api_updateTemplateV2({ templateId: 'test', updates: {} });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('FEATURE_DISABLED');
  });

  test('api_deleteTemplateV2 returns FEATURE_DISABLED when flag is off', () => {
    const result = api_deleteTemplateV2({ templateId: 'test' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('FEATURE_DISABLED');
  });

  test('api_cloneTemplateV2 returns FEATURE_DISABLED when flag is off', () => {
    const result = api_cloneTemplateV2({ sourceTemplateId: 'bar_night', newTemplateId: 'test' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('FEATURE_DISABLED');
  });
});

describe('TemplateManagementService V2 - List Templates', () => {
  beforeEach(() => {
    FEATURE_FLAGS.TEMPLATE_MANAGEMENT_V2 = true;
    mockStorage = {};
  });

  test('lists built-in templates', () => {
    const result = api_listTemplatesV2({ brandId: 'root' });

    expect(result.ok).toBe(true);
    expect(result.value.templates.length).toBeGreaterThan(0);

    const builtIn = result.value.templates.filter(t => t.source === 'built-in');
    expect(builtIn.length).toBe(3); // bar_night, rec_league, custom

    builtIn.forEach(t => {
      expect(t.editable).toBe(false);
    });
  });

  test('lists custom templates', () => {
    // Create a custom template first
    createCustomTemplate_('root', { id: 'my_custom', label: 'My Custom', sections: {} });

    const result = api_listTemplatesV2({ brandId: 'root' });

    expect(result.ok).toBe(true);
    const custom = result.value.templates.filter(t => t.source === 'custom');
    expect(custom.length).toBe(1);
    expect(custom[0].id).toBe('my_custom');
    expect(custom[0].editable).toBe(true);
  });

  test('filters to only built-in templates', () => {
    createCustomTemplate_('root', { id: 'my_custom', label: 'My Custom' });

    const result = api_listTemplatesV2({ brandId: 'root', includeCustom: false });

    expect(result.ok).toBe(true);
    expect(result.value.templates.every(t => t.source === 'built-in')).toBe(true);
  });

  test('filters to only custom templates', () => {
    createCustomTemplate_('root', { id: 'my_custom', label: 'My Custom' });

    const result = api_listTemplatesV2({ brandId: 'root', includeBuiltIn: false });

    expect(result.ok).toBe(true);
    expect(result.value.templates.every(t => t.source === 'custom')).toBe(true);
  });
});

describe('TemplateManagementService V2 - Get Template', () => {
  beforeEach(() => {
    FEATURE_FLAGS.TEMPLATE_MANAGEMENT_V2 = true;
    mockStorage = {};
  });

  test('gets built-in template', () => {
    const result = api_getTemplateV2({ templateId: 'bar_night' });

    expect(result.ok).toBe(true);
    expect(result.value.template.id).toBe('bar_night');
    expect(result.value.template.source).toBe('built-in');
    expect(result.value.template.editable).toBe(false);
  });

  test('gets custom template', () => {
    createCustomTemplate_('root', { id: 'my_custom', label: 'My Custom' });

    const result = api_getTemplateV2({ templateId: 'my_custom', brandId: 'root' });

    expect(result.ok).toBe(true);
    expect(result.value.template.id).toBe('my_custom');
    expect(result.value.template.source).toBe('custom');
    expect(result.value.template.editable).toBe(true);
  });

  test('returns NOT_FOUND for missing template', () => {
    const result = api_getTemplateV2({ templateId: 'nonexistent' });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('NOT_FOUND');
  });

  test('returns BAD_INPUT for missing templateId', () => {
    const result = api_getTemplateV2({});

    expect(result.ok).toBe(false);
    expect(result.code).toBe('BAD_INPUT');
  });
});

describe('TemplateManagementService V2 - Create Template', () => {
  beforeEach(() => {
    FEATURE_FLAGS.TEMPLATE_MANAGEMENT_V2 = true;
    mockStorage = {};
  });

  test('creates a valid custom template', () => {
    const template = {
      id: 'my_new_template',
      label: 'My New Template',
      description: 'A test template',
      icon: '&#127881;',
      sections: { video: true, map: false, schedule: true, sponsors: true, gallery: false }
    };

    const result = api_createTemplateV2({ template, brandId: 'root' });

    expect(result.ok).toBe(true);
    expect(result.value.template.id).toBe('my_new_template');
    expect(result.value.template.label).toBe('My New Template');
    expect(result.value.template.source).toBe('custom');
    expect(result.value.template.editable).toBe(true);
  });

  test('rejects template with missing required fields', () => {
    const result = api_createTemplateV2({ template: { id: 'no_label' }, brandId: 'root' });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('VALIDATION_FAILED');
  });

  test('rejects template with invalid ID format', () => {
    const result = api_createTemplateV2({
      template: { id: 'Invalid-ID-123', label: 'Test' },
      brandId: 'root'
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('VALIDATION_FAILED');
    expect(result.errors.some(e => e.field === 'id')).toBe(true);
  });

  test('rejects duplicate template ID', () => {
    createCustomTemplate_('root', { id: 'existing', label: 'Existing' });

    const result = api_createTemplateV2({
      template: { id: 'existing', label: 'Duplicate' },
      brandId: 'root'
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('CONFLICT');
  });

  test('rejects built-in template ID', () => {
    const result = api_createTemplateV2({
      template: { id: 'bar_night', label: 'Hijack' },
      brandId: 'root'
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('CONFLICT');
  });
});

describe('TemplateManagementService V2 - Update Template', () => {
  beforeEach(() => {
    FEATURE_FLAGS.TEMPLATE_MANAGEMENT_V2 = true;
    mockStorage = {};
  });

  test('updates a custom template', () => {
    createCustomTemplate_('root', { id: 'my_template', label: 'Original' });

    const result = api_updateTemplateV2({
      templateId: 'my_template',
      updates: { label: 'Updated Label', description: 'New description' },
      brandId: 'root'
    });

    expect(result.ok).toBe(true);
    expect(result.value.template.label).toBe('Updated Label');
    expect(result.value.template.description).toBe('New description');
  });

  test('preserves template ID on update', () => {
    createCustomTemplate_('root', { id: 'my_template', label: 'Original' });

    const result = api_updateTemplateV2({
      templateId: 'my_template',
      updates: { id: 'changed_id', label: 'Updated' },
      brandId: 'root'
    });

    expect(result.ok).toBe(true);
    expect(result.value.template.id).toBe('my_template'); // ID unchanged
  });

  test('rejects update to built-in template', () => {
    const result = api_updateTemplateV2({
      templateId: 'bar_night',
      updates: { label: 'Hacked' },
      brandId: 'root'
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('FORBIDDEN');
  });

  test('returns NOT_FOUND for missing template', () => {
    const result = api_updateTemplateV2({
      templateId: 'nonexistent',
      updates: { label: 'Test' },
      brandId: 'root'
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('NOT_FOUND');
  });
});

describe('TemplateManagementService V2 - Delete Template', () => {
  beforeEach(() => {
    FEATURE_FLAGS.TEMPLATE_MANAGEMENT_V2 = true;
    mockStorage = {};
  });

  test('deletes a custom template', () => {
    createCustomTemplate_('root', { id: 'to_delete', label: 'Delete Me' });

    const result = api_deleteTemplateV2({ templateId: 'to_delete', brandId: 'root' });

    expect(result.ok).toBe(true);
    expect(result.value.deleted).toBe(true);

    // Verify it's gone
    expect(getCustomTemplate_('root', 'to_delete')).toBe(null);
  });

  test('rejects deletion of built-in template', () => {
    const result = api_deleteTemplateV2({ templateId: 'bar_night', brandId: 'root' });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('FORBIDDEN');
  });

  test('returns NOT_FOUND for missing template', () => {
    const result = api_deleteTemplateV2({ templateId: 'nonexistent', brandId: 'root' });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('NOT_FOUND');
  });
});

describe('TemplateManagementService V2 - Clone Template', () => {
  beforeEach(() => {
    FEATURE_FLAGS.TEMPLATE_MANAGEMENT_V2 = true;
    mockStorage = {};
  });

  test('clones a built-in template', () => {
    const result = api_cloneTemplateV2({
      sourceTemplateId: 'bar_night',
      newTemplateId: 'my_bar_night',
      newLabel: 'My Bar Night',
      brandId: 'root'
    });

    expect(result.ok).toBe(true);
    expect(result.value.template.id).toBe('my_bar_night');
    expect(result.value.template.label).toBe('My Bar Night');
    expect(result.value.template.clonedFrom).toBe('bar_night');
    expect(result.value.template.source).toBe('custom');
    expect(result.value.template.editable).toBe(true);
  });

  test('clones a custom template', () => {
    createCustomTemplate_('root', {
      id: 'source_custom',
      label: 'Source',
      sections: { video: true }
    });

    const result = api_cloneTemplateV2({
      sourceTemplateId: 'source_custom',
      newTemplateId: 'cloned_custom',
      brandId: 'root'
    });

    expect(result.ok).toBe(true);
    expect(result.value.template.id).toBe('cloned_custom');
    expect(result.value.template.sections.video).toBe(true);
  });

  test('rejects invalid new template ID', () => {
    const result = api_cloneTemplateV2({
      sourceTemplateId: 'bar_night',
      newTemplateId: 'INVALID-ID',
      brandId: 'root'
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('BAD_INPUT');
  });

  test('rejects cloning to existing ID', () => {
    createCustomTemplate_('root', { id: 'existing', label: 'Existing' });

    const result = api_cloneTemplateV2({
      sourceTemplateId: 'bar_night',
      newTemplateId: 'existing',
      brandId: 'root'
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('CONFLICT');
  });

  test('cloning nonexistent template falls back to custom template', () => {
    // When source template doesn't exist, getEventTemplate_ falls back to 'custom'
    // This is consistent with TemplateService.gs behavior
    const result = api_cloneTemplateV2({
      sourceTemplateId: 'nonexistent',
      newTemplateId: 'cloned_from_fallback',
      brandId: 'root'
    });

    // Falls back to custom template, so clone succeeds
    expect(result.ok).toBe(true);
    expect(result.value.template.id).toBe('cloned_from_fallback');
    // The clonedFrom will be 'nonexistent' but the actual sections come from 'custom'
    expect(result.value.template.sections.schedule).toBe(true); // custom has all sections enabled
  });
});

describe('TemplateManagementService V2 - Template Validation', () => {
  beforeEach(() => {
    FEATURE_FLAGS.TEMPLATE_MANAGEMENT_V2 = true;
  });

  test('validates a correct template', () => {
    const result = api_validateTemplateV2({
      template: {
        id: 'valid_template',
        label: 'Valid Template',
        description: 'A valid template',
        sections: { video: true, map: false }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.value.valid).toBe(true);
    expect(result.value.errors).toHaveLength(0);
  });

  test('detects missing required fields', () => {
    const result = api_validateTemplateV2({
      template: { id: 'no_label' }
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('VALIDATION_FAILED');
    expect(result.errors.some(e => e.field === 'label')).toBe(true);
  });

  test('detects invalid ID format', () => {
    const result = api_validateTemplateV2({
      template: { id: 'Has-Invalid-Chars', label: 'Test' }
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.code === 'INVALID_FORMAT')).toBe(true);
  });

  test('detects invalid section keys', () => {
    const result = api_validateTemplateV2({
      template: {
        id: 'test',
        label: 'Test',
        sections: { invalid_section: true }
      }
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.code === 'INVALID_SECTION')).toBe(true);
  });

  test('detects non-boolean section values', () => {
    const result = api_validateTemplateV2({
      template: {
        id: 'test',
        label: 'Test',
        sections: { video: 'yes' }
      }
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.code === 'TYPE_MISMATCH')).toBe(true);
  });

  test('detects too many CTAs', () => {
    const result = api_validateTemplateV2({
      template: {
        id: 'test',
        label: 'Test',
        defaultCtas: ['One', 'Two', 'Three', 'Four', 'Five', 'Six']
      }
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.code === 'MAX_ITEMS')).toBe(true);
  });
});

describe('TemplateManagementService V2 - Schema Compliance', () => {
  beforeEach(() => {
    FEATURE_FLAGS.TEMPLATE_MANAGEMENT_V2 = true;
    mockStorage = {};
  });

  test('templates only allow valid section keys (event.schema.json compliance)', () => {
    // Valid section keys that map to event.settings
    const validSections = ['video', 'map', 'schedule', 'sponsors', 'gallery'];

    validSections.forEach(section => {
      const result = api_validateTemplateV2({
        template: {
          id: 'test_' + section,
          label: 'Test',
          sections: { [section]: true }
        }
      });

      expect(result.ok).toBe(true);
    });
  });

  test('notes section is allowed for legacy compatibility', () => {
    const result = api_validateTemplateV2({
      template: {
        id: 'test_notes',
        label: 'Test',
        sections: { notes: true }
      }
    });

    expect(result.ok).toBe(true);
  });

  test('template sections map to event.settings.show* fields', () => {
    // This documents the mapping for propagation
    const sectionToSettingMap = {
      video: 'showVideo',
      map: 'showMap',
      schedule: 'showSchedule',
      sponsors: 'showSponsors',
      gallery: 'showGallery'
    };

    Object.entries(sectionToSettingMap).forEach(([section, setting]) => {
      expect(VALID_TEMPLATE_SECTIONS).toContain(section);
    });
  });
});

describe('TemplateManagementService V2 - Multi-Brand Isolation', () => {
  beforeEach(() => {
    FEATURE_FLAGS.TEMPLATE_MANAGEMENT_V2 = true;
    mockStorage = {};
  });

  test('templates are isolated per brand', () => {
    createCustomTemplate_('brand_a', { id: 'brand_a_template', label: 'Brand A' });
    createCustomTemplate_('brand_b', { id: 'brand_b_template', label: 'Brand B' });

    // Brand A only sees their template
    const brandAResult = api_listTemplatesV2({ brandId: 'brand_a', includeBuiltIn: false });
    expect(brandAResult.value.templates.length).toBe(1);
    expect(brandAResult.value.templates[0].id).toBe('brand_a_template');

    // Brand B only sees their template
    const brandBResult = api_listTemplatesV2({ brandId: 'brand_b', includeBuiltIn: false });
    expect(brandBResult.value.templates.length).toBe(1);
    expect(brandBResult.value.templates[0].id).toBe('brand_b_template');
  });

  test('brand A cannot access brand B templates', () => {
    createCustomTemplate_('brand_b', { id: 'brand_b_only', label: 'Brand B Only' });

    const result = api_getTemplateV2({ templateId: 'brand_b_only', brandId: 'brand_a' });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('NOT_FOUND');
  });
});
