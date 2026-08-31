/**
 * Brain availability — CI may never report green over a check that did not run.
 *
 * OSE-1126. Every numeric wall in the sponsor covenant (local floor 30%, premium
 * cap 40%, mid cap 20%, tier weights 7/3/1, minimum presence 2%) is pinned SOLELY
 * by the drift checks asserting byte-equivalence against the brain artifacts. The
 * behavioural specs pin the covenant's STRUCTURE — shares sum to 100, ordering is
 * stable, an unknown tier throws — but not one of its numbers.
 *
 * Measured with scripts/mutate.mjs, same mutants both ways:
 *
 *   mutant                      brain absent   brain present
 *   local_floor_pct 30 -> 29    SURVIVED       killed
 *   premium_cap_pct 40 -> 41    SURVIVED       killed
 *   premium weight  7 -> 1      SURVIVED       killed
 *
 * So when the brain is missing the drift checks skip, the suite reports
 * "16 passed | 1 skipped", and a contributor can move the local floor with
 * nothing going red.
 *
 * WHY THIS IS A SPEC AND NOT A CONFIG THROW
 * Throwing from vitest.config.mts does not gate: vitest prints the config error
 * and carries on, still exiting 0 (verified). A test can actually fail the run.
 *
 * LOCAL DEVS STAY UNBLOCKED — that was a deliberate choice and it stands. This
 * only fires under CI, where the OCR-docs checkout is guaranteed by the workflow.
 * Its real job is the case nobody plans for: the checkout step silently breaking,
 * and CI then reporting success over unpinned covenant walls.
 */

import { describe, test, expect } from 'vitest';
import { env } from 'cloudflare:test';

interface BrainEnv {
  TEST_IS_CI?: string;
  TEST_BRAIN_UEC_JSON?: string;
  TEST_BRAIN_SPONSOR_ALLOCATION_JSON?: string;
}

const benv = env as unknown as BrainEnv;

// CI-ness is INJECTED, not read from process.env. These tests run inside workerd,
// where process.env is not the Node environment — reading process.env.CI there
// returns undefined, so a runIf(CI) guard would silently never fire and this whole
// gate would be decorative. Exactly the failure mode it exists to prevent.
const inCi = benv.TEST_IS_CI === 'true';

const FIX = 'Set BRAIN_DIR, or clone OCR-docs as a sibling directory.';

describe('brain artifacts are present when CI depends on them', () => {
  test.runIf(inCi)('sponsor-allocation artifact is loaded under CI', () => {
    expect(
      benv.TEST_BRAIN_SPONSOR_ALLOCATION_JSON,
      'The sponsor-allocation drift check is SKIPPING under CI. Every covenant ' +
        'wall value is unpinned while it does. ' +
        FIX
    ).toBeTruthy();
  });

  test.runIf(inCi)('UEC artifact is loaded under CI', () => {
    expect(
      benv.TEST_BRAIN_UEC_JSON,
      'The UEC drift check is SKIPPING under CI, so the code palette is unpinned. ' + FIX
    ).toBeTruthy();
  });

  test('locally, absence is reported rather than silent', () => {
    // Not an assertion about presence — local devs are deliberately unblocked.
    // This documents that the banner in vitest.config.mts is the local signal,
    // and keeps this file meaningful when run outside CI.
    expect(typeof benv.TEST_BRAIN_SPONSOR_ALLOCATION_JSON).toBe('string');
  });
});
