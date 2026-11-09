// Announce a red run of an off-chain workflow as a GitHub issue, and close it when
// the workflow is green again.
//
// Why: "Stock data (stg)" failed every day from 2026-11-07 and nobody saw it. The
// workflow is not part of T1–T4, so main stayed green, and a red scheduled run
// only reaches whoever last edited its cron. An open issue is seen by every repo
// watcher, lists each red run in one place, and closes itself on the next green.
//
// One issue per key (ANNOUNCE_KEY): it carries the label `ci-red:<key>` and a
// hidden marker, and is found by both.
//
//   red    (a job failed or was cancelled)  open the issue, or comment on the open one
//   green  (every job succeeded)            comment and close the open issue, if any
//   other  (jobs skipped, nothing failed)   nothing: e.g. a dispatch from a branch
//
// Env: GITHUB_TOKEN (issues: write), GITHUB_REPOSITORY, GITHUB_RUN_ID,
// GITHUB_SERVER_URL, NEEDS (`${{ toJSON(needs) }}`), ANNOUNCE_KEY, ANNOUNCE_TITLE,
// optional ANNOUNCE_HINT (what to do first) and ANNOUNCE_ASSIGNEE (a GitHub login).
// Only job names and results from NEEDS are ever written; outputs are ignored.

import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const KEY_RE = /^[a-z0-9][a-z0-9-]{0,48}$/;
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const JOB_RE = /^[A-Za-z0-9_-]{1,100}$/;
const RED_RESULTS = new Set(['failure', 'cancelled']);

export const labelFor = (key) => `ci-red:${key}`;
export const markerFor = (key) => `<!-- announce-run:${key} -->`;

/** { state: 'red'|'green'|'none', jobs: [[name, result]], red: [names] } from NEEDS. */
export function verdict(needsJson) {
  let needs;
  try {
    needs = JSON.parse(needsJson || '');
  } catch {
    throw new Error('NEEDS is not JSON');
  }
  if (!needs || typeof needs !== 'object' || Array.isArray(needs)) {
    throw new Error('NEEDS is not an object of jobs');
  }
  const jobs = Object.entries(needs).map(([name, j]) => [
    JOB_RE.test(name) ? name : 'job',
    j && typeof j.result === 'string' ? j.result : 'unknown',
  ]);
  if (jobs.length === 0) throw new Error('NEEDS names no job');
  const red = jobs.filter(([, r]) => RED_RESULTS.has(r)).map(([n]) => n);
  if (red.length > 0) return { state: 'red', jobs, red };
  if (jobs.every(([, r]) => r === 'success')) return { state: 'green', jobs, red };
  return { state: 'none', jobs, red };
}

function need(env, name) {
  const v = env[name];
  if (typeof v !== 'string' || v === '') throw new Error(`${name} is not set`);
  return v;
}

