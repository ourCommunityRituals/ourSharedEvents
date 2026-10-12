/**
 * A production deploy must name its ticket (scripts/ci/require-ticket.mjs), CCR B5.
 * The wiring is held too: the step exists in deploy-production, is not
 * optional, and comes after the main-ancestry guard.
 */
const fs = require('node:fs');
const path = require('node:path');

let rt;

beforeAll(async () => {
  rt = await import('../../../scripts/ci/require-ticket.mjs');
});

describe('ticketFor', () => {
  test('the dispatch input wins', () => {
    expect(rt.ticketFor({ input: 'OSE-1511', tagMessage: 'OSE-1 other' })).toBe('OSE-1511');
  });

  test('otherwise the first id in the tag message', () => {
    expect(rt.ticketFor({ input: '', tagMessage: 'OSE-1603 first update, see also OSE-1' })).toBe(
      'OSE-1603'
    );
  });

  test('other products count', () => {
    expect(rt.ticketFor({ input: 'OW-160' })).toBe('OW-160');
  });

  test.each([
    [{ input: '', tagMessage: '' }],
    [{ input: 'fix the thing', tagMessage: 'release' }],
    [{ input: 'OSE-', tagMessage: 'OSE' }],
    [{ input: 'XOSE-12', tagMessage: undefined }],
    [{}],
  ])('no ticket: %j', (args) => {
    expect(rt.ticketFor(args)).toBeNull();
  });

  test('the refusal says what to do', () => {
    const text = rt.explain();
    expect(text).toContain('`ticket` input');
    expect(text).toContain('annotated tag');
  });
});

describe('the production deploy job', () => {
  const wf = fs.readFileSync(
    path.join(__dirname, '../../../.github/workflows/oursharedevents-ci.yml'),
    'utf8'
  );
  const job = wf.slice(wf.indexOf('  deploy-production:'));

  test('takes a ticket input on dispatch', () => {
    const inputs = wf.slice(
      wf.indexOf('workflow_dispatch:'),
      wf.indexOf('workflow_dispatch:') + 1500
    );
    expect(inputs).toMatch(/\n\s+ticket:\s*\n/);
  });

  test('runs the ticket step, unconditionally, after the main-ancestry guard', () => {
    const guard = job.indexOf('scripts/ci/assert-on-main.sh');
    const step = job.indexOf('scripts/ci/require-ticket.mjs');
    expect(guard).toBeGreaterThan(-1);
    expect(step).toBeGreaterThan(guard);
    const stepText = job.slice(job.lastIndexOf('- name:', step), step + 400);
    expect(stepText).not.toMatch(/continue-on-error/);
    expect(stepText).not.toMatch(/^\s+if:/m);
  });

  test('and before any migration is applied', () => {
    expect(job.indexOf('scripts/ci/require-ticket.mjs')).toBeLessThan(
      job.indexOf('Apply D1 migrations (main DB)')
    );
  });
});
