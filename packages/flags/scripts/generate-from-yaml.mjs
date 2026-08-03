#!/usr/bin/env node
// Generates src/generated/flag-keys.ts and src/generated/presets.ts from
// OCR-docs/ocr-docs-brain/flags-contract.yaml. Fails with non-zero exit if
// --check mode detects drift. No hand-edits to generated files.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(PKG_ROOT, '..', '..');
const CONTRACT = resolve(REPO_ROOT, 'OCR-docs', 'ocr-docs-brain', 'flags-contract.yaml');
const OUT_DIR = resolve(PKG_ROOT, 'src', 'generated');
const OUT_KEYS = resolve(OUT_DIR, 'flag-keys.ts');
const OUT_PRESETS = resolve(OUT_DIR, 'presets.ts');

const checkMode = process.argv.includes('--check');

function die(msg) {
  console.error(`[generate] ${msg}`);
  process.exit(1);
}

if (!existsSync(CONTRACT)) die(`contract not found at ${CONTRACT}`);

const raw = readFileSync(CONTRACT);
const sha = createHash('sha256').update(raw).digest('hex').slice(0, 16);
const doc = yaml.load(raw.toString('utf8'));

if (!doc?.flag_keys) die('contract missing flag_keys section');
if (!doc?.tier_presets) die('contract missing tier_presets section');

// Flatten flag_keys domains into a sorted list of keys.
const keys = [];
for (const [domain, entries] of Object.entries(doc.flag_keys)) {
  for (const [key, meta] of Object.entries(entries)) {
    keys.push({ key, domain, description: meta.description ?? '' });
  }
}
keys.sort((a, b) => a.key.localeCompare(b.key));

// Validate every key appears in every preset.
const tiers = Object.keys(doc.tier_presets);
for (const t of tiers) {
  const preset = doc.tier_presets[t]?.flags ?? {};
  for (const { key } of keys) {
    if (!(key in preset)) die(`tier_presets.${t}.flags missing '${key}'`);
    if (typeof preset[key] !== 'boolean') {
      die(`tier_presets.${t}.flags['${key}'] must be boolean, got ${typeof preset[key]}`);
    }
  }
  for (const k of Object.keys(preset)) {
    if (!keys.find((x) => x.key === k)) {
      die(`tier_presets.${t}.flags['${k}'] has no matching flag_keys entry`);
    }
  }
}

// Render flag-keys.ts
const keysModule = [
  '// AUTO-GENERATED from OCR-docs/ocr-docs-brain/flags-contract.yaml',
  `// CONTRACT_SHA: ${sha}`,
  '// DO NOT EDIT. Run `pnpm generate` to regenerate.',
  '',
  'export const FLAG_KEYS = {',
  ...keys.map(({ key }) => {
    const constName = key.toUpperCase().replace(/[.-]/g, '_');
    return `  ${constName}: ${JSON.stringify(key)},`;
  }),
  '} as const;',
  '',
  'export type FlagKey = (typeof FLAG_KEYS)[keyof typeof FLAG_KEYS];',
  '',
  'export const ALL_FLAG_KEYS: readonly FlagKey[] = Object.freeze([',
  ...keys.map(({ key }) => `  ${JSON.stringify(key)},`),
  ']) as readonly FlagKey[];',
  '',
  'export const FLAG_KEY_DOMAIN: Readonly<Record<FlagKey, string>> = Object.freeze({',
  ...keys.map(({ key, domain }) => `  ${JSON.stringify(key)}: ${JSON.stringify(domain)},`),
  '}) as Readonly<Record<FlagKey, string>>;',
  '',
].join('\n');

// Render presets.ts
const presetsModule = [
  '// AUTO-GENERATED from OCR-docs/ocr-docs-brain/flags-contract.yaml',
  `// CONTRACT_SHA: ${sha}`,
  '// DO NOT EDIT. Run `pnpm generate` to regenerate.',
  '',
  "import type { Tier } from '../types.js';",
  "import type { FlagKey } from './flag-keys.js';",
  '',
  'export const TIER_PRESETS: Record<Tier, Readonly<Record<FlagKey, boolean>>> = Object.freeze({',
  ...tiers.flatMap((t) => {
    const preset = doc.tier_presets[t].flags;
    const sortedKeys = keys.map((k) => k.key).sort();
    return [
      `  ${t}: Object.freeze({`,
      ...sortedKeys.map((k) => `    ${JSON.stringify(k)}: ${preset[k]},`),
      '  }),',
    ];
  }),
  '}) as Record<Tier, Readonly<Record<FlagKey, boolean>>>;',
  '',
].join('\n');

if (checkMode) {
  const existsKeys = existsSync(OUT_KEYS) ? readFileSync(OUT_KEYS, 'utf8') : '';
  const existsPresets = existsSync(OUT_PRESETS) ? readFileSync(OUT_PRESETS, 'utf8') : '';
  if (existsKeys !== keysModule || existsPresets !== presetsModule) {
    console.error('[generate] drift detected. Run `pnpm generate` and commit.');
    process.exit(1);
  }
  console.log('[generate] check OK');
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_KEYS, keysModule, 'utf8');
writeFileSync(OUT_PRESETS, presetsModule, 'utf8');
console.log(`[generate] wrote ${OUT_KEYS}`);
console.log(`[generate] wrote ${OUT_PRESETS}`);
console.log(`[generate] CONTRACT_SHA=${sha}`);
