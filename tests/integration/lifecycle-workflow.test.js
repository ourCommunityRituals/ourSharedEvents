/* eslint-disable security/detect-non-literal-fs-filename -- reads the repo's own workflow and scripts */
/**
 * The nightly event lifecycle workflow (.github/workflows/staging-event-lifecycle.yml):
 * when it runs, that it can only reach staging, that cleanup always runs, and
 * that its secrets stay in the steps that call the site.
 */
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..');
const WF_FILE = join(ROOT, '.github', 'workflows', 'staging-event-lifecycle.yml');
const TEXT = readFileSync(WF_FILE, 'utf8');
const wf = yaml.load(TEXT);
const on = wf.on ?? wf[true];
const job = wf.jobs.lifecycle;
const steps = job.steps;
const LIFECYCLE_STEPS = ['sweep', 'create', 'edit', 'window', 'remove', 'cleanup'];
const SECRETS = [
  'ADMIN_KEY',
  'CF_ACCESS_CLIENT_ID',
  'CF_ACCESS_CLIENT_SECRET',
  'OCR_CI_EDGE_TOKEN',
];
const minuteOfDay = (cron) => {
  const [min, hour] = cron.split(' ').map(Number);
  return hour * 60 + min;
};
const scheduleOf = (file) => {
  const w = yaml.load(readFileSync(join(ROOT, '.github', 'workflows', file), 'utf8'));
  return minuteOfDay((w.on ?? w[true]).schedule[0].cron);
};

