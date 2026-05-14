import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';
import { cloudflarePool, cloudflareTest } from '@cloudflare/vitest-pool-workers';

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

const sourceFiles = collectTsFiles(srcDir);
const wranglerToml = readFileSync(join(rootDir, 'wrangler.toml'), 'utf8');

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
  },
});
