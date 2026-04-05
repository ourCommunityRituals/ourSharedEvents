/**
 * Privacy Stack Layer 4: K-Anonymity Gate Tests
 * Tests applyKAnonymity() — filters aggregates below threshold
 * From: worker_privacy_utilities.md spec
 * Story: OUR-23 / Privacy Architecture
 */

function applyKAnonymity(rows, k = 5) {
  return rows.filter((row) => row.count >= k);
}

describe('applyKAnonymity — Layer 4: K-Anonymity Gate', () => {
  test('filters rows below default k=5', () => {
    const rows = [
      { segment: 'A', count: 3 },
      { segment: 'B', count: 5 },
      { segment: 'C', count: 10 },
    ];
    const result = applyKAnonymity(rows);
    expect(result.length).toBe(2);
    expect(result.map((r) => r.segment)).toEqual(['B', 'C']);
  });

  test('accepts custom k threshold', () => {
    const rows = [
      { segment: 'A', count: 5 },
      { segment: 'B', count: 9 },
      { segment: 'C', count: 15 },
    ];
    const result = applyKAnonymity(rows, 10);
    expect(result).toEqual([{ segment: 'C', count: 15 }]);
  });

  test('returns all rows if all pass threshold', () => {
    const rows = [
      { segment: 'A', count: 10 },
      { segment: 'B', count: 20 },
    ];
    const result = applyKAnonymity(rows, 5);
    expect(result).toEqual(rows);
  });

  test('returns empty array if no rows pass', () => {
    const rows = [
      { segment: 'A', count: 1 },
      { segment: 'B', count: 2 },
    ];
    const result = applyKAnonymity(rows, 10);
    expect(result).toHaveLength(0);
  });

  test('returns empty array for empty input', () => {
    expect(applyKAnonymity([])).toEqual([]);
  });

  test('exact threshold value passes (count === k)', () => {
    const rows = [{ segment: 'A', count: 5 }];
    expect(applyKAnonymity(rows, 5)).toHaveLength(1);
  });

  test('one below threshold fails (count === k-1)', () => {
    const rows = [{ segment: 'A', count: 4 }];
    expect(applyKAnonymity(rows, 5)).toHaveLength(0);
  });

  test('preserves all properties on passing rows', () => {
    const rows = [
      { segment: 'A', geography: 'US', scan_bucket: '18:30-19:00', count: 10, extra: 'data' },
    ];
    const result = applyKAnonymity(rows);
    expect(result[0]).toEqual(rows[0]);
  });

  test('handles large dataset efficiently', () => {
    const rows = Array.from({ length: 10000 }, (_, i) => ({
      segment: `S${i}`,
      count: i % 10,
    }));
    const result = applyKAnonymity(rows);
    // Only count >= 5 pass: values 5,6,7,8,9 = 5 out of every 10
    expect(result.length).toBe(5000);
  });
});
