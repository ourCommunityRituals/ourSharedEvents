// Renders screenshots/compare.html into one PNG.
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 2000, height: 1200 } });
  await p.goto(pathToFileURL('screenshots/compare.html').href);
  await p.waitForLoadState('networkidle');
  await p.screenshot({ path: 'screenshots/comparison-sheet.png', fullPage: true });
  await b.close();
})();
