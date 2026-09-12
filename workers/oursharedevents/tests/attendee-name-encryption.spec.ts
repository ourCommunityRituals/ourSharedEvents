/**
 * DE-01 (SecurityCritical) — attendee_name MUST be encrypted at rest
 * (Anonymous Contract A-5: "personal data encrypted at rest").
 *
 * DE-06 (High) — email hashing on WRITE paths MUST NOT silently degrade to
 * bare (unpeppered) SHA-256 when FORMS_HASH_PEPPER is unset; a name/email write
 * with the pepper absent MUST fail closed (503), not succeed (200).
 *
 * Runs in the workers pool (env.FORMS_DB / miniflare). The workers-pool env sets
 * FORMS_ENCRYPTION_KEY + FORMS_HASH_PEPPER globally (vitest.workers.config.mts),
 * so the negative cases build a custom env with those keys omitted.
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import {
  handleFormRegistration,
  handleFormEmailSignup,
  type FormsEnv,
} from '../src/handlers/forms';
import { decryptText } from '../src/lib/pii';

interface TestEnv {
  FORMS_DB: D1Database;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  FORMS_ENCRYPTION_KEY: string;
  FORMS_HASH_PEPPER: string;
}

const tenv = () => env as unknown as TestEnv;
const formsEnv = (): FormsEnv => env as unknown as FormsEnv;
const formsDb = () => tenv().FORMS_DB;

function postReq(body: Record<string, unknown>): Request {
  return new Request('https://de01.test/form', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

beforeAll(async () => {
  const stmts: string[] = JSON.parse(tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await formsDb().prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }
});

describe('DE-01: attendee_name is encrypted at rest (A-5)', () => {
  // @born-red DE-01 | method: raw-row-inspection | date: 2026-09-12
  test('a registered name is stored as v1: ciphertext in attendee_name_encrypted; legacy attendee_name is NULL', async () => {
    const EVENT = 'evt-de01-enc';
    const NAME = 'Àlïce Ma°Cusing-Case'; // mixed case + non-ASCII: must survive verbatim

    const res = await handleFormRegistration(postReq({ name: NAME }), formsEnv(), EVENT);
    expect(res.status).toBe(200);
    const body = await json(res);
    const regId = body.id as string;
    expect(regId).toBeDefined();

    // Inspect the RAW row directly in the DB (bypassing the decrypt-on-read path).
    const row = await formsDb()
      .prepare('SELECT attendee_name, attendee_name_encrypted FROM form_registrations WHERE id = ?')
      .bind(regId)
      .first<{ attendee_name: string | null; attendee_name_encrypted: string | null }>();

    // THE assertion that catches cleartext-at-rest: the legacy column is NULL and
    // the name is nowhere in the raw row except as opaque AES-GCM ciphertext.
    expect(row!.attendee_name).toBeNull();
    expect(typeof row!.attendee_name_encrypted).toBe('string');
    expect(row!.attendee_name_encrypted!.startsWith('v1:')).toBe(true);
    expect(JSON.stringify(row)).not.toContain(NAME);

    // …and it round-trips back to the EXACT original (case + non-ASCII preserved).
    const decrypted = await decryptText(row!.attendee_name_encrypted!, tenv().FORMS_ENCRYPTION_KEY);
    expect(decrypted).toBe(NAME);
  });

  // @born-red DE-01 | method: fail-closed-guard | date: 2026-09-12
  test('a name-present registration with NO FORMS_ENCRYPTION_KEY returns 503 (never stores cleartext)', async () => {
    const EVENT = 'evt-de01-noenckey';
    const noKeyEnv = { ...formsEnv(), FORMS_ENCRYPTION_KEY: undefined } as FormsEnv;

    const res = await handleFormRegistration(postReq({ name: 'No Key Person' }), noKeyEnv, EVENT);
    expect(res.status).toBe(503);

    // Nothing was written.
    const cnt = await formsDb()
      .prepare('SELECT COUNT(*) AS n FROM form_registrations WHERE event_id = ?')
      .bind(EVENT)
      .first<{ n: number }>();
    expect(cnt!.n).toBe(0);
  });
});

describe('DE-06: WRITE paths fail closed when FORMS_HASH_PEPPER is unset', () => {
  // @born-red DE-06 | method: fail-closed-guard | date: 2026-09-12
  test('registration with an email and NO pepper returns 503 (not 200)', async () => {
    const EVENT = 'evt-de06-reg';
    const noPepperEnv = { ...formsEnv(), FORMS_HASH_PEPPER: undefined } as FormsEnv;

    const res = await handleFormRegistration(
      postReq({ name: 'Pepper Missing', email: 'nopepper@example.com' }),
      noPepperEnv,
      EVENT
    );
    expect(res.status).toBe(503);

    const cnt = await formsDb()
      .prepare('SELECT COUNT(*) AS n FROM form_registrations WHERE event_id = ?')
      .bind(EVENT)
      .first<{ n: number }>();
    expect(cnt!.n).toBe(0);
  });

  // @born-red DE-06 | method: fail-closed-guard | date: 2026-09-12
  test('email-signup with NO pepper returns 503 (not 200)', async () => {
    const EVENT = 'evt-de06-signup';
    const noPepperEnv = { ...formsEnv(), FORMS_HASH_PEPPER: undefined } as FormsEnv;

    const res = await handleFormEmailSignup(
      postReq({ email: 'nopepper-signup@example.com' }),
      noPepperEnv,
      EVENT
    );
    expect(res.status).toBe(503);

    const cnt = await formsDb()
      .prepare('SELECT COUNT(*) AS n FROM email_signups WHERE event_id = ?')
      .bind(EVENT)
      .first<{ n: number }>();
    expect(cnt!.n).toBe(0);
  });
});
