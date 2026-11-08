/* eslint-disable security/detect-non-literal-fs-filename -- reads the repo's own workflows */
/**
 * stg has one database (CCR 2026-11-07 R-07). Four jobs write to it outside a
 * deploy: the daily stock load, the T2 pages leg (it publishes and unpublishes
 * the landing zip fixture), the nightly event lifecycle and the rollback drill.
 * They share one concurrency group, `stg-writer`, so no two of them write at
 * the same time; a second one waits and is never cancelled out from under a run.
 *
 * GitHub keeps one waiting run per group: a third arrival replaces the waiting
 * one. The schedules are set apart (stock 09:23, lifecycle 06:47, nightly CI
 * 03:07 UTC) so that only a hand dispatch can make three meet.
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
const STG_WRITER = { group: 'stg-writer', 'cancel-in-progress': false };

describe('one writer on stg at a time', () => {
  test.each(['stock-data-full.yml', 'staging-event-lifecycle.yml', 'staging-rollback-drill.yml'])(
    '%s is in the stg-writer group, never cancelled by the next',
    (file) => {
      expect(load(file).concurrency).toEqual(STG_WRITER);
    }
  );

  test('the T2 pages leg is in the stg-writer group; the other T2 legs keep their own', () => {
    const ci = load('oursharedevents-ci.yml');
    const job = ci.jobs['contract-staging-sub'];
    const group = String(job.concurrency.group);
    expect(job.concurrency['cancel-in-progress']).toBe(false);
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
