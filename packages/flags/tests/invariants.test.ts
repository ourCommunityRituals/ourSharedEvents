/**
 * Vision invariant tests for the flags contract.
 *
 * Honors OCR_VISION_v2.md §6.2 expectations for any product that touches
 * flag-gated behavior:
 *
 *   - Invariant 5 (Tier Equity / Pricing Governance): pricing tiers govern
 *     display priority only — never platform access. Same QR, same form
 *     quality, same privacy protection at every tier. Local stays in at
 *     all flag levels. Free/Mid/Enterprise all exist.
 *
 *   - Invariant 6 (Inert Monetization Hooks): no billing logic executes
 *     in platform code. The @ocr/flags package is boolean storage only —
 *     no payment SDKs, no price fields, no monetization hooks in the
 *     package surface.
 *
 *   - Invariant 10 (Deprecation Lock): the contract declares
 *     deprecation_lock as an invariant dependency so removing a flag key
 *     requires deliberate migration.
 *
 * These tests parse the Brain contract YAML directly so a drift between
 * code and Brain fails CI here, not in production.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(PKG_ROOT, '..', '..');
const CONTRACT_PATH = resolve(REPO_ROOT, 'OCR-docs', 'ocr-docs-brain', 'flags-contract.yaml');

type Preset = Record<string, boolean>;
type Contract = {
  schema_version: string;
  flag_keys: Record<string, Record<string, { description?: string }>>;
  tier_presets: Record<string, { description?: string; flags: Preset }>;
  invariant_dependencies?: Record<string, unknown>;
  value_type?: { allowed: string[] };
  axes?: { sponsor_pricing?: { values: string[] }; flag_presets?: { values: string[] } };
};

function loadContract(): Contract | null {
  if (!existsSync(CONTRACT_PATH)) return null;
  return yaml.load(readFileSync(CONTRACT_PATH, 'utf8')) as Contract;
}

describe('OCR_VISION_v2 Invariant 5 — Tier Equity / Pricing Governance', () => {
  const contract = loadContract();

  it('Brain contract is reachable (OCR-docs sibling repo must be present)', () => {
    expect(contract, `flags-contract.yaml not found at ${CONTRACT_PATH}`).not.toBeNull();
  });

  if (!contract) return;

  it('all three flag-preset levels exist: free, mid, enterprise', () => {
    expect(Object.keys(contract.tier_presets).sort()).toEqual(['enterprise', 'free', 'mid']);
  });

  it('sponsor pricing axis and flag preset axis are declared separately', () => {
    expect(contract.axes?.sponsor_pricing?.values).toEqual(['local', 'mid', 'premium']);
    expect(contract.axes?.flag_presets?.values).toEqual(['free', 'mid', 'enterprise']);
  });

  it('free tier preserves baseline platform access (register + checkin + json export)', () => {
    const free = contract.tier_presets.free!.flags;
    expect(free['forms.register']).toBe(true);
    expect(free['forms.checkin']).toBe(true);
    expect(free['report.export-json']).toBe(true);
  });

  it('every tier preset enumerates every flag key (no preset strips keys)', () => {
    const allKeys: string[] = [];
    for (const entries of Object.values(contract.flag_keys)) {
      for (const key of Object.keys(entries)) allKeys.push(key);
    }
    for (const [tier, preset] of Object.entries(contract.tier_presets)) {
      const missing = allKeys.filter((k) => !(k in preset.flags));
      expect(missing, `tier ${tier} missing ${missing.length} keys`).toEqual([]);
    }
  });

  it('faith-organization free-marketing flag is declared for tier-equity enforcement', () => {
    const events = contract.flag_keys.events ?? {};
    expect(Object.keys(events)).toEqual(
      expect.arrayContaining([
        'events.faith-free-marketing',
        'events.faith-sponsor',
        'events.adult-only',
      ])
    );
  });

  it('contract invariant_dependencies include tier_equity', () => {
    expect(contract.invariant_dependencies).toBeDefined();
    expect(Object.keys(contract.invariant_dependencies!)).toEqual(
      expect.arrayContaining(['tier_equity'])
    );
  });
});

describe('OCR_VISION_v2 Invariant 6 — Inert Monetization Hooks', () => {
  const contract = loadContract();

  it('flag values are restricted to booleans (no price fields, no billing metadata)', () => {
    expect(contract?.value_type?.allowed).toEqual(['boolean']);
  });

  it('@ocr/flags package has zero runtime billing / payment dependencies', () => {
    const pkg = JSON.parse(readFileSync(resolve(PKG_ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const forbidden = /stripe|braintree|paypal|square|chargebee|recurly|billing|payment/i;
    const combined = { ...pkg.dependencies, ...pkg.peerDependencies };
    for (const name of Object.keys(combined)) {
      expect(forbidden.test(name), `${name} looks monetization-related`).toBe(false);
    }
  });
});

describe('OCR_VISION_v2 Invariant 10 — Deprecation Lock', () => {
  const contract = loadContract();

  it('contract declares deprecation_lock as an invariant dependency', () => {
    expect(contract?.invariant_dependencies).toBeDefined();
    expect(Object.keys(contract!.invariant_dependencies!)).toEqual(
      expect.arrayContaining(['deprecation_lock'])
    );
  });
});

describe('Anonymous ID + Tenant Isolation invariants declared', () => {
  const contract = loadContract();

  it('contract references anonymous_id and tenant_isolation as dependencies', () => {
    const deps = Object.keys(contract?.invariant_dependencies ?? {});
    expect(deps).toEqual(expect.arrayContaining(['anonymous_id', 'tenant_isolation']));
  });
});
