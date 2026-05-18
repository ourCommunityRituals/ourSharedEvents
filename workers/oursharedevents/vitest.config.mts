import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';
import { cloudflarePool, cloudflareTest } from '@cloudflare/vitest-pool-workers';
import * as yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname);
const migrationsDir = join(rootDir, 'migrations');
const formsMigrationsDir = join(rootDir, 'migrations-forms');
const srcDir = join(rootDir, 'src');

// ── Read migration SQL at config time (Node.js context) ──────────────────────
const migrationSQL = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(migrationsDir, f), 'utf8'))
  .join('\n')
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

const formsMigrationSQL = existsSync(formsMigrationsDir)
  ? readdirSync(formsMigrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => readFileSync(join(formsMigrationsDir, f), 'utf8'))
      .join('\n')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
  : '';

// ── Read source files for static analysis gates ──────────────────────────────
function collectTsFiles(dir: string): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        Object.assign(result, collectTsFiles(full));
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
        result[full] = readFileSync(full, 'utf8');
      }
    }
  } catch {
    // dir may not exist
  }
  return result;
}

// OSE-272: Static-invariant gates for the SharedReport data pipeline need to
// inspect migration .sql files (e.g., to assert no `anon_id TEXT` column
// exists in any pipeline migration). Read them into the same source map
// the existing gates already use.
function collectSqlFiles(dir: string): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        Object.assign(result, collectSqlFiles(full));
      } else if (entry.name.endsWith('.sql')) {
        result[full] = readFileSync(full, 'utf8');
      }
    }
  } catch {
    // dir may not exist
  }
  return result;
}

const sourceFiles = {
  ...collectTsFiles(srcDir),
  ...collectSqlFiles(join(rootDir, 'migrations')),
};
const wranglerToml = readFileSync(join(rootDir, 'wrangler.toml'), 'utf8');

// ── Load brain UEC artifact for OSE-323 drift check ─────────────────────────
// The drift check (tests/uec-drift-check.spec.ts) compares this artifact
// against the OSE consumed copy at src/lib/uec/uec-codes.ts. Brain is
// always canonical; drift always resolves toward brain (never the reverse).
//
// Path resolution:
//   1. BRAIN_DIR env var (CI sets this — points at the checked-out OCR-docs)
//   2. Default: ../../../OCR-docs/ocr-docs-brain (local dev sibling layout)
//
// If neither path exists, TEST_BRAIN_UEC_JSON is injected as '' and the
// drift check SKIPS with a clear message — local devs without OCR-docs
// checked out aren't blocked; CI always has it via the workflow checkout step.
const brainDir = process.env.BRAIN_DIR
  ? resolve(process.env.BRAIN_DIR)
  : resolve(rootDir, '..', '..', '..', 'OCR-docs', 'ocr-docs-brain');
const brainUecPath = join(brainDir, 'uec-codes.yaml');
let brainUecJson = '';
try {
  if (existsSync(brainUecPath)) {
    brainUecJson = JSON.stringify(yaml.load(readFileSync(brainUecPath, 'utf8')));
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      `[vitest config] brain UEC artifact not found at ${brainUecPath} — drift check will skip. ` +
        `Set BRAIN_DIR env var or clone OCR-docs as sibling to enable drift detection locally.`
    );
  }
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn(
    `[vitest config] failed to load brain UEC artifact at ${brainUecPath}: ${e instanceof Error ? e.message : String(e)}`
  );
}

// ── OSE-336: Load brain sponsor-allocation artifact for drift check ─────────
// Mirrors the UEC drift pattern (OSE-323) but for the Local Sponsor Covenant
// canonical at OCR-docs/ocr-docs-brain/sponsor-allocation.yaml. The drift check
// (tests/sponsor-allocation-drift-check.spec.ts) compares this artifact against
// the OSE consumed copy at src/lib/sponsor-allocation.ts (SPONSOR_ALLOCATION
// const). Same skip-on-missing behavior as UEC: local dev without OCR-docs
// checked out is not blocked; CI always populates this via the workflow
// checkout step that already sets BRAIN_DIR.
const brainSponsorAllocPath = join(brainDir, 'sponsor-allocation.yaml');
let brainSponsorAllocJson = '';
try {
  if (existsSync(brainSponsorAllocPath)) {
    brainSponsorAllocJson = JSON.stringify(yaml.load(readFileSync(brainSponsorAllocPath, 'utf8')));
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      `[vitest config] brain sponsor-allocation artifact not found at ${brainSponsorAllocPath} — drift check will skip. ` +
        `Set BRAIN_DIR env var or clone OCR-docs as sibling to enable drift detection locally.`
    );
  }
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn(
    `[vitest config] failed to load brain sponsor-allocation artifact at ${brainSponsorAllocPath}: ${e instanceof Error ? e.message : String(e)}`
  );
}

/**
 * Split migration SQL into individual statements, correctly handling
 * SQLite trigger bodies that contain nested BEGIN...END blocks.
 *
 * A naive split(';') breaks triggers because SELECT RAISE(...); inside
 * BEGIN...END also ends with a semicolon, producing an incomplete statement.
 * This function tracks BEGIN/END depth and only splits at the top level.
 */
