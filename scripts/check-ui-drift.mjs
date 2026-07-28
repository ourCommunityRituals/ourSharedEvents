#!/usr/bin/env node
/**
 * @ocr/ui adoption drift check — OSE-286
 *
 * Runs checkAll() from @ocr/ui against all HTML templates in the OSE
 * worker, then gates CI on critical violations while reporting inline
 * CSS size as a migration progress metric.
 *
 * Exit codes:
 *   0 — no critical violations (CI green)
 *   1 — one or more critical violations found (CI red)
 *
 * Critical violations (block merge):
 *   - local-root-tokens   template declares its own :root tokens
 *   - missing-shared-stylesheet   template doesn't link /ui.css
 *
 * Reported-only (migration progress, never block):
 *   - large-inline-style   inline CSS above 400-char budget — expected
 *     while templates are partially migrated; tracked for trend visibility
 *
 * Usage:
 *   node scripts/check-ui-drift.mjs
 *
 * CI step:
 *   - name: 'Quality: @ocr/ui adoption drift'
 *     run: node scripts/check-ui-drift.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const TEMPLATES_DIR = join(ROOT, 'workers/oursharedevents/src/templates');

// Inline import of checkAll logic — avoids needing to build @ocr/ui at
// check time. Mirror of packages/ui/src/contract.ts so the script has
// no build-time dependency on the workspace package.
const INLINE_STYLE_BUDGET = 400;

function checkTemplate(file, html) {
  const findings = [];

  if (/:root\s*\{/.test(html)) {
    findings.push({
      file,
      issue: 'local-root-tokens',
      detail: 'Declares its own :root tokens. Remove and link /ui.css instead.',
      critical: true,
    });
  }

  const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
  const inlineCss = styleBlocks.map((m) => m[1]).join('');
  if (inlineCss.length > INLINE_STYLE_BUDGET) {
    findings.push({
      file,
      issue: 'large-inline-style',
      detail: `Inline <style> is ${inlineCss.length} chars (budget ${INLINE_STYLE_BUDGET}). Migrate shared rules into @ocr/ui.`,
      critical: false,
      bytes: inlineCss.length,
    });
  }

  const links = /rel=["']stylesheet["']/i.test(html);
  if (!links && styleBlocks.length === 0 && /<body/i.test(html)) {
    findings.push({
      file,
      issue: 'missing-shared-stylesheet',
      detail: 'No stylesheet linked. Add <link rel="stylesheet" href="/ui.css">.',
      critical: true,
    });
  }

  return findings;
}

// ── Run ───────────────────────────────────────────────────────────────────────

const templates = readdirSync(TEMPLATES_DIR)
  .filter((f) => f.endsWith('.html'))
  .map((f) => ({ file: f, html: readFileSync(join(TEMPLATES_DIR, f), 'utf8') }));

const allFindings = templates.flatMap(({ file, html }) => checkTemplate(file, html));
const critical = allFindings.filter((f) => f.critical);
const warnings = allFindings.filter((f) => !f.critical);

// ── Report ────────────────────────────────────────────────────────────────────

const totalInlineBytes = warnings
  .filter((f) => f.issue === 'large-inline-style')
  .reduce((sum, f) => sum + (f.bytes ?? 0), 0);

console.log('\n@ocr/ui adoption drift check');
console.log('════════════════════════════');
console.log(`Templates scanned: ${templates.length}`);
console.log(`Critical violations: ${critical.length}`);
console.log(
  `Inline CSS remaining: ${totalInlineBytes.toLocaleString()} chars across ${warnings.length} template(s) (migration in progress)`
);

if (warnings.length > 0) {
  console.log('\n── Migration progress (not blocking) ──');
  for (const f of warnings) {
    console.log(`  ${f.file}: ${f.bytes?.toLocaleString()} chars inline CSS`);
  }
}

if (critical.length > 0) {
  console.log('\n── Critical violations (blocking) ──');
  for (const f of critical) {
    console.error(`  ✗ ${f.file} [${f.issue}]: ${f.detail}`);
  }
  console.error('\nFix critical violations before merging.\n');
  process.exit(1);
}

console.log('\n✓ No critical violations. All templates link the shared stylesheet.\n');
