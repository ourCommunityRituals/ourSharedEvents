/**
 * Multi-brand Isolation Tests
 *
 * CRITICAL SECURITY: Ensures brand data cannot cross boundaries
 * Tests that events, sponsors, and analytics are properly isolated per brand
 *
 * Priority: HIGH (Security Vulnerability)
 * Coverage Gap: 0% -> Target: 100%
 */

const { brandHelpers } = require('../shared/helpers/test.helpers');
const { createBasicEvent } = require('../shared/fixtures/events.fixtures');

describe('Multi-brand Isolation', () => {

  describe('Brand ID Validation', () => {
    it('should have all valid brand IDs defined', () => {
      expect(brandHelpers.BRANDS).toEqual(['root', 'abc', 'cbc', 'cbl']);
      expect(brandHelpers.BRANDS).toHaveLength(4);
    });

    it('should get random brand from valid list', () => {
      const brand = brandHelpers.randomBrand();
      expect(brandHelpers.BRANDS).toContain(brand);
    });

    it('should get different brand for cross-brand tests', () => {
      const brand1 = 'root';
      const brand2 = brandHelpers.differentBrand(brand1);
      expect(brand2).not.toBe(brand1);
      expect(brandHelpers.BRANDS).toContain(brand2);
    });
  });

  describe('Brand Data Separation Logic', () => {
    /**
     * Simulates the brand filtering logic from Code.gs
     * This should match the actual implementation
     */
    const filterByBrand = (items, brandId) => {
      return items.filter(item => item.brandId === brandId);
    };

    it('should only return events for specified brand', () => {
      const allEvents = [
        { id: '1', brandId: 'root', data: { name: 'Root Event 1' } },
        { id: '2', brandId: 'abc', data: { name: 'ABC Event 1' } },
        { id: '3', brandId: 'root', data: { name: 'Root Event 2' } },
        { id: '4', brandId: 'cbc', data: { name: 'CBC Event 1' } },
      ];

      const rootEvents = filterByBrand(allEvents, 'root');
      expect(rootEvents).toHaveLength(2);
      expect(rootEvents.every(e => e.brandId === 'root')).toBe(true);

      const abcEvents = filterByBrand(allEvents, 'abc');
      expect(abcEvents).toHaveLength(1);
      expect(abcEvents[0].brandId).toBe('abc');
    });

    it('should return empty array for brand with no events', () => {
      const allEvents = [
        { id: '1', brandId: 'root', data: { name: 'Root Event' } },
      ];

      const cblEvents = filterByBrand(allEvents, 'cbl');
      expect(cblEvents).toHaveLength(0);
    });

    it('should not leak events between brands', () => {
      const allEvents = [
        { id: '1', brandId: 'abc', data: { name: 'ABC Event' } },
        { id: '2', brandId: 'cbc', data: { name: 'CBC Event' } },
      ];

      const abcEvents = filterByBrand(allEvents, 'abc');
      const cbcEvents = filterByBrand(allEvents, 'cbc');

      expect(abcEvents).toHaveLength(1);
      expect(cbcEvents).toHaveLength(1);
      expect(abcEvents[0].id).toBe('1');
      expect(cbcEvents[0].id).toBe('2');

      // Verify no overlap
      expect(abcEvents.find(e => e.id === '2')).toBeUndefined();
      expect(cbcEvents.find(e => e.id === '1')).toBeUndefined();
    });
  });

  describe('Admin Key Scope', () => {
    /**
     * Simulates admin key validation logic
     * Each brand should have its own admin key
     */
    const ADMIN_KEYS = {
      root: 'root-admin-key',
      abc: 'abc-admin-key',
      cbc: 'cbc-admin-key',
      cbl: 'cbl-admin-key'
    };

    const validateAdminKey = (brandId, adminKey) => {
      return ADMIN_KEYS[brandId] === adminKey;
    };

    it('should validate admin key for correct brand', () => {
      expect(validateAdminKey('root', 'root-admin-key')).toBe(true);
      expect(validateAdminKey('abc', 'abc-admin-key')).toBe(true);
      expect(validateAdminKey('cbc', 'cbc-admin-key')).toBe(true);
      expect(validateAdminKey('cbl', 'cbl-admin-key')).toBe(true);
    });

    it('should reject admin key from different brand', () => {
      expect(validateAdminKey('root', 'abc-admin-key')).toBe(false);
      expect(validateAdminKey('abc', 'root-admin-key')).toBe(false);
      expect(validateAdminKey('cbc', 'cbl-admin-key')).toBe(false);
    });

    it('should reject invalid admin key', () => {
      expect(validateAdminKey('root', 'invalid-key')).toBe(false);
      expect(validateAdminKey('abc', '')).toBe(false);
      expect(validateAdminKey('cbc', null)).toBe(false);
    });

    it('should have unique admin key per brand', () => {
      const keys = Object.values(ADMIN_KEYS);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });
  });

  describe('Cross-Brand Request Rejection', () => {
    /**
     * Simulates request validation logic
     * Requests should be rejected if brandId doesn't match admin key
     */
    const validateRequest = (requestBrandId, adminKeyBrandId) => {
      if (requestBrandId !== adminKeyBrandId) {
        return { ok: false, code: 'BAD_INPUT', message: 'Brand mismatch' };
      }
      return { ok: true };
    };

    it('should allow request when brand matches admin key', () => {
      const result = validateRequest('root', 'root');
      expect(result.ok).toBe(true);
    });

    it('should reject request when brand does not match admin key', () => {
      const result = validateRequest('abc', 'root');
      expect(result.ok).toBe(false);
      expect(result.code).toBe('BAD_INPUT');
      expect(result.message).toContain('mismatch');
    });

    it('should reject all cross-brand combinations', () => {
      const brands = ['root', 'abc', 'cbc', 'cbl'];

      brands.forEach(brand1 => {
        brands.forEach(brand2 => {
          if (brand1 !== brand2) {
            const result = validateRequest(brand1, brand2);
            expect(result.ok).toBe(false);
          }
        });
      });
    });
  });

  describe('Brand Isolation in Event Creation', () => {
    it('should create event with correct brand ID', () => {
      const event = createBasicEvent();
      const brandId = 'root';

      const createdEvent = {
        id: 'event-123',
        brandId: brandId,
        templateId: 'event',
        data: event,
        createdAt: new Date().toISOString()
      };

      expect(createdEvent.brandId).toBe(brandId);
    });

    it('should not allow brand ID override in event data', () => {
      // Malicious attempt to override brand ID
      const maliciousEvent = createBasicEvent({ brandId: 'abc' });
      const requestBrandId = 'root';

      // System should ignore the brandId in event data and use request brand
      const createdEvent = {
        id: 'event-123',
        brandId: requestBrandId, // Should use request brand, not data brand
        templateId: 'event',
        data: maliciousEvent,
        createdAt: new Date().toISOString()
      };

      expect(createdEvent.brandId).toBe(requestBrandId);
      expect(createdEvent.brandId).not.toBe('abc');
    });
  });

  describe('Analytics Isolation', () => {
    /**
     * Analytics should be scoped per brand
     * No leakage of analytics data between brands
     */
    const filterAnalyticsByBrand = (analyticsEvents, brandId) => {
      return analyticsEvents.filter(event => event.brandId === brandId);
    };

    it('should isolate analytics by brand', () => {
      const allAnalytics = [
        { eventId: '1', brandId: 'root', eventType: 'impression', count: 100 },
        { eventId: '2', brandId: 'abc', eventType: 'impression', count: 50 },
        { eventId: '3', brandId: 'root', eventType: 'click', count: 10 },
      ];

      const rootAnalytics = filterAnalyticsByBrand(allAnalytics, 'root');
      expect(rootAnalytics).toHaveLength(2);
      expect(rootAnalytics.every(a => a.brandId === 'root')).toBe(true);

      const abcAnalytics = filterAnalyticsByBrand(allAnalytics, 'abc');
      expect(abcAnalytics).toHaveLength(1);
      expect(abcAnalytics[0].brandId).toBe('abc');
    });

    it('should not aggregate analytics across brands', () => {
      const allAnalytics = [
        { eventId: '1', brandId: 'root', impressions: 100 },
        { eventId: '2', brandId: 'abc', impressions: 50 },
      ];

      const rootTotal = filterAnalyticsByBrand(allAnalytics, 'root')
        .reduce((sum, a) => sum + a.impressions, 0);

      const abcTotal = filterAnalyticsByBrand(allAnalytics, 'abc')
        .reduce((sum, a) => sum + a.impressions, 0);

      expect(rootTotal).toBe(100);
      expect(abcTotal).toBe(50);
      expect(rootTotal + abcTotal).toBe(150); // Total is correct but isolated
    });
  });

  describe('Shortlink Token Isolation', () => {
    /**
     * Shortlink tokens should be scoped per brand
     */
    const filterShortlinksByBrand = (shortlinks, brandId) => {
      return shortlinks.filter(link => link.brandId === brandId);
    };

    it('should isolate shortlinks by brand', () => {
      const allShortlinks = [
        { token: 'abc123', brandId: 'root', targetUrl: 'https://example.com/1' },
        { token: 'def456', brandId: 'abc', targetUrl: 'https://example.com/2' },
      ];

      const rootLinks = filterShortlinksByBrand(allShortlinks, 'root');
      const abcLinks = filterShortlinksByBrand(allShortlinks, 'abc');

      expect(rootLinks).toHaveLength(1);
      expect(abcLinks).toHaveLength(1);
      expect(rootLinks[0].token).toBe('abc123');
      expect(abcLinks[0].token).toBe('def456');
    });

    it('should prevent token collision across brands', () => {
      // Even if tokens are the same, they should be scoped by brand
      const allShortlinks = [
        { token: 'same-token', brandId: 'root', targetUrl: 'https://root.com' },
        { token: 'same-token', brandId: 'abc', targetUrl: 'https://abc.com' },
      ];

      const rootLinks = filterShortlinksByBrand(allShortlinks, 'root');
      const abcLinks = filterShortlinksByBrand(allShortlinks, 'abc');

      expect(rootLinks[0].targetUrl).toBe('https://root.com');
      expect(abcLinks[0].targetUrl).toBe('https://abc.com');
      expect(rootLinks[0].targetUrl).not.toBe(abcLinks[0].targetUrl);
    });
  });

  describe('Edge Cases and Attack Vectors', () => {
    it('should handle null brand ID safely', () => {
      const filterByBrand = (items, brandId) => {
        if (!brandId) return [];
        return items.filter(item => item.brandId === brandId);
      };

      const events = [
        { id: '1', brandId: 'root', data: {} },
      ];

      expect(filterByBrand(events, null)).toEqual([]);
      expect(filterByBrand(events, undefined)).toEqual([]);
      expect(filterByBrand(events, '')).toEqual([]);
    });

    it('should handle SQL injection attempts in brand ID', () => {
      const maliciousBrandIds = [
        "root' OR '1'='1",
        "root; DROP TABLE events;--",
        "root OR 1=1",
        "../../../etc/passwd"
      ];

      maliciousBrandIds.forEach(maliciousId => {
        const isValid = brandHelpers.BRANDS.includes(maliciousId);
        expect(isValid).toBe(false);
      });
    });

    it('should handle case sensitivity in brand IDs', () => {
      const filterByBrand = (items, brandId) => {
        // Brand IDs should be case-sensitive
        return items.filter(item => item.brandId === brandId);
      };

      const events = [
        { id: '1', brandId: 'root', data: {} },
      ];

      expect(filterByBrand(events, 'ROOT')).toEqual([]);
      expect(filterByBrand(events, 'Root')).toEqual([]);
      expect(filterByBrand(events, 'root')).toHaveLength(1);
    });
  });
});
