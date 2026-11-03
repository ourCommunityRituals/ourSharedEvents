/**
 * Digest gap-to-ticket gate (scripts/ci/check-digest-gap-tickets.mjs, OSE-1792).
 *
 * 1. The real digest passes.
 * 2. Hermetic born-red cases: a minimal valid digest passes, then each injected
 *    fault turns the script red with its own message.
 */

/* eslint-disable security/detect-non-literal-fs-filename -- writes a temp file the test just created */
const { spawnSync } = require('child_process');
const { mkdtempSync, writeFileSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'ci', 'check-digest-gap-tickets.mjs');
const REAL = join(__dirname, '..', '..', '.claude', 'research', 'agent-swarm-security-digest.md');

const OK = `# Digest

## Scan 2026-10-08

x

## Scan 2026-10-13

y

## Open gap to ticket

Mapped through scan: 2026-10-13

| Open gap | Ticket | Note |
| --- | --- | --- |
| A gap | OSE-1790 | n |
| Another gap | no ticket, decided: provider-side only | n |
`;

function run(text) {
  const dir = mkdtempSync(join(tmpdir(), 'digest-gap-'));
  const file = join(dir, 'digest.md');
  writeFileSync(file, text);
  const r = spawnSync(process.execPath, [SCRIPT, '--file', file], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('digest gap tickets', () => {
  it('passes on the real digest', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--file', REAL], { encoding: 'utf8' });
    expect(`${r.stdout}${r.stderr}`).toContain('digest gap tickets ok');
    expect(r.status).toBe(0);
  });

  it('passes on a minimal valid digest', () => {
    expect(run(OK).code).toBe(0);
  });

  it('fails when the section is missing', () => {
    const r = run(OK.replace('## Open gap to ticket', '## Something else'));
    expect(r.code).toBe(1);
    expect(r.out).toContain('no "## Open gap to ticket" section');
  });

  it('fails when a row has no ticket id and no decision', () => {
    const r = run(OK.replace('| A gap | OSE-1790 | n |', '| A gap | later | n |'));
    expect(r.code).toBe(1);
    expect(r.out).toContain('gap "A gap" has neither an OSE id');
  });

  it('fails when "no ticket, decided:" has no reason', () => {
    const r = run(OK.replace('no ticket, decided: provider-side only', 'no ticket, decided:'));
    expect(r.code).toBe(1);
    expect(r.out).toContain('gap "Another gap"');
  });

  it('fails when a newer scan is appended without updating the mapping', () => {
    const r = run(
      OK.replace('## Open gap to ticket', '## Scan 2026-11-20\n\nz\n\n## Open gap to ticket')
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain('newest scan is 2026-11-20');
  });

  it('fails when the "Mapped through scan" line is missing', () => {
    const r = run(OK.replace('Mapped through scan: 2026-10-13\n', ''));
    expect(r.code).toBe(1);
    expect(r.out).toContain('Mapped through scan');
  });

  it('fails when the section has no rows', () => {
    const r = run(OK.split('| Open gap')[0]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('no gap rows');
  });
});