/** A tiny GitHub REST client over fetch. Never prints the token. */
export function github(env, fetchFn) {
  const token = need(env, 'GITHUB_TOKEN');
  const repo = need(env, 'GITHUB_REPOSITORY');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('bad GITHUB_REPOSITORY');
  const api = 'https://api.github.com';
  return async (method, path, body) => {
    const res = await fetchFn(`${api}/repos/${repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ose-announce-run',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json };
  };
}

const ok = (r) => r.status >= 200 && r.status < 300;

function runLine(env, v) {
  const server = env.GITHUB_SERVER_URL || 'https://github.com';
  const url = `${server}/${env.GITHUB_REPOSITORY}/actions/runs/${need(env, 'GITHUB_RUN_ID')}`;
  const jobs = v.jobs.map(([n, r]) => `${n} ${r}`).join(', ');
  return { url, jobs };
}

export async function announce(env, deps = {}) {
  const out = deps.write || ((s) => process.stdout.write(s));
  const key = need(env, 'ANNOUNCE_KEY');
  if (!KEY_RE.test(key)) throw new Error('ANNOUNCE_KEY must be lower-case words and dashes');
  const title = need(env, 'ANNOUNCE_TITLE');
  const v = verdict(env.NEEDS);
  if (v.state === 'none') {
    out(
      `announce-run: no job failed and not every job ran (${v.jobs.map((j) => j.join(' ')).join(', ')}); nothing to announce.\n`
    );
    return { action: 'none' };
  }
  const gh = github(env, deps.fetch || globalThis.fetch);
  const label = labelFor(key);
  const marker = markerFor(key);
  const list = await gh(
    'GET',
    `/issues?state=open&labels=${encodeURIComponent(label)}&per_page=20`
  );
  if (!ok(list) || !Array.isArray(list.json)) {
    throw new Error(`listing open issues failed: HTTP ${list.status}`);
  }
  const open = list.json.find(
    (i) => i && !i.pull_request && typeof i.body === 'string' && i.body.includes(marker)
  );
  const { url, jobs } = runLine(env, v);
  const when = (deps.now ? deps.now() : new Date()).toISOString().replace(/\.\d+Z$/, 'Z');

  if (v.state === 'green') {
    if (!open) {
      out('announce-run: green, and no open issue to close.\n');
      return { action: 'none' };
    }
    const c = await gh('POST', `/issues/${open.number}/comments`, {
      body: `Green again at ${when}: ${url} (${jobs}). Closing.`,
    });
    if (!ok(c)) throw new Error(`commenting on #${open.number} failed: HTTP ${c.status}`);
    const p = await gh('PATCH', `/issues/${open.number}`, {
      state: 'closed',
      state_reason: 'completed',
    });
    if (!ok(p)) throw new Error(`closing #${open.number} failed: HTTP ${p.status}`);
    out(`announce-run: green; closed #${open.number}.\n`);
    return { action: 'closed', number: open.number };
  }

  const redLine = `Red at ${when}: ${url}. Failed: ${v.red.join(', ')} (${jobs}).`;
  if (open) {
    const c = await gh('POST', `/issues/${open.number}/comments`, {
      body: `Still red. ${redLine}`,
    });
    if (!ok(c)) throw new Error(`commenting on #${open.number} failed: HTTP ${c.status}`);
    out(`announce-run: red; commented on #${open.number}.\n`);
    return { action: 'commented', number: open.number };
  }

  const l = await gh('POST', '/labels', {
    name: label,
    color: 'b60205',
    description: 'An off-chain workflow is red (scripts/ci/announce-run.mjs)',
  });
  if (!ok(l) && l.status !== 422) throw new Error(`creating the label failed: HTTP ${l.status}`);
  const hint = env.ANNOUNCE_HINT ? `\n\n**First step:** ${env.ANNOUNCE_HINT}` : '';
  const body = [
    marker,
    `${redLine}${hint}`,
    '',
    'This workflow is not part of T1–T4, so main stays green while it is red. This issue stays open, with a comment per red run, and closes itself on the next green run.',
  ].join('\n');
  const assignee =
    env.ANNOUNCE_ASSIGNEE && LOGIN_RE.test(env.ANNOUNCE_ASSIGNEE) ? env.ANNOUNCE_ASSIGNEE : '';
  let created = await gh('POST', '/issues', {
    title,
    body,
    labels: [label],
    ...(assignee ? { assignees: [assignee] } : {}),
  });
  // An assignee the repo cannot take must not keep the alarm from being raised.
  if (!ok(created) && assignee) {
    created = await gh('POST', '/issues', { title, body, labels: [label] });
  }
  if (!ok(created) || !created.json || !created.json.number) {
    throw new Error(`opening the issue failed: HTTP ${created.status}`);
  }
  out(`announce-run: red; opened #${created.json.number}.\n`);
  return { action: 'opened', number: created.json.number };
}

export async function main(env = process.env, deps = {}) {
  const r = await announce(env, deps);
  if (env.GITHUB_STEP_SUMMARY && r.action !== 'none') {
    (deps.appendFile || appendFileSync)(
      env.GITHUB_STEP_SUMMARY,
      `announce-run: ${r.action} issue #${r.number}\n`
    );
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`announce-run: ${err.message}`);
      process.exit(1);
    }
  );
}
