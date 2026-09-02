import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';
import { cloudflarePool, cloudflareTest } from '@cloudflare/vitest-pool-workers';
import * as yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname);
const repoRoot = resolve(rootDir, '..', '..');
const migrationsDir = join(rootDir, 'migrations');
const formsMigrationsDir = join(rootDir, 'migrations-forms');
const srcDir = join(rootDir, 'src');
const testsDir = join(rootDir, 'tests');
const workflowsDir = join(repoRoot, '.github', 'workflows');

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
// OSE-977: normalize path-map KEYS to forward slashes on every platform.
// `join()` emits OS-native separators, so on the self-hosted Windows runner the
// keys were `src\handlers\pages.ts`. The static security gates filter with
// forward-slash substrings (e.g. `path.includes('handlers/pages')`,
// `path.includes('/handlers/')`), which NEVER match a backslash key — so on
// Windows those gates iterated zero files and passed VACUOUSLY (S1/S2 cross-DB
// isolation, P5 cross-DB join, the anti-logging IP sweep). They only enforced on
// a forward-slash (Linux) filesystem. Normalizing the key here makes every gate
// enforce identically on self-hosted Windows and hosted ubuntu-latest. This is a
// no-op on Linux (join already uses `/`) and corrective on Windows.
function normalizeKey(p: string): string {
  return p.replace(/\\/g, '/');
}

function collectTsFiles(dir: string): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        Object.assign(result, collectTsFiles(full));
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
        result[normalizeKey(full)] = readFileSync(full, 'utf8');
      }
    }
  } catch {
    // dir may not exist
  }
  return result;
}

// OSE-591: Include test spec files so the born-red harness can scan for
// @born-red annotations bidirectionally on Windows CI (backslash paths).
function collectSpecFiles(dir: string): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        Object.assign(result, collectSpecFiles(full));
      } else if (entry.name.endsWith('.spec.ts')) {
        result[normalizeKey(full)] = readFileSync(full, 'utf8');
      }
    }
  } catch {
    // dir may not exist
  }
  return result;
}

function collectHtmlFiles(dir: string): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        Object.assign(result, collectHtmlFiles(full));
      } else if (entry.name.endsWith('.html')) {
        result[normalizeKey(full)] = readFileSync(full, 'utf8');
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
        result[normalizeKey(full)] = readFileSync(full, 'utf8');
      }
    }
  } catch {
    // dir may not exist
  }
  return result;
}

function collectYmlFiles(dir: string): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isFile() && (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml'))) {
        result[normalizeKey(full)] = readFileSync(full, 'utf8');
      }
    }
  } catch {
    // dir may not exist (e.g. in isolated test envs)
  }
  return result;
}

const wranglerTomlPath = join(rootDir, 'wrangler.toml');
const wranglerToml = readFileSync(wranglerTomlPath, 'utf8');

// TL-016 (OSE-911): the committed-secret gate is detect-secrets, driven by
// scripts/check-secrets-baseline.py against the committed .secrets.baseline.
// Both are included so gitleaks-ci-gate.spec.ts can assert the gate is wired,
// enforcing, and version-pinned (prevents silent removal).
const secretGateScriptPath = join(repoRoot, 'scripts', 'check-secrets-baseline.py');
const secretGateScript = existsSync(secretGateScriptPath)
  ? readFileSync(secretGateScriptPath, 'utf8')
  : '';
const secretsBaselinePath = join(repoRoot, '.secrets.baseline');
const secretsBaseline = existsSync(secretsBaselinePath)
  ? readFileSync(secretsBaselinePath, 'utf8')
  : '';

