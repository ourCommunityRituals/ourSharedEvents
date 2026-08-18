#!/usr/bin/env node
/**
 * OSE-813 — detect unprovisioned binding IDs in wrangler.toml.
 *
 * A binding whose id is still a placeholder string is not a binding. It either
 * fails at deploy or resolves to nothing at runtime, and neither failure is loud.
 * OSE-544 closed the D1 placeholders; the KV ones survived because they were not
 * in that ticket's scope. This check exists so the next one cannot survive silently.
 *
 * Exit codes:
 *   0  no placeholders
 *   1  placeholders found
 *
 * Run: node scripts/check-binding-placeholders.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const toml = readFileSync(join(root, 'wrangler.toml'), 'utf8');

// Anything that looks like an instruction rather than an identifier.
const PLACEHOLDER = /^(PROVISION|TODO|REPLACE|CHANGEME|FIXME|<.*>)/i;

const findings = [];
let currentSection = '(root)';

for (const [n, raw] of toml.split(/\r?\n/).entries()) {
  const line = raw.trim();
  if (line.startsWith('#')) continue;

  const section = line.match(/^\[\[?([^\]]+)\]?\]$/);
  if (section) {
    currentSection = section[1];
    continue;
  }

  const kv = line.match(/^(id|database_id|bucket_name)\s*=\s*["']([^"']*)["']/);
  if (kv && PLACEHOLDER.test(kv[2])) {
    findings.push({ line: n + 1, section: currentSection, key: kv[1], value: kv[2] });
  }
}

if (!findings.length) {
  console.log('ok    no placeholder binding IDs in wrangler.toml');
  process.exit(0);
}

console.error('Placeholder binding IDs found — these bindings will not resolve:\n');
for (const f of findings) {
  console.error(`  wrangler.toml:${f.line}  [${f.section}]  ${f.key} = "${f.value}"`);
}
console.error(`
To provision the rate-limit namespaces:

  npx wrangler kv namespace create rate-limit-staging
  npx wrangler kv namespace create rate-limit-production

then paste each returned id over its placeholder.
`);
process.exit(1);
