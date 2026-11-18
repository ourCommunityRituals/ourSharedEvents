/* eslint-disable security/detect-non-literal-fs-filename -- reads the repo's own workflows */
/**
 * stg has one database (CCR 2026-11-07 R-07). These jobs write to it outside a
 * deploy: the daily stock load, the T2 pages leg (it publishes and unpublishes
 * the landing zip fixture), the nightly event lifecycle, the rollback drill and
 * the example fair (stg-example-fair.yml, by hand, OSE-2009).
 * They share one concurrency group, `stg-writer`, so no two of them write at
 * the same time; a second one waits and is never cancelled out from under a run.
 * The stock load and the T2 pages leg take it per job, because their runs hold the
 * staging chain's lock (OSE-2082); the others hold it for the whole run.
 *
 * Every member sets `queue: max`: waiting runs line up first in, first out (up
 * to 100) instead of GitHub's default of one waiting run, where a third arrival
 * cancels the waiting one. GitHub refuses a run whose concurrency resolves to
 * `queue: max` with cancel-in-progress true, so the group never cancels. The
 * schedules stay set apart (stock 09:23, lifecycle 06:47, nightly CI 03:07 UTC)
 * so the queue is short.
 *
 * The stock load also runs only from main (R-06): a dispatch from any other
 * branch skips every job, so a branch's scripts never touch stg with the
 * repo-level token (owner 2026-11-07: token risk accepted under ADR-020).
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const yaml = require('js-yaml');

const WF = join(__dirname, '..', '..', '.github', 'workflows');
const load = (file) => yaml.load(readFileSync(join(WF, file), 'utf8'));
const STG_WRITER = { group: 'stg-writer', 'cancel-in-progress': false, queue: 'max' };

describe('one writer on stg at a time', () => {
  test.each([
    'staging-event-lifecycle.yml',
    'staging-rollback-drill.yml',
    // OSE-2009: the example fair, loaded or removed by hand.
    'stg-example-fair.yml',
  ])(
    '%s is in the stg-writer group, queued first in first out, never cancelled by the next',
    (file) => {
      expect(load(file).concurrency).toEqual(STG_WRITER);
    }
  );

  // OSE-2082: the stock run holds the staging chain's lock for the whole run
  // (staging-chain-lock.test.js), so, like the chain's T2 pages leg, it takes
  // stg-writer per job: each job that can write to stg, and no other.
  // Born red: with the group taken off build or check-swap, this fails.
  test('each stock job that can write to stg is in the stg-writer group; the others are not', () => {
    const wf = load('stock-data-full.yml');
    const writes = (job) =>
      /secrets\.(ADMIN_KEY|CLOUDFLARE_API_TOKEN)/.test(JSON.stringify(wf.jobs[job]));
    const writers = Object.keys(wf.jobs).filter(writes);
    expect(writers).toEqual(['build', 'check-swap']);
    for (const job of Object.keys(wf.jobs)) {
      expect(wf.jobs[job].concurrency, job).toEqual(writes(job) ? STG_WRITER : undefined);
    }
  });

  test('the T2 pages leg is in the stg-writer group; the other T2 legs keep their own', () => {
    const ci = load('oursharedevents-ci.yml');
    const job = ci.jobs['contract-staging-sub'];
    const group = String(job.concurrency.group);
    expect(job.concurrency['cancel-in-progress']).toBe(false);
    expect(job.concurrency.queue).toBe('max');
    // The group is an expression over the matrix leg; evaluate it for each leg.
    const sections = job.strategy.matrix.include.map((l) => l.section);
    expect(sections).toEqual(expect.arrayContaining(['api', 'pages']));
    const m = group.match(
      /^\$\{\{ matrix\.section == 'pages' && 'stg-writer' \|\| format\('ose-t2-staging-\{0\}', matrix\.section\) \}\}$/
    );
    expect(m, group).not.toBeNull();
  });
});

describe('the stock load runs only from main', () => {
  const wf = load('stock-data-full.yml');
  const MAIN = "github.ref == 'refs/heads/main'";

  test.each(Object.keys(wf.jobs))('%s runs only on refs/heads/main', (job) => {
    const cond = String(wf.jobs[job].if || '');
    expect(cond).toContain(MAIN);
    // the guard is ANDed in, never ORed around
    expect(cond).not.toMatch(/\|\|[^()]*refs\/heads\/main|refs\/heads\/main[^()]*\|\|/);
  });
});