const sourceFiles = {
  ...collectTsFiles(srcDir),
  ...collectHtmlFiles(join(srcDir, 'templates')),
  ...collectSqlFiles(join(rootDir, 'migrations')),
  // OSE-591: spec files included so born-red harness can scan @born-red
  // annotations on Windows CI where paths use backslashes.
  ...collectSpecFiles(testsDir),
  // .github/workflows/*.yml included so workflow-shape specs (gitleaks-ci-gate.spec.ts,
  // TL-016) can assert CI gates are wired. Originally added for OSE-589
  // runner-env.spec.ts, which was retired with the self-hosted pool (OSE-1194).
  ...collectYmlFiles(workflowsDir),
  // TL-017/TL-019: wrangler.toml included so born-red harness can scan for
  // hardcoded secrets and CF_API_KEY usage without a separate binding.
  [wranglerTomlPath]: wranglerToml,
  // TL-016 (OSE-911): the detect-secrets gate script + committed baseline so the
  // secret-gate test can assert the gate is wired, enforcing, and version-pinned.
  ...(secretGateScript ? { [secretGateScriptPath]: secretGateScript } : {}),
  ...(secretsBaseline ? { [secretsBaselinePath]: secretsBaseline } : {}),
};

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

  return results.filter((s) => {
    const withoutSemi = s.replace(/;$/, '').trim();
    if (withoutSemi.length === 0) return false;
    // D1 rejects statements that contain only SQL comments with
    // "SQL code did not contain a statement". Strip comment lines and
    // verify actual SQL content remains before including the statement.
    const nonCommentContent = withoutSemi
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .trim();
    return nonCommentContent.length > 0;
  });
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
        kvNamespaces: ['RATE_LIMIT_KV'],
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
          // OSE-666/B1: CI/test authenticates as automation (Bearer key /
          // X-OCR-Internal → `key:` actor). ADMIN_SCOPE_ALL lets those key
          // actors list events unscoped, mirroring CI. Real (email) operators
          // are NEVER elevated by this flag — they resolve via the membership
          // map (fail-closed). Specs asserting per-brand scope use email actors
          // and set ADMIN_BRAND_MEMBERSHIP locally.
          ADMIN_SCOPE_ALL: 'true',
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
          // OSE-732: HMAC secret for sponsor onboarding invite tokens (T6a).
          SPONSOR_INVITE_SIGNING_SECRET: 'test-sponsor-invite-signing-secret-do-not-use',
          WKRP_SERVICE_TOKEN: 'test-wkrp-service-token-do-not-use',
          // OSE-577: internal-fleet batch consumer token (distinct class from WKRP).
          OSE_INTERNAL_BATCH_TOKEN: 'test-internal-batch-token-do-not-use',
          // OSE-598: HMAC-SHA256 pepper for email hashing (rank-9 finding).
          // Must be set in production via Wrangler secret; test value here
          // ensures peppered path exercises correctly in CI.
          FORMS_HASH_PEPPER: 'test-forms-hash-pepper-do-not-use-in-prod',
        },
      },
    }),
  ],
  test: {
    include: ['tests/**/*.spec.ts'],
    exclude: ['tests/a11y-axe.spec.ts'],
    pool: cloudflarePool(),
    // Serialize test-file execution: ONE miniflare/workerd runtime at a time.
    //
    // Why 1 (OSE-696, 2026-08-21): under maxWorkers:2 on the RAM-bound self-
    // hosted Windows box, the pool intermittently crashes at TEARDOWN
    // ("[vitest-pool]: Worker cloudflare-pool emitted error / Worker exited
    // unexpectedly", miniflare control-socket close). Critically, that crash
    // does not just noise the log — it DROPS the crashing worker's whole spec
    // file from the run (its tests never execute) while vitest still prints the
    // survivors as "N passed (N)". Proven on run 32533213749: attempt 1 lost
    // poster-qr.spec.ts (21 tests), attempt 2 lost regulatory-label-
    // unavailable.spec.ts (2 tests); full suite = 2879 tests / 197 files, and
    // 2879-21=2858, 2879-2=2877 matched the two attempts exactly. A single
    // runtime removes the concurrent-teardown race so a complete 197-file run
    // becomes the norm. This also REDUCES (not raises) the Azure-relay-token
    // exhaustion risk the previous comment worried about — that was a *high*-
    // concurrency failure mode. The vitest-retry wrapper still covers any
    // residual crash, and only ever passes a clean, complete (exit-0) run.
    // Tune upward again only after the pool-teardown flake is fixed upstream
    // (see Linear OSE-696 / OSE-TRE epic).
    maxWorkers: 1,
    // 60s — D1 migration apply (~80 stmts) under 2-worker concurrency
    // can still exceed the 30s that was comfortable at lower file counts.
    // shared-report-read.spec.ts and qa-flag-gating.spec.ts hit hookTimeout
    // and testTimeout at 30s under 4-worker load (run 30848988594). Doubling
    // to 60s gives headroom until the TRE epic lands proper parallelism tuning.
    hookTimeout: 60000,
    testTimeout: 60000,
  },
});
