/**
 * Deploy-freshness gate — OSE-834 slice 2d (Fix step 7).
 *
 * The T4 Functional tiers assert against staging. If staging was last deployed
 * from an OLDER commit than the merge under test, every tier "passes" against
 * the wrong build — the exact defect OSE-834 opened on (a target last deployed
 * 3 Aug 2026 while the merge was 17 Aug). This gate makes that stale target a
 * hard RED before any tier runs, instead of a silent false green.
 *
 * How: the deploy step stamps WORKER_BUILD_VERSION = "stg-<shortSHA>-<date>"
 * (see the workflow "Stamp build version" step) and /health echoes it as
 * `version`. This gate fetches /health and asserts the deployed version carries
 * the sha of the merge under test (EXPECTED_SHA). A mismatch, a placeholder
 * version (no sha), or an unreachable target all fail closed — an unconfirmable
 * build is not a fresh one.
 *
 * Pure logic (`parseSha`, `isFresh`) is exported and import-safe (the CLI
 * entrypoint is isMain-guarded) so the born-red cases run both as the script's
 * `--self-test` and in the T0 `tests` shard (tests/unit/ci/deploy-freshness.test.js).
 *
 * Usage:
 *   HEALTH_URL="https://stg.oursharedevents.com/health" \
 *   EXPECTED_SHA="$(git rev-parse --short HEAD)" \
 *   CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... \
 *   node scripts/assert-deploy-freshness.mjs
 *
 *   node scripts/assert-deploy-freshness.mjs --self-test
 */

/**
 * Extract the git sha segment from a WORKER_BUILD_VERSION string.
 * Format is "stg-<shortSHA>-<YYYYMMDD>"; the sha is the first dash-delimited
 * run of 7–40 hex chars. The trailing date is all-digits (also hex-shaped) but
 * comes AFTER the sha, so the first match is the sha. Placeholder versions
 * ("stg-2026.03.22", "dev-local", "unknown") carry no such run → null.
 */
export function parseSha(version) {
  if (!version) return null;
  for (const part of String(version).toLowerCase().split('-')) {
    if (/^[0-9a-f]{7,40}$/.test(part)) return part;
  }
  return null;
}

/**
 * Is the deployed `version` built from `expectedSha` (the merge under test)?
 * Git may abbreviate the short sha to different lengths in the deploy stamp vs
 * the T4 checkout of the same commit, so a prefix match either direction counts
 * (both are abbreviations of the one commit sha). Fail-closed on any missing part.
 */
export function isFresh(version, expectedSha) {
  const sha = parseSha(version);
  if (!sha || !expectedSha) return false;
  const want = String(expectedSha).trim().toLowerCase();
  if (!want) return false;
  return sha === want || sha.startsWith(want) || want.startsWith(sha);
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function runSelfTest() {
  const cases = [
    // [name, version, expectedSha, expectedFresh]
    ['fresh: version sha == merge sha', 'stg-abc1234-20260908', 'abc1234', true],
    ['stale: version sha != merge sha', 'stg-abc1234-20260908', 'def5678', false],
    ['placeholder version (no sha) fails closed', 'stg-2026.03.22', 'abc1234', false],
    ['dev-local fails closed', 'dev-local', 'abc1234', false],
    ['unknown (env unset) fails closed', 'unknown', 'abc1234', false],
    // Full-length merge sha (longer than the short deployed sha) → prefix match.
    // Built at runtime so no 40-char hex literal sits in source (detect-secrets
    // reads a committed high-entropy hex string as a secret — OCR-130 lesson).
    ['full-length merge sha matches short deployed sha (prefix)', 'stg-abc1234-20260908', 'abc1234' + 'a'.repeat(33), true],
    ['empty merge sha fails closed', 'stg-abc1234-20260908', '', false],
    ['the date segment is NOT mistaken for the sha', 'stg-abc1234-20260908', '20260908', false],
    ['case-insensitive sha match', 'stg-ABC1234-20260908', 'abc1234', true],
    ['null version fails closed', null, 'abc1234', false],
  ];
  let failed = 0;
  for (const [name, version, sha, expected] of cases) {
    const got = isFresh(version, sha);
    const pass = got === expected;
    if (!pass) failed++;
    console.log(`${pass ? 'PASS' : 'FAIL'} — ${name} (expected ${expected}, got ${got})`);
  }
  if (failed > 0) fail(`\nself-test: ${failed} case(s) failed — freshness logic is wrong.`);
  console.log(`\nself-test: all ${cases.length} cases passed.`);
}

async function main() {
  const healthUrl = process.env.HEALTH_URL;
  const expectedSha = process.env.EXPECTED_SHA;
  if (!healthUrl || !expectedSha) {
    fail('deploy-freshness: HEALTH_URL and EXPECTED_SHA are both required.');
  }

  const headers = {};
  if (process.env.CF_ACCESS_CLIENT_ID) headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID;
  if (process.env.CF_ACCESS_CLIENT_SECRET) headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET;

  let res;
  try {
    res = await fetch(healthUrl, { headers, signal: AbortSignal.timeout(30000) });
  } catch (e) {
    fail(`deploy-freshness: could not reach ${healthUrl} — ${e.message}. An unreachable target is not a fresh one.`);
  }
  if (res.status !== 200) {
    fail(`deploy-freshness: ${healthUrl} returned HTTP ${res.status} (expected 200). Cannot confirm the deployed build.`);
  }
  let body;
  try {
    body = await res.json();
  } catch {
    fail('deploy-freshness: /health did not return JSON.');
  }
  const version = body?.version;
  if (isFresh(version, expectedSha)) {
    console.log(
      `✅ deploy-freshness: staging IS the merge under test — deployed version "${version}" carries sha ${expectedSha}.`
    );
    process.exit(0);
  }
  fail(
    `❌ deploy-freshness FAILED — staging is STALE.\n` +
      `  deployed version : "${version}" (sha ${parseSha(version) ?? 'none'})\n` +
      `  merge under test : ${expectedSha}\n` +
      `The T4 tiers would assert against a DIFFERENT build than the one being merged. ` +
      `Redeploy staging from this commit (the "Stamp build version" + Deploy steps) before the tiers run.`
  );
}

// ── entrypoint ────────────────────────────────────────────────────────────────
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('assert-deploy-freshness.mjs');
if (isMain) {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
  } else {
    await main();
  }
}
