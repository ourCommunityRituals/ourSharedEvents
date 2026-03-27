/**
 * Privacy Stack Layer 5: Aggregate-Only External API Tests
 * Tests assertAggregateOnly() — runtime guard against field leakage
 * From: worker_privacy_utilities.md spec
 * Story: OUR-23 / Privacy Architecture
 */

const FORBIDDEN_FIELDS = [
  'anonymous_id', 'token', 'session_id', 'exact_timestamp', 'timestamp',
  'ip', 'user_agent', 'useragent', 'device_id', 'deviceid',
  'fingerprint', 'request_id', 'requestid', 'mac_address', 'macaddress'
];

function assertAggregateOnly(data) {
  const forbiddenLower = FORBIDDEN_FIELDS.map(f => f.toLowerCase());

  function inspect(obj, path = '') {
    if (obj === null || obj === undefined) return;
    if (typeof obj === 'object') {
      if (Array.isArray(obj)) {
        obj.forEach((item, idx) => inspect(item, `${path}[${idx}]`));
      } else {
        for (const [key, value] of Object.entries(obj)) {
          if (forbiddenLower.includes(key.toLowerCase())) {
            throw new Error(`assertAggregateOnly: forbidden field '${key}' at ${path || 'root'}`);
          }
          inspect(value, `${path}.${key}`);
        }
      }
    }
  }
  inspect(data);
}

describe('assertAggregateOnly — Layer 5: Aggregate-Only Guard', () => {
  test('accepts clean aggregate data', () => {
    const data = { segment: 'tech', geography: 'US', count: 42 };
    expect(() => assertAggregateOnly(data)).not.toThrow();
  });

  test('rejects anonymous_id', () => {
    const data = { segment: 'tech', anonymous_id: 'uuid-123' };
    expect(() => assertAggregateOnly(data)).toThrow(/anonymous_id/);
  });

  test('rejects ip field', () => {
    const data = { segment: 'tech', ip: '192.168.1.1' };
    expect(() => assertAggregateOnly(data)).toThrow(/ip/);
  });

  test('rejects user_agent', () => {
    const data = { segment: 'tech', user_agent: 'Mozilla/5.0' };
    expect(() => assertAggregateOnly(data)).toThrow(/user_agent/);
  });

  test('rejects token', () => {
    const data = { segment: 'tech', token: 'secret-abc' };
    expect(() => assertAggregateOnly(data)).toThrow(/token/);
  });

  test('rejects session_id', () => {
    const data = { session_id: 'sess-123', count: 10 };
    expect(() => assertAggregateOnly(data)).toThrow(/session_id/);
  });

  test('rejects device_id', () => {
    const data = { device_id: 'dev-456', count: 10 };
    expect(() => assertAggregateOnly(data)).toThrow(/device_id/);
  });

  test('rejects fingerprint', () => {
    const data = { fingerprint: 'fp-789', count: 10 };
    expect(() => assertAggregateOnly(data)).toThrow(/fingerprint/);
  });

  test('rejects mac_address', () => {
    const data = { mac_address: 'AA:BB:CC:DD:EE:FF', count: 10 };
    expect(() => assertAggregateOnly(data)).toThrow(/mac_address/);
  });

  test('rejects nested forbidden field', () => {
    const data = { segment: 'tech', metadata: { session_id: 'abc' } };
    expect(() => assertAggregateOnly(data)).toThrow(/session_id/);
  });

  test('rejects deeply nested forbidden field', () => {
    const data = { a: { b: { c: { anonymous_id: 'deep' } } } };
    expect(() => assertAggregateOnly(data)).toThrow(/anonymous_id/);
  });

  test('rejects case-insensitive match (IP vs ip)', () => {
    const data = { segment: 'tech', IP: '192.168.1.1' };
    expect(() => assertAggregateOnly(data)).toThrow(/IP/);
  });

  test('rejects UserAgent (camelCase)', () => {
    const data = { UserAgent: 'Chrome' };
    expect(() => assertAggregateOnly(data)).toThrow(/UserAgent/);
  });

  test('handles array of objects', () => {
    const data = [
      { segment: 'A', count: 10 },
      { segment: 'B', count: 20 }
    ];
    expect(() => assertAggregateOnly(data)).not.toThrow();
  });

  test('rejects forbidden field in array element', () => {
    const data = [
      { segment: 'A', count: 10 },
      { segment: 'B', token: 'secret' }
    ];
    expect(() => assertAggregateOnly(data)).toThrow(/token/);
  });

  test('accepts null and undefined', () => {
    expect(() => assertAggregateOnly(null)).not.toThrow();
    expect(() => assertAggregateOnly(undefined)).not.toThrow();
  });

  test('accepts primitive values', () => {
    expect(() => assertAggregateOnly('string')).not.toThrow();
    expect(() => assertAggregateOnly(42)).not.toThrow();
    expect(() => assertAggregateOnly(true)).not.toThrow();
  });

  test('accepts empty object', () => {
    expect(() => assertAggregateOnly({})).not.toThrow();
  });

  test('accepts empty array', () => {
    expect(() => assertAggregateOnly([])).not.toThrow();
  });
});
