/**
 * INVARIANT 12: Runner Pool Readiness
 *
 * The pool's one job is to be ready for the next run, every time. A self-hosted
 * runner Listener can be alive-as-a-process but broken-at-the-broker — looks
 * green in `Get-Service`, looks green in the GitHub UI, but won't pick up the
 * next job. CI infrastructure that "looks fine" while silently failing is the
 * worst class of outage because nothing alerts.
 *
 * This invariant guards the readiness mechanism — not its runtime state (a
 * scheduled task lives on a Windows host, not in this repo's CI), but the
 * code-shape that defines what readiness MEANS and how it self-heals.
 *
 * The mechanism this invariant protects:
 *   - tools/runner/janitor.ps1               — the canonical health-and-cleanup
 *     script. Six signals: orphan job children, worker dwell time, broker-error
 *     listeners, queue-vs-idle corroboration, pool-wide outage detection,
 *     self-heartbeat. Circuit breaker stops infinite bouncing.
 *   - tools/runner/install-janitor-tasks.ps1 — installs the 1-min readiness
 *     probe + 5-min watchdog scheduled tasks (no UAC, no stored password).
 *   - tools/runner/janitor.tests.ps1         — Pester-style self-tests of the
 *     pure-logic pieces (circuit breaker, dwell lookups, broker-error parsing,
 *     runner→task-name mapping). Without these, "I refactored the janitor and
 *     it still feels like it works" is a CI-killer waiting to ship.
 *   - tools/runner/verify-probe-alive.ps1    — watchdog that reads the probe's
 *     heartbeat file and emits RUNNER_PROBE_DEAD if it goes stale.
 *
 * Brain Invariant #12 (runner_pool_readiness):
 *   - brain canonical: OCR-docs/ocr-docs-brain/architectural-invariants.yaml
 *
 * Why this can't be enforced via runtime CI:
 *   The actual probe+watchdog tasks run as Windows scheduled tasks on the
 *   Bloodraven host — they are per-machine state, not repo state. This
 *   invariant therefore asserts the CODE that defines readiness still exists
 *   and still says what we think it says. The runtime side is verified by
 *   grepping for `RUNNER_PROBE_ALIVE` (fresh = OK) or `RUNNER_PROBE_DEAD`
 *   (probe is down) in the janitor log on the host. Both signal types are
 *   asserted to be present in the source so the watchdog/probe pair can't
 *   silently lose its alerting surface.
 *
 * What this invariant catches at the structural level:
 *   - Anyone deletes janitor.ps1, install-janitor-tasks.ps1, janitor.tests.ps1,
 *     or verify-probe-alive.ps1 → CI fails
 *   - Anyone removes the circuit-breaker logic from janitor.ps1 (which would
 *     allow infinite bounce loops on a broken runner, masking the underlying
 *     problem) → CI fails
 *   - Anyone removes the GitHub-side-outage detection (which would let the
 *     probe bounce all 3 healthy runners against a dead broker endpoint,
 *     burning the breaker budget without fixing anything) → CI fails
 *   - Anyone removes the probe heartbeat or the watchdog's read of it (the
 *     probe is a single point of failure; without the watchdog, a dead probe
 *     is invisible) → CI fails
 *   - Runbook README loses the signals table that operators grep for → CI fails
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const RUNNER_TOOLS_DIR = join(REPO_ROOT, 'tools', 'runner');
const JANITOR_SCRIPT = join(RUNNER_TOOLS_DIR, 'janitor.ps1');
const JANITOR_TESTS = join(RUNNER_TOOLS_DIR, 'janitor.tests.ps1');
const INSTALL_TASKS = join(RUNNER_TOOLS_DIR, 'install-janitor-tasks.ps1');
const VERIFY_PROBE_ALIVE = join(RUNNER_TOOLS_DIR, 'verify-probe-alive.ps1');
const RUNNER_README = join(RUNNER_TOOLS_DIR, 'README.md');

test.describe('Invariant 12: Runner Pool Readiness — probe + watchdog mechanism', () => {
  test('OSE-INV12 | infra | scripts | janitor.ps1 exists', () => {
    expect(
      existsSync(JANITOR_SCRIPT),
      'tools/runner/janitor.ps1 must exist — it is the canonical pool health & cleanup script the probe invokes every minute'
    ).toBe(true);
  });

  test('OSE-INV12 | infra | scripts | install-janitor-tasks.ps1 exists', () => {
    expect(
      existsSync(INSTALL_TASKS),
      'tools/runner/install-janitor-tasks.ps1 must exist — installing the readiness probe + watchdog as scheduled tasks is what flips the mechanism from code to live'
    ).toBe(true);
  });

  test('OSE-INV12 | infra | scripts | janitor.tests.ps1 exists (self-tests for the janitor)', () => {
    expect(
      existsSync(JANITOR_TESTS),
      'tools/runner/janitor.tests.ps1 must exist — without it, "I refactored the janitor" turns into a silent CI-killer'
    ).toBe(true);
  });

  test('OSE-INV12 | infra | scripts | verify-probe-alive.ps1 exists (5-min watchdog)', () => {
    expect(
      existsSync(VERIFY_PROBE_ALIVE),
      'tools/runner/verify-probe-alive.ps1 must exist — the probe itself is a single point of failure and this watchdog catches it dying'
    ).toBe(true);
  });

  test('OSE-INV12 | infra | safety | janitor circuit breaker prevents bounce loops', () => {
    const janitor = readFileSync(JANITOR_SCRIPT, 'utf8');
    // The circuit breaker stops infinite bouncing of a runner that won't come
    // back. Without it, the probe would slap a broken machine every cycle,
    // mask the underlying problem, and never alert. RUNNER_POOL_DEGRADED is
    // the operator-facing signal name the runbook documents.
    expect(
      janitor,
      'janitor.ps1 must include circuit-breaker logic — without it the probe loops forever on a broken runner'
    ).toMatch(/RUNNER_POOL_DEGRADED/);
  });

  test('OSE-INV12 | infra | safety | janitor detects pool-wide outages', () => {
    const janitor = readFileSync(JANITOR_SCRIPT, 'utf8');
    // If every runner shows the same broker-error signature in the last few
    // minutes, the failure is GitHub-side, not local. Bouncing all healthy
    // runners against a dead broker burns the circuit-breaker budget without
    // fixing anything. GITHUB_SIDE_OUTAGE is the signal the runbook documents.
    expect(
      janitor,
      'janitor.ps1 must include pool-wide-outage detection — without it the probe burns the breaker budget against an upstream failure'
    ).toMatch(/GITHUB_SIDE_OUTAGE/);
  });

  test('OSE-INV12 | infra | safety | probe writes a heartbeat the watchdog reads', () => {
    const janitor = readFileSync(JANITOR_SCRIPT, 'utf8');
    const watchdog = readFileSync(VERIFY_PROBE_ALIVE, 'utf8');
    // The heartbeat pair is what catches the probe-task-itself-dying case.
    // The probe writes a timestamp file; the watchdog emits RUNNER_PROBE_DEAD
    // if it goes stale. If either side stops referencing the heartbeat, the
    // watchdog becomes cosmetic.
    expect(janitor, 'janitor.ps1 must reference the heartbeat file write (probe-side)').toMatch(
      /heartbeat/i
    );
    expect(
      watchdog,
      'verify-probe-alive.ps1 must reference the heartbeat (watchdog reads it)'
    ).toMatch(/heartbeat/i);
    expect(
      watchdog,
      'verify-probe-alive.ps1 must emit RUNNER_PROBE_DEAD when heartbeat is stale (the operator signal)'
    ).toMatch(/RUNNER_PROBE_DEAD/);
  });

  test('OSE-INV12 | infra | docs | runbook documents the operator signal table', () => {
    expect(existsSync(RUNNER_README)).toBe(true);
    const readme = readFileSync(RUNNER_README, 'utf8');
    // The signals table is how operators know what to grep for in the log.
    // Three human-investigate signals MUST stay documented or operators will
    // miss real failures.
    expect(readme, 'runbook must document RUNNER_POOL_DEGRADED').toMatch(/RUNNER_POOL_DEGRADED/);
    expect(readme, 'runbook must document GITHUB_SIDE_OUTAGE').toMatch(/GITHUB_SIDE_OUTAGE/);
    expect(readme, 'runbook must document RUNNER_PROBE_DEAD').toMatch(/RUNNER_PROBE_DEAD/);
  });
});
