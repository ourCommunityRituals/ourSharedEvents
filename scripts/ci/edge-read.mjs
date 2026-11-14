// Did a staging read reach the Worker, or did the edge answer it? (OSE-2022)
//
// The Cloudflare edge answers a non-browser read of some stg paths with a managed
// challenge (403, cf-mitigated: challenge) before the Worker runs. A staging test
// that accepts that 403 as a pass proves nothing about the Worker, and nobody sees
// that it proved nothing. This module is what such a test calls:
//
//   edgeHeaders(env)        the X-OCR-CI header the stg skip rule matches, when the
//                           token is set (scripts/ci/cf-waf-stg-ci-skip.mjs)
//   edgeChallenged(s, h)    true for the edge's own answer
//   noteEdgeChallenge(...)  counts it where a person looks: a GitHub warning and a
//                           step-summary line. With CALENDAR_EDGE_STRICT=1 it throws,
//                           so the test fails.
//
// The strict switch is a repository variable the owner sets once the skip rule
// covers the path. Until then a challenge is shown, not hidden and not red.
// Nothing here prints a header value.

import { appendFileSync } from 'node:fs';

/** Headers to add to a stg read so the CI skip rule lets it through. */
export function edgeHeaders(env = process.env) {
  const token = typeof env.OCR_CI_EDGE_TOKEN === 'string' ? env.OCR_CI_EDGE_TOKEN : '';
  return token === '' ? {} : { 'X-OCR-CI': token };
}

/** True when the answer is the edge's challenge, not the Worker's. */
export function edgeChallenged(status, headers) {
  const raw = headers && (headers['cf-mitigated'] ?? headers['CF-Mitigated']);
  return status === 403 && String(raw || '').trim() !== '';
}

export function edgeStrict(env = process.env) {
  return env.CALENDAR_EDGE_STRICT === '1';
}

// A path is written into a workflow command and a Markdown table, so keep it to
// the characters a path we read can hold.
const safePath = (path) =>
  String(path)
    .replace(/[^A-Za-z0-9/_.?=&%-]/g, '_')
    .slice(0, 200);

/**
 * Record that the edge challenged `path`. Returns the message. Throws in strict mode.
 * `deps` is for tests: write (stdout) and appendFile (the step summary).
 */
export function noteEdgeChallenge(path, env = process.env, deps = {}) {
  const write = deps.write || ((s) => process.stdout.write(s));
  const append = deps.appendFile || appendFileSync;
  const p = safePath(path);
  const sent = edgeHeaders(env)['X-OCR-CI'] ? 'with X-OCR-CI' : 'without X-OCR-CI (no token set)';
  const message =
    `The stg edge challenged ${p} (${sent}); the Worker did not answer, so this check ` +
    `proved nothing about it. The skip rule must cover the path: ` +
    `docs/runbooks/RUNBOOK-STG-CI-SKIP-RULE.md.`;
  write(`::warning title=Edge challenge (OSE-2022)::${message}\n`);
  if (env.GITHUB_STEP_SUMMARY) {
    append(
      env.GITHUB_STEP_SUMMARY,
      `- Edge challenge: \`${p}\` did not reach the Worker (${sent}).\n`
    );
  }
  if (edgeStrict(env)) throw new Error(`CALENDAR_EDGE_STRICT=1: ${message}`);
  return message;
}
