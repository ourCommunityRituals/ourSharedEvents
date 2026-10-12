#!/usr/bin/env node
/**
 * Seed a staging D1 database from SQL files, waiting out another leg's import.
 *
 *   node ../../scripts/ci/d1-seed-staging.mjs DB fixture-a.sql [fixture-b.sql ...]
 *
 * Run from the Worker folder, like the `npx wrangler d1 execute` lines it
 * replaces. Each file is one `wrangler d1 execute <DB> --env staging --remote
 * --file <f>`, in order; the first file that cannot be applied stops the step.
 *
 * Why: `--file --remote` is a D1 import, and D1 runs one import per database at
 * a time. T2, T3 and the T4 legs seed staging in parallel, so an import can be
 * refused with "Currently processing a long-running import" (run 38162352541,
 * 2026-10-11). The old steps retried once after 5 s, which is shorter than an
 * import. Here a refused import waits 10, 20, 30, 40 and 50 s (150 s in all);
 * any other error is retried once after 5 s, as before. Never continue-on-error:
 * a fixture that does not land fails its step by name.
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const BUSY = /currently processing a long-running import/i;
export const BUSY_WAITS_S = [10, 20, 30, 40, 50];
export const OTHER_WAITS_S = [5];

/**
 * Apply one file, retrying as above.
 * @param {{ db: string, file: string, run: (db: string, file: string) => { ok: boolean, output: string },
 *           sleep: (s: number) => Promise<void>, log: (line: string) => void }} o
 * @returns {Promise<boolean>}
 */
export async function applyWithRetry({ db, file, run, sleep, log }) {
  let busy = 0;
  let other = 0;
  for (;;) {
    const { ok, output } = run(db, file);
    if (ok) return true;
    const isBusy = BUSY.test(output);
    const waits = isBusy ? BUSY_WAITS_S : OTHER_WAITS_S;
    const n = isBusy ? busy++ : other++;
    if (n >= waits.length) {
      log(
        `::error::${db} ${file}: not applied after ${n + 1} tries${isBusy ? ' (another import kept the database busy)' : ''}`
      );
      return false;
    }
    log(
      `::warning::${db} ${file}: ${isBusy ? 'another import is running' : 'failed'}; retrying in ${waits[n]} s`
    );
    await sleep(waits[n]);
  }
}

function wranglerRun(db, file) {
  const r = spawnSync(
    'npx',
    ['wrangler', 'd1', 'execute', db, '--env', 'staging', '--remote', '--file', file],
    { encoding: 'utf8', shell: process.platform === 'win32' }
  );
  process.stdout.write(r.stdout ?? '');
  process.stderr.write(r.stderr ?? '');
  return { ok: r.status === 0, output: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

async function main(argv) {
  const [db, ...files] = argv;
  if (!db || files.length === 0) {
    console.error('usage: d1-seed-staging.mjs <DB|FORMS_DB> <file.sql> [file.sql ...]');
    return 2;
  }
  for (const file of files) {
    const ok = await applyWithRetry({
      db,
      file,
      run: wranglerRun,
      sleep: (s) => new Promise((res) => setTimeout(res, s * 1000)),
      log: (line) => console.log(line),
    });
    if (!ok) return 1;
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
