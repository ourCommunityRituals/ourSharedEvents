/**
 * OSE-306 regression guard for the Playwright UA override.
 *
 * If a future change deletes the global userAgent in playwright.config.ts
 * (e.g., "we don't need this anymore" without realizing CF still
 * challenges HeadlessChrome), this test breaks at PR-time, not at the
 * next audit dispatch where 5 false-positive violations would suddenly
 * appear on /events/:id and /sharedReport.
 *
 * Layer: API-static (Node vitest reads the playwright config source).
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CONFIG_PATH = join(process.cwd(), 'playwright.config.ts');

describe('OSE-306 Playwright UA override — regression guard', () => {
  test('playwright.config.ts exists at OSE root', () => {
    expect(existsSync(CONFIG_PATH)).toBe(true);
  });

  test('config sets a non-HeadlessChrome userAgent globally (avoids CF bot challenge)', () => {
    const config = readFileSync(CONFIG_PATH, 'utf8');
    // Must export defineConfig with a use.userAgent.
    expect(config).toContain('defineConfig');
    expect(config).toMatch(/userAgent\s*:/);
    // Strip comments first (both // line comments and /* block comments */),
    // then extract only the UA value used in the config — not example UAs
    // mentioned in JSDoc that legitimately reference "HeadlessChrome" as
    // the thing being avoided.
    const stripped = config.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const uaLiterals = stripped.match(/['"]Mozilla[^'"]+['"]/g) ?? [];
    expect(uaLiterals.length).toBeGreaterThan(0);
    for (const literal of uaLiterals) {
      expect(
        literal,
        `UA literal contains "Headless" — CF Bot Management will challenge this: ${literal}`
      ).not.toMatch(/Headless/i);
    }
  });

  test('UA is a recognizable real-browser shape (not a one-off custom string)', () => {
    const config = readFileSync(CONFIG_PATH, 'utf8');
    // The UA must START with "Mozilla/5.0" — the universal real-browser
    // signature. Any other start (e.g. "Bot/1.0", custom strings) would
    // trigger CF challenge or other middleware behavior.
    expect(config).toMatch(/Mozilla\/5\.0/);
    // Should include either Safari or Chrome marker (the two browser
    // families CF whitelists by default).
    expect(config).toMatch(/Safari|Chrome/);
  });

  test('config references OSE-306 in change comments (provenance trace)', () => {
    const config = readFileSync(CONFIG_PATH, 'utf8');
    expect(config).toContain('OSE-306');
    // Should explain WHY the UA is overridden, not just THAT it is.
    expect(config).toMatch(/Cloudflare|CF|bot[- ]?challenge/i);
  });
});
