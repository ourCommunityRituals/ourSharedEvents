#!/usr/bin/env node
/**
 * guard-declined-regimes.js — OSE-1220 declined-regimes CI gate.
 *
 * HIPAA (clearance tier 4), COPPA (tier 5) and SOPPA are DECLINED regimes per
 * `OCR-docs/docs/standards/OCR_STANDARD_declinedRegimes.md`. Declining them is
 * only real if a build cannot re-enter them. This guard makes re-entry loud:
 *
 *   1. wrangler.toml must not set `ALLOWED_MAX_TIER` above 3. The runtime
 *      `resolveAllowedMaxTier` clamps to 3 regardless, but a config that asks
 *      for 4/5 is a stated intent to enter a declined regime and fails the build.
 *   2. No migration may seed an `event_type_registry` row (or UPDATE a tier)
 *      with `legal_clearance_tier >= 4`. A seeded tier-4/5 event type is the
 *      exact trigger that would make `phaseToPool` reach for a declined pool.
 *
 * Framework-free (mirrors guard-no-gas.js). Exit 0 = clean, 1 = violation.
 * Run: `node scripts/guard-declined-regimes.js [--worker <dir>]`
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DECLINED_MAX_TIER = 3;
const STANDARD = 'docs/standards/OCR_STANDARD_declinedRegimes.md (OSE-1220)';

/** Scan a wrangler.toml body for ALLOWED_MAX_TIER settings above the ceiling. */
function scanWrangler(text, label) {
  const violations = [];
  const re = /ALLOWED_MAX_TIER\s*=\s*"?(\d+(?:\.\d+)?)"?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const val = Number(m[1]);
    if (Number.isFinite(val) && val > DECLINED_MAX_TIER) {
      violations.push(
        `${label}: ALLOWED_MAX_TIER=${val} exceeds the declined-regime ceiling ` +
          `(${DECLINED_MAX_TIER}). Tiers 4 (HIPAA) / 5 (COPPA) are declined — ${STANDARD}.`
      );
    }
  }
  return violations;
}

/** Split a VALUES tuple body on TOP-LEVEL commas, respecting '...' string
 *  literals (SQLite escapes an inner quote as ''). */
function splitTuple(body) {
  const parts = [];
  let cur = '';
  let inStr = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      cur += c;
      if (c === "'") {
        if (body[i + 1] === "'") {
          cur += "'";
          i++;
        } else {
          inStr = false;
        }
      }
    } else if (c === "'") {
      inStr = true;
      cur += c;
    } else if (c === ',') {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  parts.push(cur.trim());
  return parts;
}

/** Extract each top-level ( ... ) group from a VALUES block, respecting quotes. */
function extractTuples(block) {
  const tuples = [];
  let depth = 0;
  let cur = '';
  let inStr = false;
  for (let i = 0; i < block.length; i++) {
    const c = block[i];
    if (inStr) {
      cur += c;
      if (c === "'") {
        if (block[i + 1] === "'") {
          cur += "'";
          i++;
        } else {
          inStr = false;
        }
      }
      continue;
    }
    if (c === "'") {
      inStr = true;
      cur += c;
      continue;
    }
    if (c === '(') {
      depth++;
      if (depth === 1) {
        cur = '';
        continue;
      }
    }
    if (c === ')') {
      depth--;
      if (depth === 0) {
        tuples.push(cur);
        cur = '';
        continue;
      }
    }
    if (depth >= 1) cur += c;
  }
  return tuples;
}

/** Scan one migration's SQL for a declined tier seeded into event_type_registry. */
function scanMigration(sql, label) {
  const violations = [];

  // (a) Positional INSERT INTO event_type_registry (...) VALUES (...), (...);
  const insertRe =
    /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+event_type_registry\s*\(([^)]*)\)\s*VALUES\s*([\s\S]*?);/gi;
  let m;
  while ((m = insertRe.exec(sql)) !== null) {
    const cols = m[1].split(',').map((s) => s.trim().replace(/["`]/g, '').toLowerCase());
    const idx = cols.indexOf('legal_clearance_tier');
    if (idx === -1) continue;
    for (const tuple of extractTuples(m[2])) {
      const vals = splitTuple(tuple);
      const tier = Number((vals[idx] || '').replace(/['"]/g, '').trim());
      if (Number.isFinite(tier) && tier >= 4) {
        violations.push(
          `${label}: seeds event_type_registry with legal_clearance_tier=${tier} — ` +
            `tiers 4 (HIPAA) / 5 (COPPA) are declined regimes and must not be seeded. ${STANDARD}.`
        );
      }
    }
  }

  // (b) Direct assignment (UPDATE ... SET legal_clearance_tier = 4/5, or DEFAULT).
  const assignRe = /legal_clearance_tier\s*(?:=|DEFAULT)\s*([0-9]+)/gi;
  while ((m = assignRe.exec(sql)) !== null) {
    const tier = Number(m[1]);
    if (Number.isFinite(tier) && tier >= 4) {
      violations.push(
        `${label}: assigns legal_clearance_tier=${tier} — tiers 4 (HIPAA) / 5 (COPPA) ` +
          `are declined regimes. ${STANDARD}.`
      );
    }
  }

  return violations;
}

function run(workerDir) {
  const violations = [];

  const wrangler = path.join(workerDir, 'wrangler.toml');
  if (fs.existsSync(wrangler)) {
    violations.push(...scanWrangler(fs.readFileSync(wrangler, 'utf8'), path.basename(wrangler)));
  }

  const migDir = path.join(workerDir, 'migrations');
  if (fs.existsSync(migDir)) {
    for (const f of fs
      .readdirSync(migDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      violations.push(...scanMigration(fs.readFileSync(path.join(migDir, f), 'utf8'), f));
    }
  }

  return violations;
}

module.exports = { scanWrangler, scanMigration, splitTuple, extractTuples, run };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const wi = argv.indexOf('--worker');
  const workerDir =
    wi !== -1 && argv[wi + 1]
      ? path.resolve(argv[wi + 1])
      : path.resolve(__dirname, '..', 'workers', 'oursharedevents');

  const violations = run(workerDir);
  if (violations.length > 0) {
    console.error('❌ Declined-regime violations (OSE-1220):\n');
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      '\nHIPAA/COPPA/SOPPA are declined regimes. Serve health-/child-/student-\n' +
        'adjacent contexts in the general pool via item-tracking instead.'
    );
    process.exit(1);
  }
  console.log('✅ guard-declined-regimes: no HIPAA/COPPA tier-4/5 seeds or config above tier 3.');
}
