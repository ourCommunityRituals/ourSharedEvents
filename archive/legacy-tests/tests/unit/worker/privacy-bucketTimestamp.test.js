/**
 * Privacy Stack Layer 2: Temporal Bucketing Tests
 * Tests bucketTimestamp() — rounds timestamps to 30-min windows
 * From: worker_privacy_utilities.md spec
 * Story: OUR-23 / Privacy Architecture
 */

// Inline implementation for testing (will be imported from worker/src when deployed)
function bucketTimestamp(date, windowMinutes = 30) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new Error('bucketTimestamp: invalid Date');
  }
  if (windowMinutes <= 0 || windowMinutes > 1440) {
    throw new Error('bucketTimestamp: windowMinutes must be 1–1440');
  }

  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const bucketStartMinutes = Math.floor(utcMinutes / windowMinutes) * windowMinutes;
  const bucketEndMinutes = (bucketStartMinutes + windowMinutes) % 1440;

  const startHour = Math.floor(bucketStartMinutes / 60);
  const startMin = bucketStartMinutes % 60;
  const endHour = Math.floor(bucketEndMinutes / 60);
  const endMin = bucketEndMinutes % 60;

  const formatTime = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return `${formatTime(startHour, startMin)}-${formatTime(endHour, endMin)}`;
}

describe('bucketTimestamp — Layer 2: Temporal Bucketing', () => {
  test('buckets normal time in middle of window', () => {
    const date = new Date('2026-04-17T18:47:32Z');
    expect(bucketTimestamp(date)).toBe('18:30-19:00');
  });

  test('buckets early morning', () => {
    const date = new Date('2026-04-17T07:02:00Z');
    expect(bucketTimestamp(date, 30)).toBe('07:00-07:30');
  });

  test('handles midnight boundary (23:30-00:00)', () => {
    const date = new Date('2026-04-17T23:45:00Z');
    expect(bucketTimestamp(date)).toBe('23:30-00:00');
  });

  test('handles post-midnight (00:15)', () => {
    const date = new Date('2026-04-18T00:15:00Z');
    expect(bucketTimestamp(date, 30)).toBe('00:00-00:30');
  });

  test('handles 60-minute window', () => {
    const date = new Date('2026-04-18T00:15:00Z');
    expect(bucketTimestamp(date, 60)).toBe('00:00-01:00');
  });

  test('handles exact bucket boundary (18:30:00)', () => {
    const date = new Date('2026-04-17T18:30:00Z');
    expect(bucketTimestamp(date)).toBe('18:30-19:00');
  });

  test('handles last second before bucket boundary (18:29:59)', () => {
    const date = new Date('2026-04-17T18:29:59Z');
    expect(bucketTimestamp(date)).toBe('18:00-18:30');
  });

  test('throws on invalid Date', () => {
    expect(() => bucketTimestamp(new Date('invalid'))).toThrow('invalid Date');
  });

  test('throws on windowMinutes = 0', () => {
    const date = new Date('2026-04-17T18:47:32Z');
    expect(() => bucketTimestamp(date, 0)).toThrow('windowMinutes');
  });

  test('throws on windowMinutes > 1440', () => {
    const date = new Date('2026-04-17T18:47:32Z');
    expect(() => bucketTimestamp(date, 2000)).toThrow('windowMinutes');
  });

  test('respects custom 15-minute window', () => {
    const date = new Date('2026-04-17T18:47:32Z');
    expect(bucketTimestamp(date, 15)).toBe('18:45-19:00');
  });

  test('noon bucket is correct', () => {
    const date = new Date('2026-04-17T12:00:00Z');
    expect(bucketTimestamp(date)).toBe('12:00-12:30');
  });

  test('end of day bucket', () => {
    const date = new Date('2026-04-17T23:59:59Z');
    expect(bucketTimestamp(date)).toBe('23:30-00:00');
  });

  test('start of day bucket', () => {
    const date = new Date('2026-04-17T00:00:00Z');
    expect(bucketTimestamp(date)).toBe('00:00-00:30');
  });
});
