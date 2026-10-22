#!/usr/bin/env node
/**
 * guard-no-gas.test.js - Unit tests for the guard-no-gas security guard
 *
 * These tests run without external frameworks (no Jest dependency).
 * Uses temporary directories and files to validate guard behavior.
 *
 * Run: node scripts/guard-no-gas.test.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

// ============================================================================
// TEST UTILITIES
// ============================================================================

let testCount = 0;
let passCount = 0;
let failCount = 0;

function test(name, fn) {
  testCount++;
  try {
    fn();
    passCount++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failCount++;
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${err.message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\n     Expected: ${expected}\n     Actual: ${actual}`);
  }
}

function assertIncludes(str, substr, message) {
  if (!str.includes(substr)) {
    throw new Error(
      `${message}\n     Expected to include: "${substr}"\n     In: "${str.slice(0, 200)}..."`
    );
  }
}

function assertNotIncludes(str, substr, message) {
  if (str.includes(substr)) {
    throw new Error(`${message}\n     Expected NOT to include: "${substr}"`);
  }
}

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Create a temporary test directory with test files.
 */
function createTestFixtures() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-no-gas-test-'));

  // Create test files with forbidden patterns
  fs.mkdirSync(path.join(tmpDir, 'src'));

  // File with script.google.com
  fs.writeFileSync(
    path.join(tmpDir, 'src', 'bad-domain.js'),
    'const url = "https://script.google.com/macros/exec";\n'
  );

  // File with GAS_BASE_URL
  fs.writeFileSync(path.join(tmpDir, '.env.example'), 'GAS_BASE_URL=https://example.com\n');

  // File with doGet
  fs.writeFileSync(
    path.join(tmpDir, 'src', 'bad-code.js'),
    'function doGet(e) {\n  return ContentService.createTextOutput("hello");\n}\n'
  );

  // File with SpreadsheetApp
  fs.writeFileSync(
    path.join(tmpDir, 'src', 'sheets.js'),
    'const sheet = SpreadsheetApp.getActiveSheet();\n'
  );

  // File with google.script.run
  fs.writeFileSync(
    path.join(tmpDir, 'src', 'client.js'),
    'google.script.run.withSuccessHandler(fn).getData();\n'
  );

  // File with ScriptApp
  fs.writeFileSync(
    path.join(tmpDir, 'src', 'script.js'),
    'const props = ScriptApp.getScriptProperties();\n'
  );

  // File with UrlFetchApp
  fs.writeFileSync(
    path.join(tmpDir, 'src', 'fetch.js'),
    'const response = UrlFetchApp.fetch(url);\n'
  );

  // File with clasp
  fs.writeFileSync(path.join(tmpDir, 'config.json'), '{ "clasp": { "scriptId": "abc123" } }\n');

  // File with action=api_
  fs.writeFileSync(
    path.join(tmpDir, 'src', 'api.html'),
    '<script>fetch(url + "?action=api_getEvents");</script>\n'
  );

  // Clean file (no forbidden patterns)
  fs.writeFileSync(
    path.join(tmpDir, 'src', 'clean.js'),
    'const x = 1;\nfunction hello() { return "world"; }\n'
  );

  // Create scripts directory for allowlist
  fs.mkdirSync(path.join(tmpDir, 'scripts'));

  return tmpDir;
}

/**
 * Create a minimal allowlist file.
 */
function createAllowlist(tmpDir, entries) {
  const allowlistPath = path.join(tmpDir, 'scripts', 'guard-no-gas.allowlist.json');
  fs.writeFileSync(allowlistPath, JSON.stringify(entries, null, 2));
  return allowlistPath;
}

/**
 * Run the guard against a directory.
 */
function runGuard(rootDir, allowlistPath = null) {
  const guardPath = path.join(__dirname, 'guard-no-gas.js');
  const env = {
    ...process.env,
    GUARD_NO_GAS_ROOT: rootDir,
  };

  if (allowlistPath) {
    env.GUARD_NO_GAS_ALLOWLIST = allowlistPath;
  }

  const result = spawnSync('node', [guardPath], {
    env,
    encoding: 'utf-8',
    timeout: 30000,
  });

  return {
    exitCode: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output: (result.stdout || '') + (result.stderr || ''),
  };
}

/**
 * Clean up test directory.
 */
