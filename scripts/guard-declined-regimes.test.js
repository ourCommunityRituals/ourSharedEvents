#!/usr/bin/env node
/**
 * guard-declined-regimes.test.js — self-tests for the OSE-1220 declined-regime
 * gate. Framework-free (mirrors guard-no-gas.test.js). Run:
 *   node scripts/guard-declined-regimes.test.js
 *
 * The gate is only trustworthy if it goes RED on a real re-entry attempt, so
 * these tests assert both directions: clean input passes, and each declined
 * shape (config > 3, positional tier-4/5 seed, tier-4/5 assignment) fails.
 */
'use strict';

const assert = require('assert');
const { scanWrangler, scanMigration, splitTuple } = require('./guard-declined-regimes.js');

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    fail++;
    console.log(`  ❌ ${name}\n     ${e.message}`);
  }
}

// ── tokenizer respects quoted commas ───────────────────────────────────────
test('splitTuple keeps commas inside quoted strings together', () => {
  const parts = splitTuple(`'etr-x', 'UEC-1', 'A name, with comma', 'desc', 1, 1, 'notes', 1`);
  assert.strictEqual(parts.length, 8, `got ${parts.length} parts: ${JSON.stringify(parts)}`);
  assert.strictEqual(parts[5].trim(), '1'); // legal_clearance_tier column
});

// ── wrangler ceiling ───────────────────────────────────────────────────────
test('wrangler ALLOWED_MAX_TIER = 3 passes', () => {
  assert.strictEqual(scanWrangler('ALLOWED_MAX_TIER = "3"', 'w').length, 0);
});
test('wrangler ALLOWED_MAX_TIER = 4 FAILS (born-red)', () => {
  assert.strictEqual(scanWrangler('ALLOWED_MAX_TIER = "4"', 'w').length, 1);
});
test('wrangler ALLOWED_MAX_TIER = 5 (unquoted) FAILS', () => {
  assert.strictEqual(scanWrangler('ALLOWED_MAX_TIER = 5', 'w').length, 1);
});

// ── migration positional seed ──────────────────────────────────────────────
const CLEAN_SEED = `INSERT INTO event_type_registry
  (id, uec_code, name, description, phase, legal_clearance_tier, regulatory_notes, is_active)
VALUES
  ('etr-rec-bocce', 'REC-BOCCE-001', 'Bocce Tournament', 'Open, all levels.', 1, 1, 'LLC + ToS only', 1),
  ('etr-trivia', 'ENT-TRIVIA-001', 'Trivia Night', 'Weeknight, no gambling.', 1, 1, 'None', 1);`;

const HIPAA_SEED = CLEAN_SEED.replace(
  "'Weeknight, no gambling.', 1, 1,",
  "'Weeknight, no gambling.', 4, 4,"
);

test('clean tier-1 event_type_registry seed passes', () => {
  assert.strictEqual(scanMigration(CLEAN_SEED, '0024.sql').length, 0);
});
test('tier-4 (HIPAA) seed FAILS (born-red)', () => {
  const v = scanMigration(HIPAA_SEED, '0099.sql');
  assert.ok(v.length >= 1, 'expected a violation for tier-4 seed');
  assert.ok(/legal_clearance_tier=4/.test(v[0]), v[0]);
});
test('tier-5 (COPPA) seed FAILS', () => {
  const coppa = CLEAN_SEED.replace(
    "'Weeknight, no gambling.', 1, 1,",
    "'Weeknight, no gambling.', 5, 5,"
  );
  const v = scanMigration(coppa, '0099.sql');
  assert.ok(v.length >= 1, 'expected a violation for tier-5 seed');
  assert.ok(/legal_clearance_tier=5/.test(v[0]), v[0]);
});

// ── direct assignment (UPDATE / DEFAULT) ───────────────────────────────────
test('UPDATE ... SET legal_clearance_tier = 4 FAILS', () => {
  assert.ok(
    scanMigration('UPDATE event_type_registry SET legal_clearance_tier = 4 WHERE id = 1;', 'm.sql')
      .length >= 1
  );
});
test('reading MAX(legal_clearance_tier) does NOT false-positive', () => {
  const sql = 'UPDATE t SET x = (SELECT MAX(r.legal_clearance_tier) FROM event_type_registry r);';
  assert.strictEqual(scanMigration(sql, 'm.sql').length, 0);
});

console.log(`\nguard-declined-regimes self-test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
