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
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the repo's own wrangler.toml, by the path env-parity reads
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

  test('serves only its Access-gated route: no workers.dev host, no preview URLs', () => {
    const env = section(`env.${FULL}`);
    // explicit, never left to wrangler's defaults
    expect(env.values.workers_dev).toBe('false');
    expect(env.values.preview_urls).toBe('false');
  });

  test('vars name it a full staging site with the staging posture', () => {
    const v = vars(FULL);
    expect(v.WORKER_ENV).toBe('staging');
    expect(v.STAGING_VARIANT).toBe('full');
    expect(v.ADMIN_SCOPE_ALL).toBe('true');
    expect(v.ALLOW_ADMIN_KEY_FALLBACK).toBe('true');
  });

  // Owner ruling: no BigQuery from stg-full (no WIF provider exists for its issuer).
  test('has no BigQuery backup: none of the GCP switch vars is set, so the backup skips', () => {
    const v = vars(FULL);
    const SWITCHES = ['GCP_PROJECT_ID', 'GCP_PROJECT_NUMBER', 'WIF_POOL_ID', 'WIF_PROVIDER_ID'];
    for (const name of [...SWITCHES, 'WIF_ISSUER', 'BIGQUERY_DATASET_ID', 'VERTEX_AI_MODEL_ID']) {
      expect(v[name], name).toBeUndefined();
    }
    // the guard the nightly backup and the SharedReport export return on needs every switch
    const guard = readFileSync(
      join(ROOT, 'workers/oursharedevents/src/cloud/bigquery.ts'),
      'utf8'
    ).match(/export function isBigQueryConfigured[\s\S]*?\n\}/)[0];
    for (const name of SWITCHES) expect(guard).toContain(`env.${name}?.trim()`);
    expect(guard).toMatch(/return Boolean\(/);
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

  // Each id is its placeholder until the owner pastes the real one, so this holds
  // before and after provisioning. The deploy gate's own cases are in
  // stock-workflow.test.js, on fixture strings.
  const D1_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const KV_ID = /^[0-9a-f]{32}$/;
  const PLACEHOLDER = {
    DB: 'OWNER_TO_FILL_DB_STAGING_FULL',
    FORMS_DB: 'OWNER_TO_FILL_FORMS_DB_STAGING_FULL',
    RATE_LIMIT_KV: 'OWNER_TO_FILL_KV_STAGING_FULL',
  };
  const bindingIds = (env) => [
    ...arrays(env, 'd1_databases').map((s) => [s.values.binding, s.values.database_id]),
    ...arrays(env, 'kv_namespaces').map((s) => [s.values.binding, s.values.id]),
  ];

  test('each id is its own placeholder or a well-formed provisioned id', () => {
    const ids = bindingIds(FULL);
    expect(ids.map(([b]) => b).sort()).toEqual(['DB', 'FORMS_DB', 'RATE_LIMIT_KV']);
    for (const [binding, id] of ids) {
      const shape = binding === 'RATE_LIMIT_KV' ? KV_ID : D1_ID;
      expect(id === PLACEHOLDER[binding] || shape.test(id), `${binding} = ${id}`).toBe(true);
    }
  });

  test('its ids are distinct, and none is a staging or production id', () => {
    const own = bindingIds(FULL).map(([, id]) => id);
    expect(new Set(own).size).toBe(own.length);
    for (const other of ['staging', 'production']) {
      const theirs = bindingIds(other).map(([, id]) => id);
      expect(theirs.length, other).toBeGreaterThan(0);
      for (const id of own) expect(theirs, other).not.toContain(id);
    }
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