function cleanup(tmpDir) {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================================
// TESTS
// ============================================================================

console.log('');
console.log('==================================================');
console.log('  guard-no-gas.test.js - Unit Tests');
console.log('==================================================');
console.log('');

// Test 1: Guard detects script.google.com
console.log('Test Group: Forbidden Pattern Detection');
{
  const tmpDir = createTestFixtures();
  const allowlistPath = createAllowlist(tmpDir, {});

  test('detects script.google.com in files', () => {
    const result = runGuard(tmpDir, allowlistPath);
    assertEqual(result.exitCode, 1, 'Guard should exit with code 1');
    assertIncludes(result.output, 'script.google.com', 'Output should mention forbidden domain');
    assertIncludes(result.output, 'bad-domain.js', 'Output should mention the file');
  });

  test('detects GAS_BASE_URL in env files', () => {
    const result = runGuard(tmpDir, allowlistPath);
    assertIncludes(result.output, 'GAS_BASE_URL', 'Output should mention forbidden env var');
    assertIncludes(result.output, '.env.example', 'Output should mention the file');
  });

  test('detects doGet function', () => {
    const result = runGuard(tmpDir, allowlistPath);
    assertIncludes(result.output, 'doGet', 'Output should mention doGet');
  });

  test('detects ContentService', () => {
    const result = runGuard(tmpDir, allowlistPath);
    assertIncludes(result.output, 'ContentService', 'Output should mention ContentService');
  });

  test('detects SpreadsheetApp', () => {
    const result = runGuard(tmpDir, allowlistPath);
    assertIncludes(result.output, 'SpreadsheetApp', 'Output should mention SpreadsheetApp');
  });

  test('detects google.script.run', () => {
    const result = runGuard(tmpDir, allowlistPath);
    assertIncludes(result.output, 'google.script.run', 'Output should mention google.script.run');
  });

  test('detects ScriptApp', () => {
    const result = runGuard(tmpDir, allowlistPath);
    assertIncludes(result.output, 'ScriptApp', 'Output should mention ScriptApp');
  });

  test('detects UrlFetchApp', () => {
    const result = runGuard(tmpDir, allowlistPath);
    assertIncludes(result.output, 'UrlFetchApp', 'Output should mention UrlFetchApp');
  });

  test('detects clasp references', () => {
    const result = runGuard(tmpDir, allowlistPath);
    assertIncludes(result.output, 'clasp', 'Output should mention clasp');
  });

  test('detects action=api_ pattern', () => {
    const result = runGuard(tmpDir, allowlistPath);
    assertIncludes(result.output, 'action=api_', 'Output should mention action=api_');
  });

  cleanup(tmpDir);
}

// Test 2: Guard passes on clean directory
console.log('');
console.log('Test Group: Clean Directory');
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-no-gas-clean-'));
  fs.mkdirSync(path.join(tmpDir, 'src'));
  fs.mkdirSync(path.join(tmpDir, 'scripts'));

  // Only clean files
  fs.writeFileSync(
    path.join(tmpDir, 'src', 'index.js'),
    'export function hello() { return "world"; }\n'
  );
  fs.writeFileSync(
    path.join(tmpDir, 'src', 'utils.ts'),
    'export const sum = (a: number, b: number): number => a + b;\n'
  );

  const allowlistPath = createAllowlist(tmpDir, {});

  test('passes on clean directory with no forbidden patterns', () => {
    const result = runGuard(tmpDir, allowlistPath);
    assertEqual(result.exitCode, 0, 'Guard should exit with code 0');
    assertIncludes(result.output, 'passed', 'Output should indicate passing');
  });

  cleanup(tmpDir);
}

// Test 3: Allowlist works correctly
console.log('');
console.log('Test Group: Allowlist Functionality');
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-no-gas-allowlist-'));
  fs.mkdirSync(path.join(tmpDir, 'src'));
  fs.mkdirSync(path.join(tmpDir, 'docs'));
  fs.mkdirSync(path.join(tmpDir, 'scripts'));

  // File that would normally fail
  fs.writeFileSync(
    path.join(tmpDir, 'docs', 'legacy.md'),
    '# Legacy Architecture\n\nThe old system used `SpreadsheetApp` and `doGet` handlers.\n'
  );

  // Another file that would fail
  fs.writeFileSync(
    path.join(tmpDir, 'src', 'production.js'),
    'const sheet = SpreadsheetApp.getActive();\n'
  );

  test('allowlisted file with specific tokens is ignored', () => {
    const allowlistPath = createAllowlist(tmpDir, {
      'docs/legacy.md': ['SpreadsheetApp', 'doGet'],
    });

    const result = runGuard(tmpDir, allowlistPath);
    // Should still fail because src/production.js is not allowlisted
    assertEqual(result.exitCode, 1, 'Guard should still fail for non-allowlisted files');
    assertNotIncludes(
      result.output,
      'docs/legacy.md',
      'Allowlisted file should not appear in output'
    );
    assertIncludes(result.output, 'src/production.js', 'Non-allowlisted file should appear');
  });

  test('allowlisted file with wildcard is fully ignored', () => {
    const allowlistPath = createAllowlist(tmpDir, {
      'docs/legacy.md': ['*'],
      'src/production.js': ['*'],
    });

    const result = runGuard(tmpDir, allowlistPath);
    assertEqual(result.exitCode, 0, 'Guard should pass when all violating files are allowlisted');
  });

  cleanup(tmpDir);
}

