import { describe, expect, test } from 'vitest';
import { isSigningSecretConfigured } from '../src/handlers/health';

// CCR-PR567 re-run item 5 — the deploy-time secret gate checks PRESENCE via
// `wrangler secret list`, which can never see the value: an empty / whitespace /
// too-short secret lists as "present" yet leaves the /sponsor + /sharedReport
// signing corner fail-closed (inert). /health reports this boolean — present AND
// >= 32 chars after trimming, NEVER the value — so the post-deploy health step
// can assert real usability rather than mere presence.
describe('isSigningSecretConfigured — signing secret is present and long enough', () => {
  test('undefined → false (unset)', () => {
    expect(isSigningSecretConfigured(undefined)).toBe(false);
  });

  test('empty string → false', () => {
    expect(isSigningSecretConfigured('')).toBe(false);
  });

  test('a 31-char secret is one under the floor → false', () => {
    expect(isSigningSecretConfigured('a'.repeat(31))).toBe(false);
  });

  test('a 32-char secret is the floor → true', () => {
    expect(isSigningSecretConfigured('a'.repeat(32))).toBe(true);
  });

  test('a 64-hex-char key (openssl rand -hex 32) → true', () => {
    expect(isSigningSecretConfigured('f'.repeat(64))).toBe(true);
  });

  test('whitespace-only never clears the floor once trimmed → false', () => {
    expect(isSigningSecretConfigured(' '.repeat(40))).toBe(false);
  });
});
