#!/usr/bin/env node
/**
 * Open one page in a just-installed browser before any test does.
 *
 *   node scripts/ci/warm-playwright-browser.mjs webkit
 *
 * On 2026-10-08 (PR #885, run 37795716364) T0 Gate (component) failed with no
 * code at fault. WebKit had been downloaded 45 seconds earlier. The first
 * WebKit test on each of the two workers ended with `Test timeout of 30000ms
 * exceeded while setting up "page"`. The next two WebKit browsers, started
 * 4 seconds later, each opened a page in under 3 seconds, and all 78 later
 * WebKit tests passed. So the first page a new WebKit install is asked for can
 * take longer than a whole test is allowed; what state the first run leaves
 * behind for the second was not found.
 *
 * Why the first page and not the launch: Playwright's `browser` fixture has
 * its own limit and is not on the test's clock; the `page` fixture is. A
 * longer launch limit would not have changed that run.
 *
 * Each attempt starts the browser, opens a page, draws one line of text and
 * closes, in a child process that stops itself at the attempt's limit
 * (Playwright ends the browsers it started when its process exits). One
 * browser at a time, so two workers never share a first start. If no attempt
 * opens a page the step fails and says so, before any test runs.
 *
 * It loads no page of the app, so a page that hangs is still caught by the
 * tests, under their own unchanged 30 second limit.
 *
 * PW_WARM_ATTEMPT_SECONDS: one limit per attempt (default "60 60").
 * PW_WARM_MODULE: a module to use in place of @playwright/test (the tests).
 * Exit 0 warmed, 1 a browser did not open a page, 2 bad usage.
 *
 * Called from the "Component: viewport specs vs local worker" step;
 * tests/integration/warm-playwright-browser.test.js holds it in place.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BROWSERS = ['chromium', 'firefox', 'webkit'];
const SELF = fileURLToPath(import.meta.url);
/** Past its limit by this much, an attempt that has not stopped itself is killed. */
const KILL_AFTER_SECONDS = 15;
const STOPPED_AT_LIMIT = 124;

/** One attempt, in its own process. */
async function openOnePage(name, limitSeconds) {
  setTimeout(() => process.exit(STOPPED_AT_LIMIT), limitSeconds * 1000);
  const mod = await import(
    process.env.PW_WARM_MODULE ? pathToFileURL(process.env.PW_WARM_MODULE).href : '@playwright/test'
  );
  const browser = await (mod[name] ?? mod.default[name]).launch();
  const page = await browser.newPage();
  await page.setContent('<!doctype html><title>warm</title><p>warm</p>');
  await page.screenshot();
  await browser.close();
  process.exit(0);
}

function main(names) {
  const limits = (process.env.PW_WARM_ATTEMPT_SECONDS ?? '60 60').split(/\s+/).map(Number);
  const badLimit = limits.some((n) => !Number.isFinite(n) || n <= 0);
  if (names.length === 0 || names.some((n) => !BROWSERS.includes(n)) || badLimit) {
    console.log(
      `::error::usage: warm-playwright-browser.mjs <${BROWSERS.join('|')}>... (PW_WARM_ATTEMPT_SECONDS: seconds per attempt)`
    );
    return 2;
  }

  for (const name of names) {
    let warmed = false;
    for (const [i, limit] of limits.entries()) {
      const attempt = `attempt ${i + 1} of ${limits.length}`;
      const started = Date.now();
      const res = spawnSync(process.execPath, [SELF, '--once', name, String(limit)], {
        stdio: 'inherit',
        timeout: (limit + KILL_AFTER_SECONDS) * 1000,
        killSignal: 'SIGKILL',
      });
      const took = ((Date.now() - started) / 1000).toFixed(1);
      if (res.status === 0) {
        console.log(`${name} opened a blank page in ${took}s (${attempt})`);
        warmed = true;
        break;
      }
      if (res.status === STOPPED_AT_LIMIT || res.status === null) {
        console.log(`::warning::${name} did not open a blank page in ${limit}s (${attempt}).`);
      } else {
        console.log(
          `::warning::${name} failed to open a blank page: exit ${res.status} after ${took}s (${attempt}).`
        );
      }
    }
    if (!warmed) {
      console.log(
        `::error title=Browser did not open a page::${name} did not open a blank page in ${limits.length} attempts (limits: ${limits.join(' ')} seconds). No test ran. No page of the app was loaded, so this is the browser install or the runner and not a page in this change: re-run the job. If it happens again, look at the Playwright version and the system packages it installed.`
      );
      return 1;
    }
  }
  return 0;
}

const args = process.argv.slice(2);
if (args[0] === '--once') {
  openOnePage(args[1], Number(args[2])).catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
} else {
  process.exit(main(args));
}
