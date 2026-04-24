/**
 * OSE-202 / SEC-3 — PII email encryption tests
 *
 * L1: static analysis — INSERT statements for email_signups never contain a
 *     raw 'email' column (only email_hash and email_encrypted are permitted)
 * L2: unit — hashEmail, encryptEmail, decryptEmail correctness + round-trip
 */

import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { hashEmail, encryptEmail, decryptEmail, ENCRYPTION_VERSION } from '../src/lib/pii';

const TEST_KEY = 'test-forms-encryption-secret-32ch';

// ── L1: Static — no raw email in INSERT statements ────────────────────────────

describe('pii — L1 static: email_signups INSERT never stores raw email', () => {
  it('all INSERT INTO email_signups statements use email_hash / email_encrypted, not a bare email column', () => {
    const sourceFilesJson = (env as unknown as Record<string, string>).TEST_SOURCE_FILES_JSON;
    const sourceFiles = JSON.parse(sourceFilesJson) as Record<string, string>;

    const violations: string[] = [];

    for (const [filePath, content] of Object.entries(sourceFiles)) {
      // Find INSERT INTO email_signups statements (may span multiple lines)
      const insertPattern = /INSERT\s+INTO\s+email_signups\s*\(([^)]+)\)/gi;
      let match: RegExpExecArray | null;
      while ((match = insertPattern.exec(content)) !== null) {
        const columnList = match[1];
        // Split columns and check none is a bare 'email'
        const columns = columnList.split(',').map((c) => c.trim().replace(/[`"']/g, ''));
        for (const col of columns) {
          if (col === 'email') {
            violations.push(`${filePath}: bare 'email' column in INSERT`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('ENCRYPTION_VERSION is exported and non-empty', () => {
    expect(typeof ENCRYPTION_VERSION).toBe('string');
    expect(ENCRYPTION_VERSION.length).toBeGreaterThan(0);
  });
});

// ── L2: hashEmail ─────────────────────────────────────────────────────────────

describe('pii — L2 unit: hashEmail', () => {
  it('produces a 64-char hex string', async () => {
    const hash = await hashEmail('test@example.com');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same input', async () => {
    const a = await hashEmail('user@example.com');
    const b = await hashEmail('user@example.com');
    expect(a).toBe(b);
  });

  it('normalises to lowercase before hashing', async () => {
    expect(await hashEmail('USER@EXAMPLE.COM')).toBe(await hashEmail('user@example.com'));
    expect(await hashEmail('User@Example.Com')).toBe(await hashEmail('user@example.com'));
  });

  it('trims leading/trailing whitespace', async () => {
    expect(await hashEmail('  test@example.com  ')).toBe(await hashEmail('test@example.com'));
  });

  it('produces different hashes for different emails', async () => {
    const h1 = await hashEmail('alice@example.com');
    const h2 = await hashEmail('bob@example.com');
    expect(h1).not.toBe(h2);
  });
});

// ── L2: encryptEmail / decryptEmail ───────────────────────────────────────────

describe('pii — L2 unit: encryptEmail / decryptEmail', () => {
  it('round-trip returns the original email', async () => {
    const original = 'user@example.com';
    const encrypted = await encryptEmail(original, TEST_KEY);
    const decrypted = await decryptEmail(encrypted, TEST_KEY);
    expect(decrypted).toBe(original);
  });

  it('round-trip normalises to lowercase', async () => {
    const encrypted = await encryptEmail('USER@EXAMPLE.COM', TEST_KEY);
    const decrypted = await decryptEmail(encrypted, TEST_KEY);
    expect(decrypted).toBe('user@example.com');
  });

  it('ciphertext includes the version prefix', async () => {
    const encrypted = await encryptEmail('test@example.com', TEST_KEY);
    expect(encrypted.startsWith(`${ENCRYPTION_VERSION}:`)).toBe(true);
  });

  it('ciphertext does not contain the raw email', async () => {
    const email = 'sensitive@example.com';
    const encrypted = await encryptEmail(email, TEST_KEY);
    expect(encrypted).not.toContain(email);
    expect(encrypted.length).toBeGreaterThan(40);
  });

  it('two encryptions of the same email produce different ciphertexts (random IV)', async () => {
    const email = 'user@example.com';
    const enc1 = await encryptEmail(email, TEST_KEY);
    const enc2 = await encryptEmail(email, TEST_KEY);
    expect(enc1).not.toBe(enc2);
  });

  it('decryption with wrong key throws', async () => {
    const encrypted = await encryptEmail('user@example.com', TEST_KEY);
    await expect(decryptEmail(encrypted, 'wrong-key-entirely-different')).rejects.toThrow();
  });

  it('decrypts legacy unversioned blobs (backward compat)', async () => {
    // Simulate a legacy ciphertext without version prefix
    // Build one manually using the v1 key derivation (same as current but no prefix)
    const email = 'legacy@example.com';
    const encrypted = await encryptEmail(email, TEST_KEY);
    // Strip the version prefix to simulate old format
    const legacyBlob = encrypted.slice(encrypted.indexOf(':') + 1);
    const decrypted = await decryptEmail(legacyBlob, TEST_KEY);
    expect(decrypted).toBe(email);
  });
});
