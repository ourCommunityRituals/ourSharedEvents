#!/usr/bin/env node
// scripts/vitest-retry.mjs
//
// OSE-696: workerd pool retry wrapper (up to 3 attempts).
//
// The @cloudflare/vitest-pool-workers test step intermittently crashes in two
// observed, non-deterministic ways — both host-level, neither a real test
// failure — that clear on a plain re-run:
//
//   1. workerd segfault:
//        Check failed: std::numeric_limits<int>::max() >= length_
//
//   2. pool worker dies at teardown (the workerd child exits / its control
//      socket resets), surfacing as one of:
//        [vitest-pool]: Worker cloudflare-pool emitted error.
//        Caused by: Error: Worker exited unexpectedly
//        Failed to start cloudflare-pool worker for test files ...
//      (root cause seen as `read ECONNRESET` on the miniflare control socket).
//      Signature: "196 passed (197)" + "1 error", zero assertion failures.
//      IMPORTANT: this crash DROPS the crashing worker's whole spec file from
//      the run — those tests never execute — yet vitest still prints the
//      survivors as "N passed (N)". So a crashed run is INCOMPLETE, not just
//      noisy: it must never be treated as a pass. (This is exactly why the
//      wrapper keys "pass" strictly on exit 0 — a clean, COMPLETE run — and
//      never on a "green-looking" summary. See maxWorkers:1 in vitest.config.mts,
//      which removes the concurrent-teardown race so complete runs are the norm.)
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
//   3. If an attempt exits non-zero AND its combined output contains one of the
//      crash signatures (or it hard-crashed by exit code/signal), re-run the
//      command — up to MAX_ATTEMPTS total.
//        - The last attempt's real exit code is preserved (a persistent crash,
//          or any genuine failure on a retry, still fails the step).
//   4. A non-zero exit WITHOUT a crash signature (a real assertion failure) is
//      returned immediately — NO retry.
//   5. Only exit 0 — a clean, COMPLETE run — is ever treated as a pass.
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

  // Retry up to MAX_ATTEMPTS times, but ONLY for workerd/pool crash signatures.
  //
  // A run "passes" solely by exiting 0 — which, for the vitest-pool-workers run,
  // happens only on a clean, COMPLETE run (every one of the 197 spec files
  // executed). A crash never yields exit 0, and — critically — a teardown crash
  // that drops a whole spec file leaves the step non-zero (Errors > 0). So this
  // wrapper can NEVER pass an incomplete or dropped-file run: it just keeps
  // re-running until one attempt is genuinely clean, or the attempts run out.
  //
  // Bumped 1 → 3 (OSE-696, 2026-08-21): the teardown flake became frequent
  // enough on the RAM-bound box to hit BOTH of a retry-once's attempts (each
  // dropping a different file). More attempts converge on a clean run without
  // ever masking a real failure. A genuine assertion failure exits non-zero
  // WITHOUT a crash signature, so it stops immediately — no retry.
  const MAX_ATTEMPTS = 3;
  let attempt = 0;
  let last = { code: 1, signal: null, output: '' };

  while (attempt < MAX_ATTEMPTS) {
    attempt += 1;
    last = await runOnce(commandLine);

    if (last.code === 0) {
      if (attempt > 1) {
        process.stderr.write(`[vitest-retry] attempt ${attempt} succeeded (clean run).\n`);
      }
      process.exit(0);
      return;
    }

    const matchedSignature = hasCrashSignature(last.output);
    const matchedCrashExit = isCrashExit(last.code, last.signal);

    if (!matchedSignature && !matchedCrashExit) {
      // Genuine failure (a failed assertion exits non-zero WITHOUT killing the
      // worker) — do NOT retry; fail immediately with the real exit code.
      process.stderr.write(
        `[vitest-retry] attempt ${attempt} failed without a workerd crash signature — not retrying.\n`
      );
      process.exit(last.code);
      return;
    }

    const reason = matchedSignature
      ? `crash signature (one of: ${CRASH_SIGNATURES.join(', ')})`
      : `hard-crash exit (code ${last.code}${last.signal ? `, signal ${last.signal}` : ''})`;

    if (attempt < MAX_ATTEMPTS) {
      process.stderr.write(
        `[vitest-retry] attempt ${attempt}/${MAX_ATTEMPTS} hit a workerd ${reason} — retrying.\n`
      );
    } else {
      process.stderr.write(
        `[vitest-retry] attempt ${attempt}/${MAX_ATTEMPTS} hit a workerd ${reason} — ` +
          `retries exhausted, failing the step.\n`
      );
    }
  }

  // Exhausted every attempt on crash signatures — preserve the last real exit
  // code so the gate fails (a persistent crash is a real signal worth surfacing).
  process.exit(last.code);
}

main().catch((err) => {
  process.stderr.write(`[vitest-retry] unexpected error: ${err?.stack ?? err}\n`);
  process.exit(1);
});
