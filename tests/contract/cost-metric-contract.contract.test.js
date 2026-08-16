/**
 * L7 Contract — cost-metric schema doc ↔ code parity (COST-303 / OSE-782)
 *
 * The cost-metric contract doc (docs/monitoring/COST-METRIC-CONTRACT.md) is the
 * human-readable statement of what the `OPERATION_COST` metric emits and what it
 * must never emit (never-who). This test binds the doc to the implementation so
 * the two cannot drift:
 *
 *   1. Every field in the code's OperationCostMetric interface is documented,
 *      and the doc documents no field the code does not emit (exact set parity).
 *   2. The doc's forbidden-field list is actually present (never-who is stated).
 *   3. The metric code links back to this doc (discoverability).
 *   4. The doc declares "no sampling / no silent caps".
 *
 * The failure this catches: someone adds a field to the emitted payload without
 * documenting it (or documents a field that was removed) → the set-parity check
 * turns red, forcing the contract and the code back into agreement.
 *
 * Runs under root `npm test` (vitest) → T0 Gate. No deployed worker needed.
 */

const { readFileSync, existsSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..', '..');

const CODE_REL = 'workers/oursharedevents/src/lib/cost-metric.ts';
const DOC_REL = 'docs/monitoring/COST-METRIC-CONTRACT.md';

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** Field keys declared in the exported OperationCostMetric interface. */
function codeFields() {
  const src = read(CODE_REL);
  const m = src.match(/export\s+interface\s+OperationCostMetric\s*\{([\s\S]*?)\n\}/);
  if (!m) return null;
  const keys = new Set();
  const re = /(^|[\s{,])([A-Za-z_][A-Za-z0-9_]*)\s*:/g;
  let hit;
  while ((hit = re.exec(m[1])) !== null) keys.add(hit[2]);
  return [...keys].sort();
}

/** Field keys documented in the schema table of the contract doc. Table rows
 *  look like: `| \`type\` | string | ... |`. Extract the backticked field in
 *  column 1 of rows whose second column is a scalar type word. */
function docFields() {
  const doc = read(DOC_REL);
  const keys = new Set();
  for (const line of doc.split('\n')) {
    const m = line.match(/^\|\s*`([A-Za-z_][A-Za-z0-9_]*)`\s*\|\s*(string|number|boolean)\s*\|/);
    if (m) keys.add(m[1]);
  }
  return [...keys].sort();
}

describe('L7 Contract — cost-metric doc ↔ code parity (COST-303)', () => {
  it('the contract doc exists at the canonical path', () => {
    expect(
      existsSync(join(ROOT, DOC_REL)),
      `The cost-metric contract doc must exist at ${DOC_REL} — it is the never-who ` +
        `statement the metric is held to.`
    ).toBe(true);
  });

  it('the metric code defines an exported OperationCostMetric interface', () => {
    expect(codeFields(), `${CODE_REL} must export an OperationCostMetric interface`).not.toBeNull();
  });

  it('documented field set EXACTLY matches the emitted OperationCostMetric field set', () => {
    const code = codeFields();
    const doc = docFields();
    expect(
      doc,
      `The contract doc's schema table must document exactly the emitted fields.\n` +
        `  code: ${JSON.stringify(code)}\n  doc:  ${JSON.stringify(doc)}\n` +
        `A mismatch means the doc and the metric have drifted — update whichever is wrong.`
    ).toEqual(code);
  });

  it('the doc states the never-who forbidden set (identifiers, IP, tokens, raw path segments)', () => {
    const doc = read(DOC_REL).toLowerCase();
    for (const term of ['never-who', 'ip address', 'raw path segment', 'anon_id', 'token']) {
      expect(doc.includes(term), `contract doc must state the forbidden term "${term}"`).toBe(true);
    }
  });

  it('the doc declares no sampling / no silent caps', () => {
    const doc = read(DOC_REL).toLowerCase();
    expect(doc).toMatch(/no sampling/);
    expect(doc).toMatch(/silent cap/);
  });

  it('the metric code links back to the contract doc (discoverability)', () => {
    const src = read(CODE_REL);
    expect(
      src,
      `${CODE_REL} must reference docs/monitoring/COST-METRIC-CONTRACT.md so the contract ` +
        `is discoverable from the implementation.`
    ).toMatch(/COST-METRIC-CONTRACT\.md/);
  });
});
