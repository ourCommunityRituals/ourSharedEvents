#!/usr/bin/env node
/**
 * vitest-retry.test.js — unit tests for the OSE-696 workerd-pool retry wrapper.
 *
 * No external framework (matches scripts/guard-no-gas.test.js). Uses a tiny
 * "fake command" whose per-attempt stdout + exit code are driven by env vars,
 * so we can assert the wrapper's decisions deterministically.
 *
 * The load-bearing property under test: the wrapper passes ONLY on a clean
 * exit-0 run. A crash never yields exit 0 (a teardown crash that drops a whole
 * spec file leaves the step non-zero), and a real assertion failure exits
 * non-zero WITHOUT a crash signature and is returned immediately — so the
 * wrapper can never mask a real failure or a dropped-file (incomplete) run.
 *
 * Run: node scripts/vitest-retry.test.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const RETRY = path.join(__dirname, 'vitest-retry.mjs');

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
    console.log(`     ${err.message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\n     Expected: ${expected}\n     Actual:   ${actual}`);
  }
}

// A fake "vitest" command. Attempt N (1-based, tracked via a run-count file)
// prints env O<N> to stdout (with '#' expanded to newlines) and exits with
// env E<N>. Missing O<N>/E<N> fall back to O1/E1. This lets one script model
// clean runs, crash-then-clean, persistent crashes, and real failures.
const FAKE = `
const fs = require('fs');
const log = process.env.FAKE_LOG;
let n = 1;
if (log) {
  let prev = '';
  try { prev = fs.readFileSync(log, 'utf8'); } catch {}
  n = prev.split('\\n').filter(Boolean).length + 1;
  fs.appendFileSync(log, 'r\\n');
}
const out = process.env['O' + n] ?? process.env.O1 ?? '';
const code = process.env['E' + n] ?? process.env.E1 ?? '0';
process.stdout.write(out.replace(/#/g, '\\n') + '\\n');
process.exit(parseInt(code, 10));
`;

const CRASH = 'Worker exited unexpectedly';

function makeFake() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitest-retry-test-'));
  const fake = path.join(dir, 'fake.cjs');
  fs.writeFileSync(fake, FAKE);
  return { dir, fake, log: path.join(dir, 'runs.log') };
}

function runRetry(fake, log, vars) {
  const res = spawnSync('node', [RETRY, 'node', fake], {
    env: { ...process.env, FAKE_LOG: log, ...vars },
    encoding: 'utf-8',
    timeout: 30000,
  });
  let runs = 0;
  try {
    runs = fs.readFileSync(log, 'utf-8').split('\n').filter(Boolean).length;
  } catch {
    /* no runs recorded */
  }
  return { exitCode: res.status, output: (res.stdout || '') + (res.stderr || ''), runs };
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

console.log('');
console.log('==================================================');
console.log('  vitest-retry.test.js — Unit Tests');
console.log('==================================================');
console.log('');

// 1. Clean run on the first attempt passes with no retry.
{
  const { dir, fake, log } = makeFake();
  test('clean run passes immediately (exit 0, 1 attempt)', () => {
    const r = runRetry(fake, log, { O1: 'Tests 2879 passed (2879)', E1: '0' });
    assertEqual(r.exitCode, 0, 'should exit 0');
    assertEqual(r.runs, 1, 'should run exactly once');
  });
  cleanup(dir);
}

// 2. A crash signature triggers a retry; a clean retry passes.
{
  const { dir, fake, log } = makeFake();
  test('crash then clean → passes on retry (exit 0, 2 attempts)', () => {
    const r = runRetry(fake, log, { O1: CRASH, E1: '1', O2: 'Tests 2879 passed (2879)', E2: '0' });
    assertEqual(r.exitCode, 0, 'should exit 0 after a clean retry');
    assertEqual(r.runs, 2, 'should run twice');
    if (!r.output.includes('attempt 2 succeeded')) throw new Error('missing retry-success log');
  });
  cleanup(dir);
}

// 3. Persistent crash across all attempts fails the step (retries exhausted).
{
  const { dir, fake, log } = makeFake();
  test('crash on every attempt → fails after MAX_ATTEMPTS (exit 1, 3 attempts)', () => {
    const r = runRetry(fake, log, { O1: CRASH, E1: '1' });
    assertEqual(r.exitCode, 1, 'should fail after exhausting retries');
    assertEqual(r.runs, 3, 'should run three times');
    if (!r.output.includes('retries exhausted')) throw new Error('missing exhaustion log');
  });
  cleanup(dir);
}

// 4. THE anti-masking guard: a real failure (non-zero WITHOUT a crash
//    signature) must fail immediately, with no retry — it can never be
//    re-run into a pass, and a "green-looking" summary never overrides the
//    non-zero exit.
{
  const { dir, fake, log } = makeFake();
  test('real failure without crash signature → fails immediately, no retry', () => {
    const r = runRetry(fake, log, { O1: 'Tests 3 failed | 2876 passed (2879)', E1: '1' });
    assertEqual(r.exitCode, 1, 'should propagate the real failure exit code');
    assertEqual(r.runs, 1, 'must NOT retry a genuine failure');
    if (!r.output.includes('not retrying')) throw new Error('missing no-retry log');
  });
  cleanup(dir);
}

// 5. A failure whose output ALSO contains a green-looking summary but no crash
//    signature is still a failure — the exit code is authoritative, the summary
//    text is not. Guards against ever treating "Tests N passed" as a pass.
{
  const { dir, fake, log } = makeFake();
  test('green-looking summary but non-zero + no crash sig → still fails, no retry', () => {
    const r = runRetry(fake, log, { O1: 'Tests 2879 passed (2879)#some teardown noise', E1: '1' });
    assertEqual(r.exitCode, 1, 'a non-zero exit is never overridden by a passed-summary line');
    assertEqual(r.runs, 1, 'must not retry (no crash signature)');
  });
  cleanup(dir);
}

// 6. A hard-crash EXIT CODE with no matchable log string (e.g. SIGSEGV → 139)
//    is treated as a crash and retried.
{
  const { dir, fake, log } = makeFake();
  test('hard-crash exit code (139) with no log signature → retried', () => {
    const r = runRetry(fake, log, {
      O1: 'boom',
      E1: '139',
      O2: 'Tests 2879 passed (2879)',
      E2: '0',
    });
    assertEqual(r.exitCode, 0, 'should retry the segfault and pass on the clean run');
    assertEqual(r.runs, 2, 'should run twice');
  });
  cleanup(dir);
}

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
