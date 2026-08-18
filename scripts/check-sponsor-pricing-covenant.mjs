#!/usr/bin/env node
/**
 * check-sponsor-pricing-covenant.mjs  (OSE-883 / OSE-809)
 *
 * L1 static prose-conformance guard — tests the DOC against the invariant
 * CONSTITUTION. `docs/features/SPONSOR-PRICING.md` is the sponsor-facing
 * description of the commercial surface; Invariant #25 (Sponsor Share Covenant,
 * status `live`) governs what that surface may sell.
 *
 * #25 (ocr-docs-brain/architectural-invariants.yaml, canonical) states:
 *   "Money buys frequency-share and report depth only — never size, slot,
 *    position, or is_local status. Size, slot, and logo treatment are uniform
 *    for all sponsors regardless of spend."
 *
 * The brain YAML is NOT vendored into the OSE checkout (the OSE-336 drift-check
 * spec models canonical values inline for the same reason), so this guard
 * encodes #25's forbidden set inline and cites the brain as the source of
 * truth. If #25 changes, update FORBIDDEN/REQUIRED here in the same PR.
 *
 * FAILS (exit 1) when the doc makes an affirmative claim that spend buys size,
 * slot, position, dwell, or visible rank — the exact set OSE-809 removed and
 * that a future edit could silently re-introduce. Green when the doc matches
 * the brain; red the moment a size/slot/position/dwell claim reappears.
 *
 * Runs in the T0 Gate `lint` shard (root deps only), beside check-banned-origins.
 *
 * Usage: node scripts/check-sponsor-pricing-covenant.mjs [path-to-doc]
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOC_PATH = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(REPO_ROOT, 'docs/features/SPONSOR-PRICING.md');

// ── #25 forbidden set — affirmative violation signatures ────────────────────
// High-precision: each pattern only appears in the doc when spend is being sold
// a forbidden attribute. Negations ("No tier badge", "no size/slot meaning"),
// the #25 quote block, the "Not purchasable" column, the physical-poster slot,
// and the Change log are excluded below so they never false-positive.
const FORBIDDEN = [
  {
    id: 'size-by-tier',
    clause: '#25: logo treatment is uniform regardless of spend',
    re: /\b1\.[46]x\b/,
    hint: 'per-tier logo size multiplier (e.g. "1.6x logo on headers")',
  },
  {
    id: 'placement-by-tier',
    clause: '#25: slot/position is not purchasable',
    re: /\b(Display|Public)\s+Placement\b/,
    hint: 'per-class placement table column (class → header/sidebar)',
  },
  {
    id: 'dwell-by-tier',
    clause: '#25: dwell is uniform for all sponsors',
    re: /(more|longer)\s+dwell\s+time|premium sponsors get longer dwell|dwellMs`?\s*(override|overrides)/i,
    hint: 'buying longer dwell / per-sponsor dwell override',
  },
  {
    id: 'slot-counts-for-sale',
    clause: '#25: slot is not purchasable',
    re: /package slot counts/i,
    hint: 'selling package slot counts (e.g. "3/5/9")',
  },
  {
    id: 'rank-badge-for-sale',
    clause: '#25: visible rank is not purchasable',
    re: /tier badge shown|primary sponsor badge/i,
    hint: 'visible tier/primary-sponsor badge',
  },
];

// ── Required covenant anchors — the doc cannot be gutted of #25's guarantees ──
const REQUIRED = [
  { id: 'premium-cap', re: /premium_cap_pct/, name: 'WALL 1 (premium_cap_pct)' },
  { id: 'local-floor', re: /local_floor_pct/, name: 'WALL 2 (local_floor_pct)' },
  { id: 'frequency-share', re: /frequency-share/i, name: 'frequency-share as the purchasable axis' },
  { id: 'two-buyables', re: /##\s*The two things money can buy/i, name: 'the "two things money can buy" covenant framing' },
];

function stripExcludedRegions(lines) {
  // Return [{ n, text }] for lines that are subject to the forbidden scan,
  // excluding regions where forbidden tokens legitimately appear.
  const kept = [];
  let inQuote = false; // the #25 blockquote
  let inChangeLog = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s+Change log/i.test(line)) inChangeLog = true; // everything after is history
    if (inChangeLog) continue;
    // The #25 quotation itself (a `>` blockquote near the top) quotes the
    // forbidden words verbatim — skip blockquote lines.
    if (/^\s*>/.test(line)) continue;
    // The "| Purchasable | Not purchasable |" table names the forbidden set to
    // deny it — skip rows that contain a "not purchasable"-style negation.
    if (/not purchasable|never (a )?purchasable|no tier badge|no primary-sponsor|no size, slot|carries no size/i.test(line)) continue;
    kept.push({ n: i + 1, text: line });
  }
  return kept;
}

function main() {
  let raw;
  try {
    raw = readFileSync(DOC_PATH, 'utf8');
  } catch (e) {
    console.error(`check-sponsor-pricing-covenant: cannot read ${DOC_PATH}\n  ${e.message}`);
    process.exit(2);
  }
  const lines = raw.split(/\r?\n/);
  const scan = stripExcludedRegions(lines);

  const violations = [];
  for (const { n, text } of scan) {
    for (const f of FORBIDDEN) {
      if (f.re.test(text)) {
        violations.push({ n, id: f.id, clause: f.clause, hint: f.hint, text: text.trim() });
      }
    }
  }

  const missing = REQUIRED.filter((r) => !r.re.test(raw));

  if (violations.length === 0 && missing.length === 0) {
    console.log('✓ SPONSOR-PRICING.md conforms to Invariant #25 (no size/slot/position/dwell/rank sold; covenant anchors present).');
    process.exit(0);
  }

  console.error('✗ SPONSOR-PRICING.md violates Invariant #25 (Sponsor Share Covenant).\n');
  if (violations.length) {
    console.error('  Forbidden claims — spend cannot buy these (brain #25):');
    for (const v of violations) {
      console.error(`    ${DOC_PATH.replace(REPO_ROOT + '/', '')}:${v.n}  [${v.id}] ${v.hint}`);
      console.error(`        → ${v.clause}`);
      console.error(`        | ${v.text}`);
    }
    console.error('');
  }
  if (missing.length) {
    console.error('  Missing required covenant anchors — the doc must state #25\'s guarantees:');
    for (const m of missing) console.error(`    - ${m.name}`);
    console.error('');
  }
  console.error('  Fix: reconcile the doc to ocr-docs-brain/architectural-invariants.yaml #25.');
  console.error('  Money buys frequency-share and report depth ONLY — never size, slot, position, dwell, or rank.');
  process.exit(1);
}

main();
