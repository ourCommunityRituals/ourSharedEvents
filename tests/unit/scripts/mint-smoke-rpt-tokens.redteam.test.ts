/**
 * Red-team suite — scripts/mint-smoke-rpt-tokens.mjs (the T4f fixture minter).
 *
 * WHY THIS SUITE EXISTS (CCR Loop-2 reactive correction)
 * ------------------------------------------------------
 * The mint helper produces the four SMOKE_RPT_* bearer tokens that T4f
 * (tests/e2e/3-flows/sharedreport-depth.spec.ts) sends to staging. The CCR
 * Loop-1 assessment left the helper at 88%: (V4) no born-red test + not wired
 * to a named CI job, and (V3) its inlined mint/verify primitives are a hand
 * mirror of workers/oursharedevents/src/lib/shared-report-auth.ts with no gate
 * catching drift. This suite closes both.
 *
 * The load-bearing property is CROSS-COMPATIBILITY: every token the helper emits
 * must be accepted by the CANONICAL verifier the Worker actually runs
 * (verifySignedLinkToken). If the inlined mirror ever drifts from the canonical
 * minter, these tests go red here instead of silently minting tokens that 401
 * at staging (the exact failure mode that produced the T4f red).
 *
 * WIRING: root vitest.config.ts includes tests/unit/** — so `npx vitest run`
 * (the CI "T0 Gate (tests)" shard) collects and runs this file. It also runs on
 * the repo's Node-20 baseline, which is where the helper must work.
 *
 * These are adversarial by construction: each test asserts a security property
 * and is born-red — verified by reverting the guard and watching it fail (e.g.
 * break the signature step in the helper → the cross-verify + tamper tests fail;
 * log the secret → the exfiltration test fails).
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  mintSignedLinkToken,
  verifySignedLinkToken,
} from '../../../workers/oursharedevents/src/lib/shared-report-auth';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const SCRIPT = resolve(ROOT, 'scripts/mint-smoke-rpt-tokens.mjs');

const SECRET_A = 'ccr-redteam-signing-secret-AAA';
const SECRET_B = 'ccr-redteam-signing-secret-BBB-different';

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run the real helper as a child process with a CLEAN env (no inherited SMOKE_ or secret vars). */
function runMint(overrides: Record<string, string> = {}): RunResult {
  const base: Record<string, string | undefined> = { ...process.env };
  for (const k of [
    'SHARED_REPORT_SIGNING_SECRET',
    'SMOKE_EVENT_POST',
    'SMOKE_EVENT_OTHER',
    'SMOKE_RPT_SPONSOR_ID',
    'SMOKE_RPT_TTL_DAYS',
    'SMOKE_RPT_REPO',
  ]) {
    delete base[k];
  }
  const res = spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env: { ...base, ...overrides },
    encoding: 'utf8',
  });
  return { code: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/** Parse `# NAME\n<token>` blocks from stdout into a name→token map. */
function tokensFrom(stdout: string): Record<string, string> {
  const lines = stdout.split(/\r?\n/);
  const map: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^# (SMOKE_RPT_[A-Z_]+)$/);
    if (m) map[m[1]] = (lines[i + 1] ?? '').trim();
  }
  return map;
}

const flipFirst = (s: string): string => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);