describe('when it runs', () => {
  test('every night and by hand, and on nothing else', () => {
    expect(Object.keys(on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    expect(on.schedule).toEqual([{ cron: '47 6 * * *' }]);
    // no dispatch inputs: nothing typed at dispatch can pick the target
    expect(on.workflow_dispatch).toBeNull();
  });

  test('two hours clear of the nightly CI run, one hour clear of the stock load', () => {
    const mine = minuteOfDay(on.schedule[0].cron);
    expect(mine - scheduleOf('oursharedevents-ci.yml')).toBeGreaterThanOrEqual(120);
    expect(scheduleOf('stock-data-full.yml') - mine).toBeGreaterThanOrEqual(60);
  });

  test('one run at a time, never cancelled by the next, on its own group', () => {
    expect(wf.concurrency).toEqual({
      group: 'staging-event-lifecycle',
      'cancel-in-progress': false,
    });
  });

  test('read-only token, a GitHub-hosted runner, timeouts on the job and every lifecycle step', () => {
    expect(wf.permissions).toEqual({ contents: 'read' });
    expect(job.permissions).toBeUndefined();
    expect(job['runs-on']).toBe('ubuntu-24.04');
    expect(job['timeout-minutes']).toBeGreaterThan(0);
    for (const s of steps.filter((x) => /run\.mjs/.test(x.run || ''))) {
      expect(s['timeout-minutes'], s.name).toBeGreaterThan(0);
    }
  });
});

describe('staging only', () => {
  test('nothing in the workflow names a target, a production host or a deploy', () => {
    for (const bad of [
      'LIFECYCLE_BASE_URL',
      'LIFECYCLE_ALLOW_LOCAL',
      '//oursharedevents.com',
      'www.oursharedevents.com',
      '--env production',
      'wrangler',
      'CLOUDFLARE_API_TOKEN',
      'PRODUCTION_LIVE',
    ]) {
      expect(TEXT, bad).not.toContain(bad);
    }
  });

  test('the script pins stg and refuses production', async () => {
    const L = await import('../../scripts/lifecycle/event-lifecycle.mjs');
    expect(L.STAGING_BASE_URL).toBe('https://stg.oursharedevents.com');
    // Production comes from the one shared table (ADR-021), never spelled here.
    const { PRODUCTION_HOSTS } = require('../../config/production-hosts');
    expect(PRODUCTION_HOSTS.size).toBeGreaterThan(0);
    for (const h of PRODUCTION_HOSTS) {
      expect(() => L.assertTarget(`https://${h}`)).toThrow(/ADR-021/);
    }
  });

  test('no script in scripts/lifecycle names a production host', () => {
    const dir = join(ROOT, 'scripts', 'lifecycle');
    for (const f of readdirSync(dir)) {
      const t = readFileSync(join(dir, f), 'utf8');
      expect(t, f).not.toMatch(/\/\/(www\.)?oursharedevents\.com/);
      expect(t, f).not.toContain('--env production');
    }
  });
});

describe('the steps', () => {
  const runs = steps
    .map((s) => /node scripts\/lifecycle\/run\.mjs (\w+)/.exec(s.run || ''))
    .filter(Boolean)
    .map((m) => m[1]);

  test('one workflow step per lifecycle step, in order', () => {
    expect(runs).toEqual(LIFECYCLE_STEPS);
  });

  test('cleanup always runs, and is the last step', () => {
    const last = steps[steps.length - 1];
    expect(last.run).toContain('run.mjs cleanup');
    expect(last.if).toBe('always()');
    // every other lifecycle step stops at a red step before it
    for (const s of steps.slice(0, -1)) expect(s.if, s.name).toBeUndefined();
  });

  test('the secrets are in the steps that call the site, and nowhere else', () => {
    expect(wf.env && Object.keys(wf.env).filter((k) => SECRETS.includes(k))).toEqual([]);
    expect(job.env).toBeUndefined();
    for (const s of steps) {
      const callsSite = /run\.mjs/.test(s.run || '');
      for (const name of SECRETS) {
        if (callsSite) expect(s.env[name], `${s.name} ${name}`).toBe(`\${{ secrets.${name} }}`);
        else expect((s.env || {})[name], `${s.name} ${name}`).toBeUndefined();
      }
    }
  });

  test('the checkout keeps no credential', () => {
    const co = steps.find((s) => String(s.uses || '').startsWith('actions/checkout'));
    expect(co.with['persist-credentials']).toBe(false);
  });

  test('the window and the town search are set where the owner will change them', () => {
    expect(wf.env.WINDOW_FUTURE_DAYS).toBe('90');
    expect(wf.env.WINDOW_PAST_DAYS).toBe('0');
    expect(['on', 'off']).toContain(wf.env.LANDING_WHERE_SEARCH);
  });

  test('every step accepts the settings the workflow gives it', async () => {
    const { settingsFrom } = await import('../../scripts/lifecycle/run.mjs');
    for (const s of steps.filter((x) => /run\.mjs/.test(x.run || ''))) {
      const env = { ...wf.env, ...job.env, ...s.env };
      const got = settingsFrom(env);
      expect(got.delayMs, s.name).toBe(Number(wf.env.LIFECYCLE_POLL_DELAY_MS));
      expect(got.attempts, s.name).toBe(Number(wf.env.LIFECYCLE_POLL_ATTEMPTS));
      expect(got.window, s.name).toEqual({
        pastDays: Number(wf.env.WINDOW_PAST_DAYS),
        futureDays: Number(wf.env.WINDOW_FUTURE_DAYS),
      });
    }
  });

  test('a setting out of range is refused before anything runs', async () => {
    const { settingsFrom } = await import('../../scripts/lifecycle/run.mjs');
    expect(() => settingsFrom({ LIFECYCLE_POLL_DELAY_MS: '600000' })).toThrow();
    expect(() => settingsFrom({ LIFECYCLE_POLL_ATTEMPTS: '-1' })).toThrow();
    expect(() => settingsFrom({ WINDOW_FUTURE_DAYS: '9x' })).toThrow();
    expect(() => settingsFrom({ LANDING_WHERE_SEARCH: 'yes' })).toThrow();
    expect(settingsFrom({})).toEqual({
      whereSearch: false,
      window: { pastDays: 0, futureDays: 90 },
      attempts: 6,
      delayMs: 5000,
    });
  });
});
