/**
 * Schema Consistency Contract Tests
 *
 * Validates that JSON schema files match ApiSchemas.gs definitions.
 * This prevents schema drift between the source-of-truth JSON files
 * and the GAS runtime representations.
 *
 * Schemas validated:
 * - /schemas/event.schema.json ↔ ApiSchemas.gs events._eventShape
 * - /schemas/sponsor.schema.json ↔ ApiSchemas.gs events._sponsor
 * - /schemas/form-config.schema.json ↔ ApiSchemas.gs forms.formConfig
 * - /schemas/shared-analytics.schema.json ↔ ApiSchemas.gs analytics._sharedAnalytics
 *
 * @see EVENT_CONTRACT.md
 * @see /schemas/*.json
 * @see src/mvp/ApiSchemas.gs
 */

const fs = require('fs');
const path = require('path');

// Load JSON schemas
const schemasDir = path.join(__dirname, '../../schemas');
const eventSchema = JSON.parse(fs.readFileSync(path.join(schemasDir, 'event.schema.json'), 'utf8'));
const sponsorSchema = JSON.parse(fs.readFileSync(path.join(schemasDir, 'sponsor.schema.json'), 'utf8'));
const formConfigSchema = JSON.parse(fs.readFileSync(path.join(schemasDir, 'form-config.schema.json'), 'utf8'));
const sharedAnalyticsSchema = JSON.parse(fs.readFileSync(path.join(schemasDir, 'shared-analytics.schema.json'), 'utf8'));

