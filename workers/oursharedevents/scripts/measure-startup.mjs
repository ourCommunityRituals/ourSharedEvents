#!/usr/bin/env node
// ─── Worker startup cost — measured, not assumed ────────────────────────────────
//
// Frontend remediation plan step 7 ("measure the bundle's cold-start cost, then
// split admin" — docs/audits/frontend-remediation-plan-2026-09-04.md §4.1, "Measure
// before choosing"). This is step 7a: a repeatable A/B of the Worker's STARTUP
// phase (module evaluation, before any request), using Wrangler's own profiler
// (`wrangler check startup --workerBundle`, which runs a built Worker in local
// workerd). Each variant is built once with `wrangler deploy --dry-run --outfile`.
//
// Variants, each profiled RUNS times:
//   baseline  the Worker as built
//   no-admin  src/templates/admin.html replaced by a 1-line stub (restored after)
//   no-h3     `h3-js` aliased to a stub exporting the same names (build-time only)
//
// Output: per-variant median / min / max of sampled startup CPU (ms), and the
// raw + gzip size of what `wrangler deploy --dry-run` would upload.
//
// The absolute numbers are this machine's CPU, not Cloudflare's (Wrangler says
// so too); the DIFFERENCES between variants are the point.
//
// Usage (from workers/oursharedevents):  node scripts/measure-startup.mjs [runs=5]
// Never commit the stubs: admin.html is restored in a finally block and on
// SIGINT, and the h3 stub lives in a temp dir.

import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  copyFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const RUNS = Math.max(1, Number(process.argv[2] ?? 5));
const ADMIN = 'src/templates/admin.html';
const work = mkdtempSync(join(tmpdir(), 'ose-startup-'));

const H3_NAMES = [
  'cellToBoundary',
  'cellToLatLng',
  'cellToParent',
  'getResolution',
  'gridRingUnsafe',
  'isValidCell',
  'latLngToCell',
];
// `wrangler deploy --alias` is accepted but not applied to an installed package
// (measured: the "stubbed" build still carried h3-js), so the no-h3 variant uses
// a temporary config with an [alias] table. Both temp files sit next to
// wrangler.toml (relative paths resolve from the config) and are removed after.
const H3_STUB = '.h3-stub.measure-startup.tmp.mjs';
const ALIAS_CONFIG = '.wrangler.measure-startup.tmp.toml';
writeFileSync(H3_STUB, H3_NAMES.map((n) => `export const ${n} = () => null;`).join('\n') + '\n');
{
  const toml = readFileSync('wrangler.toml', 'utf8');
  const firstTable = toml.search(/^\[/m);
  writeFileSync(
    ALIAS_CONFIG,
    toml.slice(0, firstTable) + `[alias]\n"h3-js" = "./${H3_STUB}"\n\n` + toml.slice(firstTable)
  );
}

// Async, so a signal is handled at once (a sync child blocks Node's event loop
// and defers the handler until the child exits) and the child can be stopped.
let child = null;
function wrangler(args) {
  return new Promise((resolve, reject) => {
    child = spawn('npx', ['wrangler', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
      detached: true, // own process group, so the whole npx → wrangler → workerd tree can be stopped
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      child = null;
      if (code === 0) resolve(out);
      else reject(new Error(`wrangler ${args.join(' ')} exited ${code}\n${err.slice(-2000)}`));
    });
  });
}

/** Sampled startup CPU in ms: every sample's delta except the leading idle gap. */
function startupMs(profilePath) {
  const p = JSON.parse(readFileSync(profilePath, 'utf8'));
  const idle = new Set(
    p.nodes.filter((n) => n.callFrame.functionName === '(idle)').map((n) => n.id)
  );
  let us = 0;
  (p.samples ?? []).forEach((id, i) => {
    if (i === 0 || idle.has(id)) return;
    us += p.timeDeltas[i] ?? 0;
  });
  return us / 1000;
}

/** Build the variant once (`deploy --dry-run --outfile`), then profile it RUNS times. */
async function profile(label, buildArgs = []) {
  const bundle = join(work, `${label}.bundle`);
  await wrangler(['deploy', '--dry-run', '--outfile', bundle, ...buildArgs]);
  // Guard against a variant that silently did not apply (as --alias once did).
  const src = readFileSync(bundle, 'utf8');
  if (label === 'no-h3' && src.includes('INITIAL_TOTAL_MEMORY')) {
    throw new Error('no-h3 bundle still contains h3-js — the alias did not apply');
  }
  if (label === 'no-admin' && src.length > 0 && src.includes('data-testid="event-timeline-card"')) {
    throw new Error('no-admin bundle still contains admin.html');
  }
  const ms = [];
  for (let i = 0; i < RUNS; i++) {
    const out = join(work, `${label}-${i}.cpuprofile`);
    await wrangler(['check', 'startup', '--workerBundle', bundle, '--outfile', out]);
    ms.push(startupMs(out));
  }
  ms.sort((a, b) => a - b);
  return { label, median: ms[Math.floor(ms.length / 2)], min: ms[0], max: ms[ms.length - 1] };
}

async function uploadSize() {
  const dir = join(work, 'dry');
  await wrangler(['deploy', '--dry-run', '--outdir', dir]);
  let raw = 0;
  let gz = 0;
  const files = {};
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.map') || f === 'README.md') continue;
    const buf = readFileSync(join(dir, f));
    raw += statSync(join(dir, f)).size;
    gz += gzipSync(buf, { level: 9 }).length;
    files[f.replace(/^[0-9a-f]{40}-/, '')] = buf.length;
  }
  return { raw, gz, files };
}

const backup = join(work, 'admin.html.bak');
copyFileSync(ADMIN, backup);
let restored = false;
const restore = () => {
  if (restored) return;
  restored = true;
  if (existsSync(backup)) copyFileSync(backup, ADMIN);
  rmSync(H3_STUB, { force: true });
  rmSync(ALIAS_CONFIG, { force: true });
  rmSync(work, { recursive: true, force: true });
};
// Every catchable way out puts admin.html back (SIGKILL cannot be caught; the
// temp files are gitignored, and `git checkout src/templates/admin.html` undoes
// a stub left by a hard kill).
for (const [sig, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
  ['SIGHUP', 129],
]) {
  process.on(sig, () => {
    if (child?.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM'); // the whole group: npx, wrangler, workerd
      } catch {
        // already gone
      }
    }
    restore();
    process.exit(code);
  });
}
process.on('uncaughtException', (err) => {
  restore();
  throw err;
});

const results = [];
try {
  const size = await uploadSize();
  results.push(await profile('baseline'));
  writeFileSync(ADMIN, '<!doctype html><title>stub</title>\n');
  results.push(await profile('no-admin'));
  copyFileSync(backup, ADMIN);
  results.push(await profile('no-h3', ['-c', ALIAS_CONFIG]));

  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  console.log(`Upload (dry-run, no source maps): ${kb(size.raw)} raw, ${kb(size.gz)} gzip`);
  for (const [f, n] of Object.entries(size.files).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kb(n).padStart(10)}  ${f}`);
  }
  console.log(`\nStartup CPU, ${RUNS} runs each (local workerd; compare variants, not absolutes):`);
  const base = results[0].median;
  for (const r of results) {
    const delta =
      r === results[0]
        ? ''
        : `  (${(r.median - base >= 0 ? '+' : '') + (r.median - base).toFixed(1)} ms vs baseline)`;
    console.log(
      `  ${r.label.padEnd(9)} median ${r.median.toFixed(1)} ms  [${r.min.toFixed(1)}–${r.max.toFixed(1)}]${delta}`
    );
  }
} finally {
  restore();
}