describe('mint-smoke-rpt-tokens — red team', () => {
  it('emits exactly the four T4f-declared token names + four gh commands (exit 0)', () => {
    const { code, stdout } = runMint({ SHARED_REPORT_SIGNING_SECRET: SECRET_A });
    expect(code).toBe(0);
    expect(Object.keys(tokensFrom(stdout)).sort()).toEqual([
      'SMOKE_RPT_ADMIN_TOKEN',
      'SMOKE_RPT_LOCAL_TOKEN',
      'SMOKE_RPT_MID_TOKEN',
      'SMOKE_RPT_OTHER_EVENT_TOKEN',
    ]);
    expect((stdout.match(/^gh secret set /gm) ?? []).length).toBe(4);
  });

  it('ANTI-DRIFT: every emitted token verifies against the CANONICAL Worker verifier with the exact claim shape', async () => {
    const { stdout } = runMint({
      SHARED_REPORT_SIGNING_SECRET: SECRET_A,
      SMOKE_EVENT_POST: 'evt_post_x',
      SMOKE_EVENT_OTHER: 'evt_other_y',
      SMOKE_RPT_SPONSOR_ID: 'sp_zeta',
    });
    const t = tokensFrom(stdout);
    const env = { SHARED_REPORT_SIGNING_SECRET: SECRET_A };

    expect(await verifySignedLinkToken(env, t.SMOKE_RPT_ADMIN_TOKEN)).toMatchObject({
      eventId: 'evt_post_x',
      role: 'admin',
    });
    expect(await verifySignedLinkToken(env, t.SMOKE_RPT_LOCAL_TOKEN)).toMatchObject({
      eventId: 'evt_post_x',
      role: 'sponsor',
      depth: 'local',
      sponsor_id: 'sp_zeta',
    });
    expect(await verifySignedLinkToken(env, t.SMOKE_RPT_MID_TOKEN)).toMatchObject({
      eventId: 'evt_post_x',
      role: 'sponsor',
      depth: 'mid',
    });
    // The wrong-event token MUST be a DIFFERENT event — it drives T4f's 403 path
    // (verifies, then eventId != :id → FORBIDDEN, not UNAUTHORIZED).
    expect(await verifySignedLinkToken(env, t.SMOKE_RPT_OTHER_EVENT_TOKEN)).toMatchObject({
      eventId: 'evt_other_y',
      role: 'admin',
    });
  });

  it('tokens are SIGNED, not merely encoded: a token minted under secret A is REJECTED under secret B (this is why a stale secret 401s)', async () => {
    const { stdout } = runMint({ SHARED_REPORT_SIGNING_SECRET: SECRET_A });
    const admin = tokensFrom(stdout).SMOKE_RPT_ADMIN_TOKEN;
    // Correct secret → accepted.
    expect(
      await verifySignedLinkToken({ SHARED_REPORT_SIGNING_SECRET: SECRET_A }, admin)
    ).not.toBeNull();
    // Stale/rotated secret → null → the handler returns 401. Root cause of T4f.
    expect(
      await verifySignedLinkToken({ SHARED_REPORT_SIGNING_SECRET: SECRET_B }, admin)
    ).toBeNull();
  });

  it('EXFILTRATION GUARD: the signing secret never appears in stdout or stderr', () => {
    const { stdout, stderr } = runMint({ SHARED_REPORT_SIGNING_SECRET: SECRET_A });
    expect(stdout).not.toContain(SECRET_A);
    expect(stderr).not.toContain(SECRET_A);
  });

  it('FAIL-CLOSED: no signing secret → exit 1, zero tokens emitted', () => {
    const { code, stdout } = runMint({});
    expect(code).toBe(1);
    expect(stdout).not.toMatch(/SMOKE_RPT_/);
  });

  it('rejects a payload-tampered emitted token (signature catches mutation)', async () => {
    const { stdout } = runMint({ SHARED_REPORT_SIGNING_SECRET: SECRET_A });
    const [payload, sig] = tokensFrom(stdout).SMOKE_RPT_ADMIN_TOKEN.split('.');
    const tampered = `${flipFirst(payload)}.${sig}`;
    expect(
      await verifySignedLinkToken({ SHARED_REPORT_SIGNING_SECRET: SECRET_A }, tampered)
    ).toBeNull();
  });

  it('rejects a signature-tampered emitted token', async () => {
    const { stdout } = runMint({ SHARED_REPORT_SIGNING_SECRET: SECRET_A });
    const [payload, sig] = tokensFrom(stdout).SMOKE_RPT_ADMIN_TOKEN.split('.');
    const tampered = `${payload}.${flipFirst(sig)}`;
    expect(
      await verifySignedLinkToken({ SHARED_REPORT_SIGNING_SECRET: SECRET_A }, tampered)
    ).toBeNull();
  });

  it('rejects a malformed (no-delimiter) token', async () => {
    const { stdout } = runMint({ SHARED_REPORT_SIGNING_SECRET: SECRET_A });
    const noDelim = tokensFrom(stdout).SMOKE_RPT_ADMIN_TOKEN.replace(/\./g, '');
    expect(
      await verifySignedLinkToken({ SHARED_REPORT_SIGNING_SECRET: SECRET_A }, noDelim)
    ).toBeNull();
  });

  it('EXPIRY: an expired token is rejected (the other half of why stale tokens 401)', async () => {
    // Helper guards ttl>0, so mint an already-expired token via the canonical
    // minter to assert the verifier's expiry dimension the fixtures depend on.
    const env = { SHARED_REPORT_SIGNING_SECRET: SECRET_A };
    const expired = await mintSignedLinkToken(env, 'evt_post_x', 'admin', -10);
    expect(expired).not.toBeNull();
    expect(await verifySignedLinkToken(env, expired)).toBeNull();
  });

  it('FAT-FINGER GUARD: wrong-event id equal to post id → exit 1 (would collapse the 403 path)', () => {
    const { code } = runMint({
      SHARED_REPORT_SIGNING_SECRET: SECRET_A,
      SMOKE_EVENT_POST: 'evt_dupe',
      SMOKE_EVENT_OTHER: 'evt_dupe',
    });
    expect(code).toBe(1);
  });

  it('FAT-FINGER GUARD: non-positive / non-numeric TTL → exit 1', () => {
    for (const ttl of ['0', '-5', 'abc']) {
      const { code } = runMint({ SHARED_REPORT_SIGNING_SECRET: SECRET_A, SMOKE_RPT_TTL_DAYS: ttl });
      expect(code, `ttl=${ttl}`).toBe(1);
    }
  });

  it('respects a custom TTL in the emitted token exp claim', async () => {
    const { stdout } = runMint({ SHARED_REPORT_SIGNING_SECRET: SECRET_A, SMOKE_RPT_TTL_DAYS: '1' });
    const claim = await verifySignedLinkToken(
      { SHARED_REPORT_SIGNING_SECRET: SECRET_A },
      tokensFrom(stdout).SMOKE_RPT_ADMIN_TOKEN
    );
    expect(claim).not.toBeNull();
    const now = Math.floor(Date.now() / 1000);
    expect(claim!.exp).toBeGreaterThan(now);
    expect(claim!.exp).toBeLessThanOrEqual(now + 24 * 60 * 60 + 5);
  });
});
