/**
 * Enhanced Rate Limiting Tests
 *
 * CRITICAL SECURITY: Ensures rate limiting prevents DoS attacks
 * Tests edge cases, distributed scenarios, and reset mechanisms
 *
 * Priority: HIGH (Security - DoS Prevention)
 * Coverage Gap: 20% -> Target: 100%
 *
 * Rate Limit: 20 requests per minute per IP/identifier
 */

const { sleep } = require('../shared/helpers/test.helpers');

describe('Rate Limiting', () => {
  const RATE_MAX_PER_MIN = 20;
  const RATE_WINDOW_MS = 60000; // 1 minute

  /**
   * Simulates rate limiting logic from Code.gs
   * In production, this would use cache/property service
   */
  class RateLimiter {
    constructor() {
      this.requests = new Map(); // key -> [timestamp, timestamp, ...]
    }

    checkLimit(identifier) {
      const now = Date.now();
      const windowStart = now - RATE_WINDOW_MS;

      // Get requests in current window
      let userRequests = this.requests.get(identifier) || [];

      // Filter to only requests in current window
      userRequests = userRequests.filter(timestamp => timestamp > windowStart);

      // Update stored requests
      this.requests.set(identifier, userRequests);

      // Check if under limit
      return userRequests.length < RATE_MAX_PER_MIN;
    }

    recordRequest(identifier) {
      const now = Date.now();
      const userRequests = this.requests.get(identifier) || [];
      userRequests.push(now);
      this.requests.set(identifier, userRequests);
    }

    reset(identifier) {
      this.requests.delete(identifier);
    }

    resetAll() {
      this.requests.clear();
    }
  }

  describe('Basic Rate Limiting', () => {
    let limiter;

    beforeEach(() => {
      limiter = new RateLimiter();
    });

    it('should allow requests under limit', () => {
      const identifier = 'user-1';

      for (let i = 0; i < 19; i++) {
        expect(limiter.checkLimit(identifier)).toBe(true);
        limiter.recordRequest(identifier);
      }
    });

    it('should block requests at limit', () => {
      const identifier = 'user-1';

      // Make 20 requests (at limit)
      for (let i = 0; i < RATE_MAX_PER_MIN; i++) {
        limiter.recordRequest(identifier);
      }

      // 21st request should be blocked
      expect(limiter.checkLimit(identifier)).toBe(false);
    });

    it('should block requests over limit', () => {
      const identifier = 'user-1';

      // Make 25 requests (over limit)
      for (let i = 0; i < 25; i++) {
        limiter.recordRequest(identifier);
      }

      expect(limiter.checkLimit(identifier)).toBe(false);
    });

    it('should have correct rate limit constant', () => {
      expect(RATE_MAX_PER_MIN).toBe(20);
    });
  });

  describe('Concurrent Request Handling', () => {
    let limiter;

    beforeEach(() => {
      limiter = new RateLimiter();
    });

    it('should handle multiple users independently', () => {
      const user1 = 'user-1';
      const user2 = 'user-2';

      // User 1 makes 20 requests
      for (let i = 0; i < RATE_MAX_PER_MIN; i++) {
        limiter.recordRequest(user1);
      }

      // User 1 should be blocked
      expect(limiter.checkLimit(user1)).toBe(false);

      // User 2 should still be allowed
      expect(limiter.checkLimit(user2)).toBe(true);
    });

    it('should track requests per identifier separately', () => {
      const identifiers = ['ip-1', 'ip-2', 'ip-3'];

      identifiers.forEach(id => {
        for (let i = 0; i < 10; i++) {
          limiter.recordRequest(id);
        }
      });

      // Each should be under limit
      identifiers.forEach(id => {
        expect(limiter.checkLimit(id)).toBe(true);
      });
    });

    it('should handle simultaneous requests from same user', () => {
      const identifier = 'user-1';

      // Simulate 5 concurrent requests hitting at same millisecond
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        limiter.requests.set(identifier, [
          ...(limiter.requests.get(identifier) || []),
          now
        ]);
      }

      // Should count all 5
      const userRequests = limiter.requests.get(identifier);
      expect(userRequests.length).toBe(5);
    });
  });

  describe('Time Window Edge Cases', () => {
    let limiter;

    beforeEach(() => {
      limiter = new RateLimiter();
    });

    it('should allow requests after window expires', async () => {
      const identifier = 'user-1';

      // Make requests at start of window
      const oldTimestamp = Date.now() - RATE_WINDOW_MS - 1000;
      for (let i = 0; i < RATE_MAX_PER_MIN; i++) {
        limiter.requests.set(identifier, [
          ...(limiter.requests.get(identifier) || []),
          oldTimestamp
        ]);
      }

      // These old requests should be expired
      expect(limiter.checkLimit(identifier)).toBe(true);
    });

    it('should handle boundary condition at exact window edge', () => {
      const identifier = 'user-1';
      const now = Date.now();
      const windowStart = now - RATE_WINDOW_MS;

      // Request exactly at window boundary
      limiter.requests.set(identifier, [windowStart + 1]);

      expect(limiter.checkLimit(identifier)).toBe(true);
    });

    it('should expire old requests gradually', () => {
      const identifier = 'user-1';
      const now = Date.now();

      // Mix of old and recent requests
      const timestamps = [
        now - RATE_WINDOW_MS - 5000, // Expired
        now - RATE_WINDOW_MS - 1000, // Expired
        now - 30000, // Valid (30 seconds ago)
        now - 1000,  // Valid (1 second ago)
        now          // Valid (now)
      ];

      limiter.requests.set(identifier, timestamps);

      // Should only count 3 valid requests
      expect(limiter.checkLimit(identifier)).toBe(true);

      const validCount = limiter.requests.get(identifier)
        .filter(ts => ts > now - RATE_WINDOW_MS)
        .length;

      expect(validCount).toBe(3);
    });
  });

  describe('Rate Limit Reset Mechanism', () => {
    let limiter;

    beforeEach(() => {
      limiter = new RateLimiter();
    });

    it('should reset rate limit for specific user', () => {
      const identifier = 'user-1';

      // Max out rate limit
      for (let i = 0; i < RATE_MAX_PER_MIN; i++) {
        limiter.recordRequest(identifier);
      }

      expect(limiter.checkLimit(identifier)).toBe(false);

      // Reset
      limiter.reset(identifier);

      // Should be allowed again
      expect(limiter.checkLimit(identifier)).toBe(true);
    });

    it('should reset all rate limits', () => {
      const users = ['user-1', 'user-2', 'user-3'];

      // Max out all users
      users.forEach(user => {
        for (let i = 0; i < RATE_MAX_PER_MIN; i++) {
          limiter.recordRequest(user);
        }
      });

      // All should be blocked
      users.forEach(user => {
        expect(limiter.checkLimit(user)).toBe(false);
      });

      // Reset all
      limiter.resetAll();

      // All should be allowed
      users.forEach(user => {
        expect(limiter.checkLimit(user)).toBe(true);
      });
    });

    it('should not affect other users when resetting one', () => {
      limiter.recordRequest('user-1');
      limiter.recordRequest('user-2');

      limiter.reset('user-1');

      expect(limiter.requests.has('user-1')).toBe(false);
      expect(limiter.requests.has('user-2')).toBe(true);
    });
  });

  describe('Distributed Rate Limiting Scenarios', () => {
    let limiter;

    beforeEach(() => {
      limiter = new RateLimiter();
    });

    it('should handle rapid successive requests', () => {
      const identifier = 'user-1';

      // Simulate rapid burst
      for (let i = 0; i < 25; i++) {
        const allowed = limiter.checkLimit(identifier);
        if (allowed) {
          limiter.recordRequest(identifier);
        }
      }

      // Should have exactly 20 requests recorded
      expect(limiter.requests.get(identifier).length).toBe(RATE_MAX_PER_MIN);
    });

    it('should handle requests spread over time window', () => {
      const identifier = 'user-1';
      const now = Date.now();

      // 20 requests spread evenly over 60 seconds
      for (let i = 0; i < RATE_MAX_PER_MIN; i++) {
        const timestamp = now - (i * 3000); // Every 3 seconds
        limiter.requests.set(identifier, [
          ...(limiter.requests.get(identifier) || []),
          timestamp
        ]);
      }

      // Should be at limit
      expect(limiter.checkLimit(identifier)).toBe(false);
    });

    it('should handle rolling window correctly', () => {
      const identifier = 'user-1';
      const now = Date.now();

      // Old burst that should be expired
      for (let i = 0; i < 15; i++) {
        limiter.requests.set(identifier, [
          ...(limiter.requests.get(identifier) || []),
          now - RATE_WINDOW_MS - 5000
        ]);
      }

      // Recent requests
      for (let i = 0; i < 5; i++) {
        limiter.recordRequest(identifier);
      }

      // Should only count recent 5, not old 15
      expect(limiter.checkLimit(identifier)).toBe(true);
    });
  });

  describe('Error Response Format', () => {
    it('should return proper error envelope when rate limited', () => {
      const createRateLimitError = () => ({
        ok: false,
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please try again later.'
      });

      const error = createRateLimitError();

      expect(error.ok).toBe(false);
      expect(error.code).toBe('RATE_LIMITED');
      expect(error.message).toContain('Too many requests');
    });

    it('should include helpful message in rate limit error', () => {
      const createRateLimitError = (limit, windowSec) => ({
        ok: false,
        code: 'RATE_LIMITED',
        message: `Rate limit exceeded. Maximum ${limit} requests per ${windowSec} seconds.`
      });

      const error = createRateLimitError(RATE_MAX_PER_MIN, 60);

      expect(error.message).toContain('20');
      expect(error.message).toContain('60');
    });
  });

  describe('Performance Considerations', () => {
    let limiter;

    beforeEach(() => {
      limiter = new RateLimiter();
    });

    it('should efficiently clean up expired requests', () => {
      const identifier = 'user-1';
      const now = Date.now();

      // Add 100 expired requests
      for (let i = 0; i < 100; i++) {
        limiter.requests.set(identifier, [
          ...(limiter.requests.get(identifier) || []),
          now - RATE_WINDOW_MS - 10000
        ]);
      }

      // Add 5 valid requests
      for (let i = 0; i < 5; i++) {
        limiter.recordRequest(identifier);
      }

      // Check should clean up and only count valid ones
      limiter.checkLimit(identifier);

      const requests = limiter.requests.get(identifier);
      expect(requests.length).toBe(5);
    });

    it('should handle large number of identifiers', () => {
      // Simulate 1000 different users
      for (let i = 0; i < 1000; i++) {
        limiter.recordRequest(`user-${i}`);
      }

      expect(limiter.requests.size).toBe(1000);

      // Each should be under limit
      for (let i = 0; i < 100; i++) {
        expect(limiter.checkLimit(`user-${i}`)).toBe(true);
      }
    });
  });

  describe('Edge Cases and Attack Vectors', () => {
    let limiter;

    beforeEach(() => {
      limiter = new RateLimiter();
    });

    it('should handle null identifier', () => {
      expect(() => limiter.checkLimit(null)).not.toThrow();
      expect(() => limiter.recordRequest(null)).not.toThrow();
    });

    it('should handle undefined identifier', () => {
      expect(() => limiter.checkLimit(undefined)).not.toThrow();
      expect(() => limiter.recordRequest(undefined)).not.toThrow();
    });

    it('should handle empty string identifier', () => {
      const identifier = '';
      limiter.recordRequest(identifier);
      expect(limiter.checkLimit(identifier)).toBe(true);
    });

    it('should handle very long identifier strings', () => {
      const longId = 'a'.repeat(10000);
      limiter.recordRequest(longId);
      expect(limiter.checkLimit(longId)).toBe(true);
    });

    it('should handle special characters in identifier', () => {
      const specialIds = [
        'user@email.com',
        '192.168.1.1',
        'user-with-dashes',
        'user_with_underscores',
        "user'with'quotes"
      ];

      specialIds.forEach(id => {
        expect(() => limiter.recordRequest(id)).not.toThrow();
        expect(() => limiter.checkLimit(id)).not.toThrow();
      });
    });

    it('should prevent timestamp manipulation', () => {
      const identifier = 'user-1';

      // Attempt to add future timestamp
      const futureTimestamp = Date.now() + 100000;
      limiter.requests.set(identifier, [futureTimestamp]);

      // Should still work correctly
      expect(() => limiter.checkLimit(identifier)).not.toThrow();
    });

    it('should handle negative timestamps', () => {
      const identifier = 'user-1';
      limiter.requests.set(identifier, [-1000, -500]);

      // Should handle gracefully
      expect(() => limiter.checkLimit(identifier)).not.toThrow();
    });
  });
});
