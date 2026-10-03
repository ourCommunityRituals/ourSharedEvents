/**
 * Production /health carries no internal DataProvider state.
 *
 * `_debug` ({ db_bound, mock_mode_forced }) is a staging/dev diagnostic. On a
 * public production endpoint it is internal state with no reader, so it is
 * omitted when WORKER_ENV is exactly 'production' and kept everywhere else
 * (fail closed toward showing it only where an operator debugs).
 */

import { describe, test, expect } from 'vitest';
import { handleHealth } from '../src/handlers/health';

async function body(env: Record<string, unknown>) {
  const res = await handleHealth(env as Parameters<typeof handleHealth>[0]);
  return (await res.json()) as Record<string, unknown>;
}

describe('/health _debug is env-gated', () => {
  test('production omits _debug', async () => {
    const b = await body({
      WORKER_ENV: 'production',
      WORKER_BUILD_VERSION: 'prod-abc1234-20261003',
    });
    expect(b).not.toHaveProperty('_debug');
    expect(b.env).toBe('production');
    expect(b.version).toBe('prod-abc1234-20261003');
  });

  test('staging keeps _debug', async () => {
    const b = await body({ WORKER_ENV: 'staging' });
    expect(b).toHaveProperty('_debug');
  });

  test('a miscased production value is not production (keeps _debug)', async () => {
    const b = await body({ WORKER_ENV: 'Production' });
    expect(b).toHaveProperty('_debug');
  });
});
