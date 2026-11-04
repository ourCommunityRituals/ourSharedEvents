/**
 * OSE-564 — Born-red harness: CI validation of threat ledger integrity.
 *
 * Every test tagged @born-red in the test suite must:
 *   1. Reference a real ledger entry (ID exists in THREAT_LEDGER)
 *   2. Match a ledger entry with status 'tested' or 'mitigated'
 *   3. Correspond to a ledger entry with a recorded red_birth
 *
 * This harness ALSO validates the ledger itself:
 *   - No duplicate IDs
 *   - Every 'tested' entry has a test_ref and red_birth
 *   - Every 'mitigated' entry has a mitigation_story
 *   - test_ref paths point to files that actually exist in the source map
 *
 * Additional structural gates in this file:
 *   - wrangler.toml does not contain CF_API_KEY (TL-019)
 *   - No source file imports from sibling repos (TL-020/021 extension)
 *
 * Annotation convention (place IMMEDIATELY above the test() call):
 *   // @born-red TL-XXX | method: design-time-negative-assertion | date: YYYY-MM-DD
 *
 * Emits [OSE-564-LEDGER] structured JSON for OSE-560 conformance report.
 */

import { describe, test, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { THREAT_LEDGER, THREAT_LEDGER_META, type ThreatEntry } from './fixtures/threat-ledger';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}

const tenv = () => env as unknown as TestEnv;

