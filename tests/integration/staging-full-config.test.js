const { readFileSync } = require('fs');
const { join } = require('path');
const { pathToFileURL } = require('url');

/**
 * The second staging site, stg-full.oursharedevents.com, is its own wrangler
 * env: its own Worker, databases, bucket, KV and rate-limit counters, so it
 * can be rebuilt from real events without touching staging or production.
 */

const ROOT = join(__dirname, '..', '..');
const load = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

let toml;
let sections;
let compareEnvironments;
beforeAll(async () => {
  const { parseToml } = await load('scripts/prod-preflight.mjs');
  const parity = await load('scripts/ci/env-parity.mjs');
  compareEnvironments = parity.compareEnvironments;
  toml = readFileSync(join(ROOT, parity.WRANGLER_PATH), 'utf8');
  sections = parseToml(toml);
});

const FULL = 'staging-full';
const section = (header) => sections.find((s) => s.header === header);
const vars = (env) => section(`env.${env}.vars`)?.values ?? {};
const arrays = (env, kind) => sections.filter((s) => s.array && s.header === `env.${env}.${kind}`);
const names = (env) => ({
  d1: arrays(env, 'd1_databases').map((s) => s.values.database_name),
  r2: arrays(env, 'r2_buckets').map((s) => s.values.bucket_name),
});

describe('staging-full wrangler env', () => {
  test('has its own Worker name and a single stg-full route', () => {
    const env = section(`env.${FULL}`);
    expect(env, 'env.staging-full is declared').toBeDefined();
    expect(env.values.name).toBe('oursharedevents-stg-full');
    const patterns = [...env.values.routes.matchAll(/pattern\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(patterns).toEqual(['stg-full.oursharedevents.com/*']);
  });

  test('vars name it a full staging site with the staging posture', () => {
    const v = vars(FULL);
    expect(v.WORKER_ENV).toBe('staging');
    expect(v.STAGING_VARIANT).toBe('full');
    expect(v.ADMIN_SCOPE_ALL).toBe('true');
    expect(v.ALLOW_ADMIN_KEY_FALLBACK).toBe('true');
    expect(v.WIF_ISSUER).toBe('https://stg-full.oursharedevents.com');
    expect(v.BIGQUERY_DATASET_ID).toBeTruthy();
    expect(v.BIGQUERY_DATASET_ID).not.toBe(vars('staging').BIGQUERY_DATASET_ID);
    expect(v.BIGQUERY_DATASET_ID).not.toBe(vars('production').BIGQUERY_DATASET_ID);
  });

  test('staging is the empty site and keeps both of its hosts', () => {
    expect(vars('staging').STAGING_VARIANT).toBe('empty');
    const routes = section('env.staging').values.routes;
    expect(routes).toContain('stg.oursharedevents.com/*');
    expect(routes).toContain('stg-empty.oursharedevents.com/*');
  });

  test('declares no queue, and runs the same crons as staging', () => {
    expect(sections.filter((s) => s.header.startsWith(`env.${FULL}.queues`))).toEqual([]);
    expect(section(`env.${FULL}.triggers`)?.values.crons).toBe(
      section('env.staging.triggers').values.crons
    );
  });

  test('its D1 databases and bucket are its own, never staging or production', () => {
    const own = names(FULL);
    expect(own.d1.sort()).toEqual(['ocr-db-staging-full', 'ocr-forms-db-staging-full']);
    expect(own.r2).toEqual(['ose-uploads-staging-full']);
    for (const other of ['staging', 'production']) {
      const theirs = names(other);
      for (const n of own.d1) expect(theirs.d1).not.toContain(n);
      for (const n of own.r2) expect(theirs.r2).not.toContain(n);
    }
    const bindings = arrays(FULL, 'd1_databases').map((s) => s.values.binding);
    expect(bindings.sort()).toEqual(['DB', 'FORMS_DB']);
    expect(arrays(FULL, 'r2_buckets')[0].values.binding).toBe('UPLOADS_BUCKET');
    expect(arrays(FULL, 'kv_namespaces')[0].values.binding).toBe('RATE_LIMIT_KV');
  });

  test('rate-limit namespace ids are unique across every env', () => {
    const ids = sections
      .filter((s) => s.array && /(^|\.)ratelimits$/.test(s.header))
      .map((s) => s.values.namespace_id);
    expect(arrays(FULL, 'ratelimits')).toHaveLength(2);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('staging-full in the staging/production parity check', () => {
  test('no finding mentions staging-full', () => {
    const { findings } = compareEnvironments(toml);
    expect(findings.filter((f) => `${f.key} ${f.detail}`.includes(FULL))).toEqual([]);
  });

  test('ok holds, as on main', () => {
    expect(compareEnvironments(toml).ok).toBe(true);
  });
});
