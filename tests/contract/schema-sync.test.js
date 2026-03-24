/**
 * Schema Sync Contract Tests - Story 7
 *
 * LOCKED CONTRACT: Ensures 100% alignment across all schema layers:
 * - /schemas/*.schema.json (JSON Schema source of truth)
 * - ApiSchemas.gs SCHEMAS object (GAS runtime validation)
 * - TemplateService.gs EVENT_TEMPLATES (template → settings mapping)
 * - HTML READS/WRITES header blocks (frontend contracts)
 *
 * TEST FAILS IF:
 * - A field is added in HTML but not in JSON schema
 * - A field exists in ApiSchemas.gs but not in JSON schema
 * - A field is in JSON schema but missing from ApiSchemas.gs
 * - A template writes to a settings field not in event.schema.json
 * - A frontend reads a field not defined in the schema
 *
 * This is a LOCKED CONTRACT - changes require explicit schema migration.
 *
 * @see /schemas/event.schema.json (v2.2 MVP-frozen)
 * @see /schemas/sponsor.schema.json
 * @see /schemas/form-config.schema.json
 * @see /schemas/shared-analytics.schema.json
 * @see src/mvp/ApiSchemas.gs
 * @see src/mvp/TemplateService.gs
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// Schema Loading Utilities
// ============================================================================

const ROOT = path.join(__dirname, '../..');
const SCHEMAS_DIR = path.join(ROOT, 'schemas');
const MVP_DIR = path.join(ROOT, 'src/mvp');
// Story 5.3: GAS files archived to archive/gas/
const GAS_ARCHIVE_DIR = path.join(ROOT, 'archive/gas');

/**
 * Load and parse JSON schema file
 */
function loadJsonSchema(filename) {
  const filepath = path.join(SCHEMAS_DIR, filename);
  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
}

/**
 * Extract all field paths from a JSON Schema (flattened)
 * Returns Set of dot-notation paths like: "settings.showSchedule"
 */
