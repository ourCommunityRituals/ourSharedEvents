/**
 * OSE-803 — schema version guard unit tests.
 *
 * The guard's whole value is in WHICH way it fails:
 *   - a binding demonstrably behind the required migration is real drift → fail CLOSED (503)
 *   - a binding we cannot read (D1 unreachable, d1_migrations absent) is infrastructure,
 *     not drift → fail OPEN (serve) and let the transient hiccup pass
 *   - the diagnostic routes stay reachable during drift so the drift is readable
 *
 * These assertions pin those three behaviours plus the once-per-isolate cache.
 * Runtime companion to the pre-deploy CI gate in .github/workflows (OSE-803).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkSchema,
  schemaDriftResponse,
  isDiagnosticPath,
  __resetSchemaGuard,
  REQUIRED_DB_MIGRATION,
  REQUIRED_FORMS_MIGRATION,
  type SchemaGuardEnv,
} from '../src/lib/schema-guard';

/**
 * Minimal D1 stand-in. `v` is the MAX(id) returned by the migrations query;
 * pass 'throw' to simulate an unreachable binding / missing d1_migrations table.
 */
function fakeDb(v: number | null | 'throw'): SchemaGuardEnv['DB'] {
  return {
    prepare: () => ({
      first: async () => {
        if (v === 'throw') throw new Error('D1_ERROR: no such table: d1_migrations');
        return { v };
      },
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => {
  __resetSchemaGuard();
});

describe('checkSchema — fail closed on real drift', () => {
  it('reports drift when DB is behind the required migration', async () => {
    const drift = await checkSchema({
      DB: fakeDb(REQUIRED_DB_MIGRATION - 1),
      FORMS_DB: fakeDb(REQUIRED_FORMS_MIGRATION),
    });
    expect(drift).toEqual({
      binding: 'DB',
      found: REQUIRED_DB_MIGRATION - 1,
      required: REQUIRED_DB_MIGRATION,
    });
  });

  it('reports drift when FORMS_DB is behind and DB is current', async () => {
    const drift = await checkSchema({
      DB: fakeDb(REQUIRED_DB_MIGRATION),
      FORMS_DB: fakeDb(REQUIRED_FORMS_MIGRATION - 1),
    });
    expect(drift).toEqual({
      binding: 'FORMS_DB',
      found: REQUIRED_FORMS_MIGRATION - 1,
      required: REQUIRED_FORMS_MIGRATION,
    });
  });
});

describe('checkSchema — healthy', () => {
  it('returns null when both bindings are at or beyond the required migration', async () => {
    const drift = await checkSchema({
      DB: fakeDb(REQUIRED_DB_MIGRATION),
      FORMS_DB: fakeDb(REQUIRED_FORMS_MIGRATION + 5),
    });
    expect(drift).toBeNull();
  });
});

describe('checkSchema — fail open on infrastructure', () => {
  it('does not report drift when the migrations query throws (D1 unreachable)', async () => {
    const drift = await checkSchema({
      DB: fakeDb('throw'),
      FORMS_DB: fakeDb('throw'),
    });
    expect(drift).toBeNull();
  });

  it('does not report drift when MAX(id) is null (empty d1_migrations)', async () => {
    const drift = await checkSchema({
      DB: fakeDb(null),
      FORMS_DB: fakeDb(null),
    });
    expect(drift).toBeNull();
  });

  it('does not report drift when a binding is absent', async () => {
    const drift = await checkSchema({ DB: undefined, FORMS_DB: undefined });
    expect(drift).toBeNull();
  });
});

describe('checkSchema — once per isolate', () => {
  it('caches the first result and ignores a later env', async () => {
    const first = await checkSchema({
      DB: fakeDb(REQUIRED_DB_MIGRATION),
      FORMS_DB: fakeDb(REQUIRED_FORMS_MIGRATION),
    });
    expect(first).toBeNull();

    // A drifted env on the second call must be ignored — the check is cached.
    const second = await checkSchema({
      DB: fakeDb(REQUIRED_DB_MIGRATION - 10),
      FORMS_DB: fakeDb(REQUIRED_FORMS_MIGRATION),
    });
    expect(second).toBeNull();
  });
});

describe('schemaDriftResponse', () => {
  it('serves a no-store 503 naming the binding and versions', async () => {
    const res = schemaDriftResponse({ binding: 'DB', found: 41, required: 61 });
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as { ok: boolean; detail: string };
    expect(body.ok).toBe(false);
    expect(body.detail).toContain('DB');
    expect(body.detail).toContain('41');
    expect(body.detail).toContain('61');
  });
});

describe('isDiagnosticPath', () => {
  it('lets the diagnostic routes through and refuses everything else', () => {
    expect(isDiagnosticPath('/health')).toBe(true);
    expect(isDiagnosticPath('/api/status')).toBe(true);
    expect(isDiagnosticPath('/')).toBe(false);
    expect(isDiagnosticPath('/api/v2/events')).toBe(false);
  });
});
