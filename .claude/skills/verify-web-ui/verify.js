#!/usr/bin/env node
// verify.js — the wrapper this skill drives Playwright through.
//
//   node verify.js [--url <url>] [--server <file>] [--out <dir>] [--path </>] [--devices phone,tablet,desktop]
//
// With no --url it starts `node server.mjs` itself on a free port (PORT env),
// waits until it answers, captures every device, then stops only the process
// it started. With --url it captures an instance that is already running.
//
// Per device it writes <out>/<device>.png (device-true size and pixel ratio)
// and <out>/<device>.aria.yml (ARIA snapshot), and prints one JSON summary.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(resolve(process.cwd(), 'noop.js'));
let chromium, devices;
for (const name of ['playwright', '@playwright/test', 'playwright-core']) {
  try {
    ({ chromium, devices } = require(name));
    break;
  } catch {
    /* try the next package */
  }
}
if (!chromium) {
  console.error(
    'verify.js: cannot resolve Playwright from ' +
      process.cwd() +
      '. Run it from a repo that has it installed (npm ci), e.g. ourSharedEvents or ourWKRP.'
  );
  process.exit(2);
}

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--'))
      acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, [])
);

// Device-true: real UA, touch, viewport and pixel ratio from Playwright's registry,
// forced onto Chromium so one browser build serves all three.
const strip = ({ defaultBrowserType, ...rest }) => rest;
const PROFILES = {
  phone: strip(devices['iPhone 14']),
  tablet: strip(devices['iPad Pro 11']),
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};

const wanted = String(args.devices || 'phone,tablet,desktop').split(',');
const unknown = wanted.filter((d) => !PROFILES[d]);
if (unknown.length) {
  console.error('verify.js: unknown device "' + unknown[0] + '" (phone, tablet, desktop)');
  process.exit(2);
}
const route = args.path && args.path !== true ? args.path : '/';
const out = resolve(String(args.out && args.out !== true ? args.out : '.verify-out'));
mkdirSync(out, { recursive: true });

const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });

async function waitFor(url, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not answer at ' + url + ' within ' + ms + 'ms');
}

let child;
let base = args.url && args.url !== true ? String(args.url).replace(/\/$/, '') : null;
try {
  if (!base) {
    const port = await freePort();
    child = spawn(
      process.execPath,
      [args.server && args.server !== true ? String(args.server) : 'server.mjs'],
      {
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'inherit', 'inherit'],
      }
    );
    child.once('exit', (code) => {
      if (code) console.error('server.mjs exited with ' + code);
    });
    base = 'http://127.0.0.1:' + port;
    await waitFor(base + route);
  }

  const browser = await chromium.launch();
  const results = [];
  for (const name of wanted) {
    const profile = PROFILES[name];
    if (!profile) throw new Error('unknown device "' + name + '" (phone, tablet, desktop)');
    const context = await browser.newContext(profile);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(base + route, { waitUntil: 'networkidle' });
    await page.screenshot({ path: resolve(out, name + '.png'), fullPage: true });
    writeFileSync(resolve(out, name + '.aria.yml'), await page.locator('body').ariaSnapshot());
    results.push({
      device: name,
      viewport: page.viewportSize(),
      pixelRatio: profile.deviceScaleFactor,
      title: await page.title(),
      h1: await page.locator('h1').count(),
      consoleErrors: errors,
    });
    await context.close();
  }
  await browser.close();
  console.log(JSON.stringify({ url: base + route, out, results }, null, 2));
} finally {
  if (child && !child.killed) child.kill();
}
