/**
 * The staging rollback drill workflow (CCR A2) must be unable to touch production
 * and unable to change anything by default.
 */
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '../../../.github/workflows/staging-rollback-drill.yml');
const text = fs.readFileSync(FILE, 'utf8');
const code = text
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

describe('staging rollback drill workflow', () => {
  test('is dispatch-only', () => {
    expect(code).toMatch(/^on:\s*\n\s+workflow_dispatch:/m);
    expect(code).not.toMatch(/^\s+(push|pull_request|schedule):/m);
  });

  test('never names the production environment', () => {
    expect(code).not.toMatch(/--env production/);
    expect(code).not.toMatch(/environment:\s*production/);
    expect(code).not.toMatch(/oursharedevents\.com\/health/);
    expect(code).toMatch(/--env staging/);
  });

  test('refuses unless STAGING is typed, as its first step', () => {
    const first = code.indexOf('- name:');
    const stepText = code.slice(first, first + 400);
    expect(stepText).toContain('Refuse unless STAGING was typed');
    expect(stepText).toContain('!= "STAGING"');
  });

  test('changes nothing unless both versions are given', () => {
    const drill = code.slice(code.indexOf("'DRILL:"));
    expect(drill).toMatch(/if:\s*\$\{\{[^}]*rollback_to != ''[^}]*restore_to != ''/);
    // The only rollback commands are inside that step.
    const before = code.slice(0, code.indexOf("'DRILL:"));
    expect(before).not.toMatch(/wrangler rollback/);
  });

  test('always rolls forward again, and validates both ids', () => {
    expect(code).toMatch(/trap restore EXIT/);
    expect(code).toMatch(/\[0-9a-f\]\{8\}/);
  });

  test('has read-only permissions and one run at a time', () => {
    expect(code).toMatch(/permissions:\s*\n\s+contents: read/);
    expect(code).toMatch(/concurrency:\s*\n\s+group: stg-writer/);
  });
});
