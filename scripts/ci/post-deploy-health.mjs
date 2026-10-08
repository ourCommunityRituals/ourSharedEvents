#!/usr/bin/env node
/**
 * Post-deploy health signal.
 *
 * After a production deploy, read /health a few times and say one of:
 *
 *   HEALTHY      the right build is live and five readings in a row were good
 *   WRONG BUILD  production is healthy but is not the commit this run deployed
 *   ROLL BACK    three bad readings in a row, or it did not settle in time
 *   CANNOT SEE   the readings never reached the Worker (a sign-in or challenge
 *                page answered instead), so there is no verdict on the build
 *
 * Only HEALTHY passes. It never rolls anything back. ROLL BACK is an instruction
 * to the operator and a failing check; the steps are in docs/runbooks/ROLLBACK.md.
 *
 * A reading is good when /health answers 200 with ok: true, db: "ok" and the
 * expected env. "db" is checked because /health says ok: true when no database
 * is bound at all.
 *
 * Called from: the "Gate: production runs this build and stays healthy" step of
 * the T2 Smoke → Production job (tests/integration/post-deploy-health-wired.test.js
 * holds the step in place).
 *
 * The rules are pure functions (`judgeReading`, `healthSignal`, `isThisBuild`,
 * `decide`) tested in tests/unit/ci/post-deploy-health.test.js.
 *
 * Usage:
 *   HEALTH_URL=https://<host>/health EXPECTED_SHA=<commit> \
 *   EXPECTED_ENV=production EXPECTED_PREFIX=prod \
 *   node scripts/ci/post-deploy-health.mjs
 */
import { isFresh } from '../assert-deploy-freshness.mjs';

/** Change a number here and tests/unit/ci/post-deploy-health.test.js must change with it. */
export const THRESHOLDS = {
  ROLL_BACK_AFTER_BAD_IN_A_ROW: 3,
  HEALTHY_AFTER_GOOD_IN_A_ROW: 5,
  MAX_READINGS: 12,
  SECONDS_BETWEEN_READINGS: 10,
  REQUEST_TIMEOUT_SECONDS: 10,
};

export const ROLLBACK_RUNBOOK = 'docs/runbooks/ROLLBACK.md';

/**
 * One reading is `{ status, body }` or `{ error }`. Returns `{ good, blocked, why }`.
 *
 *   good     /health answered 200 with ok: true, db: "ok" and the expected env
 *   blocked  something in front of the Worker answered instead: a redirect, a
 *            4xx, or a 200 that is not JSON (a sign-in or challenge page). The
 *            Worker's /health never sends those, so the reading says nothing
 *            about the build.
 *   bad      everything else: no answer, a 5xx, or JSON that says unhealthy
 */
export function judgeReading(reading, { expectedEnv } = {}) {
  const r = reading || {};
  const bad = (why) => ({ good: false, blocked: false, why });
  const blocked = (why) => ({ good: false, blocked: true, why });
  if (r.error) return bad(`no answer (${r.error})`);
  if (r.status >= 300 && r.status < 500) return blocked(`HTTP ${r.status}, not from the Worker`);
  if (r.status !== 200) return bad(`HTTP ${r.status}`);
  if (!r.body || typeof r.body !== 'object') return blocked('the answer was not JSON');
  if (r.body.ok !== true) return bad('ok is not true');
  if (r.body.db !== 'ok') return bad(`db is "${r.body.db}"`);
  if (expectedEnv && r.body.env !== expectedEnv) {
    return bad(`env is "${r.body.env}", expected "${expectedEnv}"`);
  }
  return { good: true, blocked: false, why: 'good' };
}

/**
 * Readings, oldest first, to "healthy", "keep watching" or "roll back".
 *
 *   roll back      three bad readings in a row (a blocked reading in between
 *                  neither counts nor resets; later good readings do not forgive
 *                  it), or MAX_READINGS reached without becoming healthy and
 *                  with more bad readings than blocked ones
 *   healthy        the last five readings are all good
 *   keep watching  anything else. At MAX_READINGS this means the check mostly
 *                  could not see the Worker (`blind: true`): there is no verdict
 *                  on the build, and the caller fails the check without telling
 *                  anyone to roll back.
 */
export function healthSignal(readings, opts = {}) {
  const t = { ...THRESHOLDS, ...(opts.thresholds || {}) };
  const judged = (readings || []).map((r) => judgeReading(r, opts));
  let badRun = 0;
  for (const j of judged) {
    if (j.blocked) continue;
    badRun = j.good ? 0 : badRun + 1;
    if (badRun >= t.ROLL_BACK_AFTER_BAD_IN_A_ROW) {
      return {
        verdict: 'roll back',
        reason: `${t.ROLL_BACK_AFTER_BAD_IN_A_ROW} bad readings in a row (the last one: ${j.why})`,
      };
    }
  }
  let goodRun = 0;
  for (let i = judged.length - 1; i >= 0 && judged[i].good; i--) goodRun++;
  if (goodRun >= t.HEALTHY_AFTER_GOOD_IN_A_ROW) {
    return { verdict: 'healthy', reason: `${goodRun} good readings in a row` };
  }
  if (judged.length >= t.MAX_READINGS) {
    const badCount = judged.filter((j) => !j.good && !j.blocked).length;
    const blockedCount = judged.filter((j) => j.blocked).length;
    if (blockedCount >= badCount && blockedCount > 0) {
      const lastBlocked = [...judged].reverse().find((j) => j.blocked);
      return {
        verdict: 'keep watching',
        blind: true,
        reason: `${blockedCount} of ${judged.length} readings never reached the Worker (${lastBlocked.why})`,
      };
    }
    return {
      verdict: 'roll back',
      reason: `it did not settle: ${judged.length} readings, ${badCount} bad, never ${t.HEALTHY_AFTER_GOOD_IN_A_ROW} good in a row`,
    };
  }
  return {
    verdict: 'keep watching',
    reason: `${goodRun} good in a row so far; ${t.HEALTHY_AFTER_GOOD_IN_A_ROW} needed`,
  };
}

