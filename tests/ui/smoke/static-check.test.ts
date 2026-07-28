/**
 * Static manifest validation — runs under node:test with NO browser.
 *
 * Purpose: prove the route manifests match the real templates BEFORE the spec
 * ever runs in CI, so Tier-1 lands green on day one. Checks, per template-backed
 * route: anchor selector exists in the HTML, <html lang> present, <title>
 * present, viewport meta present.
 *
 * Usage:  OSE_TPL=<dir> WKRP_TPL=<dir> tsx --test static-check.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { oseManifest } from './ose.routes';
import { wkrpManifest } from './wkrp.routes';

const OSE_TPL = process.env.OSE_TPL ?? '';
const WKRP_TPL = process.env.WKRP_TPL ?? '';

// route → template file mapping (template-backed pages only; dynamic pages
// like /events/{id} are composed server-side and validated live).
const oseFiles: Record<string, string> = {
  landing: 'landing.html',
  'public listing': 'public.html',
  'admin dashboard': 'admin.html',
  'admin sign-in gate (no auth)': 'admin-signin.html',
  'display board': 'display.html',
  poster: 'poster.html',
  'shared report shell': 'shared-report.html',
};
const wkrpFiles: Record<string, string> = {
  connect: 'connect.html',
  catalog: 'catalog.html',
  'create playlist': 'create.html',
  'dj dashboard': 'dashboard.html',
  stats: 'stats.html',
  import: 'import.html',
  'live set (public attribution)': 'live.html',
  'qr poster': 'qr-poster.html',
  'contributor profile': 'profile.html',
};

function anchorPresent(html: string, anchor: string): boolean {
  const m = anchor.match(/^\[data-testid="(.+)"\]$/);
  if (m) return html.includes(`data-testid="${m[1]}"`);
  if (anchor === 'body' || anchor === 'main' || anchor === 'header') {
    return new RegExp(`<${anchor}[\\s>]`).test(html);
  }
  return html.includes(anchor);
}

function checkApp(
  name: string,
  dir: string,
  manifest: typeof oseManifest,
  files: Record<string, string>
) {
  for (const route of manifest.routes) {
    const file = files[route.name];
    if (!file) continue; // dynamic/JSON route
    test(`[static:${name}] ${route.name} — anchor + doc floor`, () => {
      const p = join(dir, file);
      assert.ok(existsSync(p), `template exists: ${p}`);
      const html = readFileSync(p, 'utf8');
      assert.ok(anchorPresent(html, route.anchor), `anchor ${route.anchor} present in ${file}`);
      assert.match(html, /<html[^>]*\slang=/, `<html lang> in ${file}`);
      assert.match(html, /<title>[^<]+<\/title>/, `<title> in ${file}`);
      assert.match(html, /name="viewport"/, `viewport meta in ${file}`);
    });
  }
}

if (OSE_TPL) checkApp('ose', OSE_TPL, oseManifest, oseFiles);
if (WKRP_TPL) checkApp('wkrp', WKRP_TPL, wkrpManifest, wkrpFiles);
if (!OSE_TPL && !WKRP_TPL) {
  test('set OSE_TPL and/or WKRP_TPL to template dirs', () => assert.ok(true));
}
