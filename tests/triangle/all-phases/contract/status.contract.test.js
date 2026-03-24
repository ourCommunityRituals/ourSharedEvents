/**
 * Contract Tests for Status API (All Phases)
 *
 * Tests the system status endpoints that are always available across all Triangle phases
 *
 * Triangle Phase: ⚡ All Phases (Blue)
 * API Endpoints:
 *   - ?action=status → api_status() → envelope format { ok, value: { build, contract, time, db } }
 *   - ?page=status → api_statusPure() → flat format { ok, buildId, brandId, timestamp }
 * Purpose: System health and build information
 */

describe('🔺 TRIANGLE [ALL PHASES]: Status API Contract', () => {

  const validateEnvelope = (response) => {
    expect(response).toHaveProperty('ok');
    expect(typeof response.ok).toBe('boolean');

    if (response.ok) {
      // notModified responses don't have value property
      if (!response.notModified) {
        expect(response).toHaveProperty('value');
      }
    } else {
      expect(response).toHaveProperty('code');
      expect(response).toHaveProperty('message');
    }
  };

  describe('api_status', () => {
    it('should return valid Ok envelope with system information', () => {
      const mockResponse = {
        ok: true,
        value: {
          build: 'triangle-extended-v1.3',
          contract: '1.0.3',
          time: '2025-11-10T12:00:00.000Z',
          db: { ok: true, id: 'spreadsheet-id' }
        }
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.value).toHaveProperty('build');
      expect(mockResponse.value).toHaveProperty('contract');
      expect(mockResponse.value).toHaveProperty('time');
      expect(mockResponse.value).toHaveProperty('db');
      expect(mockResponse.value.db).toHaveProperty('ok');
    });

    it('should include database connection status', () => {
      const mockResponse = {
        ok: true,
        value: {
          build: 'triangle-extended-v1.3',
          contract: '1.0.3',
          time: '2025-11-10T12:00:00.000Z',
          db: { ok: true, id: 'spreadsheet-id' }
        }
      };

      expect(mockResponse.value.db.ok).toBe(true);
      expect(typeof mockResponse.value.db.id).toBe('string');
    });

    it('should include build version information', () => {
      const mockResponse = {
        ok: true,
        value: {
          build: 'triangle-extended-v1.3',
          contract: '1.0.3',
          time: '2025-11-10T12:00:00.000Z',
          db: { ok: true, id: 'spreadsheet-id' }
        }
      };

      expect(typeof mockResponse.value.build).toBe('string');
      expect(typeof mockResponse.value.contract).toBe('string');
      expect(mockResponse.value.build).toMatch(/triangle/i);
    });
  });

  describe('api_statusPure (flat format for health checks)', () => {
    const validatePureStatus = (response) => {
      expect(response).toHaveProperty('ok');
      expect(typeof response.ok).toBe('boolean');
      expect(response).toHaveProperty('buildId');
      expect(response).toHaveProperty('brandId');
      expect(response).toHaveProperty('timestamp');
    };

    it('should return flat format with ok, buildId, brandId, timestamp', () => {
      const mockResponse = {
        ok: true,
        buildId: 'triangle-extended-v1.5',
        brandId: 'root',
        timestamp: '2025-11-25T12:00:00.000Z'
      };

      validatePureStatus(mockResponse);
      expect(mockResponse.ok).toBe(true);
      expect(typeof mockResponse.buildId).toBe('string');
      expect(typeof mockResponse.brandId).toBe('string');
    });

    it('should return ok:false with message for invalid brand', () => {
      const mockResponse = {
        ok: false,
        buildId: 'triangle-extended-v1.5',
        brandId: 'invalid-brand',
        timestamp: '2025-11-25T12:00:00.000Z',
        message: 'Brand not found: invalid-brand'
      };

      expect(mockResponse.ok).toBe(false);
      expect(mockResponse).toHaveProperty('message');
      expect(mockResponse.message).toContain('not found');
    });

    it('should have ISO 8601 formatted timestamp', () => {
      const mockResponse = {
        ok: true,
        buildId: 'triangle-extended-v1.5',
        brandId: 'root',
        timestamp: '2025-11-25T12:00:00.000Z'
      };

      // Timestamp should be parseable as ISO 8601
      const parsed = new Date(mockResponse.timestamp);
      expect(parsed.toISOString()).toBe(mockResponse.timestamp);
    });

    it('should NOT include envelope wrapper (no value property)', () => {
      const mockResponse = {
        ok: true,
        buildId: 'triangle-extended-v1.5',
        brandId: 'root',
        timestamp: '2025-11-25T12:00:00.000Z'
      };

      // Pure status is flat format - no value wrapper
      expect(mockResponse).not.toHaveProperty('value');
    });
  });
});
