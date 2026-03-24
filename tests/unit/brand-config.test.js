/**
 * UNIT TESTS: Brand Configuration
 *
 * Purpose: Validate centralized brand configuration integrity
 * Source of Truth: config/brand-config.js
 *
 * These tests ensure:
 * - All brands have required metadata (brandId, brandName)
 * - Brand IDs are unique and lowercase
 * - Parent-child relationships are consistent
 * - All config files use the centralized source
 * - Backend Config.gs stays in sync
 *
 * Run with: npm run test -- tests/unit/brand-config.test.js
 */

const fs = require('fs');
const path = require('path');

// Import centralized brand config
const {
  BRANDS,
  BRAND_METADATA,
  DEFAULT_BRAND,
  DEFAULT_SPREADSHEET_ID,
  isValidBrand,
  getBrandMetadata,
  getBrandName,
  getAllBrandMetadata,
  getChildBrands,
  getParentBrand,
  getBrandsByType,
  getBrandConfig,
  getAllBrandConfigs,
  getConfiguredBrands,
  createBrandTestMatrix
} = require('../../config/brand-config');

// Import environments config to verify it uses centralized source
const environmentsConfig = require('../../config/environments');

// Import test helpers to verify they use centralized source
const testHelpers = require('../shared/helpers/test.helpers');
const testBrandConfig = require('../shared/config/brand-config');