// Test 4: Output format is correct
console.log('');
console.log('Test Group: Output Format');
{
  const tmpDir = createTestFixtures();
  const allowlistPath = createAllowlist(tmpDir, {});

  test('failure output includes required elements', () => {
    const result = runGuard(tmpDir, allowlistPath);
    assertIncludes(result.output, 'guard-no-gas failed', 'Should include failure headline');
    assertIncludes(result.output, 'Line ', 'Should include line numbers');
    assertIncludes(result.output, 'Total findings:', 'Should include summary');
    assertIncludes(result.output, 'Remove GAS dependency', 'Should include guidance');
  });

  cleanup(tmpDir);
}

// Test 5: Ignores node_modules and other excluded directories
console.log('');
console.log('Test Group: Directory Exclusions');
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-no-gas-exclude-'));
  fs.mkdirSync(path.join(tmpDir, 'scripts'));
  fs.mkdirSync(path.join(tmpDir, 'node_modules'));
  fs.mkdirSync(path.join(tmpDir, 'node_modules', 'some-package'));
  fs.mkdirSync(path.join(tmpDir, '.git'));
  fs.mkdirSync(path.join(tmpDir, '.git', 'objects'));

  // Put forbidden patterns in excluded directories
  fs.writeFileSync(
    path.join(tmpDir, 'node_modules', 'some-package', 'index.js'),
    'const sheet = SpreadsheetApp.getActive();\n'
  );
  fs.writeFileSync(
    path.join(tmpDir, '.git', 'objects', 'file'),
    'SpreadsheetApp doGet ContentService\n'
  );

  const allowlistPath = createAllowlist(tmpDir, {});

  test('ignores node_modules directory', () => {
    const result = runGuard(tmpDir, allowlistPath);
    assertEqual(result.exitCode, 0, 'Guard should pass (only excluded dirs have violations)');
    assertNotIncludes(result.output, 'node_modules', 'Should not scan node_modules');
  });

  test('ignores .git directory', () => {
    const result = runGuard(tmpDir, allowlistPath);
    assertNotIncludes(result.output, '.git', 'Should not scan .git');
  });

  cleanup(tmpDir);
}

// Test 5b: Nested git worktrees under .claude/worktrees hold full copies of the repo.
// They are not part of it, so the guard must not scan them, while the rest of .claude is.
console.log('');
console.log('Test Group: Nested Worktrees');
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-no-gas-worktrees-'));
  fs.mkdirSync(path.join(tmpDir, 'scripts'));
  fs.mkdirSync(path.join(tmpDir, '.claude', 'worktrees', 'agent-x', 'scripts'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(tmpDir, '.claude', 'worktrees', 'agent-x', 'scripts', 'copy.js'),
    'const sheet = SpreadsheetApp.getActive();\n'
  );
  const allowlistPath = createAllowlist(tmpDir, {});

  test('ignores a banned pattern inside .claude/worktrees', () => {
    const result = runGuard(tmpDir, allowlistPath);
    assertEqual(result.exitCode, 0, 'Guard should pass (only a nested worktree has the pattern)');
    assertNotIncludes(result.output, 'copy.js', 'Should not scan .claude/worktrees');
  });

  cleanup(tmpDir);

  // Control: the same pattern elsewhere under .claude must still fail the guard.
  const controlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-no-gas-claude-control-'));
  fs.mkdirSync(path.join(controlDir, 'scripts'));
  fs.mkdirSync(path.join(controlDir, '.claude', 'hooks'), { recursive: true });
  fs.writeFileSync(
    path.join(controlDir, '.claude', 'hooks', 'leak.js'),
    'const sheet = SpreadsheetApp.getActive();\n'
  );
  const controlAllowlist = createAllowlist(controlDir, {});

  test('still scans the rest of .claude (control)', () => {
    const result = runGuard(controlDir, controlAllowlist);
    assertEqual(result.exitCode, 1, 'Guard should fail on a banned pattern under .claude/hooks');
  });

  cleanup(controlDir);
}

// Test 6: Handles missing allowlist gracefully (fail-closed)
console.log('');
console.log('Test Group: Fail-Closed Behavior');
{
  const tmpDir = createTestFixtures();

  test('works without allowlist file (empty allowlist)', () => {
    // Don't create an allowlist file - should still work
    const result = runGuard(tmpDir, path.join(tmpDir, 'nonexistent', 'allowlist.json'));
    // The guard should fail because test fixtures have violations
    assertEqual(result.exitCode, 1, 'Guard should fail with violations');
  });

  cleanup(tmpDir);
}

// ============================================================================
// SUMMARY
// ============================================================================

console.log('');
console.log('==================================================');
console.log(`  Results: ${passCount}/${testCount} passed`);
if (failCount > 0) {
  console.log(`  ❌ ${failCount} test(s) failed`);
  console.log('==================================================');
  process.exit(1);
} else {
  console.log('  ✅ All tests passed');
  console.log('==================================================');
  process.exit(0);
}
