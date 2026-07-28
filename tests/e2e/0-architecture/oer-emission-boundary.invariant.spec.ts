/**
 * INVARIANT 17: OER Emission Boundary
 *
 * Brain Invariant #17 (oer_emission_boundary):
 *   - status: live (structural gate is the enforcement mechanism)
 *   - group: security_isolation
 *   - brain canonical: OCR-docs/ocr-docs-brain/architectural-invariants.yaml
 *
 * OurEventRings (OER) is the intelligence and analytics layer for the OCR
 * product line. Products emit events; OER ingests and answers. Products do
 * NOT query each other's databases directly — the Cloudflare Worker runtime
 * enforces this at the binding layer: a D1 database is only accessible inside
 * a Worker if it is declared as a binding in wrangler.toml for that worker.
 *
 * The attack vector this invariant guards against:
 *   - A developer adds a cross-product D1 database binding to the OSE
 *     wrangler.toml (e.g., to query OW's named-identity database from the
 *     OSE anonymous-identity surface). This would break the core privacy
 *     invariant: OSE is anonymous-by-construction; OW is named. Cross-binding
 *     would allow correlation of anonymous IDs with named identities, silently
 *     destroying the privacy guarantee that is the product's core commitment.
 *   - A developer adds a Worker service binding (`[[services]]`) which, unlike
 *     a D1 binding, provides a direct RPC channel to another product's Worker.
 *     A service-bound Worker could proxy queries against its own D1 bindings
 *     and return raw rows to the caller — a back-channel cross-product query
 *     that bypasses both the public API contract and OSE's privacy isolation.
 *
 * The Cloudflare binding model is the enforcement mechanism:
 *   - `[[d1_databases]]` bindings: OSE may only bind `DB` (anonymous) and
 *     `FORMS_DB` (identified). Any additional d1_databases binding is a
 *     cross-product coupling and must fail CI.
 *   - `[[services]]` (Worker-to-Worker service bindings): none are permitted
 *     in the OSE wrangler.toml. Cross-product communication must go through
 *     the public API layer, not Worker RPC. If a service binding is ever
 *     needed legitimately (e.g., an internal health-check sidecar), it must
 *     be added to the approved allowlist in this spec alongside a brain
 *     enrichment_history entry documenting the architectural decision.
 *
 * What this spec locks:
 *   (a) wrangler.toml exists at the canonical path
 *   (b) Every d1_databases binding declaration names either `DB` or `FORMS_DB`
 *       (in any environment section — base, staging, production, or other)
 *   (c) No `[[services]]` or `[[env.*.services]]` stanza appears in
 *       wrangler.toml — service bindings open a Worker-to-Worker RPC channel
 *       that could proxy cross-product DB access
 *
 * Pattern reference: cors-allowlist.invariant.spec.ts (same L0 structural
 * approach using node:fs to read a config file and assert a security boundary).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const WRANGLER_PATH = join(REPO_ROOT, 'workers', 'oursharedevents', 'wrangler.toml');

/**
 * The only D1 database binding names that OSE is permitted to declare.
 * DB = anonymous scan/event surface. FORMS_DB = identified-user forms surface.
 * Both are OSE-internal. Adding any other D1 binding here is a cross-product
 * coupling that breaks privacy isolation.
 */
const PERMITTED_D1_BINDINGS = new Set(['DB', 'FORMS_DB']);

/**
 * Extract all `binding = "..."` values that follow a `[[d1_databases]]` or
 * `[[env.*.d1_databases]]` section header in the wrangler.toml text.
 * Returns an array of binding names found in the file.
 */
function extractD1BindingNames(toml: string): string[] {
  const lines = toml.split('\n');
  const names: string[] = [];
  let inD1Section = false;

  for (const line of lines) {
    const trimmed = line.trim();
    // Any [[...d1_databases]] stanza header (base or env-scoped)
    if (/^\[\[(?:env\.\w+\.)?d1_databases\]\]/.test(trimmed)) {
      inD1Section = true;
      continue;
    }
    // A new stanza header (any [[...]] line) ends the current section
    if (/^\[\[/.test(trimmed)) {
      inD1Section = false;
    }
    // Inside a d1_databases section, extract the binding name
    if (inD1Section) {
      const match = trimmed.match(/^binding\s*=\s*"([^"]+)"/);
      if (match) {
        names.push(match[1]);
      }
    }
  }

  return names;
}

/**
 * Return true if the wrangler.toml text contains any [[services]] or
 * [[env.*.services]] stanza header.
 */
function hasServiceBindings(toml: string): boolean {
  return /^\[\[(?:env\.\w+\.)?services\]\]/m.test(toml);
}

test.describe('Invariant 17: OER Emission Boundary — wrangler.toml cross-product binding lock', () => {
  test('OSE-INV17 | oer-boundary | config | wrangler.toml exists at canonical path', () => {
    expect(
      existsSync(WRANGLER_PATH),
      'workers/oursharedevents/wrangler.toml must exist — ' +
        'this file declares all D1 bindings and service bindings for the OSE Worker; ' +
        'without it, the cross-product isolation check cannot run'
    ).toBe(true);
  });

  test('OSE-INV17 | oer-boundary | d1 | every d1_databases binding is DB or FORMS_DB (no cross-product DB)', () => {
    const toml = readFileSync(WRANGLER_PATH, 'utf8');
    const bindings = extractD1BindingNames(toml);

    expect(
      bindings.length,
      'wrangler.toml must declare at least one d1_databases binding — ' +
        'if this fails, the toml format may have changed and the parser needs updating'
    ).toBeGreaterThan(0);

    for (const name of bindings) {
      expect(
        PERMITTED_D1_BINDINGS.has(name),
        `wrangler.toml declares a d1_databases binding named '${name}' which is not in the permitted set ` +
          `[${[...PERMITTED_D1_BINDINGS].map((b) => `'${b}'`).join(', ')}]. ` +
          'Adding a cross-product D1 binding to the OSE Worker breaks privacy isolation: ' +
          "OSE is anonymous-by-construction; binding another product's database (e.g., OW's named-identity DB) " +
          'allows correlation of anonymous IDs with named identities. ' +
          'If a new internal OSE database is intentionally added, add its binding name to PERMITTED_D1_BINDINGS ' +
          'in this spec AND add a brain enrichment_history entry documenting the architectural decision.'
      ).toBe(true);
    }
  });

  test('OSE-INV17 | oer-boundary | services | no [[services]] stanza (no Worker-to-Worker RPC bindings)', () => {
    const toml = readFileSync(WRANGLER_PATH, 'utf8');

    expect(
      hasServiceBindings(toml),
      'wrangler.toml contains a [[services]] or [[env.*.services]] stanza, which opens a direct ' +
        'Worker-to-Worker RPC channel. A service-bound Worker can proxy queries against its own D1 ' +
        'bindings and return raw rows — creating a back-channel cross-product query path that bypasses ' +
        "both the public API contract and OSE's privacy isolation. " +
        'Cross-product communication must use the public API layer, not Worker RPC. ' +
        'If a service binding is genuinely needed (e.g., an internal sidecar), remove this assertion, ' +
        'add the binding to an explicit allowlist, and add a brain enrichment_history entry.'
    ).toBe(false);
  });
});
