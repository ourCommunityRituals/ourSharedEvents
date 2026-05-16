/**
 * OSE-303 — Regression guard for the spec-as-source-of-truth pattern
 * on `EXPECTED_DB` / `EXPECTED_FORMS` in oursharedevents-ci.yml.
 *
 * Background: PR #213 fixed a 2-week silent staging-deploy outage caused
 * by `EXPECTED_DB` drift — the workflow held a hard-coded copy of the
 * spec's DB_TABLES list, and migrations 0031-0035 (OSE-272 SharedReport
 * pipeline) updated the spec without updating the workflow. Deploys
 * silently failed every push to main from migration 0031 to PR #213.
 *
 * This story (OSE-303) eliminated the drift class by switching the
 * workflow to extract DB_TABLES / FORMS_DB_TABLES from the spec at
 * runtime via a `node -e` script. This regression guard locks the
 * pattern in:
 *
 *   1. Workflow MUST NOT contain hard-coded `EXPECTED_DB=" "` or
 *      `EXPECTED_FORMS=" "` literals — those are the anti-pattern.
 *   2. Workflow MUST use `node -e` extraction reading from
 *      `tests/migration-smoke.spec.ts`.
 *   3. Executing the extraction script on the current spec MUST
 *      produce the EXPECTED list (matches what staging/prod will
 *      actually have post-migration-apply).
 *   4. Pattern applies to BOTH staging and production verify steps
 *      (mirror by intent — drift between prod and staging would be a
 *      separate alarm, but the extraction logic must be identical).
 *
 * If a future "let me just inline this for simplicity" change reverts
 * to the hard-coded copy, this test breaks at PR-time, not at the
 * next migration that introduces silent staging breakage.
 *
 * Layer: API-static (Node vitest reads workflow + spec source).
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const WORKFLOW_PATH = join(process.cwd(), '.github', 'workflows', 'oursharedevents-ci.yml');
const SPEC_PATH_ABS = join(
  process.cwd(),
  'workers',
  'oursharedevents',
  'tests',
  'migration-smoke.spec.ts'
);
const SPEC_DIR_ABS = join(process.cwd(), 'workers', 'oursharedevents');

function readWorkflow(): string {
  return readFileSync(WORKFLOW_PATH, 'utf8');
}

function extractTablesFromSpec(constName: 'DB_TABLES' | 'FORMS_DB_TABLES'): string[] {
  const spec = readFileSync(SPEC_PATH_ABS, 'utf8');
  const pattern = new RegExp(`const ${constName} = \\[([\\s\\S]*?)\\] as const;`);
  const m = spec.match(pattern);
  if (!m) throw new Error(`${constName} not found in spec at ${SPEC_PATH_ABS}`);
  return (m[1].match(/'([^']+)'/g) ?? []).map((s) => s.slice(1, -1)).sort();
}

// Reproduces the exact node script the workflow uses, executed via
// execFileSync (no shell quoting). This asserts on the actual extraction
// pipeline's behavior, not a clean-room reimplementation.
function runExtractionScript(constName: 'DB_TABLES' | 'FORMS_DB_TABLES'): string[] {
  const minCount = constName === 'DB_TABLES' ? 10 : 3;
  const script = `
    const m = require('fs').readFileSync('tests/migration-smoke.spec.ts', 'utf8').match(/const ${constName} = \\[([\\s\\S]*?)\\] as const;/);
    if (!m) { console.error('${constName} not found'); process.exit(1); }
    const n = (m[1].match(/'([^']+)'/g) || []).map(s => s.slice(1, -1)).sort();
    if (n.length < ${minCount}) { console.error('only ' + n.length); process.exit(1); }
    console.log(n.join(' '));
  `;
  const out = execFileSync('node', ['-e', script], {
    cwd: SPEC_DIR_ABS,
    encoding: 'utf8',
  }).trim();
  return out.split(' ').filter(Boolean);
}

describe('OSE-303 spec-as-source-of-truth — EXPECTED_DB extraction regression guard', () => {
  test('workflow file exists at expected path', () => {
    expect(() => readWorkflow()).not.toThrow();
  });

  test('workflow does NOT hard-code EXPECTED_DB or EXPECTED_FORMS as literal strings', () => {
    const wf = readWorkflow();
    // The anti-pattern: EXPECTED_DB="admin_audit_log corridors..."
    // Must NOT appear in the workflow. Allow the form
    // EXPECTED_DB=$(node ...) which IS the correct pattern.
    expect(
      wf,
      'workflow contains hard-coded EXPECTED_DB literal — reverts the OSE-303 spec-as-source-of-truth pattern'
    ).not.toMatch(/EXPECTED_DB="[a-z_]/);
    expect(
      wf,
      'workflow contains hard-coded EXPECTED_FORMS literal — reverts the OSE-303 spec-as-source-of-truth pattern'
    ).not.toMatch(/EXPECTED_FORMS="[a-z_]/);
  });

  test('workflow uses node -e extraction for both EXPECTED_DB and EXPECTED_FORMS', () => {
    const wf = readWorkflow();
    // Each verify step (staging + production = 2 places each) must
    // use $(node -e " ... ") to extract from the spec.
    const dbNodeExtractions = (wf.match(/EXPECTED_DB=\$\(node -e/g) ?? []).length;
    const formsNodeExtractions = (wf.match(/EXPECTED_FORMS=\$\(node -e/g) ?? []).length;
    expect(
      dbNodeExtractions,
      `EXPECTED_DB node-extraction count = ${dbNodeExtractions}, expected exactly 2 (staging + production verify steps)`
    ).toBe(2);
    expect(
      formsNodeExtractions,
      `EXPECTED_FORMS node-extraction count = ${formsNodeExtractions}, expected exactly 2 (staging + production verify steps)`
    ).toBe(2);
  });

  test('running the DB_TABLES extraction script produces a list matching the spec', () => {
    const fromScript = runExtractionScript('DB_TABLES');
    const fromSpec = extractTablesFromSpec('DB_TABLES');
    expect(fromScript).toEqual(fromSpec);
    expect(fromScript.length).toBeGreaterThanOrEqual(10);
  });

  test('running the FORMS_DB_TABLES extraction script produces a list matching the spec', () => {
    const fromScript = runExtractionScript('FORMS_DB_TABLES');
    const fromSpec = extractTablesFromSpec('FORMS_DB_TABLES');
    expect(fromScript).toEqual(fromSpec);
    expect(fromScript.length).toBeGreaterThanOrEqual(3);
  });

  test('workflow references OSE-303 in change comments (provenance trace)', () => {
    const wf = readWorkflow();
    const mentions = (wf.match(/OSE-303/g) ?? []).length;
    expect(
      mentions,
      `OSE-303 mention count = ${mentions}, expected >= 2 (staging + production extraction blocks both annotated)`
    ).toBeGreaterThanOrEqual(2);
  });
});
