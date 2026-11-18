/**
 * [Claude] The T2 "Bruno contract section" step limit leaves room for a slow
 * but correct staging, and still fits inside its job.
 *
 * On 2026-11-17 the api section ran 5:12 on main run 44168751059 with no
 * assertion failing; the 5-minute step limit cut it off and T3/T4 were skipped.
 * Measured 2026-11-18 over the last 30 main push runs: green api runs took
 * 135-218 s, pages 66-116 s. The limit must be at least 2.5x the slowest green
 * run, and the job must keep room for the seed steps before it and the resets
 * after it. The per-request response-time ceilings in the collections are a
 * separate, deliberate check and are not touched here.
 *
 * Born red: the checker is run on the old 5-minute limit below.
 */

const { readFileSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');

const WF = join(__dirname, '..', '..', '..', '.github', 'workflows', 'oursharedevents-ci.yml');
const JOB = 'contract-staging-sub';
const STEP = 'Bruno contract section';
const SLOWEST_GREEN_SECONDS = 218; // api section, main push runs to 2026-11-18
const HEADROOM = 2.5;
const OTHER_STEPS_MINUTES = 4; // checkout, install, ~14 D1 seeds, resets, report

function problems(job) {
  const step = (job.steps || []).find((s) => s && s.name === STEP);
  if (!step) return [`no step named "${STEP}"`];
  const limit = step['timeout-minutes'];
  const out = [];
  if (typeof limit !== 'number') return [`"${STEP}" has no numeric timeout-minutes`];
  if (limit * 60 < SLOWEST_GREEN_SECONDS * HEADROOM) {
    out.push(
      `step limit ${limit} min is under ${HEADROOM}x the slowest green run (${SLOWEST_GREEN_SECONDS} s)`
    );
  }
  if (limit + OTHER_STEPS_MINUTES > job['timeout-minutes']) {
    out.push(
      `step limit ${limit} min + ${OTHER_STEPS_MINUTES} min of other steps exceeds the job limit ${job['timeout-minutes']} min`
    );
  }
  return out;
}

describe('T2 Bruno contract step timeout', () => {
  const job = yaml.load(readFileSync(WF, 'utf8')).jobs[JOB];

  test('checker: the old 5-minute limit is caught, and so is a limit the job cannot hold', () => {
    const withLimit = (n, jobLimit = 15) => ({
      'timeout-minutes': jobLimit,
      steps: [{ name: STEP, 'timeout-minutes': n }],
    });
    expect(problems(withLimit(5))).toHaveLength(1);
    expect(problems(withLimit(14))).toHaveLength(1);
    expect(problems(withLimit(10))).toEqual([]);
    expect(problems({ 'timeout-minutes': 15, steps: [] })).toEqual([`no step named "${STEP}"`]);
  });

  test('the real workflow', () => {
    expect(job, `job ${JOB}`).toBeDefined();
    expect(problems(job)).toEqual([]);
  });
});
