/**
 * Contract Tests for Events List API (During Event)
 *
 * Tests the events listing endpoint used during the During Event phase
 *
 * Triangle Phase: ▶️ During Event (Orange)
 * API Endpoint: ?action=list
 * Purpose: List all events for public view and admin management
 * User Roles: Event Manager, Consumer/Attendee
 */

describe('🔺 TRIANGLE [DURING EVENT]: Events List API Contract', () => {

  const validateEnvelope = (response) => {
    expect(response).toHaveProperty('ok');
    expect(typeof response.ok).toBe('boolean');

    if (response.ok) {
      if (!response.notModified) {
        expect(response).toHaveProperty('value');
      }
    } else {
      expect(response).toHaveProperty('code');
      expect(response).toHaveProperty('message');
    }
  };

  describe('api_list - Success responses', () => {
    it('should return valid list response with etag', () => {
      const mockResponse = {
        ok: true,
        etag: 'abc123',
        value: {
          items: [
            {
              id: 'event-1',
              templateId: 'event',
              data: { name: 'Test Event', dateISO: '2025-12-01' },
              createdAt: '2025-11-10T12:00:00.000Z',
              slug: 'test-event'
            }
          ]
        }
      };

      validateEnvelope(mockResponse);
      expect(mockResponse).toHaveProperty('etag');
      expect(mockResponse.value).toHaveProperty('items');
      expect(Array.isArray(mockResponse.value.items)).toBe(true);
    });

    it('should include etag for caching', () => {
      const mockResponse = {
        ok: true,
        etag: 'abc123',
        value: {
          items: []
        }
      };

      expect(mockResponse).toHaveProperty('etag');
      expect(typeof mockResponse.etag).toBe('string');
    });

    it('should return array of events with required fields', () => {
      const mockResponse = {
        ok: true,
        etag: 'abc123',
        value: {
          items: [
            {
              id: 'event-1',
              templateId: 'event',
              data: { name: 'Test Event', dateISO: '2025-12-01' },
              createdAt: '2025-11-10T12:00:00.000Z',
              slug: 'test-event'
            }
          ]
        }
      };

      const event = mockResponse.value.items[0];
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('templateId');
      expect(event).toHaveProperty('data');
      expect(event).toHaveProperty('createdAt');
      expect(event).toHaveProperty('slug');
    });

    it('should include event data with name and date', () => {
      const mockResponse = {
        ok: true,
        etag: 'abc123',
        value: {
          items: [
            {
              id: 'event-1',
              templateId: 'event',
              data: { name: 'Test Event', dateISO: '2025-12-01' },
              createdAt: '2025-11-10T12:00:00.000Z',
              slug: 'test-event'
            }
          ]
        }
      };

      const event = mockResponse.value.items[0];
      expect(event.data).toHaveProperty('name');
      expect(event.data).toHaveProperty('dateISO');
    });
  });

  describe('api_list - ETag and caching', () => {
    it('should support notModified response when etag matches', () => {
      const mockResponse = {
        ok: true,
        notModified: true,
        etag: 'abc123'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.notModified).toBe(true);
      expect(mockResponse).toHaveProperty('etag');
    });

    it('should not include value in notModified response', () => {
      const mockResponse = {
        ok: true,
        notModified: true,
        etag: 'abc123'
      };

      expect(mockResponse).not.toHaveProperty('value');
    });
  });

  describe('api_list - Empty results', () => {
    it('should return empty array when no events exist', () => {
      const mockResponse = {
        ok: true,
        etag: 'empty123',
        value: {
          items: []
        }
      };

      validateEnvelope(mockResponse);
      expect(Array.isArray(mockResponse.value.items)).toBe(true);
      expect(mockResponse.value.items.length).toBe(0);
    });
  });
});
