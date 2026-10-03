// Captures the proof screenshots and measures load time, tile bytes and CSP violations.
// Usage: node scripts/shoot.cjs [place ...]   (server must be running on :8799)
const { chromium } = require('playwright');
const fs = require('node:fs');
const BASE = 'http://localhost:8799';
const places = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['region', 'riph', 'sawyer', 'milwaukee', 'davenport', 'kankakee'];
(async () => {
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const rows = [];
  async function shot(name, query, viewport, clipMap = true) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const m = { name, tileReqs: 0, tileBytes: 0, csp: [], errors: [], thirdParty: [] };
    page.on('console', (msg) => {
      if (/Content Security Policy|Refused/i.test(msg.text())) m.csp.push(msg.text().slice(0, 200));
      else if (msg.type() === 'error') m.errors.push(msg.text().slice(0, 200));
    });
    page.on('request', (r) => {
      if (!r.url().startsWith(BASE) && !r.url().startsWith('data:') && !r.url().startsWith('blob:'))
        m.thirdParty.push(r.url());
    });
    page.on('response', async (r) => {
      if (r.url().includes('/tiles/')) {
        m.tileReqs++;
        m.tileBytes += Number(r.headers()['content-length'] || 0);
      }
    });
    const t0 = Date.now();
    await page.goto(`${BASE}/?shot=1&${query}`);
    await page.waitForSelector('html[data-map-idle="true"]', { timeout: 90000 });
    m.idleMs = Date.now() - t0;
    await page.waitForTimeout(500);
    const target = clipMap ? page.locator('#map') : page;
    await target.screenshot({ path: `screenshots/${name}.png` });
    if (!clipMap) {
      m.layout = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        small: [...document.querySelectorAll('button, a')]
          .filter((e) => e.offsetParent)
          .map((e) => {
            const r = e.getBoundingClientRect();
            return {
              t: (e.textContent || e.getAttribute('aria-label') || e.className).trim().slice(0, 30),
              w: Math.round(r.width),
              h: Math.round(r.height),
            };
          })
          .filter((x) => x.w < 44 || x.h < 44),
      }));
    }
    rows.push(m);
    await ctx.close();
  }
  for (const p of places) {
    for (const theme of ['dark', 'light']) {
      if (p === 'region') {
        await shot(`region-${theme}`, `place=region&theme=${theme}`, { width: 1100, height: 900 });
        continue;
      }
      await shot(`${p}-${theme}`, `place=${p}&theme=${theme}&frame=960x640`, {
        width: 1100,
        height: 900,
      });
      // Same frame as the Google venue image: 240x160 at Google zoom 15 (= MapLibre zoom 14).
      await shot(`${p}-${theme}-venue-frame`, `place=${p}&theme=${theme}&z=14&frame=240x160`, {
        width: 1100,
        height: 900,
      });
    }
  }
  if (!process.argv.slice(2).length) {
    await shot('phone-375-dark', 'place=riph&theme=dark&z=13', { width: 375, height: 812 }, false);
    await shot(
      'phone-375-light',
      'place=riph&theme=light&z=13',
      { width: 375, height: 812 },
      false
    );
  }
  await browser.close();
  fs.writeFileSync('screenshots/measurements.json', JSON.stringify(rows, null, 1));
  for (const r of rows)
    console.log(
      r.name.padEnd(34),
      `${r.idleMs}ms`.padEnd(9),
      `${r.tileReqs} reads`.padEnd(10),
      `${Math.round(r.tileBytes / 1024)} KB`.padEnd(9),
      `csp:${r.csp.length} err:${r.errors.length} 3p:${r.thirdParty.length}`,
      r.layout ? JSON.stringify(r.layout) : ''
    );
  const bad = rows.filter((r) => r.csp.length || r.errors.length || r.thirdParty.length);
  if (bad.length)
    console.log(
      JSON.stringify(
        bad.map((b) => ({ n: b.name, csp: b.csp, e: b.errors, tp: b.thirdParty })),
        null,
        1
      ).slice(0, 3000)
    );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