/**
 * Is `version` the stamp the deploy step wrote for this commit?
 * The stamp is "<prefix>-<short commit id>-<YYYYMMDD>". The date is the deploy
 * job's clock, so only its shape is checked.
 */
export function isThisBuild(version, { prefix, sha } = {}) {
  const m = /^([a-z]+)-([0-9a-f]{7,40})-(\d{8})$/.exec(String(version ?? '').toLowerCase());
  if (!m || !prefix || m[1] !== String(prefix).toLowerCase()) return false;
  return isFresh(`${m[1]}-${m[2]}-${m[3]}`, sha);
}

/** Readings so far to the answer, the exit code and what to tell the operator. */
export function decide(readings, { prefix, sha, expectedEnv, thresholds } = {}) {
  const signal = healthSignal(readings, { expectedEnv, thresholds });
  if (signal.verdict === 'keep watching' && signal.blind) {
    return {
      verdict: 'CANNOT SEE',
      done: true,
      exitCode: 1,
      message:
        `CANNOT SEE: ${signal.reason}. ` +
        'This says nothing about the build, so do not roll back on this alone. ' +
        'Open /health in a browser. If it is good there, a Cloudflare rule (bot protection or Access) is stopping this check, not the Worker.',
    };
  }
  if (signal.verdict === 'keep watching') {
    return { verdict: 'KEEP WATCHING', done: false, message: signal.reason };
  }
  if (signal.verdict === 'roll back') {
    return {
      verdict: 'ROLL BACK',
      done: true,
      exitCode: 1,
      message:
        `ROLL BACK: ${signal.reason}. ` +
        `Nothing was rolled back for you. Roll production back now unless you already know the cause: ${ROLLBACK_RUNBOOK}`,
    };
  }
  const last = readings[readings.length - 1];
  const version = last?.body?.version;
  if (!isThisBuild(version, { prefix, sha })) {
    return {
      verdict: 'WRONG BUILD',
      done: true,
      exitCode: 1,
      message:
        `WRONG BUILD: /health reports version "${version}", not ${prefix}-${String(sha).slice(0, 7)}-<date>. ` +
        'Production is healthy but is not running the commit this run deployed. ' +
        'Do not roll back: the old build is what is running. Read the "Stamp build version" and "Deploy" steps of the deploy job.',
    };
  }
  return {
    verdict: 'HEALTHY',
    done: true,
    exitCode: 0,
    message: `HEALTHY: ${signal.reason}, version "${version}".`,
  };
}

// ── command line ────────────────────────────────────────────────────────────

async function takeReading(url, timeoutSeconds) {
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch (e) {
    return { error: e?.name || 'request failed' };
  }
}

async function main() {
  const url = process.env.HEALTH_URL;
  const sha = process.env.EXPECTED_SHA;
  const prefix = process.env.EXPECTED_PREFIX || 'prod';
  const expectedEnv = process.env.EXPECTED_ENV || undefined;
  if (!url || !sha) {
    console.error('post-deploy-health: HEALTH_URL and EXPECTED_SHA are both required.');
    return 1;
  }
  // The wait can be shortened for the localhost test. It cannot change the rules.
  const raw = process.env.SECONDS_BETWEEN_READINGS;
  const asked = raw === undefined || raw === '' ? NaN : Number(raw);
  const wait = Number.isFinite(asked) && asked >= 0 ? asked : THRESHOLDS.SECONDS_BETWEEN_READINGS;

  console.log(`Watching ${url} for ${prefix}-${sha.slice(0, 7)}-<date>, one reading every ${wait}s.`);
  const readings = [];
  for (;;) {
    const reading = await takeReading(url, THRESHOLDS.REQUEST_TIMEOUT_SECONDS);
    readings.push(reading);
    const judged = judgeReading(reading, { expectedEnv });
    console.log(
      `reading ${readings.length}: ${judged.good ? 'good' : `${judged.blocked ? 'blocked' : 'bad'} (${judged.why})`}` +
        (reading.body?.version ? `, version "${reading.body.version}"` : '')
    );
    const answer = decide(readings, { prefix, sha, expectedEnv });
    if (answer.done) {
      if (answer.exitCode !== 0 && process.env.GITHUB_ACTIONS) console.log(`::error::${answer.message}`);
      console.log(answer.message);
      return answer.exitCode;
    }
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
}

const isMain = process.argv[1]?.split(String.fromCharCode(92)).join('/').endsWith('scripts/ci/post-deploy-health.mjs');
if (isMain) {
  // Not awaited at top level: the lint shard's parser disallows top-level await.
  // The exit code is set and the process is left to end by itself: on Windows,
  // process.exit() straight after a fetch can crash Node while a socket closes.
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
