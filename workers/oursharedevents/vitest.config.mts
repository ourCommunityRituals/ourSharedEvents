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

const migrationStatements = migrationSQL
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
  .map((s) => s + ';');

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
        },
      },
    }),
  ],
  test: {
    include: ['tests/**/*.spec.ts'],
    pool: cloudflarePool(),
  },
});
