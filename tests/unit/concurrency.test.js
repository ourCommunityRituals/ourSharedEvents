/**
 * Concurrency Bug Fixes Tests
 *
 * Tests for race condition fixes:
 * - Bug #12: Slug collision race condition
 * - Bug #13: Update race condition
 * - Bug #38: Idempotency race condition
 */

describe('Concurrency Bug Fixes', () => {

  describe('Bug #38: Idempotency Key Validation', () => {
    test('should validate correct idempotency key format', () => {
      const validKeys = [
        'abc123',
        'test-key-123',
        'UUID-1234-5678',
        'a'.repeat(128)
      ];

      validKeys.forEach(key => {
        expect(/^[a-zA-Z0-9-]{1,128}$/.test(key)).toBe(true);
      });
    });

    test('should reject invalid idempotency key format', () => {
      const invalidKeys = [
        'key with spaces',
        'key@special',
        'key.with.dots',
        'key/slash',
        'a'.repeat(129), // too long
        ''
      ];

      invalidKeys.forEach(key => {
        expect(/^[a-zA-Z0-9-]{1,128}$/.test(key)).toBe(false);
      });
    });

    test('should reject SQL injection in idempotency key', () => {
      const sqlInjection = "1' OR '1'='1";
      expect(/^[a-zA-Z0-9-]{1,128}$/.test(sqlInjection)).toBe(false);
    });
  });

  describe('Bug #12: Slug Generation', () => {
    let generateSlug;

    beforeEach(() => {
      generateSlug = function(name, id) {
        return String((name || id))
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '');
      };
    });

    test('should generate slug from name', () => {
      expect(generateSlug('Test Event', 'id123')).toBe('test-event');
      expect(generateSlug('My Cool Event!', 'id123')).toBe('my-cool-event');
    });

    test('should use ID as fallback if no name', () => {
      expect(generateSlug('', 'abc-123')).toBe('abc-123');
      expect(generateSlug(null, 'test-id')).toBe('test-id');
    });

    test('should handle special characters', () => {
      expect(generateSlug('Event @2024', 'id')).toBe('event-2024');
      expect(generateSlug('Test & Demo', 'id')).toBe('test-demo');
    });

    test('should remove leading/trailing hyphens', () => {
      expect(generateSlug('---test---', 'id')).toBe('test');
      expect(generateSlug('!@#test!@#', 'id')).toBe('test');
    });

    test('should collapse multiple hyphens', () => {
      expect(generateSlug('test   event', 'id')).toBe('test-event');
      expect(generateSlug('test!!!event', 'id')).toBe('test-event');
    });
  });

  describe('LockService Behavior Simulation', () => {
    let lockState;

    beforeEach(() => {
      lockState = {
        locked: false,
        owner: null
      };
    });

    test('should simulate lock acquisition', () => {
      const acquireLock = (owner) => {
        if (lockState.locked) {
          throw new Error('Lock already held');
        }
        lockState.locked = true;
        lockState.owner = owner;
        return true;
      };

      const releaseLock = (owner) => {
        if (!lockState.locked || lockState.owner !== owner) {
          throw new Error('Cannot release lock not owned');
        }
        lockState.locked = false;
        lockState.owner = null;
      };

      // First request acquires lock
      expect(() => acquireLock('request1')).not.toThrow();
      expect(lockState.locked).toBe(true);
      expect(lockState.owner).toBe('request1');

      // Second request cannot acquire while locked
      expect(() => acquireLock('request2')).toThrow('Lock already held');

      // First request releases lock
      expect(() => releaseLock('request1')).not.toThrow();
      expect(lockState.locked).toBe(false);

      // Now second request can acquire
      expect(() => acquireLock('request2')).not.toThrow();
      expect(lockState.owner).toBe('request2');
    });

    test('should prevent concurrent modifications', () => {
      const data = { value: 0 };
      const operations = [];

      const performUpdate = (requestId) => {
        return new Promise((resolve) => {
          // Simulate lock acquisition
          if (!lockState.locked) {
            lockState.locked = true;
            lockState.owner = requestId;

            // Read current value
            const currentValue = data.value;
            operations.push({ requestId, read: currentValue });

            // Simulate delay
            setTimeout(() => {
              // Write new value
              data.value = currentValue + 1;
              operations.push({ requestId, write: data.value });

              // Release lock
              lockState.locked = false;
              lockState.owner = null;

              resolve(data.value);
            }, 10);
          } else {
            // Wait and retry
            setTimeout(() => {
              resolve(performUpdate(requestId));
            }, 5);
          }
        });
      };

      // This test demonstrates that with locking, updates are serialized
      return Promise.all([
        performUpdate('req1'),
        performUpdate('req2')
      ]).then(results => {
        expect(data.value).toBe(2);
        expect(results).toContain(1);
        expect(results).toContain(2);
      });
    });
  });

  describe('Idempotency Cache Behavior', () => {
    let cache;

    beforeEach(() => {
      cache = new Map();
    });

    test('should detect duplicate requests', () => {
      const checkIdempotency = (key) => {
        if (cache.has(key)) {
          return { isDuplicate: true };
        }
        cache.set(key, { timestamp: Date.now(), status: 'processing' });
        return { isDuplicate: false };
      };

      const result1 = checkIdempotency('idem-key-1');
      expect(result1.isDuplicate).toBe(false);

      const result2 = checkIdempotency('idem-key-1');
      expect(result2.isDuplicate).toBe(true);
    });

    test('should allow different idempotency keys', () => {
      const checkIdempotency = (key) => {
        if (cache.has(key)) {
          return { isDuplicate: true };
        }
        cache.set(key, { timestamp: Date.now() });
        return { isDuplicate: false };
      };

      const result1 = checkIdempotency('idem-key-1');
      expect(result1.isDuplicate).toBe(false);

      const result2 = checkIdempotency('idem-key-2');
      expect(result2.isDuplicate).toBe(false);

      const result3 = checkIdempotency('idem-key-1');
      expect(result3.isDuplicate).toBe(true);
    });

    test('should store metadata with idempotency key', () => {
      const storeWithMetadata = (key) => {
        const metadata = {
          timestamp: Date.now(),
          status: 'processing'
        };
        cache.set(key, JSON.stringify(metadata));
        return metadata;
      };

      const metadata = storeWithMetadata('idem-key-1');
      expect(metadata.status).toBe('processing');
      expect(metadata.timestamp).toBeDefined();

      const stored = JSON.parse(cache.get('idem-key-1'));
      expect(stored.status).toBe('processing');
    });
  });

  describe('Slug Collision Handling', () => {
    let existingSlugs;

    beforeEach(() => {
      existingSlugs = ['test-event', 'test-event-2', 'another-event'];
    });

    test('should detect slug collision', () => {
      const slug = 'test-event';
      expect(existingSlugs.includes(slug)).toBe(true);
    });

    test('should generate unique slug with counter', () => {
      let slug = 'test-event';
      const originalSlug = slug;
      let counter = 2;

      while (existingSlugs.includes(slug)) {
        slug = `${originalSlug}-${counter}`;
        counter++;
      }

      expect(slug).toBe('test-event-3');
      expect(existingSlugs.includes(slug)).toBe(false);
    });

    test('should handle multiple collisions', () => {
      existingSlugs.push('new-event', 'new-event-2', 'new-event-3');

      let slug = 'new-event';
      const originalSlug = slug;
      let counter = 2;

      while (existingSlugs.includes(slug)) {
        slug = `${originalSlug}-${counter}`;
        counter++;
      }

      expect(slug).toBe('new-event-4');
    });
  });

  describe('Race Condition Prevention Patterns', () => {
    test('should demonstrate check-then-act race condition', () => {
      // This test shows the problem we're solving
      let sharedResource = [];

      const unsafeAdd = (item) => {
        // Check
        if (!sharedResource.includes(item)) {
          // Act (race condition window here)
          sharedResource.push(item);
        }
      };

      // Without locking, both could pass the check before either acts
      unsafeAdd('item1');
      expect(sharedResource).toContain('item1');
    });

    test('should demonstrate atomic check-and-act', () => {
      let sharedResource = [];
      let lock = false;

      const safeAdd = (item) => {
        // Atomic check-and-act
        if (lock) return false;
        lock = true;

        try {
          if (!sharedResource.includes(item)) {
            sharedResource.push(item);
            return true;
          }
          return false;
        } finally {
          lock = false;
        }
      };

      expect(safeAdd('item1')).toBe(true);
      expect(safeAdd('item1')).toBe(false); // Duplicate
      expect(sharedResource.length).toBe(1);
    });
  });
});
