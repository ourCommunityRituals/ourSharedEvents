// Shared helpers for the workstation / GitHub hardening scripts.
// Nothing here prints a settings value or a token: callers get rule patterns and
// key names only, through redact().

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const REPO = 'ourCommunityRituals/ourSharedEvents';
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const HOOK_REL = '.claude/hooks/policy-gate.mjs';
export const HOOK_SOURCE = join(REPO_ROOT, '.claude', 'hooks', 'policy-gate.mjs');
export const PROPOSED = join(REPO_ROOT, '.claude', 'hooks', 'settings.user.proposed.json');

/** CLAUDE_HOME points the read-only verifier at another home folder (tests). Never used to write. */
export function claudeHome() {
  return process.env.CLAUDE_HOME ? resolve(process.env.CLAUDE_HOME) : homedir();
}
export const settingsPath = (home = claudeHome()) => join(home, '.claude', 'settings.json');
export const hookInstallPath = (home = claudeHome()) =>
  join(home, '.claude', 'hooks', 'policy-gate.mjs');

export function readJson(path) {
  const text = readFileSync(path, 'utf8');
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}
export const readSettings = (home = claudeHome()) =>
  existsSync(settingsPath(home)) ? readJson(settingsPath(home)) : {};

/** The hook as merged on origin/main (what review approved), or null when git cannot say. */
export function hookFromMain() {
  const r = spawnSync('git', ['show', `origin/main:${HOOK_REL}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return r.status === 0 && r.stdout ? r.stdout : null;
}

export function redact(s) {
  return String(s ?? '')
    .replace(
      /(ghp_|gho_|ghs_|github_pat_|sk-ant-|sk-|xox[bap]-|AKIA|AIza)[\w-]{8,}/g,
      '$1[REDACTED]'
    )
    .replace(/[A-Za-z0-9_-]{32,}/g, '[REDACTED-LONG]')
    .slice(0, 100);
}

// ---- gh ----
// OCR_GH_FIXTURE=<file.json> answers gh calls from a map of "args joined by space" ->
// { stdout, status } so the GitHub half of the verifier can be tested offline. The verifier
// prints a FIXTURE MODE banner when it is set, so its output is never mistaken for a live read.
export const fixtureMode = () => Boolean(process.env.OCR_GH_FIXTURE);

export function gh(args, input) {
  if (fixtureMode()) {
    // OCR_GH_FIXTURE_LOG=<file> records each call's args, one JSON line per call, so a test can
    // prove a dry run sent no write. Fixture mode only: a live run never writes this file.
    if (process.env.OCR_GH_FIXTURE_LOG) {
      appendFileSync(process.env.OCR_GH_FIXTURE_LOG, `${JSON.stringify(args)}\n`);
    }
    const map = readJson(process.env.OCR_GH_FIXTURE);
    const hit = map[args.join(' ')];
    if (!hit) {
      return { ok: false, status: 1, stdout: '', stderr: `no fixture for: ${args.join(' ')}` };
    }
    const status = hit.status ?? 0;
    return { ok: status === 0, status, stdout: hit.stdout ?? '', stderr: hit.stderr ?? '' };
  }
  const r = spawnSync('gh', args, { encoding: 'utf8', input, shell: false });
  if (r.error) return { ok: false, status: -1, stdout: '', stderr: String(r.error.message) };
  return { ok: r.status === 0, status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
export function ghJson(args) {
  const r = gh(args);
  if (!r.ok) return { ok: false, error: r.stderr.trim().split('\n')[0] || `exit ${r.status}` };
  try {
    return { ok: true, data: JSON.parse(r.stdout || 'null') };
  } catch {
    return { ok: false, error: 'unparseable gh output' };
  }
}

/** The terminal half alone: exits 3 with no TTY and asks nothing. Run it before any network call. */
export function requireTty(what) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(
      `Refusing: ${what} must be run by the owner in their own terminal (no TTY here).`
    );
    process.exit(3);
  }
}

/**
 * A change to security settings is the owner's. --apply needs a real terminal and a typed
 * confirmation, so an agent's non-interactive shell cannot answer it. There is no environment
 * switch that skips this: tests call the library functions with a scratch folder instead.
 * (A pseudo-terminal is a way round it; the hook's owner-script rule and the GitHub-side
 * controls are what stand behind this.)
 */
export async function requireOwnerTerminal(what) {
  requireTty(what);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) => rl.question(`Type APPLY to ${what}: `, res));
  rl.close();
  if (answer.trim() !== 'APPLY') {
    console.error('Not confirmed; nothing changed.');
    process.exit(3);
  }
}
