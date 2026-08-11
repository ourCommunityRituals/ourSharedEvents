#!/usr/bin/env node
/**
 * check-conformance-gaps.js — turn the conformance gap check into a real gate.
 *
 * Reads the set of DETECTED conformance gaps (invariant ids that render as
 * "❌ Gap" in the conformance report) and the gap allowlist. Fails (exit 1) if:
 *   - any detected gap is NOT allow-listed, OR
 *   - any allowlist entry whose invariant is currently a detected gap is past
 *     its expiry relative to the supplied --today.
 * Otherwise exits 0.
 *
 * CLOCK-NEUTRAL BY DESIGN: this script never reads the system clock. "Today"
 * MUST be supplied via --today YYYY-MM-DD so the gate is deterministic and
 * testable. If --today is missing, the script errors (exit 2) rather than
 * guessing.
 *
 * Usage:
 *   node check-conformance-gaps.js --today 2026-08-11 \
 *     [--allowlist <path>] \
 *     [--gaps 663,662] \
 *     [--conformance-json <path>] \
 *     [--gaps-file <path>]
 *
 * Gap sources (first non-empty wins):
 *   1. --gaps            comma-separated invariant ids (CLI)
 *   2. --gaps-file       a file: JSON array, or newline/comma-separated ids
 *   3. --conformance-json  the generated conformance.json; gaps are
 *                          invariants[].id where enforcement_status === 'gap'
 *
 * Exit codes:
 *   0  all detected gaps allow-listed and unexpired
 *   1  gate failure (un-allowlisted gap and/or expired waiver)
 *   2  usage / input error
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── arg parsing ─────────────────────────────────────────────────────────────
function getArg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(2);
}

// ─── date helpers (string comparison only, no Date/clock) ────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function assertDate(value, label) {
  if (typeof value !== 'string' || !DATE_RE.test(value.trim())) {
    fail(`${label} must be a YYYY-MM-DD date, got: ${JSON.stringify(value)}`);
  }
  return value.trim();
}
// ISO YYYY-MM-DD sorts lexicographically === chronologically.
function isPastExpiry(today, expiry) {
  return today > expiry;
}

// ─── minimal YAML reader for the allowlist shape ─────────────────────────────
// Supports exactly the fixture's structure: a top-level `allowlist:` list of
// mappings with scalar keys. No external deps (js-yaml is not installed).
function parseAllowlist(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  let inList = false;
  let current = null;

  const stripComment = (s) => {
    // Remove trailing comments not inside quotes (keys/values here never use #).
    const hash = s.indexOf(' #');
    return hash === -1 ? s : s.slice(0, hash);
  };
  const unquote = (v) => {
    let t = v.trim();
    if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
      t = t.slice(1, -1);
    }
    return t;
  };

  for (const rawLine of lines) {
    const line = stripComment(rawLine).replace(/\s+$/, '');
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    if (/^allowlist:\s*$/.test(line)) {
      inList = true;
      continue;
    }
    if (!inList) continue;

    const itemMatch = line.match(/^(\s*)-\s+(.*)$/);
    if (itemMatch) {
      // New list item.
      if (current) entries.push(current);
      current = {};
      const rest = itemMatch[2];
      const kv = rest.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
      if (kv) current[kv[1]] = unquote(kv[2]);
      continue;
    }

    const kvMatch = line.match(/^\s+([A-Za-z0-9_]+):\s*(.*)$/);
    if (kvMatch && current) {
      current[kvMatch[1]] = unquote(kvMatch[2]);
      continue;
    }
  }
  if (current) entries.push(current);
  return entries;
}

// ─── gap detection sources ───────────────────────────────────────────────────
function normalizeId(v) {
  return String(v).trim();
}

function readDetectedGaps() {
  const gapsArg = getArg('--gaps');
  if (gapsArg !== undefined) {
    return gapsArg
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(normalizeId);
  }

  const gapsFile = getArg('--gaps-file');
  if (gapsFile) {
    const raw = fs.readFileSync(gapsFile, 'utf8').trim();
    if (raw === '') return [];
    if (raw.startsWith('[')) {
      const arr = JSON.parse(raw);
      return arr.map(normalizeId);
    }
    return raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(normalizeId);
  }

  const conf = getArg('--conformance-json');
  if (conf) {
    const data = JSON.parse(fs.readFileSync(conf, 'utf8'));
    const invs = Array.isArray(data.invariants) ? data.invariants : [];
    return invs.filter((i) => i.enforcement_status === 'gap').map((i) => normalizeId(i.id));
  }

  fail('no gap source supplied — pass one of --gaps, --gaps-file, or --conformance-json');
  return [];
}

// ─── main ────────────────────────────────────────────────────────────────────
function main() {
  const today = assertDate(getArg('--today'), '--today');

  const allowlistPath =
    getArg('--allowlist') ||
    path.join(__dirname, '..', 'tests', 'fixtures', 'conformance-gap-allowlist.yaml');

  if (!fs.existsSync(allowlistPath)) {
    fail(`allowlist not found at ${allowlistPath}`);
  }

  const rawAllow = fs.readFileSync(allowlistPath, 'utf8');
  const entries = parseAllowlist(rawAllow);

  // Validate + index allowlist by invariant id.
  const byId = new Map();
  for (const e of entries) {
    if (e.invariant === undefined || e.invariant === '') {
      fail(`allowlist entry missing 'invariant': ${JSON.stringify(e)}`);
    }
    if (!e.expiry) {
      fail(`allowlist entry for invariant ${e.invariant} missing 'expiry'`);
    }
    assertDate(e.expiry, `expiry for invariant ${e.invariant}`);
    byId.set(normalizeId(e.invariant), e);
  }

  const detected = readDetectedGaps();

  console.log(`Conformance gap gate — today=${today}`);
  console.log(`  Allowlist: ${allowlistPath} (${byId.size} entr${byId.size === 1 ? 'y' : 'ies'})`);
  console.log(`  Detected gaps: ${detected.length ? detected.join(', ') : '(none)'}`);

  const failures = [];

  for (const id of detected) {
    const entry = byId.get(id);
    if (!entry) {
      failures.push(
        `invariant #${id}: conformance GAP is not allow-listed — close it or add an entry (with blocking_ticket + expiry) to ${path.basename(allowlistPath)}`
      );
      continue;
    }
    if (isPastExpiry(today, entry.expiry)) {
      failures.push(
        `invariant #${id}: allowlist waiver EXPIRED on ${entry.expiry} (today ${today}) — blocking_ticket ${entry.blocking_ticket || '(none)'} : re-triage the gap`
      );
      continue;
    }
    console.log(
      `  OK  invariant #${id}: allow-listed until ${entry.expiry} (ticket ${entry.blocking_ticket || 'n/a'})`
    );
  }

  if (failures.length > 0) {
    console.error('\nConformance gap gate FAILED:');
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }

  console.log('\nConformance gap gate PASSED — all detected gaps allow-listed and unexpired.');
  process.exit(0);
}

main();