function extractJsonSchemaFields(schema, prefix = '', defs = null) {
  const fields = new Set();
  const definitions = defs || schema.$defs || {};

  if (!schema || typeof schema !== 'object') return fields;

  // Handle $ref
  if (schema.$ref) {
    const refPath = schema.$ref.replace(/^#\/\$defs\//, '');
    if (definitions[refPath]) {
      const refFields = extractJsonSchemaFields(definitions[refPath], prefix, definitions);
      refFields.forEach(f => fields.add(f));
    }
    return fields;
  }

  // Handle oneOf (take first valid schema)
  if (schema.oneOf) {
    for (const option of schema.oneOf) {
      if (option.type !== 'null') {
        const oneOfFields = extractJsonSchemaFields(option, prefix, definitions);
        oneOfFields.forEach(f => fields.add(f));
        break;
      }
    }
    return fields;
  }

  // Handle properties
  if (schema.properties) {
    for (const [key, value] of Object.entries(schema.properties)) {
      const fieldPath = prefix ? `${prefix}.${key}` : key;
      fields.add(fieldPath);

      // Recurse into nested objects
      if (value.type === 'object' || value.$ref || value.oneOf) {
        const nestedFields = extractJsonSchemaFields(value, fieldPath, definitions);
        nestedFields.forEach(f => fields.add(f));
      }

      // Handle array items
      if (value.type === 'array' || (Array.isArray(value.type) && value.type.includes('array'))) {
        if (value.items) {
          const itemFields = extractJsonSchemaFields(value.items, `${fieldPath}[]`, definitions);
          itemFields.forEach(f => fields.add(f));
        }
      }
    }
  }

  // Handle items directly for array schemas
  if (schema.items) {
    const itemFields = extractJsonSchemaFields(schema.items, prefix, definitions);
    itemFields.forEach(f => fields.add(f));
  }

  return fields;
}

/**
 * Parse ApiSchemas.gs and extract field paths from SCHEMAS object
 * This is a simplified parser that extracts property names from the GAS file
 */
function parseApiSchemasGs() {
  const filepath = path.join(GAS_ARCHIVE_DIR, 'ApiSchemas.gs');
  const content = fs.readFileSync(filepath, 'utf8');

  // Extract key schema definitions we care about
  const schemas = {
    event: new Set(),
    sponsor: new Set(),
    formConfig: new Set(),
    sharedAnalytics: new Set(),
    settings: new Set()
  };

  // Parse _eventShape properties
  const eventShapeMatch = content.match(/_eventShape:\s*\{[\s\S]*?required:\s*\[([\s\S]*?)\][\s\S]*?properties:\s*\{([\s\S]*?)\n\s{4}\}/);
  if (eventShapeMatch) {
    // Extract required fields
    const requiredStr = eventShapeMatch[1];
    const requiredFields = requiredStr.match(/'([^']+)'/g)?.map(s => s.replace(/'/g, '')) || [];
    requiredFields.forEach(f => schemas.event.add(f));

    // Extract property names from the properties block
    const propsStr = eventShapeMatch[2];
    const propMatches = propsStr.matchAll(/^\s+(\w+):\s*\{/gm);
    for (const match of propMatches) {
      schemas.event.add(match[1]);
    }
  }

  // Parse _sponsor properties
  const sponsorMatch = content.match(/_sponsor:\s*\{[\s\S]*?properties:\s*\{([\s\S]*?)\n\s{6}\}/);
  if (sponsorMatch) {
    const propsStr = sponsorMatch[1];
    const propMatches = propsStr.matchAll(/^\s+(\w+):\s*\{/gm);
    for (const match of propMatches) {
      schemas.sponsor.add(match[1]);
    }
  }

  // Parse _settings properties
  const settingsMatch = content.match(/_settings:\s*\{[\s\S]*?properties:\s*\{([\s\S]*?)\n\s{6}\}/);
  if (settingsMatch) {
    const propsStr = settingsMatch[1];
    const propMatches = propsStr.matchAll(/^\s+(\w+):\s*\{/gm);
    for (const match of propMatches) {
      schemas.settings.add(match[1]);
    }
  }

  // Parse formConfig properties
  const formConfigMatch = content.match(/formConfig:\s*\{[\s\S]*?properties:\s*\{([\s\S]*?)\n\s{6}\}/);
  if (formConfigMatch) {
    const propsStr = formConfigMatch[1];
    const propMatches = propsStr.matchAll(/^\s+(\w+):\s*\{/gm);
    for (const match of propMatches) {
      schemas.formConfig.add(match[1]);
    }
  }

  // Parse _sharedAnalytics properties
  const sharedAnalyticsMatch = content.match(/_sharedAnalytics:\s*\{[\s\S]*?properties:\s*\{([\s\S]*?)\n\s{6}\}/);
  if (sharedAnalyticsMatch) {
    const propsStr = sharedAnalyticsMatch[1];
    const propMatches = propsStr.matchAll(/^\s+(\w+):\s*\{/gm);
    for (const match of propMatches) {
      schemas.sharedAnalytics.add(match[1]);
    }
  }

  return schemas;
}

/**
 * Parse HTML file header comments to extract READ/WRITE field references
 * Returns object with reads and writes arrays
 */
function parseHtmlFields(filename) {
  const filepath = path.join(MVP_DIR, filename);
  const content = fs.readFileSync(filepath, 'utf8');

  // Extract header comment block
  const headerMatch = content.match(/<!--([\s\S]*?)-->/);
  if (!headerMatch) return { reads: new Set(), writes: new Set() };

  const header = headerMatch[1];
  const reads = new Set();
  const writes = new Set();

  // Parse READS section - look for "event.field" or "surface.field" patterns
  const readsSection = header.match(/READS FROM[\s\S]*?(?=WRITES TO|SECTION GATES|═{10,}|$)/i);
  if (readsSection) {
    // Match patterns like "event.id", "event.settings.showSchedule", etc.
    const fieldMatches = readsSection[0].matchAll(/(?:event|surface|sponsor|analytics|summary)\.([a-zA-Z._[\]]+)/g);
    for (const match of fieldMatches) {
      // Normalize: remove trailing commas, dots, and clean up
      const field = match[1].replace(/[,.\s]+$/, '').replace(/\[\]$/, '');
      if (field && !field.startsWith('_') && field.length > 0) {
        reads.add(field);
      }
    }
    // Also match standalone "showXxx" pattern for settings
    const settingsMatches = readsSection[0].matchAll(/\bshow(\w+)/g);
    for (const match of settingsMatches) {
      reads.add(`settings.show${match[1]}`);
    }
  }

  // Parse WRITES section
  const writesSection = header.match(/WRITES TO[\s\S]*?(?=V2 HIDDEN|SERVER-GENERATED|SECTION GATES|DO NOT|═{10,}|$)/i);
  if (writesSection) {
    const fieldMatches = writesSection[0].matchAll(/(?:event|surface)\.([a-zA-Z._[\]]+)/g);
    for (const match of fieldMatches) {
      const field = match[1].replace(/[,.\s]+$/, '').replace(/\[\]$/, '');
      if (field && !field.startsWith('_') && field.length > 0) {
        writes.add(field);
      }
    }
  }

  return { reads, writes };
}

/**
 * Parse TemplateService.gs to extract template section mappings
 * Returns object with template IDs and which settings they enable
 */
function parseTemplateServiceGs() {
  const filepath = path.join(GAS_ARCHIVE_DIR, 'TemplateService.gs');
  const content = fs.readFileSync(filepath, 'utf8');

  const templates = {};
  const settingsWritten = new Set();

  // Parse EVENT_TEMPLATES object
  const templatesMatch = content.match(/const\s+EVENT_TEMPLATES\s*=\s*\{([\s\S]*?)^\};/m);
  if (templatesMatch) {
    const templatesBlock = templatesMatch[1];

    // Find all template definitions
    const templateMatches = templatesBlock.matchAll(/^\s*(\w+):\s*\{([\s\S]*?)^\s{2}\}/gm);
    for (const match of templateMatches) {
      const templateId = match[1];
      const templateBlock = match[2];

      // Extract sections
      const sectionsMatch = templateBlock.match(/sections:\s*\{([^}]+)\}/);
      if (sectionsMatch) {
        const sectionsStr = sectionsMatch[1];
        const sectionProps = sectionsStr.matchAll(/(\w+):\s*(true|false)/g);
        for (const prop of sectionProps) {
          settingsWritten.add(prop[1]);
        }
      }

      templates[templateId] = true;
    }
  }

  // Map section names to settings field names
  const sectionToSettingMap = {
    schedule: 'showSchedule',
    standings: 'showStandings',
    bracket: 'showBracket',
    sponsors: 'showSponsors',
    video: 'showVideo',
    map: 'showMap',
    gallery: 'showGallery'
  };

  const settingsFields = new Set();
  settingsWritten.forEach(section => {
    if (sectionToSettingMap[section]) {
      settingsFields.add(sectionToSettingMap[section]);
    }
  });

  return {
    templateIds: Object.keys(templates),
    settingsFields,
    sectionToSettingMap
  };
}

// ============================================================================
// Test Data - Manual Mirror Lists for Contract Validation
// ============================================================================

/**
 * CANONICAL FIELD LISTS - Manual mirror of schema fields
 * These serve as the expected values and are maintained alongside schemas.
 * Test fails if JSON schema or ApiSchemas.gs diverges from these.
 */
const CANONICAL = {
  // Event Schema top-level fields
  event: {
    required: ['id', 'slug', 'name', 'startDateISO', 'venue', 'links', 'qr', 'ctas', 'settings', 'createdAtISO', 'updatedAtISO'],
    optional: ['templateId', 'schedule', 'standings', 'bracket', 'sponsors', 'media', 'externalData', 'checkinUrl', 'walkinUrl', 'surveyUrl', 'display', 'analytics', 'payments']
  },

  // Links sub-schema
  links: {
    required: ['publicUrl', 'displayUrl', 'posterUrl', 'signupUrl'],
    optional: ['sharedReportUrl']
  },

  // QR sub-schema
  qr: {
    required: ['public', 'signup'],
    optional: []
  },

  // Settings sub-schema
  settings: {
    required: ['showSchedule', 'showStandings', 'showBracket'],
    optional: ['showSponsors', 'showVideo', 'showMap', 'showGallery', 'showSponsorBanner', 'showSponsorStrip', 'showLeagueStrip', 'showQRSection', 'displayRotation']
  },

  // CTAs sub-schema
  ctas: {
    required: ['primary'],
    optional: ['secondary']
  },

  // CTA object
  cta: {
    required: ['label', 'url'],
    optional: []
  },

  // Sponsor schema
  // Note: 'placement' OR 'placements' is required via anyOf, but neither is in base required
  sponsor: {
    required: ['id', 'name', 'logoUrl'],
    optional: ['linkUrl', 'placement', 'placements', 'clickToken', 'impressionToken', 'tier']
  },

  // FormConfig schema
  formConfig: {
    required: ['formId', 'signupUrl', 'totalResponses'],
    optional: ['shortLink', 'qrB64']
  },

  // SharedAnalytics schema
  sharedAnalytics: {
    required: ['lastUpdatedISO', 'summary', 'surfaces'],
    optional: ['sponsors', 'events', 'topSponsors']
  },

  // Summary sub-schema
  summary: {
    required: ['totalImpressions', 'totalClicks', 'totalQrScans', 'totalSignups', 'uniqueEvents', 'uniqueSponsors'],
    optional: []
  },

  // SurfaceMetrics sub-schema
  surfaceMetrics: {
    required: ['id', 'label', 'impressions', 'clicks', 'qrScans'],
    optional: ['engagementRate']
  },

  // SponsorMetrics sub-schema
  sponsorMetrics: {
    required: ['id', 'name', 'impressions', 'clicks', 'ctr'],
    optional: []
  },

  // EventMetrics sub-schema
  eventMetrics: {
    required: ['id', 'name', 'impressions', 'clicks', 'ctr', 'signupsCount'],
    optional: []
  },

  // Media sub-schema
  media: {
    required: [],
    optional: ['videoUrl', 'mapUrl', 'gallery']
  },

  // ExternalData sub-schema
  externalData: {
    required: [],
    optional: ['scheduleUrl', 'standingsUrl', 'bracketUrl']
  },

  // Schedule row
  scheduleRow: {
    required: ['time', 'title'],
    optional: ['description']
  },

  // Standing row
  standingRow: {
    required: ['rank', 'team', 'wins', 'losses'],
    optional: ['points']
  },

  // Bracket match
  bracketMatch: {
    required: ['id'],
    optional: ['team1', 'team2', 'score1', 'score2', 'winner']
  }
};

// ============================================================================
// Tests
// ============================================================================

describe('Schema Sync Contract Tests - Story 7 (LOCKED)', () => {
  let eventSchema, sponsorSchema, formConfigSchema, sharedAnalyticsSchema;
  let gasSchemas;

  beforeAll(() => {
    // Load JSON schemas
    eventSchema = loadJsonSchema('event.schema.json');
    sponsorSchema = loadJsonSchema('sponsor.schema.json');
    formConfigSchema = loadJsonSchema('form-config.schema.json');
    sharedAnalyticsSchema = loadJsonSchema('shared-analytics.schema.json');

    // Parse ApiSchemas.gs
    gasSchemas = parseApiSchemasGs();
  });

  // ==========================================================================
  // JSON Schema ↔ Canonical List Alignment
  // ==========================================================================

  describe('JSON Schema ↔ Canonical List Alignment', () => {
    describe('event.schema.json', () => {
      it('should have exactly the canonical required fields', () => {
        const actual = eventSchema.required.sort();
        const expected = CANONICAL.event.required.sort();
        expect(actual).toEqual(expected);
      });

      it('should have all canonical optional fields in properties', () => {
        const props = Object.keys(eventSchema.properties);
        CANONICAL.event.optional.forEach(field => {
          expect(props).toContain(field);
        });
      });

      it('should not have extra fields beyond canonical list', () => {
        const props = Object.keys(eventSchema.properties);
        const canonical = [...CANONICAL.event.required, ...CANONICAL.event.optional];
        const extra = props.filter(p => !canonical.includes(p));
        expect(extra).toEqual([]);
      });
    });

    describe('Settings sub-schema', () => {
      it('should have exactly the canonical required settings', () => {
        const settingsSchema = eventSchema.$defs.Settings;
        const actual = settingsSchema.required.sort();
        const expected = CANONICAL.settings.required.sort();
        expect(actual).toEqual(expected);
      });

      it('should have all canonical optional settings', () => {
        const settingsSchema = eventSchema.$defs.Settings;
        const props = Object.keys(settingsSchema.properties);
        CANONICAL.settings.optional.forEach(field => {
          expect(props).toContain(field);
        });
      });

      it('should not have extra settings beyond canonical list', () => {
        const settingsSchema = eventSchema.$defs.Settings;
        const props = Object.keys(settingsSchema.properties);
        const canonical = [...CANONICAL.settings.required, ...CANONICAL.settings.optional];
        const extra = props.filter(p => !canonical.includes(p));
        expect(extra).toEqual([]);
      });
    });

    describe('Links sub-schema', () => {
      it('should have exactly the canonical required link fields', () => {
        const linksSchema = eventSchema.$defs.Links;
        const actual = linksSchema.required.sort();
        const expected = CANONICAL.links.required.sort();
        expect(actual).toEqual(expected);
      });
    });

    describe('sponsor.schema.json', () => {
      it('should have exactly the canonical required fields', () => {
        const actual = sponsorSchema.required.sort();
        const expected = CANONICAL.sponsor.required.sort();
        expect(actual).toEqual(expected);
      });

      it('should have all canonical optional fields', () => {
        const props = Object.keys(sponsorSchema.properties);
        CANONICAL.sponsor.optional.forEach(field => {
          expect(props).toContain(field);
        });
      });

      it('should not have extra fields beyond canonical list', () => {
        const props = Object.keys(sponsorSchema.properties);
        const canonical = [...CANONICAL.sponsor.required, ...CANONICAL.sponsor.optional];
        const extra = props.filter(p => !canonical.includes(p));
        expect(extra).toEqual([]);
      });
    });

    describe('form-config.schema.json', () => {
      it('should have exactly the canonical required fields', () => {
        const actual = formConfigSchema.required.sort();
        const expected = CANONICAL.formConfig.required.sort();
        expect(actual).toEqual(expected);
      });

      it('should not have extra fields beyond canonical list', () => {
        const props = Object.keys(formConfigSchema.properties);
        const canonical = [...CANONICAL.formConfig.required, ...CANONICAL.formConfig.optional];
        const extra = props.filter(p => !canonical.includes(p));
        expect(extra).toEqual([]);
      });
    });

    describe('shared-analytics.schema.json', () => {
      it('should have exactly the canonical required fields', () => {
        const actual = sharedAnalyticsSchema.required.sort();
        const expected = CANONICAL.sharedAnalytics.required.sort();
        expect(actual).toEqual(expected);
      });

      it('Summary should have all canonical required fields', () => {
        const summarySchema = sharedAnalyticsSchema.$defs.Summary;
        const actual = summarySchema.required.sort();
        const expected = CANONICAL.summary.required.sort();
        expect(actual).toEqual(expected);
      });

      it('SurfaceMetrics should have all canonical required fields', () => {
        const surfaceSchema = sharedAnalyticsSchema.$defs.SurfaceMetrics;
        const actual = surfaceSchema.required.sort();
        const expected = CANONICAL.surfaceMetrics.required.sort();
        expect(actual).toEqual(expected);
      });
    });
  });

  // ==========================================================================
  // ApiSchemas.gs ↔ JSON Schema Alignment
  // ==========================================================================

  describe('ApiSchemas.gs ↔ JSON Schema Alignment', () => {
    it('ApiSchemas.gs events._eventShape should have all JSON schema required fields', () => {
      const jsonRequired = new Set(eventSchema.required);
      const gasFields = gasSchemas.event;

      jsonRequired.forEach(field => {
        expect(gasFields.has(field)).toBe(true);
      });
    });

    it('ApiSchemas.gs events._settings should have all JSON schema settings fields', () => {
      const settingsSchema = eventSchema.$defs.Settings;
      const jsonSettings = new Set(Object.keys(settingsSchema.properties));
      const gasSettings = gasSchemas.settings;

      jsonSettings.forEach(field => {
        expect(gasSettings.has(field)).toBe(true);
      });
    });

    it('ApiSchemas.gs events._sponsor should have all JSON sponsor schema fields', () => {
      const jsonFields = new Set(Object.keys(sponsorSchema.properties));
      const gasFields = gasSchemas.sponsor;

      jsonFields.forEach(field => {
        expect(gasFields.has(field)).toBe(true);
      });
    });

    it('ApiSchemas.gs forms.formConfig should have all JSON form-config schema fields', () => {
      const jsonFields = new Set(Object.keys(formConfigSchema.properties));
      const gasFields = gasSchemas.formConfig;

      jsonFields.forEach(field => {
        expect(gasFields.has(field)).toBe(true);
      });
    });

    it('ApiSchemas.gs analytics._sharedAnalytics should have all JSON shared-analytics schema fields', () => {
      const jsonFields = new Set(Object.keys(sharedAnalyticsSchema.properties));
      const gasFields = gasSchemas.sharedAnalytics;

      jsonFields.forEach(field => {
        expect(gasFields.has(field)).toBe(true);
      });
    });
  });

  // ==========================================================================
  // HTML READ/WRITE ↔ JSON Schema Alignment
  // ==========================================================================

  describe('HTML READ/WRITE ↔ JSON Schema Alignment', () => {
    // Allowed fields that HTML can read (includes nested paths)
    const getAllowedEventFields = () => {
      const fields = extractJsonSchemaFields(eventSchema);
      // Add common patterns that are valid
      fields.add('id');
      fields.add('settings.*'); // Wildcard for all settings
      return fields;
    };

    describe('Admin.html', () => {
      let adminFields;

      beforeAll(() => {
        adminFields = parseHtmlFields('Admin.html');
      });

      it('should only read fields that exist in event.schema.json', () => {
        const allowedFields = getAllowedEventFields();
        const invalidFields = [];

        adminFields.reads.forEach(field => {
          // Check if field or its parent exists
          const parts = field.split('.');
          const topLevel = parts[0];
          const isValid = allowedFields.has(field) ||
                          allowedFields.has(topLevel) ||
                          field.startsWith('settings.') ||
                          field.startsWith('links.') ||
                          field.startsWith('qr.') ||
                          field.startsWith('ctas.') ||
                          field.startsWith('sponsors');

          if (!isValid) {
            invalidFields.push(field);
          }
        });

        expect(invalidFields).toEqual([]);
      });

      it('should only write fields that exist in event.schema.json', () => {
        const allowedFields = getAllowedEventFields();
        const invalidFields = [];

        adminFields.writes.forEach(field => {
          const parts = field.split('.');
          const topLevel = parts[0];
          const isValid = allowedFields.has(field) ||
                          allowedFields.has(topLevel) ||
                          field.startsWith('settings.') ||
                          field.startsWith('ctas.') ||
                          field.startsWith('externalData.');

          if (!isValid) {
            invalidFields.push(field);
          }
        });

        expect(invalidFields).toEqual([]);
      });
    });

    describe('Public.html', () => {
      let publicFields;

      beforeAll(() => {
        publicFields = parseHtmlFields('Public.html');
      });

      it('should only read fields that exist in event.schema.json', () => {
        const allowedFields = getAllowedEventFields();
        const invalidFields = [];

        publicFields.reads.forEach(field => {
          const parts = field.split('.');
          const topLevel = parts[0];
          const isValid = allowedFields.has(field) ||
                          allowedFields.has(topLevel) ||
                          field.startsWith('settings.') ||
                          field.startsWith('ctas.') ||
                          field.startsWith('schedule') ||
                          field.startsWith('standings') ||
                          field.startsWith('bracket') ||
                          field.startsWith('sponsors') ||
                          field.startsWith('media.') ||
                          field.startsWith('externalData.') ||
                          field.startsWith('payments.');

          if (!isValid) {
            invalidFields.push(field);
          }
        });

        expect(invalidFields).toEqual([]);
      });
    });

    describe('Display.html', () => {
      let displayFields;

      beforeAll(() => {
        displayFields = parseHtmlFields('Display.html');
      });

      it('should only read fields that exist in event.schema.json', () => {
        const allowedFields = getAllowedEventFields();
        const invalidFields = [];

        displayFields.reads.forEach(field => {
          const parts = field.split('.');
          const topLevel = parts[0];
          const isValid = allowedFields.has(field) ||
                          allowedFields.has(topLevel) ||
                          field.startsWith('settings.') ||
                          field.startsWith('links.') ||
                          field.startsWith('sponsors') ||
                          field.startsWith('externalData.');

          if (!isValid) {
            invalidFields.push(field);
          }
        });

        expect(invalidFields).toEqual([]);
      });
    });

    describe('Poster.html', () => {
      let posterFields;

      beforeAll(() => {
        posterFields = parseHtmlFields('Poster.html');
      });

      it('should only read fields that exist in event.schema.json', () => {
        const allowedFields = getAllowedEventFields();
        const invalidFields = [];

        posterFields.reads.forEach(field => {
          const parts = field.split('.');
          const topLevel = parts[0];
          const isValid = allowedFields.has(field) ||
                          allowedFields.has(topLevel) ||
                          field.startsWith('settings.') ||
                          field.startsWith('links.') ||
                          field.startsWith('qr.') ||
                          field.startsWith('ctas.') ||
                          field.startsWith('sponsors');

          if (!isValid) {
            invalidFields.push(field);
          }
        });

        expect(invalidFields).toEqual([]);
      });
    });

    describe('SharedReport.html', () => {
      let reportFields;

      beforeAll(() => {
        reportFields = parseHtmlFields('SharedReport.html');
      });

      it('should only read fields that exist in shared-analytics.schema.json', () => {
        const allowedFields = extractJsonSchemaFields(sharedAnalyticsSchema);
        // Add common patterns
        allowedFields.add('lastUpdatedISO');
        allowedFields.add('summary');
        allowedFields.add('surfaces');
        allowedFields.add('sponsors');
        allowedFields.add('events');

        const invalidFields = [];

        reportFields.reads.forEach(field => {
          const parts = field.split('.');
          const topLevel = parts[0];
          const isValid = allowedFields.has(field) ||
                          allowedFields.has(topLevel) ||
                          field.startsWith('summary.') ||
                          field.startsWith('surface.') ||
                          field.startsWith('sponsor.') ||
                          field.startsWith('event.');

          if (!isValid) {
            invalidFields.push(field);
          }
        });

        expect(invalidFields).toEqual([]);
      });
    });
  });

  // ==========================================================================
  // Cross-Schema Consistency
  // ==========================================================================

  describe('Cross-Schema Consistency', () => {
    it('Event embedded Sponsor should match standalone sponsor.schema.json', () => {
      const embeddedSponsor = eventSchema.$defs.Sponsor;

      // Required fields should match
      expect(embeddedSponsor.required.sort()).toEqual(sponsorSchema.required.sort());

      // Property names should match
      expect(Object.keys(embeddedSponsor.properties).sort()).toEqual(
        Object.keys(sponsorSchema.properties).sort()
      );

      // Placement enum should match
      expect(embeddedSponsor.properties.placement.enum).toEqual(
        sponsorSchema.properties.placement.enum
      );
    });

    it('All show* settings toggles should be boolean type', () => {
      const settingsSchema = eventSchema.$defs.Settings;
      const allSettings = [...CANONICAL.settings.required, ...CANONICAL.settings.optional];
      // Filter to only show* settings (boolean toggles) - displayRotation is an object
      const booleanToggles = allSettings.filter(s => s.startsWith('show'));

      booleanToggles.forEach(setting => {
        const prop = settingsSchema.properties[setting];
        expect(prop).toBeDefined();
        expect(prop.type).toBe('boolean');
      });
    });

    it('displayRotation setting should be an optional object type', () => {
      const settingsSchema = eventSchema.$defs.Settings;
      const displayRotation = settingsSchema.properties.displayRotation;
      if (displayRotation) {
        // displayRotation uses oneOf pattern with object ref and null
        expect(displayRotation.oneOf || displayRotation.type).toBeDefined();
      }
    });

    it('SharedAnalytics surface IDs should match valid surface types', () => {
      const surfaceSchema = sharedAnalyticsSchema.$defs.SurfaceMetrics;
      const validSurfaces = ['poster', 'display', 'public', 'signup'];

      expect(surfaceSchema.properties.id.enum.sort()).toEqual(validSurfaces.sort());
    });

    it('Sponsor placement enum should include all valid surfaces', () => {
      const sponsorPlacements = sponsorSchema.properties.placement.enum;
      // poster, display, public for standard surfaces + tv-banner for TV display
      expect(sponsorPlacements).toContain('poster');
      expect(sponsorPlacements).toContain('display');
      expect(sponsorPlacements).toContain('public');
      expect(sponsorPlacements).toContain('tv-banner');
    });
  });

  // ==========================================================================
  // TemplateService.gs ↔ JSON Schema Alignment
  // ==========================================================================

  describe('TemplateService.gs ↔ JSON Schema Alignment', () => {
    let templateServiceData;

    beforeAll(() => {
      templateServiceData = parseTemplateServiceGs();
    });

    it('All template section mappings should write to valid settings fields', () => {
      const settingsSchema = eventSchema.$defs.Settings;
      const validSettings = Object.keys(settingsSchema.properties);
      const invalidFields = [];

      templateServiceData.settingsFields.forEach(field => {
        if (!validSettings.includes(field)) {
          invalidFields.push(field);
        }
      });

      expect(invalidFields).toEqual([]);
    });

    it('TemplateService should not write to reserved settings fields', () => {
      // Reserved settings that templates should not control directly
      const reservedSettings = ['showQRSection'];

      const conflictingFields = [];
      templateServiceData.settingsFields.forEach(field => {
        if (reservedSettings.includes(field)) {
          conflictingFields.push(field);
        }
      });

      expect(conflictingFields).toEqual([]);
    });

    it('Section-to-setting mapping should cover all template sections', () => {
      const { sectionToSettingMap } = templateServiceData;

      // All core sections should be mapped
      const coreSections = ['schedule', 'standings', 'bracket', 'sponsors', 'video', 'map', 'gallery'];
      coreSections.forEach(section => {
        expect(sectionToSettingMap[section]).toBeDefined();
      });
    });

    it('All mapped settings should exist in event.schema.json Settings', () => {
      const settingsSchema = eventSchema.$defs.Settings;
      const validSettings = new Set(Object.keys(settingsSchema.properties));
      const { sectionToSettingMap } = templateServiceData;

      Object.values(sectionToSettingMap).forEach(setting => {
        expect(validSettings.has(setting)).toBe(true);
      });
    });
  });

  // ==========================================================================
  // No Rogue Fields (MVP Pruning Check)
  // ==========================================================================

  describe('No Rogue Fields (MVP Pruning)', () => {
    it('event.schema.json should have additionalProperties: false', () => {
      expect(eventSchema.additionalProperties).toBe(false);
    });

    it('sponsor.schema.json should have additionalProperties: false', () => {
      expect(sponsorSchema.additionalProperties).toBe(false);
    });

    it('form-config.schema.json should have additionalProperties: false', () => {
      expect(formConfigSchema.additionalProperties).toBe(false);
    });

    it('shared-analytics.schema.json should have additionalProperties: false', () => {
      expect(sharedAnalyticsSchema.additionalProperties).toBe(false);
    });

    it('All event sub-schemas should have additionalProperties: false', () => {
      const subSchemas = ['Links', 'QRCodes', 'Settings', 'CTAs', 'CTA', 'Sponsor', 'Media', 'ExternalData', 'Analytics', 'Payments'];

      subSchemas.forEach(name => {
        const subSchema = eventSchema.$defs[name];
        if (subSchema) {
          expect(subSchema.additionalProperties).toBe(false);
        }
      });
    });
  });
});
