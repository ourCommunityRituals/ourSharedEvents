/**
 * The nightly security cron labels its alerts with the staging site that
 * raised them. runSecurityMetricsCron builds its own alert env, so a field it
 * leaves out never reaches the label: without STAGING_VARIANT, an alert from
 * stg-full would send the on-call to the empty site.
 *
 * Driven through worker.scheduled(): an overdue FORMS_KEY_ROTATED_AT raises a
 * key_rotation_age alert, and the Linear request it makes is read back from a
 * stubbed fetch. Linear is never called.
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, afterEach, vi } from 'vitest';
import worker from '../src/index';
import type { RouterEnv } from '../src/router';

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as Record<string, unknown>;
  for (const [db, key] of [
    ['DB', 'TEST_MIGRATION_STATEMENTS'],
    ['FORMS_DB', 'TEST_FORMS_MIGRATION_STATEMENTS'],
  ] as const) {
    const stmts: string[] = JSON.parse(tenv[key] as string);
    for (const stmt of stmts) {
      try {
        await (tenv[db] as D1Database).prepare(stmt).run();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
        throw e;
      }
    }
  }
}

beforeAll(async () => {
  await applyMigrations();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// The description of every Linear issue the cron asked for.
async function linearDescriptions(over: Record<string, string>): Promise<string[]> {
  const descriptions: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url !== 'https://api.linear.app/graphql')
        return new Response('not stubbed', { status: 599 });
      const body = JSON.parse(String(init?.body ?? '{}'));
      descriptions.push(String(body.variables?.input?.description ?? ''));
      return Response.json({
        data: {
          issueCreate: {
            success: true,
            issue: { id: 'iss-1', identifier: 'T-1', url: 'https://linear.example/T-1' },
          },
        },
      });
    }
  );
  const rotatedAt = new Date(Date.now() - 100 * 86_400_000).toISOString();
  const cronEnv = {
    ...(env as unknown as Record<string, unknown>),
    LINEAR_API_KEY: 'not-a-real-linear-credential',
    LINEAR_TEAM_ID: 'team-under-test',
    FORMS_KEY_ROTATED_AT: rotatedAt,
    ...over,
  } as unknown as RouterEnv;
  const ctx = createExecutionContext();
  await worker.scheduled(
    { scheduledTime: Date.now(), cron: '0 3 * * *', noRetry: () => {} },
    cronEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return descriptions;
}

describe('security cron → alert: the staging variant reaches the label', () => {
  test('an alert raised on stg-full is labelled staging-full', async () => {
    const all = await linearDescriptions({ WORKER_ENV: 'staging', STAGING_VARIANT: 'full' });
    const rotation = all.filter((d) => d.includes('FORMS_ENCRYPTION_KEY'));
    expect(rotation.length).toBeGreaterThan(0);
    for (const d of rotation) {
      expect(d).toContain('**Environment:** staging-full');
      expect(d).not.toContain('**Environment:** staging\n');
    }
  });

  test('the empty site stays labelled staging', async () => {
    const all = await linearDescriptions({ WORKER_ENV: 'staging', STAGING_VARIANT: 'empty' });
    const rotation = all.filter((d) => d.includes('FORMS_ENCRYPTION_KEY'));
    expect(rotation.length).toBeGreaterThan(0);
    for (const d of rotation) {
      expect(d).toContain('**Environment:** staging');
      expect(d).not.toContain('staging-full');
    }
  });
});
