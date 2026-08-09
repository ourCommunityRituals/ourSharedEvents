/**
 * OSE-580 — Offline PII re-encryption job.
 *
 * Re-encrypts all email_signups.email_encrypted records from one key version
 * to another. Run ONLY after the versioned key envelope (OSE-579) is deployed.
 *
 * Usage:
 *   npx tsx scripts/reencrypt-pii.ts \
 *     --from-version v1 \
 *     --to-version v2 \
 *     [--dry-run] \
 *     [--env staging|production]
 *
 * Required environment variables:
 *   CF_ACCOUNT_ID          Cloudflare account ID
 *   CF_API_TOKEN           Cloudflare API token (D1 read+write on FORMS_DB)
 *   CF_D1_FORMS_DB_ID      D1 database ID for FORMS_DB (not the main DB)
 *   FORMS_ENCRYPTION_KEY   JSON key map: '{"v1":"oldkey","v2":"newkey"}'
 *
 * Safety:
 *   - --dry-run mode logs what would change without writing anything
 *   - Idempotent: records already at --to-version are skipped
 *   - Decryption errors are logged and skipped (batch never aborts)
 *   - Run against staging FORMS_DB first; production only after staging confirms clean
 */

import { createHash, createHmac } from 'node:crypto';
import { webcrypto } from 'node:crypto';
import * as process from 'node:process';

// Node 18+ has globalThis.crypto — polyfill for older versions
if (!globalThis.crypto) {
  (globalThis as Record<string, unknown>).crypto = webcrypto;
}

// ─── Arg parsing ──────────────────────────────────────────────────────────────

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const FROM_VERSION = getArg('--from-version');
const TO_VERSION = getArg('--to-version');
const DRY_RUN = process.argv.includes('--dry-run');

if (!FROM_VERSION || !TO_VERSION) {
  console.error('Usage: reencrypt-pii.ts --from-version v1 --to-version v2 [--dry-run]');
  process.exit(1);
}
if (FROM_VERSION === TO_VERSION) {
  console.error('--from-version and --to-version must differ');
  process.exit(1);
}

// ─── Env validation ───────────────────────────────────────────────────────────

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;
const CF_D1_FORMS_DB_ID = process.env.CF_D1_FORMS_DB_ID;
const FORMS_ENCRYPTION_KEY = process.env.FORMS_ENCRYPTION_KEY;

if (!CF_ACCOUNT_ID || !CF_API_TOKEN || !CF_D1_FORMS_DB_ID || !FORMS_ENCRYPTION_KEY) {
  console.error(
    'Missing required env vars: CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_FORMS_DB_ID, FORMS_ENCRYPTION_KEY'
  );
  process.exit(1);
}

// ─── Key map (mirrors src/lib/pii.ts logic) ───────────────────────────────────

function parseKeyMap(formsEncKey: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(formsEncKey);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // plain string
  }
  return { v1: formsEncKey };
}

const keyMap = parseKeyMap(FORMS_ENCRYPTION_KEY);

if (!keyMap[FROM_VERSION]) {
  console.error(`No key for --from-version ${FROM_VERSION} in FORMS_ENCRYPTION_KEY`);
  process.exit(1);
}
if (!keyMap[TO_VERSION]) {
  console.error(`No key for --to-version ${TO_VERSION} in FORMS_ENCRYPTION_KEY`);
  process.exit(1);
}

// ─── Crypto (mirrors src/lib/pii.ts) ─────────────────────────────────────────

async function deriveKey(rawKey: string, version: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(rawKey),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(`oursharedevents-forms-${version}`),
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function decryptValue(encrypted: string, version: string): Promise<string> {
  const colonIdx = encrypted.indexOf(':');
  const payload = colonIdx !== -1 ? encrypted.slice(colonIdx + 1) : encrypted;
  const rawKey = keyMap[version]!;
  const key = await deriveKey(rawKey, version);
  const combined = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

async function encryptValue(plaintext: string, version: string): Promise<string> {
  const rawKey = keyMap[version]!;
  const key = await deriveKey(rawKey, version);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return `${version}:${btoa(String.fromCharCode(...combined))}`;
}

// ─── Cloudflare D1 HTTP API ───────────────────────────────────────────────────

const D1_BASE = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_FORMS_DB_ID}`;

async function d1Query<T = Record<string, unknown>>(
  sql: string,
  params: (string | number | null)[] = []
): Promise<T[]> {
  const res = await fetch(`${D1_BASE}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`D1 query failed ${res.status}: ${text}`);
  }
  const body = (await res.json()) as {
    success: boolean;
    result: { results: T[] }[];
    errors: { message: string }[];
  };
  if (!body.success) throw new Error(`D1 error: ${body.errors.map((e) => e.message).join(', ')}`);
  return body.result[0]?.results ?? [];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const BATCH_SIZE = 100;

async function main() {
  console.log(`Re-encryption job: ${FROM_VERSION} → ${TO_VERSION}${DRY_RUN ? ' [DRY RUN]' : ''}`);

  let offset = 0;
  let totalProcessed = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let totalUpdated = 0;

  while (true) {
    const rows = await d1Query<{ id: string; email_encrypted: string }>(
      'SELECT id, email_encrypted FROM email_signups ORDER BY id LIMIT ? OFFSET ?',
      [BATCH_SIZE, offset]
    );

    if (rows.length === 0) break;
    offset += rows.length;

    for (const row of rows) {
      totalProcessed++;
      const { id, email_encrypted } = row;

      // Determine current version from ciphertext prefix
      const colonIdx = email_encrypted.indexOf(':');
      const recordVersion = colonIdx !== -1 ? email_encrypted.slice(0, colonIdx) : 'v1';

      // Skip records already at target version
      if (recordVersion === TO_VERSION) {
        totalSkipped++;
        continue;
      }
      // Skip records not at source version (don't touch unexpected versions)
      if (recordVersion !== FROM_VERSION) {
        console.warn(`  SKIP ${id}: unexpected version ${recordVersion}`);
        totalSkipped++;
        continue;
      }

      try {
        const plaintext = await decryptValue(email_encrypted, FROM_VERSION);
        const reencrypted = await encryptValue(plaintext, TO_VERSION);

        if (DRY_RUN) {
          console.log(`  DRY ${id}: ${FROM_VERSION} → ${TO_VERSION}`);
        } else {
          await d1Query(
            'UPDATE email_signups SET email_encrypted = ? WHERE id = ?',
            [reencrypted, id]
          );
          totalUpdated++;
        }
      } catch (err) {
        console.error(`  ERROR ${id}: ${err instanceof Error ? err.message : String(err)}`);
        totalErrors++;
      }
    }

    console.log(
      `Processed ${totalProcessed} records (${totalUpdated} updated, ${totalSkipped} skipped, ${totalErrors} errors)`
    );
  }

  console.log('');
  console.log('── Summary ──────────────────────────────────────────────');
  console.log(`  Total processed : ${totalProcessed}`);
  console.log(`  Updated         : ${totalUpdated}`);
  console.log(`  Skipped         : ${totalSkipped}`);
  console.log(`  Errors          : ${totalErrors}`);
  if (DRY_RUN) console.log('  Mode            : DRY RUN — no records were written');
  if (totalErrors > 0) {
    console.error('  WARNING: some records failed — review errors above before proceeding');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
