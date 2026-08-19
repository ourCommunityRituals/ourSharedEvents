#!/usr/bin/env node
// scripts/vitest-retry.mjs
//
// OSE-696: workerd pool retry-once wrapper.
//
// The @cloudflare/vitest-pool-workers test step intermittently crashes in two
// observed, non-deterministic ways — both host-level, neither a real test
// failure — that clear on a plain re-run:
//
//   1. workerd segfault:
//        Check failed: std::numeric_limits<int>::max() >= length_
//
//   2. pool worker dies mid-run (the workerd child exits / its control socket
//      resets), surfacing as one of:
//        [vitest-pool]: Worker cloudflare-pool emitted error.
//        Caused by: Error: Worker exited unexpectedly
//        Failed to start cloudflare-pool worker for test files ...
//      (root cause seen as `read ECONNRESET` on the miniflare control socket).
//      Signature: "191 passed (192)" + "1 error", zero assertion failures.
//
// Both need a human to click "re-run" today. This wrapper makes that retry
// automatic — and ONLY for these infrastructure crash signatures, so a genuine
// test failure (a failed assertion never kills the worker) still fails the gate
// immediately. See also the runner-fleet notes: this is HOST-level, not runner-
// specific — it lands on -1 or -2 alike, so re-run beats rebuilding the fleet.
//
// Contract:
//   1. Runs the given command (argv after this script) exactly as passed.
//   2. Streams the command's stdout/stderr to this process (so CI logs are
//      intact) AND captures them so we can inspect for the crash signature.
//   3. If attempt 1 exits non-zero AND its combined output contains one of the
//      crash signatures, re-run the command ONCE.
//        - Attempt 2's real exit code is preserved (a genuine failure on the
//          retry fails the step).
//   4. Otherwise (exit 0, or non-zero WITHOUT the signature) pass through
//      attempt 1's exit code immediately — NO retry.
//
// Deterministic: signature-driven, no clock, no randomness, no sleep.
//
// Usage:
//   node scripts/vitest-retry.mjs <command> [args...]
// Example (from a workflow step):
//   node ../../scripts/vitest-retry.mjs npm test

import { spawn } from 'node:child_process';

// Crash signatures that indicate a workerd / pool-worker infrastructure crash
// (NOT a real test failure). Kept as plain substrings so matching is exact and
// cheap. Each string is chosen to be emitted ONLY by the pool infrastructure
// tearing down — a failed assertion does not kill the worker, so these cannot
// mask a genuine test failure.
//
// Deliberately NOT retried (would mask real regressions, so let them fail):
//   - bare "ECONNRESET" / "ECONNREFUSED": a test exercising connection-reset
//     handling could log it. The accompanying "Worker exited unexpectedly" /
//     "Failed to start cloudflare-pool worker" covers the flake without the risk.
//   - "JavaScript heap out of memory" / "Reached heap limit": often infra on a
//     RAM-bound box, but can equally be a genuine memory-leak regression —
//     retrying hides it. Surface/alert on OOM instead of silently re-running.
//   - "EBUSY" / "EPERM" (Windows file locks): too ambiguous with real bugs.
const CRASH_SIGNATURES = [
  'std::numeric_limits',
  'Check failed',
  'Worker exited unexpectedly',
  'Failed to start cloudflare-pool worker',
  '[vitest-pool]: Worker cloudflare-pool emitted error',
  'listen EADDRINUSE', // two pool workers race for a port on the shared box
  'The service was stopped', // esbuild daemon crash (transient)
  'The service is no longer running', // esbuild daemon crash (transient)
];

// Exit codes / signals that mean the child process HARD-CRASHED (segfault,
// abort, Windows access violation) rather than reporting a test result. A real
// assertion failure exits 1; these codes cannot come from vitest reporting a
// failed test, so retrying on them is safe. This closes the canonical OSE-696
// "exit-139 SIGSEGV" case, where the crash produces NO matchable log string —
// only a crash exit code — and the output-only matcher above would miss it.
const CRASH_EXIT_CODES = new Set([
  134, // 128 + SIGABRT(6)  — abort
  139, // 128 + SIGSEGV(11) — segfault (POSIX)
  3221225477, // 0xC0000005 — access violation (Windows workerd segfault)
]);
const CRASH_SIGNALS = new Set(['SIGSEGV', 'SIGABRT', 'SIGBUS', 'SIGILL']);