describe('Brand Configuration - Single Source of Truth', () => {

  describe('BRANDS Array (Canonical List)', () => {

    test('BRANDS is a frozen array', () => {
      expect(Array.isArray(BRANDS)).toBe(true);
      expect(Object.isFrozen(BRANDS)).toBe(true);
    });

    test('BRANDS contains expected brands', () => {
      expect(BRANDS).toContain('root');
      expect(BRANDS).toContain('abc');
      expect(BRANDS).toContain('cbc');
      expect(BRANDS).toContain('cbl');
    });

    test('BRANDS has at least one brand', () => {
      expect(BRANDS.length).toBeGreaterThan(0);
    });

    test('all brand IDs are lowercase strings', () => {
      BRANDS.forEach(brandId => {
        expect(typeof brandId).toBe('string');
        expect(brandId).toBe(brandId.toLowerCase());
        expect(brandId.length).toBeGreaterThan(0);
      });
    });

    test('brand IDs are unique', () => {
      const uniqueIds = new Set(BRANDS);
      expect(uniqueIds.size).toBe(BRANDS.length);
    });

    test('brand IDs contain no special characters', () => {
      const validIdPattern = /^[a-z0-9_]+$/;
      BRANDS.forEach(brandId => {
        expect(brandId).toMatch(validIdPattern);
      });
    });
  });

  describe('BRAND_METADATA (Per-Brand Configuration)', () => {

    test('BRAND_METADATA is a frozen object', () => {
      expect(typeof BRAND_METADATA).toBe('object');
      expect(Object.isFrozen(BRAND_METADATA)).toBe(true);
    });

    test('every brand in BRANDS has metadata', () => {
      BRANDS.forEach(brandId => {
        expect(BRAND_METADATA).toHaveProperty(brandId);
        expect(BRAND_METADATA[brandId]).not.toBeNull();
      });
    });

    test('every brand has required fields: id, name, type', () => {
      BRANDS.forEach(brandId => {
        const metadata = BRAND_METADATA[brandId];

        // Required fields
        expect(metadata).toHaveProperty('id');
        expect(metadata).toHaveProperty('name');
        expect(metadata).toHaveProperty('type');

        // Validate types
        expect(typeof metadata.id).toBe('string');
        expect(typeof metadata.name).toBe('string');
        expect(typeof metadata.type).toBe('string');

        // Validate id matches key
        expect(metadata.id).toBe(brandId);

        // Validate name is non-empty
        expect(metadata.name.length).toBeGreaterThan(0);

        // Validate type is one of allowed values
        expect(['standalone', 'parent', 'child']).toContain(metadata.type);
      });
    });

    test('brand names are human-readable', () => {
      BRANDS.forEach(brandId => {
        const metadata = BRAND_METADATA[brandId];

        // Names should be longer than IDs (more descriptive)
        expect(metadata.name.length).toBeGreaterThanOrEqual(brandId.length);

        // Names shouldn't be all uppercase (not constants)
        expect(metadata.name).not.toBe(metadata.name.toUpperCase());
      });
    });

    test('child brands have parentBrand defined', () => {
      BRANDS.forEach(brandId => {
        const metadata = BRAND_METADATA[brandId];

        if (metadata.type === 'child') {
          expect(metadata).toHaveProperty('parentBrand');
          expect(typeof metadata.parentBrand).toBe('string');
          expect(BRANDS).toContain(metadata.parentBrand);
        }
      });
    });

    test('parent brands have childBrands array', () => {
      BRANDS.forEach(brandId => {
        const metadata = BRAND_METADATA[brandId];

        if (metadata.type === 'parent') {
          expect(metadata).toHaveProperty('childBrands');
          expect(Array.isArray(metadata.childBrands)).toBe(true);
          expect(metadata.childBrands.length).toBeGreaterThan(0);

          // All child brands should exist
          metadata.childBrands.forEach(childId => {
            expect(BRANDS).toContain(childId);
          });
        }
      });
    });

    test('parent-child relationships are bidirectional', () => {
      BRANDS.forEach(brandId => {
        const metadata = BRAND_METADATA[brandId];

        if (metadata.type === 'parent' && metadata.childBrands) {
          metadata.childBrands.forEach(childId => {
            const childMetadata = BRAND_METADATA[childId];
            expect(childMetadata.parentBrand).toBe(brandId);
          });
        }

        if (metadata.type === 'child' && metadata.parentBrand) {
          const parentMetadata = BRAND_METADATA[metadata.parentBrand];
          expect(parentMetadata.childBrands).toContain(brandId);
        }
      });
    });
  });

  describe('DEFAULT Values', () => {

    test('DEFAULT_BRAND is a valid brand', () => {
      expect(typeof DEFAULT_BRAND).toBe('string');
      expect(BRANDS).toContain(DEFAULT_BRAND);
    });

    test('DEFAULT_SPREADSHEET_ID is a valid Google Sheets ID format', () => {
      expect(typeof DEFAULT_SPREADSHEET_ID).toBe('string');
      expect(DEFAULT_SPREADSHEET_ID.length).toBeGreaterThan(20);
      // Google Sheets IDs are alphanumeric with dashes and underscores
      expect(DEFAULT_SPREADSHEET_ID).toMatch(/^[a-zA-Z0-9_-]+$/);
    });
  });

  describe('Helper Functions', () => {

    test('isValidBrand() validates correctly', () => {
      // Valid brands
      BRANDS.forEach(brandId => {
        expect(isValidBrand(brandId)).toBe(true);
      });

      // Invalid brands
      expect(isValidBrand('invalid')).toBe(false);
      expect(isValidBrand('')).toBe(false);
      expect(isValidBrand(null)).toBe(false);
      expect(isValidBrand(undefined)).toBe(false);
      expect(isValidBrand(123)).toBe(false);
    });

    test('getBrandMetadata() returns correct data', () => {
      BRANDS.forEach(brandId => {
        const metadata = getBrandMetadata(brandId);
        expect(metadata).not.toBeNull();
        expect(metadata.id).toBe(brandId);
        expect(metadata.name).toBe(BRAND_METADATA[brandId].name);
      });

      // Invalid brand returns null
      expect(getBrandMetadata('invalid')).toBeNull();
    });

    test('getBrandName() returns human-readable names', () => {
      expect(getBrandName('root')).toBe('Zeventbook');
      expect(getBrandName('abc')).toBe('American Bocce Co.');
      expect(getBrandName('cbc')).toBe('Chicago Bocce Club');
      expect(getBrandName('cbl')).toBe('Chicago Bocce League');

      // Invalid brand returns brandId as fallback
      expect(getBrandName('invalid')).toBe('invalid');
    });

    test('getAllBrandMetadata() returns all brands', () => {
      const allMetadata = getAllBrandMetadata();

      expect(Object.keys(allMetadata).length).toBe(BRANDS.length);
      BRANDS.forEach(brandId => {
        expect(allMetadata).toHaveProperty(brandId);
      });
    });

    test('getChildBrands() returns correct children', () => {
      // ABC should have cbc and cbl as children
      const abcChildren = getChildBrands('abc');
      expect(abcChildren).toContain('cbc');
      expect(abcChildren).toContain('cbl');

      // Root has no children
      expect(getChildBrands('root')).toEqual([]);

      // Invalid brand returns empty array
      expect(getChildBrands('invalid')).toEqual([]);
    });

    test('getParentBrand() returns correct parent', () => {
      expect(getParentBrand('cbc')).toBe('abc');
      expect(getParentBrand('cbl')).toBe('abc');
      expect(getParentBrand('abc')).toBeNull();
      expect(getParentBrand('root')).toBeNull();
    });

    test('getBrandsByType() filters correctly', () => {
      const standalone = getBrandsByType('standalone');
      const parents = getBrandsByType('parent');
      const children = getBrandsByType('child');

      expect(standalone).toContain('root');
      expect(parents).toContain('abc');
      expect(children).toContain('cbc');
      expect(children).toContain('cbl');

      // All brands should be categorized
      const total = standalone.length + parents.length + children.length;
      expect(total).toBe(BRANDS.length);
    });
  });

  describe('Runtime Configuration', () => {

    test('getBrandConfig() returns complete config for all brands', () => {
      BRANDS.forEach(brandId => {
        const config = getBrandConfig(brandId);

        // Static metadata
        expect(config).toHaveProperty('brandId');
        expect(config).toHaveProperty('brandName');
        expect(config).toHaveProperty('brandType');
        expect(config.brandId).toBe(brandId);

        // Runtime config
        expect(config).toHaveProperty('spreadsheetId');
        expect(config).toHaveProperty('adminKey');

        // Derived flags
        expect(config).toHaveProperty('hasAdminKey');
        expect(config).toHaveProperty('hasDedicatedSpreadsheet');
        expect(config).toHaveProperty('isConfigured');

        // Types
        expect(typeof config.hasAdminKey).toBe('boolean');
        expect(typeof config.hasDedicatedSpreadsheet).toBe('boolean');
        expect(typeof config.isConfigured).toBe('boolean');
      });
    });

    test('getBrandConfig() defaults to root for invalid brand', () => {
      const config = getBrandConfig('invalid');
      expect(config.brandId).toBe('root');
    });

    test('getAllBrandConfigs() returns config for all brands', () => {
      const allConfigs = getAllBrandConfigs();

      expect(Object.keys(allConfigs).length).toBe(BRANDS.length);
      BRANDS.forEach(brandId => {
        expect(allConfigs).toHaveProperty(brandId);
        expect(allConfigs[brandId].brandId).toBe(brandId);
      });
    });

    test('getConfiguredBrands() returns array', () => {
      const configured = getConfiguredBrands();
      expect(Array.isArray(configured)).toBe(true);

      // All configured brands should be valid
      configured.forEach(brandId => {
        expect(BRANDS).toContain(brandId);
      });
    });

    test('createBrandTestMatrix() creates valid test matrix', () => {
      const matrix = createBrandTestMatrix();

      expect(Array.isArray(matrix)).toBe(true);
      expect(matrix.length).toBe(BRANDS.length);

      matrix.forEach(([brandId, config]) => {
        expect(BRANDS).toContain(brandId);
        expect(config.brandId).toBe(brandId);
      });
    });
  });

  describe('Source Consistency - All Files Use Centralized Config', () => {

    test('environments.js imports BRANDS from centralized config', () => {
      // The BRANDS exported from environments.js should be the same array
      expect(environmentsConfig.BRANDS).toEqual(BRANDS);
    });

    test('test.helpers.js uses centralized BRANDS', () => {
      expect(testHelpers.brandHelpers.BRANDS).toEqual(BRANDS);
    });

    test('test brand-config.js uses centralized BRANDS', () => {
      expect(testBrandConfig.BRANDS).toEqual(BRANDS);
    });

    test('test brand-config.js exposes centralized metadata', () => {
      expect(testBrandConfig.BRAND_METADATA).toEqual(BRAND_METADATA);
    });
  });

  describe('Backend Sync - Config.gs Alignment', () => {
    // Story 5.3: GAS files archived to archive/gas/
    const GAS_ARCHIVE_DIR = path.join(__dirname, '../../archive/gas');

    test('Config.gs BRANDS array matches centralized config', () => {
      const configGsPath = path.join(GAS_ARCHIVE_DIR, 'Config.gs');

      // Read Config.gs
      const configGs = fs.readFileSync(configGsPath, 'utf8');

      // Extract brand IDs from Config.gs BRANDS array
      // Pattern: id: 'brandId'
      const brandIdPattern = /id:\s*['"]([a-z]+)['"]/g;
      const configGsBrands = [];
      let match;
      while ((match = brandIdPattern.exec(configGs)) !== null) {
        configGsBrands.push(match[1]);
      }

      // Should find at least the expected brands
      BRANDS.forEach(brandId => {
        expect(configGsBrands).toContain(brandId);
      });
    });

    test('Config.gs brand names match centralized config', () => {
      const configGsPath = path.join(GAS_ARCHIVE_DIR, 'Config.gs');
      const configGs = fs.readFileSync(configGsPath, 'utf8');

      // Check that each brand's name appears in Config.gs
      BRANDS.forEach(brandId => {
        const metadata = BRAND_METADATA[brandId];
        // Brand name should appear somewhere in Config.gs
        // Using a loose check since formatting may differ
        const namePattern = new RegExp(`name:\\s*['"]${metadata.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`);
        expect(configGs).toMatch(namePattern);
      });
    });
  });

  describe('Worker Sync - Cloudflare Worker Alignment', () => {

    test('worker.js VALID_BRANDS matches centralized config', () => {
      const workerPath = path.join(__dirname, '../../cloudflare-proxy/worker.js');
      const workerJs = fs.readFileSync(workerPath, 'utf8');

      // Extract VALID_BRANDS from worker.js
      const validBrandsMatch = workerJs.match(/const\s+VALID_BRANDS\s*=\s*Object\.freeze\(\[([^\]]+)\]\)/);
      expect(validBrandsMatch).not.toBeNull();

      const brandStrings = validBrandsMatch[1];
      const workerBrands = brandStrings
        .match(/'([^']+)'/g)
        .map(s => s.replace(/'/g, ''));

      // Worker should have exactly the same brands
      expect(workerBrands.sort()).toEqual([...BRANDS].sort());
    });
  });
});

/**
 * Coverage Report: Brand Configuration
 *
 * Tests ensure:
 * - All brands have required metadata (id, name, type)
 * - Brand IDs are unique and lowercase
 * - Parent-child relationships are consistent
 * - Helper functions work correctly
 * - All config files use centralized source
 * - Backend Config.gs stays in sync
 * - Worker routing config stays in sync
 *
 * Run with: npm run test -- tests/unit/brand-config.test.js
 */
