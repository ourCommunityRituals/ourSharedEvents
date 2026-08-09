/**
 * TL-018 — FORMS_ENCRYPTION_KEY rotation age alert
 *
 * Source-level gates asserting that the security cron checks FORMS_KEY_ROTATED_AT
 * and raises a 'key_rotation_age' alert when the key exceeds the rotation window:
 *
 *   1. AlertType includes 'key_rotation_age'
 *   2. SecurityCronEnv includes FORMS_KEY_ROTATED_AT
 *   3. runSecurityMetricsCron reads FORMS_KEY_ROTATED_AT
 *   4. KEY_ROTATION_MAX_DAYS = 90
 *   5. KEY_ROTATION_WARN_DAYS = 75 (15-day advance warning)
 *   6. HIGH alert raised when age >= 90 days
 *   7. MEDIUM alert raised when 75 <= age < 90 days
 *   8. anomaly flag 'key_rotation_overdue' pushed when overdue
 *   9. anomaly flag 'key_rotation_due_soon' pushed in warn zone
 *  10. Invalid date string emits SECURITY_CRON_WARN (no crash)
 *  11. Missing FORMS_KEY_ROTATED_AT is a no-op (graceful absence)
 */

import { env } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}

function getIndexTs(): string {
  const sources: Record<string, string> = JSON.parse(
    (env as unknown as TestEnv).TEST_SOURCE_FILES_JSON
  );
  const entry = Object.entries(sources).find(([p]) =>
    p.replace(/\\/g, '/').endsWith('src/index.ts')
  );
  if (!entry) throw new Error('src/index.ts not found in TEST_SOURCE_FILES_JSON');
  return entry[1];
}

function getSecurityAlertTs(): string {
  const sources: Record<string, string> = JSON.parse(
    (env as unknown as TestEnv).TEST_SOURCE_FILES_JSON
  );
  const entry = Object.entries(sources).find(([p]) =>
    p.replace(/\\/g, '/').endsWith('lib/security-alert.ts')
  );
  if (!entry) throw new Error('lib/security-alert.ts not found in TEST_SOURCE_FILES_JSON');
  return entry[1];
}

describe('TL-018 | Key rotation age alert | Source gate', () => {
  test('AlertType includes key_rotation_age', () => {
    const src = getSecurityAlertTs();
    expect(src).toContain("'key_rotation_age'");
  });

  test('SecurityCronEnv includes FORMS_KEY_ROTATED_AT', () => {
    const src = getIndexTs();
    // Must appear inside the SecurityCronEnv interface
    const ifaceIdx = src.indexOf('interface SecurityCronEnv');
    expect(ifaceIdx).toBeGreaterThan(-1);
    const ifaceBody = src.slice(ifaceIdx, ifaceIdx + 600);
    expect(ifaceBody).toContain('FORMS_KEY_ROTATED_AT');
  });

  test('runSecurityMetricsCron reads FORMS_KEY_ROTATED_AT', () => {
    const src = getIndexTs();
    const fnIdx = src.indexOf('async function runSecurityMetricsCron(');
    expect(fnIdx).toBeGreaterThan(-1);
    const fnBody = src.slice(fnIdx);
    expect(fnBody).toContain('FORMS_KEY_ROTATED_AT');
  });

  test('KEY_ROTATION_MAX_DAYS = 90', () => {
    const src = getIndexTs();
    expect(src).toContain('KEY_ROTATION_MAX_DAYS = 90');
  });

  test('KEY_ROTATION_WARN_DAYS = 75', () => {
    const src = getIndexTs();
    expect(src).toContain('KEY_ROTATION_WARN_DAYS = 75');
  });

  test('HIGH alert is raised when key age >= KEY_ROTATION_MAX_DAYS', () => {
    const src = getIndexTs();
    const fnIdx = src.indexOf('async function runSecurityMetricsCron(');
    const fnBody = src.slice(fnIdx);
    // Must check age >= max and raise HIGH severity
    expect(fnBody).toContain('key_rotation_overdue');
    expect(fnBody).toContain("severity: 'HIGH'");
    expect(fnBody).toContain("type: 'key_rotation_age'");
  });

  test('MEDIUM alert is raised in the 75–90 day warn zone', () => {
    const src = getIndexTs();
    const fnIdx = src.indexOf('async function runSecurityMetricsCron(');
    const fnBody = src.slice(fnIdx);
    expect(fnBody).toContain('key_rotation_due_soon');
    expect(fnBody).toContain("severity: 'MEDIUM'");
  });

  test('invalid FORMS_KEY_ROTATED_AT value emits SECURITY_CRON_WARN without crashing', () => {
    const src = getIndexTs();
    const fnIdx = src.indexOf('async function runSecurityMetricsCron(');
    const fnBody = src.slice(fnIdx);
    expect(fnBody).toContain('SECURITY_CRON_WARN');
    expect(fnBody).toContain('key_rotation_age');
    expect(fnBody).toContain('not a valid ISO date');
  });

  test('missing FORMS_KEY_ROTATED_AT skips the check (graceful absence)', () => {
    const src = getIndexTs();
    const fnIdx = src.indexOf('async function runSecurityMetricsCron(');
    const fnBody = src.slice(fnIdx);
    // Must guard on rotatedAtRaw being truthy before Date.parse
    expect(fnBody).toContain('rotatedAtRaw');
    // The check must be inside an if (rotatedAtRaw) guard
    const rotatedAtIdx = fnBody.indexOf('rotatedAtRaw');
    expect(rotatedAtIdx).toBeGreaterThan(-1);
    const guardSection = fnBody.slice(rotatedAtIdx - 50, rotatedAtIdx + 200);
    expect(guardSection).toMatch(/if\s*\(\s*rotatedAtRaw\s*\)/);
  });

  test('investigation steps for key_rotation_age include rotation script reference', () => {
    const src = getSecurityAlertTs();
    const caseIdx = src.indexOf("case 'key_rotation_age':");
    expect(caseIdx).toBeGreaterThan(-1);
    const caseBody = src.slice(caseIdx, caseIdx + 600);
    expect(caseBody).toContain('FORMS_KEY_ROTATED_AT');
    expect(caseBody).toContain('FORMS_ENCRYPTION_KEY');
  });

  test('RouterEnv includes FORMS_KEY_ROTATED_AT binding', () => {
    const sources: Record<string, string> = JSON.parse(
      (env as unknown as TestEnv).TEST_SOURCE_FILES_JSON
    );
    const routerEntry = Object.entries(sources).find(([p]) =>
      p.replace(/\\/g, '/').endsWith('src/router.ts')
    );
    if (!routerEntry) throw new Error('src/router.ts not found in TEST_SOURCE_FILES_JSON');
    const src = routerEntry[1];
    expect(src).toContain('FORMS_KEY_ROTATED_AT');
  });
});
