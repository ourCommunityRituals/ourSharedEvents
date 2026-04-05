/**
 * Privacy Stack: Data Normalization Tests
 * Tests normalizeScanPayload() — strict data minimization
 * From: worker_privacy_utilities.md spec
 * Story: OUR-23 / Privacy Architecture
 */

function bucketTimestamp(date, windowMinutes = 30) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new Error('bucketTimestamp: invalid Date');
  }
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const bucketStartMinutes = Math.floor(utcMinutes / windowMinutes) * windowMinutes;
  const bucketEndMinutes = (bucketStartMinutes + windowMinutes) % 1440;
  const formatTime = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return `${formatTime(Math.floor(bucketStartMinutes / 60), bucketStartMinutes % 60)}-${formatTime(Math.floor(bucketEndMinutes / 60), bucketEndMinutes % 60)}`;
}

function normalizeScanPayload(rawData) {
  if (!rawData.anonymousId || typeof rawData.anonymousId !== 'string') {
    throw new Error('normalizeScanPayload: anonymousId must be a non-empty string (UUID)');
  }
  if (!rawData.placement_format || typeof rawData.placement_format !== 'string') {
    throw new Error('normalizeScanPayload: placement_format required');
  }
  if (!rawData.segment || typeof rawData.segment !== 'string') {
    throw new Error('normalizeScanPayload: segment required');
  }
  if (!rawData.geography || typeof rawData.geography !== 'string') {
    throw new Error('normalizeScanPayload: geography required');
  }

  const timestamp = rawData.timestamp || new Date();
  const scan_bucket = bucketTimestamp(timestamp);

  return {
    anonymous_id: rawData.anonymousId,
    scan_bucket,
    placement_format: rawData.placement_format,
    segment: rawData.segment,
    geography: rawData.geography,
    count: 1,
    recorded_at: new Date().toISOString(),
  };
}

describe('normalizeScanPayload — Data Minimization', () => {
  const validInput = {
    anonymousId: 'test-uuid-123',
    timestamp: new Date('2026-04-17T18:47:32Z'),
    placement_format: 'wall_poster',
    segment: 'bocce',
    geography: 'chicago-south',
  };

  test('normalizes valid raw data', () => {
    const payload = normalizeScanPayload(validInput);
    expect(payload.anonymous_id).toBe('test-uuid-123');
    expect(payload.scan_bucket).toBe('18:30-19:00');
    expect(payload.placement_format).toBe('wall_poster');
    expect(payload.segment).toBe('bocce');
    expect(payload.geography).toBe('chicago-south');
    expect(payload.count).toBe(1);
    expect(payload.recorded_at).toBeDefined();
  });

  test('output has exactly 7 fields — no more', () => {
    const payload = normalizeScanPayload(validInput);
    const keys = Object.keys(payload);
    expect(keys).toEqual([
      'anonymous_id',
      'scan_bucket',
      'placement_format',
      'segment',
      'geography',
      'count',
      'recorded_at',
    ]);
  });

  test('throws if anonymousId is missing', () => {
    expect(() =>
      normalizeScanPayload({
        ...validInput,
        anonymousId: '',
      })
    ).toThrow(/anonymousId/);
  });

  test('throws if anonymousId is not a string', () => {
    expect(() =>
      normalizeScanPayload({
        ...validInput,
        anonymousId: 123,
      })
    ).toThrow(/anonymousId/);
  });

  test('throws if placement_format is missing', () => {
    expect(() =>
      normalizeScanPayload({
        ...validInput,
        placement_format: '',
      })
    ).toThrow(/placement_format/);
  });

  test('throws if segment is missing', () => {
    expect(() =>
      normalizeScanPayload({
        ...validInput,
        segment: '',
      })
    ).toThrow(/segment/);
  });

  test('throws if geography is missing', () => {
    expect(() =>
      normalizeScanPayload({
        ...validInput,
        geography: '',
      })
    ).toThrow(/geography/);
  });

  test('ignores ip in raw data — not included in output', () => {
    const payload = normalizeScanPayload({
      ...validInput,
      ip: '192.168.1.1',
    });
    expect(Object.keys(payload)).not.toContain('ip');
  });

  test('ignores user_agent in raw data', () => {
    const payload = normalizeScanPayload({
      ...validInput,
      user_agent: 'Mozilla/5.0',
    });
    expect(Object.keys(payload)).not.toContain('user_agent');
  });

  test('ignores device_id in raw data', () => {
    const payload = normalizeScanPayload({
      ...validInput,
      device_id: 'abc123',
    });
    expect(Object.keys(payload)).not.toContain('device_id');
  });

  test('ignores cookies in raw data', () => {
    const payload = normalizeScanPayload({
      ...validInput,
      cookies: 'session=xyz',
    });
    expect(Object.keys(payload)).not.toContain('cookies');
  });

  test('ignores referer in raw data', () => {
    const payload = normalizeScanPayload({
      ...validInput,
      referer: 'https://evil.com',
    });
    expect(Object.keys(payload)).not.toContain('referer');
  });

  test('uses current time if timestamp not provided', () => {
    const { timestamp, ...noTimestamp } = validInput;
    const payload = normalizeScanPayload(noTimestamp);
    expect(payload.scan_bucket).toBeDefined();
    expect(payload.scan_bucket).toMatch(/^\d{2}:\d{2}-\d{2}:\d{2}$/);
  });

  test('count is always 1 (single observation per scan)', () => {
    const payload = normalizeScanPayload(validInput);
    expect(payload.count).toBe(1);
  });

  test('all placement formats accepted', () => {
    const formats = [
      'wall_poster',
      'table_card',
      'bar_top',
      'event_space',
      'partner_site',
      'kiosk_display',
    ];
    formats.forEach((format) => {
      const payload = normalizeScanPayload({ ...validInput, placement_format: format });
      expect(payload.placement_format).toBe(format);
    });
  });
});
