#!/usr/bin/env node
/**
 * Mutation runner — catalog-driven, no new dependency.
 *
 *   node scripts/mutate.mjs [--only <substr>] [--json]
 *
 * For each mutant: back up the module, apply one textual change, run the specs
 * named for it, restore. A mutant that SURVIVES is a claim the suite does not
 * check. "Born-red" already asks that per-test by hand; this asks it in bulk.
 *
 * Scoped deliberately to pure, invariant-critical modules with fast specs. It is
 * not a coverage tool and should not be run across the whole Worker.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const onlyIx = args.indexOf('--only');
const only = onlyIx > -1 ? args[onlyIx + 1] : null;
const asJson = args.includes('--json');

/**
 * The catalog. Each mutant states the invariant it attacks, so a survivor reads
 * as a missing assertion rather than a curiosity.
 */
const MUTANTS = [
  // ── QR encoder — the poster spine ─────────────────────────────────────────
  { id: 'qr-size-formula', module: 'src/lib/qr.ts', specs: ['tests/qr-roundtrip.spec.ts'],
    attacks: 'QR module grid size (17 + 4v) — wrong size = unscannable',
    find: 'return 17 + version * 4;', replace: 'return 17 + version * 5;' },
  { id: 'qr-alignment-threshold', module: 'src/lib/qr.ts', specs: ['tests/qr-roundtrip.spec.ts'],
    attacks: 'alignment pattern drawn only for version >= 2',
    find: 'if (version >= 2) drawAlignment', replace: 'if (version >= 3) drawAlignment' },
  { id: 'qr-codeword-adjust', module: 'src/lib/qr.ts', specs: ['tests/qr-roundtrip.spec.ts'],
    // SURVIVES legitimately: mutates v7 capacity, and v7 is inside the still-broken
    // high-version range (see the OSE-1127 follow-up). Unkillable until that lands.
    attacks: 'total codeword count at v7 — blocked by the unfixed high-version range',
    find: 'const TOTAL_CODEWORDS: readonly number[] = [0, 26, 44, 70, 100, 134, 172, 196];', replace: 'const TOTAL_CODEWORDS: readonly number[] = [0, 26, 44, 70, 100, 134, 172, 197];' },
  { id: 'qr-ec-level-bits', module: 'src/lib/qr.ts', specs: ['tests/qr-roundtrip.spec.ts'],
    attacks: 'format bits: EC level shifted into place',
    find: 'const EC_FORMAT_INDICATOR: readonly number[] = [1, 0, 3, 2];', replace: 'const EC_FORMAT_INDICATOR: readonly number[] = [0, 1, 2, 3];' },

  // ── Shortlinks ────────────────────────────────────────────────────────────
  { id: 'sl-code-length', module: 'src/lib/shortlinks.ts', specs: ['tests/shortlinks.spec.ts'],
    attacks: 'code length 6 — collision math and shape validation both assume it',
    find: 'const CODE_LEN = 6;', replace: 'const CODE_LEN = 5;' },
  { id: 'sl-shape-length-check', module: 'src/lib/shortlinks.ts', specs: ['tests/shortlinks.spec.ts'],
    attacks: 'isValidCodeShape rejects wrong-length codes before hitting D1',
    find: 'if (typeof code !== \'string\' || code.length !== CODE_LEN) return false;',
    replace: 'if (typeof code !== \'string\') return false;' },
  { id: 'sl-shape-charset', module: 'src/lib/shortlinks.ts', specs: ['tests/shortlinks.spec.ts'],
    attacks: 'base62 charset guard — stops probing with garbage',
    find: 'if (!BASE62_ALPHABET.includes(code[i])) return false;', replace: 'if (false) return false;' },
  { id: 'sl-collision-retry', module: 'src/lib/shortlinks.ts', specs: ['tests/shortlinks.spec.ts'],
    attacks: 'PK collision retries rather than throwing',
    find: 'const MAX_GENERATE_RETRIES = 5;', replace: 'const MAX_GENERATE_RETRIES = 1;' },
  { id: 'sl-click-increment', module: 'src/lib/shortlinks.ts', specs: ['tests/shortlinks.spec.ts'],
    attacks: 'the ONLY datum collected — the click counter actually increments',
    find: 'SET clicks = clicks + 1,', replace: 'SET clicks = clicks + 0,' },

  // ── Staleness — "a poster must never rot" ────────────────────────────────
  { id: 'stale-negation', module: 'src/lib/event-staleness.ts', specs: ['tests/qr-staleness.spec.ts'],
    attacks: 'isStaleForPublicLanding inverts canRender — drops the whole gate',
    find: "return !canRender(parseEventState(status), 'public');",
    replace: "return canRender(parseEventState(status), 'public');" },
  { id: 'stale-forward-target', module: 'src/lib/event-staleness.ts', specs: ['tests/qr-staleness.spec.ts'],
    attacks: 'fixed internal forward path — never derived from request input',
    find: "export const STALE_FORWARD_PATH = '/events';",
    replace: "export const STALE_FORWARD_PATH = '/';" },
  { id: 'stale-no-store', module: 'src/lib/event-staleness.ts', specs: ['tests/qr-staleness.spec.ts'],
    attacks: 'the stale forward must not be cached',
    find: "'Cache-Control': 'no-store',", replace: "'Cache-Control': 'public, max-age=3600'," },

  // ── Event state — the gate the whole wizard flow rests on ────────────────
  { id: 'state-draft-renderable', module: 'src/domain/event-state.ts', specs: ['tests/event-state.spec.ts'],
    attacks: 'ONLY active renders on public/display/poster',
    find: "draft: ['admin']", replace: "draft: ['admin', 'public']" },
];

const list = only ? MUTANTS.filter((m) => m.id.includes(only) || m.module.includes(only)) : MUTANTS;
const results = [];

for (const m of list) {
  const path = join(root, m.module);
  if (!existsSync(path)) { results.push({ ...m, outcome: 'MODULE_MISSING' }); continue; }
  const original = readFileSync(path, 'utf8');
  if (!original.includes(m.find)) { results.push({ ...m, outcome: 'PATTERN_MISSING' }); continue; }

  writeFileSync(path, original.replace(m.find, m.replace), 'utf8');
  let outcome;
  try {
    execSync(`npx vitest run ${m.specs.join(' ')}`, { cwd: root, stdio: 'ignore', timeout: 300000 });
    outcome = 'SURVIVED';
  } catch {
    outcome = 'killed';
  } finally {
    writeFileSync(path, original, 'utf8');
  }
  results.push({ ...m, outcome });
}

if (asJson) { console.log(JSON.stringify(results, null, 2)); process.exit(0); }

const survivors = results.filter((r) => r.outcome === 'SURVIVED');
const broken = results.filter((r) => r.outcome.endsWith('_MISSING'));

let lastModule = '';
for (const r of results) {
  if (r.module !== lastModule) { console.log(`\n${r.module}`); lastModule = r.module; }
  const tag = r.outcome === 'SURVIVED' ? 'SURVIVED' : r.outcome === 'killed' ? '  killed' : r.outcome;
  console.log(`  ${tag}  ${r.id}`);
  if (r.outcome === 'SURVIVED') console.log(`            ↳ unchecked: ${r.attacks}`);
}

console.log(`\n${results.length} mutant(s): ${results.length - survivors.length - broken.length} killed, ${survivors.length} SURVIVED.`);
if (broken.length) console.log(`${broken.length} could not run (module or pattern moved) — update the catalog.`);
if (survivors.length) {
  console.log('\nA survivor is not a bug in the code. It is a claim nothing checks.');
}
process.exit(0);
