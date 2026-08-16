/**
 * INVARIANT: Cost metric is aggregate-only / never-who (COST-301 / OSE-780).
 *
 * The per-operation cost metric (src/lib/cost-metric.ts) exists to make runtime
 * cost visible as it scales toward the 100× D1/BigQuery watch-item. It must NOT
 * become a privacy hole: the emitted payload can only ever carry aggregate
 * numbers plus a keyword-masked operation label. No user identifier, IP, email,
 * anon-id, token, actor, or raw path segment may appear.
 *
 * This is the S0/S2 wall for the metric. It is a STRUCTURAL invariant (reads
 * source via node:fs, no deployed worker) so it runs on every PR/push in the
 * T0 gate — it must be listed in the "Architecture: structural invariants"
 * step of .github/workflows/oursharedevents-ci.yml (enforced by
 * tests/integration/infra-consistency.test.js).
 *
 * Pattern reference: aggregate-only.invariant.spec.ts (same readFileSync
 * L0 structural approach using Playwright with Node fs access).
 *
 * What this catches:
 *   - A field added to the OperationCostMetric payload that is not one of the
 *     sealed aggregate keys → key-set assertion fails.
 *   - An identifier token (email/ip/anon_id/actor/token/...) introduced into the
 *     payload interface or the emitter body → forbidden-token assertion fails.
 *   - The metric emission being unwired from the request seam in index.ts →
 *     wiring assertion fails.
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const COST_METRIC_PATH = join(
  REPO_ROOT,
  'workers',
  'oursharedevents',
  'src',
  'lib',
  'cost-metric.ts'
);
const INDEX_PATH = join(REPO_ROOT, 'workers', 'oursharedevents', 'src', 'index.ts');

// The complete, sealed set of keys the metric payload may carry. Adding a key
// here is a deliberate act that must be reviewed against the never-who wall.
const ALLOWED_PAYLOAD_KEYS = [
  'type',
  'op',
  'wallMs',
  'd1RowsRead',
  'd1RowsWritten',
  'd1Queries',
  'status',
].sort();

// Identifier-shaped tokens that must never appear in the payload interface or
// the emitter body. Word-boundary matched to avoid false positives.
const FORBIDDEN_IDENTIFIER_TOKENS = [
  'email',
  'anon_id',
  'anonId',
  'ip',
  'actor',
  'userId',
  'user_id',
  'phone',
  'cookie',
  'authorization',
  'password',
  'secret',
  'pepper',
  'token',
  'slug',
  'pathname',
];

function extractKeys(body: string): string[] {
  // Pull identifier-like keys from an interface body or object literal:
  // matches `foo:` at a line start (interface) or `foo:` in a literal.
  const keys = new Set<string>();
  const re = /(^|[\s{,])([A-Za-z_][A-Za-z0-9_]*)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    keys.add(m[2]);
  }
  return [...keys].sort();
}

test.describe('Invariant: cost metric never-who — structural code-shape lock', () => {
  test('OSE-COST301 | privacy | existence | cost-metric.ts exists', () => {
    expect(
      existsSync(COST_METRIC_PATH),
      'workers/oursharedevents/src/lib/cost-metric.ts must exist — deleting it removes ' +
        'the aggregate-only cost metric and its never-who guarantee'
    ).toBe(true);
  });

  test('OSE-COST301 | privacy | payload | OperationCostMetric carries only sealed aggregate keys', () => {
    const src = readFileSync(COST_METRIC_PATH, 'utf8');
    const ifaceMatch = src.match(/export\s+interface\s+OperationCostMetric\s*\{([\s\S]*?)\n\}/);
    expect(
      ifaceMatch,
      'OperationCostMetric interface must be defined and exported from cost-metric.ts'
    ).not.toBeNull();
    const keys = extractKeys(ifaceMatch![1]);
    expect(
      keys,
      `OperationCostMetric has unexpected fields. Only aggregate, non-identifying keys are ` +
        `permitted (${ALLOWED_PAYLOAD_KEYS.join(', ')}). A new key here must be reviewed ` +
        `against the never-who wall.`
    ).toEqual(ALLOWED_PAYLOAD_KEYS);
  });

  test('OSE-COST301 | privacy | emitter | emitted payload literal has exactly the sealed keys', () => {
    const src = readFileSync(COST_METRIC_PATH, 'utf8');
    // The literal assigned inside emitOperationCost: `const payload: ... = { ... };`
    const literalMatch = src.match(
      /const\s+payload\s*:\s*OperationCostMetric\s*=\s*\{([\s\S]*?)\n\s*\};/
    );
    expect(
      literalMatch,
      'emitOperationCost must build the payload as an explicit `const payload: OperationCostMetric = {...}` ' +
        'literal — this is the structural never-who guarantee (only allowlisted fields are emitted)'
    ).not.toBeNull();
    const keys = extractKeys(literalMatch![1]);
    expect(
      keys,
      'the emitted payload literal must contain exactly the sealed aggregate keys and nothing else'
    ).toEqual(ALLOWED_PAYLOAD_KEYS);
  });

  test('OSE-COST301 | privacy | no-identifiers | payload interface + emitter body carry no identifier tokens', () => {
    const src = readFileSync(COST_METRIC_PATH, 'utf8');
    const ifaceMatch = src.match(/export\s+interface\s+OperationCostMetric\s*\{([\s\S]*?)\n\}/);
    const emitMatch = src.match(/export\s+function\s+emitOperationCost[\s\S]*?\n\}/);
    const guarded = `${ifaceMatch ? ifaceMatch[1] : ''}\n${emitMatch ? emitMatch[0] : ''}`;
    for (const tok of FORBIDDEN_IDENTIFIER_TOKENS) {
      const re = new RegExp(`\\b${tok}\\b`, 'i');
      expect(
        re.test(guarded),
        `identifier token "${tok}" appears in the cost-metric payload interface or emitter body — ` +
          `the metric must be aggregate-only / never-who. If this is a false positive, narrow the region.`
      ).toBe(false);
    }
  });

  test('OSE-COST301 | privacy | masking | operation label masks non-keyword segments to :x', () => {
    const src = readFileSync(COST_METRIC_PATH, 'utf8');
    // normalizeOperation must mask unknown segments — the guarantee that an
    // event slug / QR token / id can never surface as a label. Lock the masking
    // sentinel and the STATIC_SEGMENTS allowlist mechanism structurally; the
    // behavioral proof lives in the unit test.
    expect(
      src,
      'normalizeOperation must exist to derive an identifier-free operation label'
    ).toMatch(/export\s+function\s+normalizeOperation\s*\(/);
    expect(src, 'the label must mask non-keyword path segments to the ":x" sentinel').toMatch(
      /':x'/
    );
    expect(
      src,
      'masking must be an allowlist (STATIC_SEGMENTS.has(...)) so the DEFAULT is to mask — ' +
        'a segment is only kept if it is a known keyword'
    ).toMatch(/STATIC_SEGMENTS\.has\s*\(/);
  });

  test('OSE-COST301 | wiring | index.ts emits the cost metric at the request seam', () => {
    const src = readFileSync(INDEX_PATH, 'utf8');
    expect(
      src,
      'index.ts must import the cost-metric emitter — the request seam is where the metric is emitted'
    ).toMatch(/from\s+'\.\/lib\/cost-metric'/);
    expect(
      src,
      'index.ts must call emitOperationCost(...) once per request so the metric is actually emitted'
    ).toMatch(/emitOperationCost\s*\(/);
    expect(
      src,
      'index.ts must instrument the D1 bindings via instrumentEnvForCost(...) so D1 rows are counted'
    ).toMatch(/instrumentEnvForCost\s*\(/);
  });
});
