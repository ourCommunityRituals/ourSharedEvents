// Latency budget for one Bruno request (OSE-2091).
//
// One copy per collection: Bruno only loads a module from inside the running
// collection, so bruno/ose-api/lib/ and bruno/ose-pages/lib/ hold the same file.
// tests/integration/bruno-latency-budget.test.js keeps the two byte-identical
// and proves the rules below fail on an injected slow response.
//
// Why: a single over-budget sample on shared staging (one 6081 ms POST against
// a 6000 ms ceiling, 15 runs and ~6,300 samples where p99.9 was 1.7 s) turned
// T2 red with nothing broken. A single sample is not evidence of a
// regression; a slow re-read, a sample far over budget, or slow samples piling
// up within one run are.
//
// The rules, per request:
//   1. Under budget: pass.
//   2. At or over the hard ceiling (HARD_CEILING_FACTOR x budget): fail. No
//      retry, no allowance. Never seen on main (max observed 1.01 x budget).
//   3. Over budget, and the request is safe to repeat (GET or HEAD, not a
//      counted path): send it once more. A retry that is also over budget,
//      or answers with a different status, fails.
//   4. Every over-budget sample that was not failed by 2 or 3 is a "slow
//      sample". A collection run tolerates SLOW_SAMPLES_PER_RUN of them; the
//      next one fails. Writes and counted reads are never re-sent, so for them
//      this allowance is the only tolerance.
//
// Counted GETs are never re-sent: a second /q/ scan or /e/ share open would
// change the counts later requests assert on.

const HARD_CEILING_FACTOR = 2;
const SLOW_SAMPLES_PER_RUN = 2;
const SLOW_SAMPLES_VAR = 'latencySlowSamples';
const COUNTED_GET = /^\/(?:q|e|p|r|c|s|es\/e)\//;

function pathOf(url) {
  const s = String(url || '');
  const schemeEnd = s.indexOf('://');
  const start = schemeEnd === -1 ? 0 : s.indexOf('/', schemeEnd + 3);
  if (start === -1) return '/';
  return s.slice(start).split(/[?#]/)[0] || '/';
}

function canResend(method, url) {
  const m = String(method || '').toUpperCase();
  if (m !== 'GET' && m !== 'HEAD') return false;
  return !COUNTED_GET.test(pathOf(url));
}

// Pure decision, so it can be tested without Bruno.
//   sample: { elapsed, budget, status, slowSoFar, resendable,
//             retry: null | { elapsed, status } }
//   returns { pass, slow, label }
function judge(sample) {
  const budget = sample.budget;
  const hard = budget * HARD_CEILING_FACTOR;
  const base = 'Response time < ' + budget + 'ms (actual: ' + sample.elapsed + 'ms';
  if (sample.elapsed < budget) return { pass: true, slow: false, label: base + ')' };
  if (sample.elapsed >= hard) {
    return {
      pass: false,
      slow: true,
      label: base + '; at or over the ' + hard + 'ms hard ceiling)',
    };
  }
  const retry = sample.retry;
  if (sample.resendable && retry && retry.status === sample.status) {
    if (retry.elapsed >= budget) {
      return {
        pass: false,
        slow: true,
        label: base + '; retry also slow: ' + retry.elapsed + 'ms)',
      };
    }
  }
  const note = sample.resendable
    ? retry && retry.status === sample.status
      ? 'retry ' + retry.elapsed + 'ms'
      : 'retry unusable: ' + (retry ? 'status ' + retry.status : 'no answer')
    : 'not re-sent: ' +
      (/^(GET|HEAD)$/i.test(String(sample.method || ''))
        ? 'a counted read'
        : 'a ' + String(sample.method || '').toUpperCase());
  const n = sample.slowSoFar + 1;
  const within = n <= SLOW_SAMPLES_PER_RUN;
  return {
    pass: within,
    slow: true,
    label:
      base +
      '; ' +
      note +
      '; slow sample ' +
      n +
      ' of ' +
      SLOW_SAMPLES_PER_RUN +
      ' allowed this run)',
  };
}

// Bruno glue: measures a retry when one is warranted, records the verdict as
// one named test and keeps the run's slow-sample count in a runtime variable.
async function enforce(ctx) {
  const bru = ctx.bru;
  const req = ctx.req;
  const res = ctx.res;
  const budget = ctx.budget;
  const elapsed = ctx.elapsed;
  const method = req.getMethod();
  const url = req.getUrl();
  const status = res.getStatus();
  const resendable = canResend(method, url);
  let retry = null;
  if (elapsed >= budget && elapsed < budget * HARD_CEILING_FACTOR && resendable) {
    const started = Date.now();
    let retryStatus = null;
    try {
      await bru.sendRequest(
        {
          method: method,
          url: url,
          headers: req.getHeaders(),
          timeout: budget * HARD_CEILING_FACTOR,
        },
        function (err, r) {
          retryStatus = err ? err.status : r && r.status;
        }
      );
    } catch (_e) {
      retryStatus = null;
    }
    retry = {
      elapsed: Date.now() - started,
      status: typeof retryStatus === 'number' ? retryStatus : null,
    };
  }
  const slowSoFar = Number(bru.getVar(SLOW_SAMPLES_VAR) || 0);
  const verdict = judge({
    elapsed: elapsed,
    budget: budget,
    status: status,
    method: method,
    slowSoFar: slowSoFar,
    resendable: resendable,
    retry: retry,
  });
  if (verdict.slow) bru.setVar(SLOW_SAMPLES_VAR, slowSoFar + 1);
  ctx.test(verdict.label, function () {
    ctx.expect(verdict.pass, verdict.label).to.equal(true);
  });
  return verdict;
}

module.exports = {
  HARD_CEILING_FACTOR: HARD_CEILING_FACTOR,
  SLOW_SAMPLES_PER_RUN: SLOW_SAMPLES_PER_RUN,
  SLOW_SAMPLES_VAR: SLOW_SAMPLES_VAR,
  canResend: canResend,
  pathOf: pathOf,
  judge: judge,
  enforce: enforce,
};
