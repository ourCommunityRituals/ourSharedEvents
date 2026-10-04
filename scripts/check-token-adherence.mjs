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
  // poster.html: screen chrome fully tokenised; the remaining 6 are @media-print
  // PAPER colors (white paper / dark ink, theme-invariant) that have no semantic
  // token today. Closing them to 0 is the print-token follow-up: teach @ocr/ui
  // /ui.css an `@media print { :root { <light tokens> } }` so print is paper by
  // construction, then this block tokenises. Tracked; do not "fix" by tokenising
  // print to theme-flipping vars (that risks dark-on-dark printed posters).
  'poster.html': 6,
  // shared-report.html: chrome fully tokenised; the remaining 8 are the
  // status/tier BADGE hues (tier mid blue, tier enterprise purple, checkin-bar
  // green; .badge.active is on --success since OSE-1395) — meaning-carrying like UEC,
  // no @ocr/ui token today — plus 3 @media-print paper colors. Closing them is a
  // pending design decision (add status/tier tokens vs. treat as theme-invariant
  // status hues), informed by the QR/customization research.
  'shared-report.html': 8,
  // admin.html: chrome converted in priority order (accent, neutral text/border/
  // surface, validation-red → --error): 219 → 98; then OSE-1328 retired the five
  // per-surface surface-card left-border hexes (#6c757d/#d97706/#4361ee/#16a34a/
  // #7c3aed) as those cards adopted the uniform token-driven .card: 98 → 93; then
  // card 2 (forms-card) took the anatomy and its `.form-link:hover` #e9ecef → var(--surface-hover): 93 → 92; then
  // card 3 (poster-deployments) took the anatomy + `.add-spon-btn:hover` #3a56d4 → var(--accent-hover): 92 → 91. The remaining 91 are the
  // status/SEMANTIC palette (tier + phase badges, green-success #16a34a family,
  // red/amber/info alert-banner TINTS), white-on-accent button text (color:#fff —
  // no --on-accent token), a few mixed-context grays, and one JS-string print-
  // window color (#555 @ ~4254, which has no /ui.css and MUST stay hex). Closing
  // these needs the STATUS/TIER TOKEN decision (add --success/--on-accent/tier +
  // warn/info tint tokens to @ocr/ui vs. treat as theme-invariant status hues) —
  // admin's rich palette is the strongest driver of that decision. Chrome done.
  // Then the theme-parity pass (rendered audit 2026-09-29) routed the light-only
  // fills that vanished in dark — wizard selected option (OSE-1340), tier/phase
  // badges, .badge.active, copy/Generate-Link, card-error, warning banner,
  // selected row, silver tier pill, #16a34a success family, white-on-accent text —
  // through --success / --warn / --info / --on-accent / --surface*: 90 → 30. The
  // 30 left are fixed light-fill/dark-ink pairs (phase 2-5 badges, sponsor tier
  // pills, pips, lock overlay, spon-edit-ctx) that read in both themes, the
  // decorative skeleton shimmer, two #fff overridden by the token block below
  // (th, .skip-link:focus), and the print-window #555. OSE-1361 moved the
  // forms upsell (was the tan per-row lock overlay) onto --surface-hover /
  // --border: 30 -> 28.
  'admin.html': 28,
  // sponsor-home.html (Epic TRIANGLE, PR #567): born fully tokenised — status
  // pills route to --success / --warn / --info / --accent with var(--bg) inverse
  // text (all AA-verified by the hub @ocr/ui verify-contrast.mjs), messages to
  // --success / --danger, left-border accents to --warn. Zero raw hex; keep at 0.
  'sponsor-home.html': 0,
  // sponsor-card.html (0083): the public sponsor card — /ui.css classes plus a
  // sub-400-char page style on tokens. Zero raw hex; keep at 0.
  'sponsor-card.html': 0,
  // admin-logs.html / admin-settings.html: the admin Logs and Settings screens —
  // /ui.css classes plus a sub-400-char page style on tokens. Zero raw hex; keep at 0.
  'admin-logs.html': 0,
  'admin-settings.html': 0,
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