function splitMigrationSQL(sql: string): string[] {
  const results: string[] = [];
  let buffer = '';
  let depth = 0;

  for (const part of sql.split(';')) {
    const upper = part.toUpperCase();
    const begins = (upper.match(/\bBEGIN\b/g) ?? []).length;
    const ends = (upper.match(/\bEND\b/g) ?? []).length;
    buffer += (buffer ? ';' : '') + part;
    depth += begins - ends;

    if (depth <= 0 && buffer.trim().length > 0) {
      results.push(buffer.trim() + ';');
      buffer = '';
      depth = 0;
    }
  }

  if (buffer.trim().length > 0) results.push(buffer.trim() + ';');

  return results.filter((s) => s.replace(/;$/, '').trim().length > 0);
}

const migrationStatements = splitMigrationSQL(migrationSQL);

const formsMigrationStatements = formsMigrationSQL
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
  .map((s) => s + ';');

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: './wrangler.toml',
      },
      miniflare: {
        d1Databases: ['DB', 'FORMS_DB'],
        r2Buckets: ['UPLOADS_BUCKET'],
        bindings: {
          TEST_MIGRATION_STATEMENTS: JSON.stringify(migrationStatements),
          TEST_FORMS_MIGRATION_STATEMENTS: JSON.stringify(formsMigrationStatements),
          TEST_SOURCE_FILES_JSON: JSON.stringify(sourceFiles),
          TEST_WRANGLER_TOML: wranglerToml,
          // OSE-323 drift check input — brain canonical UEC artifact loaded
          // at config time. Empty string when brain not available (local dev
          // without OCR-docs checked out); CI always populates this.
          TEST_BRAIN_UEC_JSON: brainUecJson,
          // OSE-336 drift check input — brain canonical sponsor-allocation
          // artifact (the Local Sponsor Covenant scaffolding from OSE-330
          // Phase 1). Same skip-on-empty behavior as TEST_BRAIN_UEC_JSON.
          TEST_BRAIN_SPONSOR_ALLOCATION_JSON: brainSponsorAllocJson,
          ADMIN_KEY: 'test-admin-key-e2e-2026',
          ALLOW_ADMIN_KEY_FALLBACK: 'true',
          X_OCR_INTERNAL: 'test-ocr-internal-secret-2026',
          ALLOW_OCR_INTERNAL: 'true',
          FORMS_ENCRYPTION_KEY: 'test-forms-encryption-secret-32ch',
          WORKER_ENV: 'test',
          WORKER_BUILD_VERSION: 'e2e-mock',
          // OSE-211: admin email allowlist (SEC-5)
          ALLOWED_ADMIN_EMAILS: 'test-admin@example.com',
          ALLOWED_ADMIN_DOMAINS: 'example.com',
          // OSE-215: Google Service Account auth + BigQuery (BE-19)
          GOOGLE_SA_CLIENT_EMAIL: 'sa@test-project.iam.gserviceaccount.com',
          GOOGLE_SA_PRIVATE_KEY_PEM: 'stub-pem-key-not-real',
          GCP_PROJECT_ID: 'test-gcp-project',
          BIGQUERY_DATASET_ID: 'test-dataset',
          // OSE-216: Vertex AI chatbot (BE-20)
          VERTEX_AI_MODEL_ID: 'gemini-2.0-flash',
          GCP_REGION: 'us-central1',
          // OSE-207: per-env pepper for handleSubscribe ip_hash (BE-17)
          IP_HASH_PEPPER: 'test-ip-hash-pepper-32char-secret',
          // OSE-207 follow-up: subscribers retention knob. Unset by default
          // (cron logs no-op). Specific specs that exercise the retention
          // path mutate env per-test via the cloudflare:test helpers.
          // SUBSCRIBERS_RETENTION_DAYS intentionally NOT set here.
          // OSE-272 Session 5: SharedReport read API auth.
          SHARED_REPORT_SIGNING_SECRET: 'test-shared-report-signing-secret-do-not-use',
          WKRP_SERVICE_TOKEN: 'test-wkrp-service-token-do-not-use',
        },
      },
    }),
  ],
  test: {
    include: ['tests/**/*.spec.ts'],
    exclude: ['tests/a11y-axe.spec.ts'],
    pool: cloudflarePool(),
    // 30s — miniflare worker bootstrap + per-spec D1 migration apply (~80 stmts)
    // can exceed vitest's 10s default `hookTimeout` when the self-hosted
    // Bloodraven runners are processing parallel workflow jobs and CPU/IO
    // contention slows the SQLite migration loop. 30s is comfortable headroom
    // for the slowest beforeAll observed (~6s) while still failing fast on
    // genuine hangs. Without this, T0 Gate flakes whenever 2+ PRs run their
    // test pyramids concurrently.
    hookTimeout: 30000,
    // Same reasoning for testTimeout. QA-1 migration idempotency
    // (constraints.spec.ts) re-runs the entire 28-migration loop inside the
    // test body (not just beforeAll), which puts the work under the
    // testTimeout budget rather than hookTimeout. Default 5s timed out on
    // PR #156 CI under runner contention (observed 12.8s wall-clock).
    // Aligning testTimeout with hookTimeout keeps both budgets symmetric
    // and removes a second class of parallel-runner flake.
    testTimeout: 30000,
  },
});
