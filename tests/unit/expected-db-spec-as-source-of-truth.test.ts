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
 * OSE-303 eliminated the drift class by making the workflow extract
 * DB_TABLES / FORMS_DB_TABLES from the spec at runtime. OSE-1347 moved
 * that extractor into `scripts/verify-d1-canonical-shape.mjs` so the same
 * deploy gate can also verify columns. This regression guard locks the
 * pattern in:
 *
 *   1. Workflow MUST NOT contain hard-coded `EXPECTED_DB=" "` or
 *      `EXPECTED_FORMS=" "` literals — those are the anti-pattern.
 *   2. Workflow MUST call the shared verifier for both staging and production.
 *   3. Executing the verifier's extraction path on the current spec MUST
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
const VERIFY_SCRIPT_REL = './workers/oursharedevents/scripts/verify-d1-canonical-shape.mjs';

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

function runVerifierExtraction(binding: 'DB' | 'FORMS_DB'): string[] {
  const script = `
    import('${VERIFY_SCRIPT_REL}').then((m) => {
      const schema = m.canonicalSchema();
      console.log([...schema.${binding}.keys()].sort().join(' '));
    }).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  `;
  const out = execFileSync('node', ['-e', script], {
    cwd: process.cwd(),
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

  test('workflow uses the shared D1 canonical-shape verifier for staging and production', () => {
    const wf = readWorkflow();
    const verifierCalls = (
      wf.match(/node scripts\/verify-d1-canonical-shape\.mjs --env (staging|production)/g) ?? []
    ).sort();
    expect(verifierCalls, 'workflow must call the shared verifier in both deploy gates').toEqual([
      'node scripts/verify-d1-canonical-shape.mjs --env production',
      'node scripts/verify-d1-canonical-shape.mjs --env staging',
    ]);
  });

  test('running the verifier DB extraction path produces a list matching the spec', () => {
    const fromScript = runVerifierExtraction('DB');
    const fromSpec = extractTablesFromSpec('DB_TABLES');
    expect(fromScript).toEqual(fromSpec);
    expect(fromScript.length).toBeGreaterThanOrEqual(10);
  });

  test('running the verifier FORMS_DB extraction path produces a list matching the spec', () => {
    const fromScript = runVerifierExtraction('FORMS_DB');
    const fromSpec = extractTablesFromSpec('FORMS_DB_TABLES');
    expect(fromScript).toEqual(fromSpec);
    expect(fromScript.length).toBeGreaterThanOrEqual(3);
  });

  test('workflow references OSE-303 in change comments (provenance trace)', () => {
    const wf = readWorkflow();
    const mentions = (wf.match(/OSE-303/g) ?? []).length;
    expect(
      mentions,
      `OSE-303 mention count = ${mentions}, expected >= 1 provenance comment for the shared verifier`
    ).toBeGreaterThanOrEqual(1);
  });
});
