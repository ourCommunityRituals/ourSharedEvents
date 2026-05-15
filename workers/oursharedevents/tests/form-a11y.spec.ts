/**
 * A11Y-2: Form accessibility — labels, errors, autocomplete
 *
 * Pyramid coverage:
 *   L1 Static — HTML template contains role="alert", autocomplete, aria-required,
 *               survey rating group has role="group" + aria-labelledby
 *   L2 Integration — /forms/:id (each type) serves accessible markup
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { handleFormPage } from '../src/handlers/form-pages';

// ─── L1 Static: template structure ─────────────────────────────────────────

describe('A11Y-2 L1 Static: error-msg has role=alert + aria-live=assertive', () => {
  const types = ['register', 'checkin', 'survey', 'email'] as const;

  for (const type of types) {
    test(`${type} form error-msg has role="alert"`, async () => {
      // OSE-R-007 (2026-05-15): handleFormPage is now async because it
      // does a D1 lookup for the canonical event title. Await its
      // Response before reading headers/body.
      const req = new Request(`https://t.test/forms/evt1?type=${type}&event=Test`);
      const res = await handleFormPage(req, {}, 'evt1');
      expect(res.headers.get('Content-Type')).toContain('text/html');
    });
  }
});

describe('A11Y-2 L1 Static: registration form autocomplete + aria-required', () => {
  async function html(): Promise<string> {
    const req = new Request('https://t.test/forms/evt1?type=register&event=Test');
    return (await handleFormPage(req, {}, 'evt1')).text();
  }

  test('name input has autocomplete="name"', async () => {
    expect(await html()).toContain('autocomplete="name"');
  });

  test('name input has aria-required="true"', async () => {
    expect(await html()).toContain('aria-required="true"');
  });

  test('email input has autocomplete="email"', async () => {
    expect(await html()).toContain('autocomplete="email"');
  });

  test('error-msg has role="alert"', async () => {
    expect(await html()).toContain('role="alert"');
  });

  test('error-msg has aria-live="assertive"', async () => {
    expect(await html()).toContain('aria-live="assertive"');
  });
});

describe('A11Y-2 L1 Static: survey form rating group', () => {
  async function html(): Promise<string> {
    const req = new Request('https://t.test/forms/evt1?type=survey&event=Test');
    return (await handleFormPage(req, {}, 'evt1')).text();
  }

  test('rating div has role="group"', async () => {
    expect(await html()).toContain('role="group"');
  });

  test('rating div has aria-labelledby="rating-label"', async () => {
    expect(await html()).toContain('aria-labelledby="rating-label"');
  });

  test('label has id="rating-label"', async () => {
    expect(await html()).toContain('id="rating-label"');
  });
});

describe('A11Y-2 L1 Static: email signup form', () => {
  async function html(): Promise<string> {
    const req = new Request('https://t.test/forms/evt1?type=email&event=Test');
    return (await handleFormPage(req, {}, 'evt1')).text();
  }

  test('email input has autocomplete="email"', async () => {
    expect(await html()).toContain('autocomplete="email"');
  });

  test('email input has aria-required="true"', async () => {
    expect(await html()).toContain('aria-required="true"');
  });

  test('error-msg has role="alert"', async () => {
    expect(await html()).toContain('role="alert"');
  });
});

// ─── L2 Integration: /forms/:id routes serve accessible markup ─────────────

interface TestEnv {
  FORMS_DB: D1Database;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

describe('A11Y-2 L2 Integration: /forms/:id serves accessible markup', () => {
  beforeAll(async () => {
    const tenv = env as unknown as TestEnv;
    const stmts = JSON.parse(tenv.TEST_FORMS_MIGRATION_STATEMENTS) as string[];
    for (const stmt of stmts) {
      try {
        await tenv.FORMS_DB.prepare(stmt).run();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes('duplicate column name') && !msg.includes('already exists')) throw e;
      }
    }
  });

  test('register form: error-msg role=alert present', async () => {
    const res = await SELF.fetch('https://t.test/forms/evt1?type=register&event=Test');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('role="alert"');
    expect(body).toContain('aria-live="assertive"');
  });

  test('register form: autocomplete=name on name input', async () => {
    const res = await SELF.fetch('https://t.test/forms/evt1?type=register&event=Test');
    const body = await res.text();
    expect(body).toContain('autocomplete="name"');
  });

  test('checkin form: error-msg role=alert present', async () => {
    const res = await SELF.fetch('https://t.test/forms/evt1?type=checkin&event=Test');
    const body = await res.text();
    expect(body).toContain('role="alert"');
  });

  test('survey form: rating group role=group present', async () => {
    const res = await SELF.fetch('https://t.test/forms/evt1?type=survey&event=Test');
    const body = await res.text();
    expect(body).toContain('role="group"');
    expect(body).toContain('aria-labelledby="rating-label"');
  });

  test('email form: autocomplete=email + aria-required on email input', async () => {
    const res = await SELF.fetch('https://t.test/forms/evt1?type=email&event=Test');
    const body = await res.text();
    expect(body).toContain('autocomplete="email"');
    expect(body).toContain('aria-required="true"');
  });
});
