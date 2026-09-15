#!/usr/bin/env node
/**
 * Fleet token-adherence gate (OSE-1328).
 *
 * ONE consistent color pattern across every served template: colors go through
 * `var(--token)` (references), never raw `#rrggbb` (hardcoded). This resolves the
 * hardcoding-vs-reference drift — a page can't be half-tokens, half-hex, because
 * the count is gated.
 *
 * RATCHET: each surface has a raw-hex CEILING (its count today). The gate fails
 * if a surface goes ABOVE its ceiling (new hardcoded hex) OR BELOW it without
 * lowering the ceiling (migration progress must tighten the baseline — no slack).
 * Fully-migrated surfaces sit at 0 and can never regress. Drive every number to 0.
 *
 * Detection mirrors @ocr/ui `checkTemplate`'s `raw-hex-color` finding (whose unit
 * tests are the canonical guard): CSS comments and `var(--token, #fallback)`
 * fallbacks are stripped first, so token-routed hex is never counted.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = join(ROOT, 'workers', 'oursharedevents', 'src', 'templates');

// Ceiling per surface. LOWER as each migrates; goal is 0 everywhere.
const BASELINE = {
  'landing.html': 0,
  'public.html': 0,
  'admin-signin.html': 0,
  'display.html': 0,
  'poster.html': 45,
  'shared-report.html': 65,
  'admin.html': 219,
};

function rawHexCount(html) {
  const css = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [])
    .join(' ')
    .replace(/\/\*[\s\S]*?\*\//g, '') // drop CSS comments
    .replace(/var\([^)]*\)/g, ''); // drop token fallbacks — hex inside var() is token-routed
  return (css.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
}

// Tokens are LOCKED in @ocr/ui — no surface redefines them via a local :root
// block. Per-brand customization comes from the [data-brand] override layer, fed
// by OSM (contracts/onboards the brand assets+config) + OA (deploys the
// white-label instance / client fork), never a hand-edited token in a template.
function redefinesTokens(html) {
  return /:root\s*\{/.test(html);
}

// Every template must appear in BASELINE — a new surface can't skip the gate.
const onDisk = readdirSync(TEMPLATES).filter((f) => f.endsWith('.html'));
let fail = false;
for (const file of onDisk) {
  if (!(file in BASELINE)) {
    console.log(`  ✗ ${file}: not in BASELINE — add it (start at its current raw-hex count).`);
    fail = true;
  }
}

for (const [file, ceiling] of Object.entries(BASELINE)) {
  const html = readFileSync(join(TEMPLATES, file), 'utf8');
  const count = rawHexCount(html);
  let note = count === 0 ? 'clean ✓' : 'at ceiling';
  if (count > ceiling) {
    note = `REGRESSION — route new colors through var(--token)`;
    fail = true;
  } else if (count < ceiling) {
    note = `migrated ${ceiling}→${count}: lower BASELINE['${file}'] to ${count}`;
    fail = true;
  }
  console.log(`${String(count).padStart(4)} / ${String(ceiling).padEnd(4)}  ${file.padEnd(20)} ${note}`);
  if (redefinesTokens(html)) {
    console.log(`  ✗ ${file}: redefines :root tokens locally — tokens are LOCKED in @ocr/ui; customize via the [data-brand] layer (OSM/OA), not here.`);
    fail = true;
  }
}

console.log('');
console.log(
  fail
    ? '✗ Token-adherence: fix the lines above (no raw hex; keep the ratchet tight).'
    : '✓ Token-adherence: one var(--token) pattern, ratchet holds across all surfaces.'
);
process.exit(fail ? 1 : 0);