function loadSources(): Record<string, string> {
  return JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Ledger integrity: the ledger itself must be well-formed
// ═══════════════════════════════════════════════════════════════════════════════

describe('OSE-564: Threat ledger integrity', () => {
  test('ledger has expected metadata', () => {
    expect(THREAT_LEDGER_META.schema_version).toBe('1.0.0');
    expect(THREAT_LEDGER_META.layers).toBe(8);
    expect(THREAT_LEDGER.length).toBe(THREAT_LEDGER_META.total_entries);
    expect(THREAT_LEDGER.length).toBeGreaterThanOrEqual(20);
  });

  test('no duplicate threat IDs', () => {
    const ids = THREAT_LEDGER.map((e) => e.id);
    const unique = new Set(ids);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates, `Duplicate threat IDs found: ${duplicates.join(', ')}`).toHaveLength(0);
    expect(unique.size).toBe(ids.length);
  });

  test('all IDs follow TL-NNN format', () => {
    for (const entry of THREAT_LEDGER) {
      expect(entry.id, `${entry.id} does not match TL-NNN format`).toMatch(/^TL-\d{3}$/);
    }
  });

  test('every "tested" entry has test_ref and red_birth', () => {
    const gaps: string[] = [];
    for (const entry of THREAT_LEDGER) {
      if (entry.status === 'tested') {
        if (!entry.test_ref) gaps.push(`${entry.id}: missing test_ref`);
        if (!entry.red_birth) gaps.push(`${entry.id}: missing red_birth`);
      }
    }
    expect(gaps, `Tested threats without evidence:\n${gaps.join('\n')}`).toHaveLength(0);
  });

  test('every "mitigated" entry has a mitigation_story', () => {
    const gaps: string[] = [];
    for (const entry of THREAT_LEDGER) {
      if (entry.status === 'mitigated') {
        if (!entry.mitigation_story) {
          gaps.push(`${entry.id}: mitigated but no mitigation_story (Linear story ID)`);
        }
      }
    }
    expect(gaps, `Mitigated threats without story reference:\n${gaps.join('\n')}`).toHaveLength(0);
  });

  test('red_birth dates are valid ISO dates in YYYY-MM-DD format', () => {
    for (const entry of THREAT_LEDGER) {
      if (entry.red_birth) {
        expect(entry.red_birth.date, `${entry.id}.red_birth.date is not YYYY-MM-DD`).toMatch(
          /^\d{4}-\d{2}-\d{2}$/
        );
      }
    }
  });

  test('all 8 layers represented in the ledger', () => {
    const expectedLayers = new Set<string>([
      'd1_boundary',
      'worker_surface',
      'permission_layer',
      'pipeline',
      'secrets_layer',
      'repo_wall',
      'export_boundary',
      'audit_layer',
    ]);
    const presentLayers = new Set(THREAT_LEDGER.map((e) => e.layer));
    for (const layer of expectedLayers) {
      expect(presentLayers, `Layer "${layer}" has no entries in the threat ledger`).toContain(
        layer
      );
    }
  });

  test('coverage summary by status (informational — never fails)', () => {
    const counts = { open: 0, tested: 0, mitigated: 0, accepted: 0 };
    for (const entry of THREAT_LEDGER) counts[entry.status]++;
    const bySeverity: Record<string, number> = {};
    for (const entry of THREAT_LEDGER) {
      bySeverity[entry.severity] = (bySeverity[entry.severity] ?? 0) + 1;
    }
    const evidence = {
      invariant: 'threat_ledger_coverage',
      story: 'OSE-564',
      last_updated: THREAT_LEDGER_META.last_updated,
      total: THREAT_LEDGER.length,
      by_status: counts,
      by_severity: bySeverity,
      open_gap_count: counts.open,
    };
    console.info(`[OSE-564-LEDGER] ${JSON.stringify(evidence)}`);
    // Always passes — existence of open threats is normal; the conformance report surfaces them.
    expect(THREAT_LEDGER.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Born-red annotation validation
// Scan all test files for @born-red annotations; validate each references
// a real, well-formed ledger entry.
// ═══════════════════════════════════════════════════════════════════════════════

describe('OSE-564: Born-red annotation cross-reference', () => {
  // Annotation format: @born-red TL-XXX | method: <method> | date: YYYY-MM-DD
  const ANNOTATION_RE = /@born-red\s+(TL-\d{3})/g;

  // OSE-1801: the header promised "test_ref paths point to files that actually
  // exist"; nothing checked it. A worker-tests test_ref must name a spec in this
  // repo, and when it names a test ("file > … > test name") that test must exist.
  test('every worker-tests test_ref names a spec that exists, and the test it names', () => {
    const sources = loadSources();
    const specs = new Map<string, string>();
    for (const [path, content] of Object.entries(sources)) {
      const m = normalizePath(path).match(/\/workers\/oursharedevents\/(tests\/.+)$/);
      if (m) specs.set(m[1]!, content);
    }
    const gaps: string[] = [];
    for (const entry of THREAT_LEDGER) {
      if (entry.status !== 'tested' || !entry.test_ref) continue;
      const m = entry.test_ref.match(/^(tests\/[\w./-]+?\.(?:spec|test)\.ts)(?:\s*>\s*([^;]+))?/);
      if (!m) continue; // a CI gate or repo-root reference; checked elsewhere
      const file = m[1]!;
      const content = specs.get(file);
      if (content === undefined) {
        // Repo-root specs (tests/e2e, tests/integration) are not in the worker bundle.
        if (!/^tests\/(e2e|integration|unit)\//.test(file))
          gaps.push(`${entry.id}: no spec ${file}`);
        continue;
      }
      // Test names are checked from TL-084 on (a ratchet): older refs name tests by
      // a short label ("S2: …") rather than the exact title.
      const testName = m[2]?.split('>').pop()?.trim();
      const checksName = Number(entry.id.slice(3)) >= 84;
      if (checksName && testName && !content.includes(testName)) {
        gaps.push(`${entry.id}: ${file} has no test named "${testName}"`);
      }
    }
    expect(gaps, `test_ref points at nothing:\n${gaps.join('\n')}`).toEqual([]);
  });

  test('every @born-red annotation names a method from the ledger enum', () => {
    const METHODS = new Set([
      'design-time-negative-assertion',
      'historical-ci-failure',
      'deliberate-fixture-break',
      'red-team-fleet-finding',
    ]);
    const bad: string[] = [];
    for (const [path, content] of Object.entries(loadSources())) {
      if (!/[/\\]tests[/\\]/.test(path)) continue;
      for (const m of content.matchAll(/@born-red\s+(TL-\d{3})\s*\|\s*method:\s*([^|\n]+)/g)) {
        const method = m[2]!.trim();
        if (!METHODS.has(method)) bad.push(`${normalizePath(path)}: ${m[1]} method "${method}"`);
      }
    }
    expect(bad, `Annotation methods outside RedBirthMethod:\n${bad.join('\n')}`).toEqual([]);
  });

  test('every @born-red annotation references a real threat ledger ID', () => {
    const sources = loadSources();
    const ledgerIds = new Set(THREAT_LEDGER.map((e) => e.id));
    const violations: string[] = [];

    for (const [path, content] of Object.entries(sources)) {
      if (!/[/\\]tests[/\\]/.test(path)) continue;
      const matches = [...content.matchAll(ANNOTATION_RE)];
      for (const m of matches) {
        const refId = m[1];
        if (!ledgerIds.has(refId)) {
          violations.push(`${normalizePath(path)}: @born-red ${refId} not found in THREAT_LEDGER`);
        }
      }
    }
    expect(
      violations,
      `@born-red annotations referencing non-existent ledger entries:\n${violations.join('\n')}`
    ).toHaveLength(0);
  });

  test('every @born-red annotation references a threat with status "tested" or "mitigated"', () => {
    const sources = loadSources();
    const ledgerById = new Map<string, ThreatEntry>(THREAT_LEDGER.map((e) => [e.id, e]));
    const violations: string[] = [];

    for (const [path, content] of Object.entries(sources)) {
      if (!/[/\\]tests[/\\]/.test(path)) continue;
      const matches = [...content.matchAll(ANNOTATION_RE)];
      for (const m of matches) {
        const refId = m[1];
        const entry = ledgerById.get(refId);
        if (!entry) continue; // caught by previous test
        if (entry.status === 'open') {
          violations.push(
            `${normalizePath(path)}: @born-red ${refId} references threat with status "open" — must be "tested" or "mitigated" to claim green coverage`
          );
        }
      }
    }
    expect(
      violations,
      `@born-red annotations on open (untested) threats:\n${violations.join('\n')}`
    ).toHaveLength(0);
  });

  test('every @born-red annotation has a date stamp on the same or adjacent line', () => {
    const sources = loadSources();
    const violations: string[] = [];

    for (const [path, content] of Object.entries(sources)) {
      if (!/[/\\]tests[/\\]/.test(path)) continue;
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/@born-red\s+TL-\d{3}/.test(lines[i])) {
          // Check current line and next line for a date
          const window = [lines[i], lines[i + 1] ?? ''].join(' ');
          if (!/\d{4}-\d{2}-\d{2}/.test(window)) {
            violations.push(
              `${normalizePath(path)}:${i + 1}: @born-red annotation missing date stamp (expected YYYY-MM-DD on same or next line)`
            );
          }
        }
      }
    }
    expect(
      violations,
      `@born-red annotations without date stamps:\n${violations.join('\n')}`
    ).toHaveLength(0);
  });

  // @born-red TL-033 | method: deliberate-fixture-break | date: 2026-08-03
  test('every "tested" ledger entry has at least one @born-red annotation in test files', () => {
    const sources = loadSources();
    const annotatedIds = new Set<string>();

    for (const [path, content] of Object.entries(sources)) {
      if (!/[/\\]tests[/\\]/.test(path)) continue;
      const matches = [...content.matchAll(ANNOTATION_RE)];
      for (const m of matches) annotatedIds.add(m[1]);
    }

    const unannotated: string[] = [];
    for (const entry of THREAT_LEDGER) {
      if (entry.status === 'tested' && !annotatedIds.has(entry.id)) {
        unannotated.push(
          `${entry.id}: status=tested but no @born-red annotation found in any test file`
        );
      }
    }
    expect(
      unannotated,
      `Tested threats without @born-red annotation in test suite:\n${unannotated.join('\n')}\n→ Add // @born-red ${unannotated[0]?.split(':')[0] ?? 'TL-XXX'} | method: ... | date: YYYY-MM-DD above the relevant test()`
    ).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TL-019: No CF_API_KEY (global scope) in wrangler.toml
// ═══════════════════════════════════════════════════════════════════════════════

describe('OSE-564 TL-019: Global CF_API_KEY prohibited in wrangler.toml (SEC-1.2)', () => {
  // @born-red TL-019 | method: design-time-negative-assertion | date: 2026-08-03
  test('wrangler.toml does not contain CF_API_KEY var or binding', () => {
    const sources = loadSources();
    const wranglerEntry = Object.entries(sources).find(([p]) =>
      normalizePath(p).endsWith('wrangler.toml')
    );
    expect(wranglerEntry, 'wrangler.toml not found in TEST_SOURCE_FILES_JSON').toBeDefined();
    const [, content] = wranglerEntry!;

    // CF_API_KEY is the global Cloudflare API key — prohibited per SEC-1.2
    // Must use scoped token (CF_API_TOKEN) restricted to oursharedevents.com zone only
    expect(
      content,
      'wrangler.toml contains CF_API_KEY — global API key is prohibited (SEC-1.2); use scoped CF_API_TOKEN restricted to oursharedevents.com zone'
    ).not.toMatch(/\bCF_API_KEY\b/);

    // Scoped token is referenced in scripts but should not be hardcoded in wrangler.toml
    // (it's a secret, set via `wrangler secret put`)
    // This test validates absence of the global key name, not presence of the scoped name
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TL-017: No placeholder secrets in wrangler.toml that would pass as real values
// ═══════════════════════════════════════════════════════════════════════════════

describe('OSE-564 TL-017: Production secrets are not hardcoded in wrangler.toml', () => {
  // @born-red TL-017 | method: historical-ci-failure | date: 2026-08-03
  test('wrangler.toml production env has no hardcoded ADMIN_KEY or FORMS_ENCRYPTION_KEY values', () => {
    const sources = loadSources();
    const wranglerEntry = Object.entries(sources).find(([p]) =>
      normalizePath(p).endsWith('wrangler.toml')
    );
    expect(wranglerEntry, 'wrangler.toml not found in TEST_SOURCE_FILES_JSON').toBeDefined();
    const [, content] = wranglerEntry!;

    // These must be set via wrangler secret put, never in vars block
    const forbiddenInVars = ['ADMIN_KEY', 'FORMS_ENCRYPTION_KEY'];
    // Extract [vars] and [env.*.vars] blocks only (not comments)
    const varsBlockMatch = content.match(/^\[(?:env\.\w+\.)?vars\][^[]*?(?=\[|$)/gm) ?? [];
    const varsContent = varsBlockMatch.join('\n');

    for (const key of forbiddenInVars) {
      // The key may appear as a comment (documenting it as a required secret) — that's OK
      // It must NOT appear as an actual var assignment: KEY = "value"
      const assignmentPattern = new RegExp(`^\\s*${key}\\s*=\\s*[^#]`, 'm');
      expect(
        varsContent,
        `wrangler.toml [vars] block contains ${key} as a variable assignment — this must be a wrangler secret, not a plaintext var`
      ).not.toMatch(assignmentPattern);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TL-020/021: Cross-repo import wall (extension of architecture.spec.ts gate)
// ═══════════════════════════════════════════════════════════════════════════════

describe('OSE-564 TL-020/021: No cross-repo module imports in any source file', () => {
  const FORBIDDEN_IMPORT_PATTERNS: RegExp[] = [
    /from\s+['"]\.\.\/\.\.\/ourWKRP/,
    /from\s+['"]\.\.\/\.\.\/ourAirwaves/,
    /from\s+['"]\.\.\/\.\.\/ourSharedGames/,
    /from\s+['"]\.\.\/\.\.\/ourSharedRecords/,
    /from\s+['"]\.\.\/\.\.\/ourSharedPulse/,
    /from\s+['"]\.\.\/\.\.\/ourSharedMagnets/,
    /from\s+['"]\.\.\/\.\.\/OurEventRings/,
    // Workspace aliases for sibling product repos
    /from\s+['"]@ourWKRP\//,
    /from\s+['"]@ourAirwaves\//,
    // @ocr/ is the OSE-internal workspace namespace (file: paths in package.json) — NOT cross-repo
  ];

  // @born-red TL-020 | method: design-time-negative-assertion | date: 2026-08-03
  // @born-red TL-021 | method: design-time-negative-assertion | date: 2026-08-03
  test('no source or test file imports a module from a sibling repo directory', () => {
    const sources = loadSources();
    const violations: string[] = [];

    for (const [path, content] of Object.entries(sources)) {
      for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
        if (pattern.test(content)) {
          violations.push(
            `${normalizePath(path)}: forbidden cross-repo import matching ${pattern.source}`
          );
        }
      }
    }
    expect(
      violations,
      `Cross-repo import violations (Invariant #22 — cross_repo_import_isolation):\n${violations.join('\n')}\n→ Only permitted seam is HTTP GET /api/events/:id/music`
    ).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Ledger coverage report (always passes — feeds OSE-560)
// ═══════════════════════════════════════════════════════════════════════════════

describe('OSE-564: Ledger gap report (gaps are expected — surfaced, not failed)', () => {
  // @born-red TL-036 | method: design-time-negative-assertion | date: 2026-08-03
  test('open threats are visible and named (never silent gaps)', () => {
    const openThreats = THREAT_LEDGER.filter((e) => e.status === 'open');
    const openIds = openThreats.map(
      (e) => `${e.id} [${e.severity}] ${e.layer}: ${e.threat.slice(0, 60)}...`
    );

    if (openThreats.length > 0) {
      console.warn(`[OSE-564-GAPS] ${openThreats.length} open threats:\n${openIds.join('\n')}`);
    }

    // This test PASSES even if there are open threats — gaps are expected
    // The conformance report (OSE-560) surfaces them to operators.
    // A gap that is SILENT is the bug; a gap that is NAMED is acceptable.
    expect(openThreats.length).toBeGreaterThanOrEqual(0);
  });
});
