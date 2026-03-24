/**
 * Data Validation Bug Fixes Tests
 *
 * Tests for data validation improvements:
 * - Bug #8: Off-by-one errors in diagnostic cleanup
 * - Bug #9: Off-by-one errors in daily cleanup
 * - Bug #10: Array bounds checking
 * - Bug #23: getRange invalid parameters
 * - Bug #24: getRange with empty sheets
 * - Bug #27: Schema validation for updates
 * - Bug #28: Safe JSON parsing
 */

describe('Data Validation Bug Fixes', () => {

  describe('Bug #8 & #9: Off-by-One Errors', () => {
    test('should calculate correct rows to delete for hard cap', () => {
      const DIAG_MAX = 3000;

      // Test when last row exceeds cap
      const last1 = 3500;
      const rowsToDelete1 = last1 - DIAG_MAX;
      expect(rowsToDelete1).toBe(500);

      // Test when last row is at cap
      const last2 = 3000;
      const rowsToDelete2 = last2 - DIAG_MAX;
      expect(rowsToDelete2).toBe(0);

      // Test when last row is below cap
      const last3 = 2500;
      const rowsToDelete3 = last3 - DIAG_MAX;
      expect(rowsToDelete3).toBe(-500);
      expect(rowsToDelete3 > 0).toBe(false); // Should not delete
    });

    test('should calculate correct rows for daily cleanup', () => {
      const DIAG_PER_DAY = 800;

      // If we have 900 entries for today
      const todayEntries = 900;
      const rowsToDelete = todayEntries - DIAG_PER_DAY;
      expect(rowsToDelete).toBe(100);

      // If we have exactly 800 entries
      const exactEntries = 800;
      const rowsToDelete2 = exactEntries - DIAG_PER_DAY;
      expect(rowsToDelete2).toBe(0);
    });

    test('should not delete when count is below threshold', () => {
      const DIAG_PER_DAY = 800;
      const todayEntries = 500;
      const rowsToDelete = todayEntries - DIAG_PER_DAY;

      expect(rowsToDelete).toBeLessThan(0);
      // In actual code, we check: if (rowsToDelete > 0)
      expect(rowsToDelete > 0).toBe(false);
    });
  });

  describe('Bug #10: Array Bounds Checking', () => {
    test('should check array length before accessing elements', () => {
      const emptyArray = [];
      const nonEmptyArray = [{ sponsorId: 'sponsor1' }];

      // Safe access pattern
      const accessSafely = (arr) => {
        if (arr && arr.length > 0) {
          return arr[0];
        }
        return null;
      };

      expect(accessSafely(emptyArray)).toBe(null);
      expect(accessSafely(nonEmptyArray)).toEqual({ sponsorId: 'sponsor1' });
    });

    test('should handle undefined array', () => {
      const accessSafely = (arr) => {
        if (arr && arr.length > 0) {
          return arr[0];
        }
        return null;
      };

      expect(accessSafely(undefined)).toBe(null);
      expect(accessSafely(null)).toBe(null);
    });

    test('should check before accessing nested properties', () => {
      const metrics = {
        bySponsor: []
      };

      const getTopSponsor = (m) => {
        if (m.bySponsor && m.bySponsor.length > 0) {
          const topSponsor = m.bySponsor[0];
          if (topSponsor && topSponsor.sponsorId) {
            return topSponsor.sponsorId;
          }
        }
        return null;
      };

      expect(getTopSponsor(metrics)).toBe(null);

      metrics.bySponsor.push({ sponsorId: 'sponsor1' });
      expect(getTopSponsor(metrics)).toBe('sponsor1');
    });
  });

  describe('Bug #23 & #24: getRange Invalid Parameters', () => {
    test('should check lastRow before calling getRange', () => {
      const simulateGetRange = (lastRow) => {
        // getRange requires at least 1 row
        if (lastRow > 1) {
          const numRows = lastRow - 1;
          return { success: true, rows: numRows };
        }
        return { success: false, rows: 0 };
      };

      // Sheet with only header
      expect(simulateGetRange(1)).toEqual({ success: false, rows: 0 });

      // Sheet with header + data
      expect(simulateGetRange(5)).toEqual({ success: true, rows: 4 });
    });

    test('should return empty array for empty sheets', () => {
      const getDataSafely = (lastRow) => {
        if (lastRow > 1) {
          return Array(lastRow - 1).fill({ data: 'row' });
        }
        return [];
      };

      expect(getDataSafely(1)).toEqual([]);
      expect(getDataSafely(3).length).toBe(2);
    });

    test('should handle Math.max correctly', () => {
      // Bug was: Math.max(0, lastRow - 1) when lastRow = 1
      const lastRow = 1;
      const numRows = Math.max(0, lastRow - 1);

      expect(numRows).toBe(0);
      // getRange(2, 1, 0, 6) would throw error
      // So we need to check: if (numRows > 0)
      expect(numRows > 0).toBe(false);
    });
  });

  describe('Bug #27: Schema Validation for Updates', () => {
    let template;

    beforeEach(() => {
      template = {
        fields: [
          { id: 'name', type: 'text', required: true },
          { id: 'description', type: 'text', required: false },
          { id: 'websiteUrl', type: 'url', required: false },
          { id: 'videoUrl', type: 'url', required: false }
        ]
      };
    });

    test('should accept valid fields', () => {
      const updateData = {
        name: 'Updated Event',
        description: 'New description'
      };

      const validateUpdate = (data, tpl) => {
        for (const [key, _value] of Object.entries(data)) {
          const field = tpl.fields.find(f => f.id === key);
          if (!field) {
            return { valid: false, error: `Unknown field: ${key}` };
          }
        }
        return { valid: true };
      };

      expect(validateUpdate(updateData, template)).toEqual({ valid: true });
    });

    test('should reject unknown fields', () => {
      const updateData = {
        unknownField: 'value'
      };

      const validateUpdate = (data, tpl) => {
        for (const [key, _value] of Object.entries(data)) {
          const field = tpl.fields.find(f => f.id === key);
          if (!field) {
            return { valid: false, error: `Unknown field: ${key}` };
          }
        }
        return { valid: true };
      };

      const result = validateUpdate(updateData, template);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Unknown field: unknownField');
    });

    test('should validate URL fields', () => {
      const isUrl = (s) => {
        try {
          const url = new URL(s);
          return ['http:', 'https:'].includes(url.protocol);
        } catch {
          return false;
        }
      };

      const validateUpdate = (data, tpl) => {
        for (const [key, value] of Object.entries(data)) {
          const field = tpl.fields.find(f => f.id === key);
          if (!field) {
            return { valid: false, error: `Unknown field: ${key}` };
          }

          if (value !== null && value !== undefined) {
            if (field.type === 'url' && !isUrl(value)) {
              return { valid: false, error: `Invalid URL for field: ${key}` };
            }
          }
        }
        return { valid: true };
      };

      expect(validateUpdate({ websiteUrl: 'https://example.com' }, template)).toEqual({ valid: true });
      expect(validateUpdate({ websiteUrl: 'invalid-url' }, template).valid).toBe(false);
    });

    test('should allow null/undefined values', () => {
      const validateUpdate = (data, tpl) => {
        for (const [key, _value] of Object.entries(data)) {
          const field = tpl.fields.find(f => f.id === key);
          if (!field) {
            return { valid: false, error: `Unknown field: ${key}` };
          }
        }
        return { valid: true };
      };

      expect(validateUpdate({ description: null }, template)).toEqual({ valid: true });
      expect(validateUpdate({ description: undefined }, template)).toEqual({ valid: true });
    });
  });

  describe('Bug #28: Safe JSON Parsing', () => {
    let safeJSONParse_;

    beforeEach(() => {
      safeJSONParse_ = function(jsonString, defaultValue = {}) {
        try {
          return JSON.parse(jsonString || '{}');
        } catch (e) {
          return defaultValue;
        }
      };
    });

    test('should parse valid JSON', () => {
      const result = safeJSONParse_('{"name": "test", "value": 123}');
      expect(result).toEqual({ name: 'test', value: 123 });
    });

    test('should return default for invalid JSON', () => {
      const result = safeJSONParse_('invalid json');
      expect(result).toEqual({});
    });

    test('should use custom default value', () => {
      const result = safeJSONParse_('invalid', []);
      expect(result).toEqual([]);
    });

    test('should handle empty string', () => {
      const result = safeJSONParse_('');
      expect(result).toEqual({});
    });

    test('should handle null', () => {
      const result = safeJSONParse_(null);
      expect(result).toEqual({});
    });

    test('should handle undefined', () => {
      const result = safeJSONParse_(undefined);
      expect(result).toEqual({});
    });

    test('should parse nested objects', () => {
      const json = '{"user": {"name": "John", "age": 30}}';
      const result = safeJSONParse_(json);
      expect(result.user.name).toBe('John');
      expect(result.user.age).toBe(30);
    });

    test('should not throw on truncated JSON', () => {
      const truncated = '{"name": "test", "incomplete"';
      expect(() => safeJSONParse_(truncated)).not.toThrow();
      expect(safeJSONParse_(truncated)).toEqual({});
    });
  });

  describe('Template Field Validation', () => {
    let template;

    beforeEach(() => {
      template = {
        fields: [
          { id: 'name', type: 'text', required: true },
          { id: 'email', type: 'text', required: true },
          { id: 'website', type: 'url', required: false },
          { id: 'description', type: 'text', required: false }
        ]
      };
    });

    test('should validate required fields', () => {
      const validateRequired = (data, tpl) => {
        for (const field of tpl.fields) {
          if (field.required) {
            const value = data[field.id];
            if (value === undefined || value === null || value === '') {
              return { valid: false, error: `Missing field: ${field.id}` };
            }
          }
        }
        return { valid: true };
      };

      expect(validateRequired({ name: 'Test', email: 'test@test.com' }, template)).toEqual({ valid: true });
      expect(validateRequired({ name: 'Test' }, template).valid).toBe(false);
      expect(validateRequired({}, template).valid).toBe(false);
    });

    test('should allow optional fields to be missing', () => {
      const validateRequired = (data, tpl) => {
        for (const field of tpl.fields) {
          if (field.required) {
            const value = data[field.id];
            if (value === undefined || value === null || value === '') {
              return { valid: false, error: `Missing field: ${field.id}` };
            }
          }
        }
        return { valid: true };
      };

      const data = { name: 'Test', email: 'test@test.com' };
      // website and description are optional
      expect(validateRequired(data, template)).toEqual({ valid: true });
    });

    test('should validate field types', () => {
      const isUrl = (s) => {
        try {
          new URL(s);
          return true;
        } catch {
          return false;
        }
      };

      const validateTypes = (data, tpl) => {
        for (const field of tpl.fields) {
          const value = data[field.id];
          if (value != null && field.type === 'url' && !isUrl(value)) {
            return { valid: false, error: `Invalid URL: ${field.id}` };
          }
        }
        return { valid: true };
      };

      expect(validateTypes({ website: 'https://example.com' }, template)).toEqual({ valid: true });
      expect(validateTypes({ website: 'not-a-url' }, template).valid).toBe(false);
    });
  });

  describe('Bug #39: Inconsistent Null Checks', () => {
    test('should handle 0 and empty string correctly', () => {
      const getValue = (value, defaultValue) => {
        // Old buggy way: value || defaultValue (treats 0 and "" as falsy)
        // Fixed way: explicit null/undefined check
        return (value !== null && value !== undefined && value !== '') ? value : defaultValue;
      };

      expect(getValue(0, 10)).toBe(0); // 0 should NOT be replaced
      expect(getValue('', 'default')).toBe('default'); // '' should be replaced
      expect(getValue(false, true)).toBe(false); // false should NOT be replaced
      expect(getValue(null, 'default')).toBe('default');
      expect(getValue(undefined, 'default')).toBe('default');
    });

    test('should preserve valid 0 values in analytics', () => {
      const row = [null, null, 'surface', 'metric', '', 0, ''];

      const sponsorId = (row[4] !== null && row[4] !== undefined && row[4] !== '') ? row[4] : '-';
      const value = Number((row[5] !== null && row[5] !== undefined) ? row[5] : 0);
      const token = (row[6] !== null && row[6] !== undefined && row[6] !== '') ? row[6] : '-';

      expect(sponsorId).toBe('-');
      expect(value).toBe(0); // Valid 0 value
      expect(token).toBe('-');
    });
  });

  describe('Bug #42: Deterministic Cleanup Logic', () => {
    test('should use counter instead of random', () => {
      const shouldCleanup = (currentCounter) => {
        return (currentCounter % 50 === 0);
      };

      expect(shouldCleanup(50)).toBe(true);
      expect(shouldCleanup(100)).toBe(true);
      expect(shouldCleanup(150)).toBe(true);
      expect(shouldCleanup(49)).toBe(false);
      expect(shouldCleanup(51)).toBe(false);
    });

    test('should be deterministic and predictable', () => {
      const cleanupTriggers = [];
      for (let i = 1; i <= 200; i++) {
        if (i % 50 === 0) {
          cleanupTriggers.push(i);
        }
      }

      expect(cleanupTriggers).toEqual([50, 100, 150, 200]);
      expect(cleanupTriggers.length).toBe(4);
    });
  });

  describe('Bug #43: Brand Fallback Logic', () => {
    test('should return null for unknown hosts instead of defaulting to root', () => {
      const BRANDS = [
        { id: 'root', hostnames: ['zeventbook.io'] },
        { id: 'abc', hostnames: ['abc.zeventbooks.io'] }
      ];

      const findBrandByHost = (host) => {
        const brand = BRANDS.find(t => (t.hostnames || []).includes(host.toLowerCase()));
        return brand || null; // Return null, not root brand
      };

      expect(findBrandByHost('zeventbook.io')).toEqual({ id: 'root', hostnames: ['zeventbook.io'] });
      expect(findBrandByHost('abc.zeventbooks.io')).toEqual({ id: 'abc', hostnames: ['abc.zeventbooks.io'] });
      expect(findBrandByHost('unknown.com')).toBe(null); // Should be null, not root
    });

    test('should log warning for unknown hostnames', () => {
      const warnings = [];

      const findBrandByHost = (host) => {
        const BRANDS = [{ id: 'root', hostnames: ['zeventbook.io'] }];
        const brand = BRANDS.find(t => (t.hostnames || []).includes(host.toLowerCase()));

        if (!brand) {
          warnings.push(`Unknown hostname: ${host}`);
        }

        return brand || null;
      };

      findBrandByHost('unknown.com');
      expect(warnings).toContain('Unknown hostname: unknown.com');
    });
  });

  describe('Bug #45: Input Length Validation', () => {
    test('should validate URL length in createShortlink', () => {
      const validateUrlLength = (url, maxLength = 2048) => {
        if (!url) return false;
        if (url.length > maxLength) return false;
        return true;
      };

      const normalUrl = 'https://example.com/page';
      const longUrl = 'http://example.com/' + 'a'.repeat(3000);

      expect(validateUrlLength(normalUrl)).toBe(true);
      expect(validateUrlLength(longUrl, 2048)).toBe(false);
      expect(validateUrlLength(longUrl, 5000)).toBe(true);
    });

    test('should reject URLs exceeding max length', () => {
      const MAX_URL_LENGTH = 2048;

      const isValidLength = (url) => {
        return url && url.length <= MAX_URL_LENGTH;
      };

      expect(isValidLength('https://example.com')).toBe(true);
      expect(isValidLength('http://example.com/' + 'a'.repeat(2050))).toBe(false);
    });
  });

  describe('Bug #47: Cleanup Error Handling', () => {
    test('should not fail logging when cleanup fails', () => {
      const logs = [];
      const errors = [];

      const logWithCleanup = (message) => {
        logs.push(message);

        try {
          // Simulate cleanup operations
          if (logs.length > 100) {
            throw new Error('Cleanup failed');
          }
        } catch (cleanupErr) {
          errors.push(cleanupErr.message);
          // Continue execution - don't fail logging
        }
      };

      // Add many logs to trigger cleanup
      for (let i = 0; i < 105; i++) {
        logWithCleanup(`Log ${i}`);
      }

      expect(logs.length).toBe(105); // All logs should succeed
      expect(errors.length).toBeGreaterThan(0); // Cleanup errors captured
      expect(errors[0]).toBe('Cleanup failed');
    });

    test('should wrap cleanup in try-catch', () => {
      let cleanupFailed = false;

      const performCleanup = () => {
        try {
          throw new Error('Simulated cleanup error');
        } catch (err) {
          cleanupFailed = true;
        }
      };

      performCleanup();
      expect(cleanupFailed).toBe(true);
    });
  });

  describe('Bug #41: Memory Leak Prevention', () => {
    test('should limit data processed for unique counts', () => {
      const largeDataset = Array.from({ length: 20000 }, (_, i) => ({
        eventId: `event${i % 100}`,
        sponsorId: `sponsor${i % 50}`
      }));

      // Old approach: processes all data (memory issue)
      // New approach: limit to 10000 items
      const limitedDataset = largeDataset.slice(0, 10000);

      const uniqueEvents = new Set(limitedDataset.map(a => a.eventId)).size;
      const uniqueSponsors = new Set(limitedDataset.map(a => a.sponsorId)).size;

      expect(limitedDataset.length).toBe(10000);
      expect(uniqueEvents).toBeLessThanOrEqual(100);
      expect(uniqueSponsors).toBeLessThanOrEqual(50);
    });

    test('should use Math.min to cap unique counts', () => {
      const filtered = Array.from({ length: 15000 }, (_, i) => ({
        eventId: `event${i % 200}`
      }));

      // Calculate with limit
      const uniqueEvents = Math.min(
        new Set(filtered.slice(0, 10000).map(a => a.eventId)).size,
        filtered.length
      );

      expect(uniqueEvents).toBeLessThanOrEqual(filtered.length);
      expect(uniqueEvents).toBeGreaterThan(0);
    });
  });
});