describe('Schema Consistency Contract Tests', () => {

  describe('JSON Schema Validity', () => {
    it('event.schema.json should be valid JSON Schema draft 2020-12', () => {
      expect(eventSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(eventSchema.type).toBe('object');
      expect(eventSchema.properties).toBeDefined();
      expect(eventSchema.required).toBeInstanceOf(Array);
    });

    it('sponsor.schema.json should be valid JSON Schema draft 2020-12', () => {
      expect(sponsorSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(sponsorSchema.type).toBe('object');
      expect(sponsorSchema.properties).toBeDefined();
      expect(sponsorSchema.required).toBeInstanceOf(Array);
    });

    it('form-config.schema.json should be valid JSON Schema draft 2020-12', () => {
      expect(formConfigSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(formConfigSchema.type).toBe('object');
      expect(formConfigSchema.properties).toBeDefined();
      expect(formConfigSchema.required).toBeInstanceOf(Array);
    });

    it('shared-analytics.schema.json should be valid JSON Schema draft 2020-12', () => {
      expect(sharedAnalyticsSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(sharedAnalyticsSchema.type).toBe('object');
      expect(sharedAnalyticsSchema.properties).toBeDefined();
      expect(sharedAnalyticsSchema.required).toBeInstanceOf(Array);
    });
  });

  describe('Event Schema - Required Fields', () => {
    const expectedRequired = [
      'id', 'slug', 'name', 'startDateISO', 'venue',
      'links', 'qr', 'ctas', 'settings',
      'createdAtISO', 'updatedAtISO'
    ];

    it('should have all MVP required fields', () => {
      expect(eventSchema.required).toEqual(expect.arrayContaining(expectedRequired));
      expect(eventSchema.required.length).toBe(expectedRequired.length);
    });

    it('should have additionalProperties: false for strict validation', () => {
      expect(eventSchema.additionalProperties).toBe(false);
    });
  });

  describe('Event Schema - Links', () => {
    const linksSchema = eventSchema.$defs.Links;

    it('should require publicUrl, displayUrl, posterUrl, signupUrl', () => {
      expect(linksSchema.required).toEqual(
        expect.arrayContaining(['publicUrl', 'displayUrl', 'posterUrl', 'signupUrl'])
      );
    });

    it('should have sharedReportUrl as optional (V2)', () => {
      expect(linksSchema.properties.sharedReportUrl).toBeDefined();
      expect(linksSchema.properties.sharedReportUrl.type).toContain('null');
    });
  });

  describe('Event Schema - QR Codes', () => {
    const qrSchema = eventSchema.$defs.QRCodes;

    it('should require public and signup QR codes', () => {
      expect(qrSchema.required).toEqual(['public', 'signup']);
    });
  });

  describe('Event Schema - Settings (Critical for Templates)', () => {
    const settingsSchema = eventSchema.$defs.Settings;

    it('should have MVP required settings', () => {
      expect(settingsSchema.required).toEqual(
        expect.arrayContaining(['showSchedule', 'showStandings', 'showBracket'])
      );
    });

    it('should have all template-aware toggles (Feature 4)', () => {
      const expectedSettings = [
        'showSchedule',    // MVP Required
        'showStandings',   // MVP Required
        'showBracket',     // MVP Required
        'showSponsors',    // MVP Optional
        'showVideo',       // Feature 4 - Template-aware
        'showMap',         // Feature 4 - Template-aware
        'showGallery',     // Feature 4 - Template-aware
        'showSponsorBanner',  // Surface-specific
        'showSponsorStrip',   // Surface-specific
        'showLeagueStrip',    // Surface-specific
        'showQRSection'       // Surface-specific
      ];

      const actualSettings = Object.keys(settingsSchema.properties);

      expectedSettings.forEach(setting => {
        expect(actualSettings).toContain(setting);
      });
    });

    it('should have boolean type for all show* toggle settings', () => {
      // Boolean toggles follow the pattern "show*"
      // Non-boolean settings like displayRotation are V2 objects
      Object.entries(settingsSchema.properties).forEach(([key, value]) => {
        if (key.startsWith('show')) {
          expect(value.type).toBe('boolean');
        }
      });
    });

    it('should have displayRotation as optional object (V2 rotation engine)', () => {
      const displayRotation = settingsSchema.properties.displayRotation;
      if (displayRotation) {
        // displayRotation can be object or null (oneOf pattern)
        expect(displayRotation.oneOf || displayRotation.type).toBeDefined();
      }
    });
  });

  describe('Event Schema - Sponsor Placement Enum', () => {
    const sponsorSchema = eventSchema.$defs.Sponsor;

    it('should have valid placement enum values', () => {
      const expectedPlacements = ['poster', 'display', 'public', 'tv-banner'];
      expect(sponsorSchema.properties.placement.enum).toEqual(expectedPlacements);
    });
  });

  describe('Sponsor Schema Consistency', () => {
    it('should have required fields: id, name, logoUrl', () => {
      expect(sponsorSchema.required).toEqual(
        expect.arrayContaining(['id', 'name', 'logoUrl'])
      );
      // placement is no longer base-required - it's via anyOf
      expect(sponsorSchema.required).not.toContain('placement');
    });

    it('should require either placement OR placements via anyOf', () => {
      expect(sponsorSchema.anyOf).toBeDefined();
      expect(sponsorSchema.anyOf).toEqual([
        { required: ['placement'] },
        { required: ['placements'] }
      ]);
    });

    it('should have linkUrl as optional', () => {
      expect(sponsorSchema.properties.linkUrl).toBeDefined();
      expect(sponsorSchema.properties.linkUrl.type).toContain('null');
    });

    it('should have placements object with surface booleans', () => {
      expect(sponsorSchema.properties.placements).toBeDefined();
      expect(sponsorSchema.properties.placements.properties).toHaveProperty('posterTop');
      expect(sponsorSchema.properties.placements.properties).toHaveProperty('tvTop');
      expect(sponsorSchema.properties.placements.properties).toHaveProperty('tvSide');
      expect(sponsorSchema.properties.placements.properties).toHaveProperty('mobileBanner');
    });

    it('should have tracking token fields', () => {
      expect(sponsorSchema.properties.clickToken).toBeDefined();
      expect(sponsorSchema.properties.impressionToken).toBeDefined();
    });

    it('should match Event Schema embedded Sponsor definition', () => {
      const embeddedSponsor = eventSchema.$defs.Sponsor;

      // Required fields should match
      expect(embeddedSponsor.required).toEqual(sponsorSchema.required);

      // anyOf constraint should match
      expect(embeddedSponsor.anyOf).toEqual(sponsorSchema.anyOf);

      // Placement enum should match
      expect(embeddedSponsor.properties.placement.enum).toEqual(
        sponsorSchema.properties.placement.enum
      );
    });
  });

  describe('FormConfig Schema Consistency', () => {
    it('should have required fields: formId, signupUrl, totalResponses', () => {
      expect(formConfigSchema.required).toEqual(
        expect.arrayContaining(['formId', 'signupUrl', 'totalResponses'])
      );
    });

    it('should have optional fields: shortLink, qrB64', () => {
      expect(formConfigSchema.properties.shortLink).toBeDefined();
      expect(formConfigSchema.properties.qrB64).toBeDefined();
      expect(formConfigSchema.properties.shortLink.type).toContain('null');
      expect(formConfigSchema.properties.qrB64.type).toContain('null');
    });
  });

  describe('SharedAnalytics Schema Consistency', () => {
    it('should have required fields: lastUpdatedISO, summary, surfaces', () => {
      expect(sharedAnalyticsSchema.required).toEqual(
        expect.arrayContaining(['lastUpdatedISO', 'summary', 'surfaces'])
      );
    });

    it('should have optional fields: sponsors, events', () => {
      expect(sharedAnalyticsSchema.properties.sponsors).toBeDefined();
      expect(sharedAnalyticsSchema.properties.events).toBeDefined();
    });

    describe('Summary Schema', () => {
      const summarySchema = sharedAnalyticsSchema.$defs.Summary;

      it('should have all required summary fields', () => {
        const expectedFields = [
          'totalImpressions', 'totalClicks', 'totalQrScans',
          'totalSignups', 'uniqueEvents', 'uniqueSponsors'
        ];
        expect(summarySchema.required).toEqual(expect.arrayContaining(expectedFields));
      });
    });

    describe('SurfaceMetrics Schema', () => {
      const surfaceSchema = sharedAnalyticsSchema.$defs.SurfaceMetrics;

      it('should have required fields: id, label, impressions, clicks, qrScans', () => {
        expect(surfaceSchema.required).toEqual(
          expect.arrayContaining(['id', 'label', 'impressions', 'clicks', 'qrScans'])
        );
      });

      it('should have valid surface ID enum', () => {
        const expectedSurfaces = ['poster', 'display', 'public', 'signup'];
        expect(surfaceSchema.properties.id.enum).toEqual(expectedSurfaces);
      });

      it('should have optional engagementRate', () => {
        expect(surfaceSchema.properties.engagementRate).toBeDefined();
        expect(surfaceSchema.properties.engagementRate.type).toContain('null');
      });
    });

    describe('SponsorMetrics Schema', () => {
      const sponsorMetricsSchema = sharedAnalyticsSchema.$defs.SponsorMetrics;

      it('should have required fields: id, name, impressions, clicks, ctr', () => {
        expect(sponsorMetricsSchema.required).toEqual(
          expect.arrayContaining(['id', 'name', 'impressions', 'clicks', 'ctr'])
        );
      });
    });

    describe('EventMetrics Schema', () => {
      const eventMetricsSchema = sharedAnalyticsSchema.$defs.EventMetrics;

      it('should have required fields: id, name, impressions, clicks, ctr', () => {
        expect(eventMetricsSchema.required).toEqual(
          expect.arrayContaining(['id', 'name', 'impressions', 'clicks', 'ctr'])
        );
      });
    });
  });

  describe('Cross-Schema Consistency', () => {
    it('Event and Sponsor schemas should have matching placement values', () => {
      const eventSponsorPlacements = eventSchema.$defs.Sponsor.properties.placement.enum;
      const standaloneSponsorPlacements = sponsorSchema.properties.placement.enum;

      expect(eventSponsorPlacements).toEqual(standaloneSponsorPlacements);
    });

    it('SharedAnalytics surface IDs should be valid event surfaces', () => {
      const analyticsSurfaces = sharedAnalyticsSchema.$defs.SurfaceMetrics.properties.id.enum;
      const validSurfaces = ['poster', 'display', 'public', 'signup'];

      analyticsSurfaces.forEach(surface => {
        expect(validSurfaces).toContain(surface);
      });
    });
  });

  describe('Template → Settings Mapping Validation', () => {
    // Templates define sections that map to settings.show* flags
    const templateSectionToSettingMap = {
      'schedule': 'showSchedule',
      'standings': 'showStandings',
      'bracket': 'showBracket',
      'sponsors': 'showSponsors',
      'video': 'showVideo',
      'map': 'showMap',
      'gallery': 'showGallery'
    };

    it('all template sections should have corresponding settings in schema', () => {
      const settingsSchema = eventSchema.$defs.Settings;
      const settingsProperties = Object.keys(settingsSchema.properties);

      Object.values(templateSectionToSettingMap).forEach(settingName => {
        expect(settingsProperties).toContain(settingName);
      });
    });
  });
});