function hasCrashSignature(output) {
  return CRASH_SIGNATURES.some((sig) => output.includes(sig));
}

function isCrashExit(code, signal) {
  return CRASH_EXIT_CODES.has(code) || CRASH_SIGNALS.has(signal);
}

/**
 * Run a command once. Resolves with { code, signal, output }.
 *   - code: numeric exit code (a signal-terminated child is normalized to a
 *     non-zero code so the caller still sees "failure").
 *   - signal: the terminating signal name (e.g. 'SIGSEGV') or null.
 *   - output: combined stdout+stderr as a string (also streamed live).
 */
function runOnce(commandLine) {
  return new Promise((resolvePromise) => {
    // Pass the whole invocation as ONE shell string so `npm`/`npx` resolve via
    // the platform shell (.cmd shims on Windows self-hosted runners). Passing a
    // separate args array alongside shell:true triggers Node DEP0190; a single
    // pre-joined string avoids it. Inherit env so bindings/secrets flow through.
    const child = spawn(commandLine, {
      shell: true,
      env: process.env,
    });

    let output = '';

    child.stdout.on('data', (chunk) => {
      const s = chunk.toString();
      output += s;
      process.stdout.write(chunk);
    });

    child.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      output += s;
      process.stderr.write(chunk);
    });

    child.on('error', (err) => {
      // Failed to spawn at all — surface as a non-zero exit with the message
      // captured so the signature check can still see it if relevant.
      output += `\n[vitest-retry] spawn error: ${err.message}\n`;
      process.stderr.write(`[vitest-retry] spawn error: ${err.message}\n`);
      resolvePromise({ code: 1, signal: null, output });
    });

    child.on('close', (code, signal) => {
      // Normalize: null code (killed by signal) → 1 so it's treated as failure.
      const exitCode = code === null ? 1 : code;
      if (signal) {
        output += `\n[vitest-retry] child terminated by signal ${signal}\n`;
      }
      resolvePromise({ code: exitCode, signal: signal ?? null, output });
    });
  });
}

async function main() {
  const parts = process.argv.slice(2);

  if (parts.length === 0) {
    process.stderr.write(
      '[vitest-retry] usage: node scripts/vitest-retry.mjs <command> [args...]\n'
    );
    process.exit(2);
    return;
  }

  // Re-join into a single shell command line. Any arg containing whitespace is
  // quoted so multi-word args survive the shell round-trip.
  const commandLine = parts
    .map((p) => (/\s/.test(p) ? JSON.stringify(p) : p))
    .join(' ');

  // ── Attempt 1 ──────────────────────────────────────────────────────────────
  const first = await runOnce(commandLine);

  if (first.code === 0) {
    process.exit(0);
    return;
  }

  const matchedSignature = hasCrashSignature(first.output);
  const matchedCrashExit = isCrashExit(first.code, first.signal);

  if (!matchedSignature && !matchedCrashExit) {
    // Genuine failure (or any non-crash failure) — do NOT retry.
    process.stderr.write(
      '[vitest-retry] attempt 1 failed without a workerd crash signature — not retrying.\n'
    );
    process.exit(first.code);
    return;
  }

  // ── Attempt 2 (retry once, crash detected) ──────────────────────────────────
  const reason = matchedSignature
    ? `crash signature (one of: ${CRASH_SIGNATURES.join(', ')})`
    : `hard-crash exit (code ${first.code}${first.signal ? `, signal ${first.signal}` : ''})`;
  process.stderr.write(`[vitest-retry] attempt 1 hit a workerd ${reason} — retrying once.\n`);

  const second = await runOnce(commandLine);

  if (second.code === 0) {
    process.stderr.write('[vitest-retry] retry succeeded.\n');
  } else {
    process.stderr.write(
      `[vitest-retry] retry also failed (exit ${second.code}) — failing the step.\n`
    );
  }

  // Preserve the retry's real exit code — a genuine failure on attempt 2 fails.
  process.exit(second.code);
}

main().catch((err) => {
  process.stderr.write(`[vitest-retry] unexpected error: ${err?.stack ?? err}\n`);
  process.exit(1);
});
