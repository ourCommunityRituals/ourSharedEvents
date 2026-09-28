/**
 * L4 Turnstile-dark — born-red unit coverage for src/lib/turnstile.ts (OSE-1378).
 *
 * Node-clean by construction: imports the pure lib, stubs global `fetch`; no
 * cloudflare:test / SELF.fetch / D1. Listed in vitest.node-specs.mjs.
 *
 * Born-red proof: each enabled-path assertion targets one guard clause. Reverting
 * that clause (e.g. dropping the `action !== action` check, or making the disabled
 * branch call siteverify) turns the corresponding test red.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  guardTurnstile,
  isTurnstileEnabled,
  extractTurnstileToken,
  type TurnstileEnv,
} from '../src/lib/turnstile';

const OFF: TurnstileEnv = {};
const ON: TurnstileEnv = {
  TURNSTILE_ENABLED: 'true',
  TURNSTILE_SECRET: 's3cret',
  TURNSTILE_HOSTNAMES: 'oursharedevents.com, stg.oursharedevents.com',
};

function req(headers: Record<string, string> = {}): Request {
  return new Request('https://stg.oursharedevents.com/api/v2/events/evt_1/forms/register', {
    method: 'POST',
    headers,
  });
}

function mockSiteverify(body: unknown, ok = true) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

describe('turnstile — flag gate', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is enabled ONLY for the exact string "true"', () => {
    expect(isTurnstileEnabled({})).toBe(false);
    expect(isTurnstileEnabled({ TURNSTILE_ENABLED: '0' })).toBe(false);
    expect(isTurnstileEnabled({ TURNSTILE_ENABLED: 'false' })).toBe(false);
    expect(isTurnstileEnabled({ TURNSTILE_ENABLED: 'TRUE' })).toBe(false);
    expect(isTurnstileEnabled({ TURNSTILE_ENABLED: '1' })).toBe(false);
    expect(isTurnstileEnabled({ TURNSTILE_ENABLED: 'true' })).toBe(true);
  });

  it('DARK: returns null and never calls siteverify when disabled', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    expect(await guardTurnstile(req(), OFF, 'register', 'anytoken')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('DARK: no-op even with no token at all', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    expect(await guardTurnstile(req(), OFF, 'register')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('turnstile — enabled enforcement (fail-closed)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('enabled + no token → 403 without calling siteverify', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const res = await guardTurnstile(req(), ON, 'register');
    expect(res?.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it('enabled + missing secret → 403 (misconfig, fail-closed)', async () => {
    const res = await guardTurnstile(
      req(),
      { TURNSTILE_ENABLED: 'true', TURNSTILE_HOSTNAMES: 'oursharedevents.com' },
      'register',
      'tok'
    );
    expect(res?.status).toBe(403);
  });

  it('enabled + empty hostnames → 403 (misconfig, fail-closed)', async () => {
    const res = await guardTurnstile(
      req(),
      { TURNSTILE_ENABLED: 'true', TURNSTILE_SECRET: 's' },
      'register',
      'tok'
    );
    expect(res?.status).toBe(403);
  });

  it('enabled + oversized token (>2048) → 403 without calling siteverify', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const res = await guardTurnstile(req(), ON, 'register', 'x'.repeat(2049));
    expect(res?.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it('enabled + siteverify success:false → 403', async () => {
    mockSiteverify({ success: false, 'error-codes': ['invalid-input-response'] });
    const res = await guardTurnstile(req(), ON, 'register', 'tok');
    expect(res?.status).toBe(403);
  });

  it('enabled + valid token but WRONG action → 403', async () => {
    mockSiteverify({ success: true, action: 'login', hostname: 'oursharedevents.com' });
    const res = await guardTurnstile(req(), ON, 'register', 'tok');
    expect(res?.status).toBe(403);
  });

  it('enabled + valid token but hostname NOT allowlisted → 403', async () => {
    mockSiteverify({ success: true, action: 'register', hostname: 'evil.example' });
    const res = await guardTurnstile(req(), ON, 'register', 'tok');
    expect(res?.status).toBe(403);
  });

  it('enabled + siteverify throws (network) → 403 fail-closed', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    const res = await guardTurnstile(req(), ON, 'register', 'tok');
    expect(res?.status).toBe(403);
  });

  it('enabled + siteverify non-2xx → 403 fail-closed', async () => {
    mockSiteverify({ success: true }, false);
    const res = await guardTurnstile(req(), ON, 'register', 'tok');
    expect(res?.status).toBe(403);
  });

  it('enabled + success + matching action + allowlisted hostname → null (pass)', async () => {
    mockSiteverify({ success: true, action: 'register', hostname: 'stg.oursharedevents.com' });
    const res = await guardTurnstile(req(), ON, 'register', 'tok');
    expect(res).toBeNull();
  });

  it('reads the token from the cf-turnstile-response header for bodyless handlers', async () => {
    const m = mockSiteverify({ success: true, action: 'checkin', hostname: 'oursharedevents.com' });
    const res = await guardTurnstile(req({ 'cf-turnstile-response': 'hdrtok' }), ON, 'checkin');
    expect(res).toBeNull();
    const sentBody = m.mock.calls[0][1]?.body as URLSearchParams;
    expect(sentBody.get('response')).toBe('hdrtok');
  });
});

describe('turnstile — token extraction', () => {
  it('prefers a non-empty body token, then the header, else null', () => {
    expect(extractTurnstileToken(req(), 'body')).toBe('body');
    expect(extractTurnstileToken(req({ 'cf-turnstile-response': 'h' }))).toBe('h');
    expect(extractTurnstileToken(req())).toBeNull();
    expect(extractTurnstileToken(req(), 123)).toBeNull();
    expect(extractTurnstileToken(req(), '')).toBeNull();
  });
});
