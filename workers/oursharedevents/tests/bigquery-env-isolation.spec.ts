import { describe, test, expect, vi, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import { BIGQUERY_DATASETS, datasetForPool, REGULATORY_POOLS } from '../src/lib/pool-contract';
import { getDatasetId, PRODUCTION_BACKUP_DATASET } from '../src/cloud/config';
import { bigQueryInsertRows, BigQueryError } from '../src/cloud/bigquery';

/**
 * OSE-1416 — staging must never write production's BigQuery datasets.
 *
 * Staging and production share one GCP project. Before this change the pool
 * datasets (`oureventring_*`, read by OER) had one hard-coded name for every
 * env, and the flat backup dataset defaulted to production's name when unset.
 * A staging export would have put test events beside real community data.
 */

const NON_PRODUCTION = ['staging', 'development', 'test', undefined, '', 'Production', 'prod'];

describe('OSE-1416 | pool datasets are scoped per environment', () => {
  test('production resolves the bare (OER-read) dataset name', () => {
    expect(datasetForPool('general', 'production')).toBe(BIGQUERY_DATASETS.general);
  });

  test('staging resolves its own _stg dataset', () => {
    expect(datasetForPool('general', 'staging')).toBe(`${BIGQUERY_DATASETS.general}_stg`);
  });

  test('every non-production env (incl. unset / miscased) resolves a non-production name', () => {
    const productionNames = new Set(Object.values(BIGQUERY_DATASETS));
    for (const pool of REGULATORY_POOLS) {
      for (const workerEnv of NON_PRODUCTION) {
        const dataset = datasetForPool(pool, workerEnv);
        expect(productionNames.has(dataset), `${String(workerEnv)} -> ${dataset}`).toBe(false);
      }
    }
  });
});

describe('OSE-1416 | flat backup dataset fails closed', () => {
  test('production may default to, or name, the production dataset', () => {
    expect(getDatasetId({ WORKER_ENV: 'production' })).toBe(PRODUCTION_BACKUP_DATASET);
    expect(
      getDatasetId({ WORKER_ENV: 'production', BIGQUERY_DATASET_ID: PRODUCTION_BACKUP_DATASET })
    ).toBe(PRODUCTION_BACKUP_DATASET);
  });

  test('a non-production env with no dataset set does NOT fall back to production', () => {
    for (const workerEnv of NON_PRODUCTION) {
      expect(() => getDatasetId({ WORKER_ENV: workerEnv })).toThrow(/production dataset/);
    }
  });

  test('a non-production env may not name the production dataset', () => {
    for (const workerEnv of NON_PRODUCTION) {
      expect(() =>
        getDatasetId({ WORKER_ENV: workerEnv, BIGQUERY_DATASET_ID: PRODUCTION_BACKUP_DATASET })
      ).toThrow(/production dataset/);
    }
  });

  test('staging with its own dataset resolves it', () => {
    expect(
      getDatasetId({ WORKER_ENV: 'staging', BIGQUERY_DATASET_ID: 'oursharedevents_backup_stg' })
    ).toBe('oursharedevents_backup_stg');
  });

  describe('bigQueryInsertRows refuses before any network call', () => {
    afterEach(() => vi.restoreAllMocks());

    test('staging pointed at the production dataset -> NOT_CONFIGURED, no fetch', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const stagingEnv = {
        WORKER_ENV: 'staging',
        BIGQUERY_DATASET_ID: PRODUCTION_BACKUP_DATASET,
        WIF_PRIVATE_KEY_PEM: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----',
        GCP_PROJECT_NUMBER: '123456789012',
        WIF_POOL_ID: 'p',
        WIF_PROVIDER_ID: 'p',
        GCP_PROJECT_ID: 'ose-test',
      };
      const err = await bigQueryInsertRows(stagingEnv as never, 'events_backup', [
        { id: 'x' },
      ]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BigQueryError);
      expect((err as BigQueryError).code).toBe('NOT_CONFIGURED');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});

describe('OSE-1416 | wrangler.toml names a different dataset per environment', () => {
  const toml = (env as Record<string, unknown>).TEST_WRANGLER_TOML as string;

  function datasetIn(envName: string): string | undefined {
    const header = new RegExp(`^\\[env\\.${envName}\\.vars\\][ \\t]*\\r?$`, 'm');
    const match = header.exec(toml);
    if (!match) return undefined;
    const rest = toml.slice(match.index + match[0].length);
    const next = rest.search(/^\s*\[/m);
    const section = next === -1 ? rest : rest.slice(0, next);
    return /^BIGQUERY_DATASET_ID\s*=\s*"([^"]+)"/m.exec(section)?.[1];
  }

  test('production keeps oursharedevents_backup; staging has its own', () => {
    expect(datasetIn('production')).toBe(PRODUCTION_BACKUP_DATASET);
    const staging = datasetIn('staging');
    expect(staging).toBeTruthy();
    expect(staging).not.toBe(PRODUCTION_BACKUP_DATASET);
  });
});
