/**
 * [Claude] Every workflow job sets `timeout-minutes`.
 *
 * Without it a job runs until GitHub's default of 360 minutes: a hung browser, a
 * stuck network call or a wait on staging holds a runner (and, for jobs in a
 * concurrency group, every run queued behind it) for six hours before anyone
 * sees red. Jobs that call a reusable workflow (`uses:`) take the called jobs'
 * limits and are out of scope.
 *
 * Born red: the detector is run on a planted workflow below.
 */

const { readdirSync, readFileSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');

const DIR = join(__dirname, '..', '..', '..', '.github', 'workflows');

function jobsWithoutTimeout(file, wf) {
  return Object.entries((wf && wf.jobs) || {})
    .filter(([, job]) => !job.uses && job['timeout-minutes'] === undefined)
    .map(([id]) => `${file}:${id}`);
}

describe('workflow jobs have a timeout', () => {
  test('detector: a job without timeout-minutes is caught; reusable-workflow calls are not', () => {
    const planted = yaml.load(
      [
        'jobs:',
        '  bounded:',
        '    timeout-minutes: 10',
        '    runs-on: ubuntu-24.04',
        '  unbounded:',
        '    runs-on: ubuntu-24.04',
        '  called:',
        '    uses: ./.github/workflows/other.yml',
      ].join('\n')
    );
    expect(jobsWithoutTimeout('x.yml', planted)).toEqual(['x.yml:unbounded']);
  });

  test('every job in .github/workflows', () => {
    const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));
    expect(files.length).toBeGreaterThan(10);
    const bad = files.flatMap((f) =>
      jobsWithoutTimeout(f, yaml.load(readFileSync(join(DIR, f), 'utf8')))
    );
    expect(bad).toEqual([]);
  });
});
