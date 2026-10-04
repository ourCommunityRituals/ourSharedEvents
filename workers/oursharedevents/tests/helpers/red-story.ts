/**
 * TDD red layer: a test written BEFORE its story is built.
 *
 * A bare `it.fails()` is a trap: it also passes when the test fails for the wrong
 * reason (a typo, a missing seed, a changed route), so a red test can sit there
 * proving nothing. `redStory()` closes that:
 *
 *   - the body must FAIL, and the failure must be an assertion carrying the story
 *     tag, e.g. `expect(x, '[OSE-1560] a new event is off the map').toBe(0)`.
 *     Any other failure (TypeError, 500, timeout) fails this test: the red test is
 *     broken, not red.
 *   - when the body starts to PASS, this test fails with "promote it". That is the
 *     signal the story landed: delete the `redStory` wrapper (keep the body as a
 *     normal test) and move the story to Done in tdd-red-map.md.
 *
 * So the suite is green while stories are open, and goes red exactly when the work
 * lands, until the test is promoted. Same shape at every level of the pyramid.
 */
import { it } from 'vitest';

/** The rule, separate from vitest so it can be tested: resolves when the body is red for the right reason. */
export async function assertRed(story: string, body: () => Promise<void>): Promise<void> {
  let failure: unknown;
  try {
    await body();
  } catch (e) {
    failure = e;
  }
  if (failure === undefined) {
    throw new Error(
      `${story} now passes: promote this test (remove redStory, keep the body) and mark the story done in docs/ops/TDD-RED-MAP.md`
    );
  }
  const message = failure instanceof Error ? failure.message : String(failure);
  if (!message.includes(`[${story}]`)) {
    throw new Error(
      `${story} failed for the wrong reason (no [${story}] assertion message), so it is broken, not red: ${message}`
    );
  }
}

export function redStory(story: string, name: string, body: () => Promise<void>): void {
  it(`[RED ${story}] ${name}`, () => assertRed(story, body));
}
