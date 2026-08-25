/**
 * A11Y-3: Table & tab panel accessibility — shared report page
 *
 * Pyramid coverage:
 *   L1 Static — SHARED_REPORT_HTML has h2 section headings with ids, aria-labelledby
 *               on sections, dl/dt/dd stat cards, sr-only caption, scope="col" on th
 *   L2 Integration — /sharedReport serves the accessible markup
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { handleSharedReportPage } from '../src/handlers/pages';

// ─── L1 Static ──────────────────────────────────────────────────────────────

describe('A11Y-3 L1 Static: section headings (h2 + id)', () => {
  async function html(): Promise<string> {
    return handleSharedReportPage({} as never).then((r) => r.text());
  }

  test('Events Overview is h2 with id=section-stats', async () => {
    expect(await html()).toContain('id="section-stats"');
    expect(await html()).toContain('>Events Overview</h2>');
  });

  test('Events section is h2 with id=section-events', async () => {
    expect(await html()).toContain('id="section-events"');
    expect(await html()).toContain('>Events</h2>');
  });

  test('Sponsor Overview is h2 with id=section-sponsors', async () => {
    expect(await html()).toContain('id="section-sponsors"');
    expect(await html()).toContain('>Sponsor Overview</h2>');
  });
});

describe('A11Y-3 L1 Static: sections have aria-labelledby', () => {
  async function html(): Promise<string> {
    return handleSharedReportPage({} as never).then((r) => r.text());
  }

  test('stats section has aria-labelledby="section-stats"', async () => {
    expect(await html()).toContain('aria-labelledby="section-stats"');
  });

  test('events section has aria-labelledby="section-events"', async () => {
    expect(await html()).toContain('aria-labelledby="section-events"');
  });

  test('sponsor section has aria-labelledby="section-sponsors"', async () => {
    expect(await html()).toContain('aria-labelledby="section-sponsors"');
  });
});

describe('A11Y-3 L1 Static: stat cards use dl/dt/dd', () => {
  async function html(): Promise<string> {
    return handleSharedReportPage({} as never).then((r) => r.text());
  }

  test('stat-total card contains dl.stat-dl', async () => {
    expect(await html()).toContain('class="stat-dl"');
  });

  test('stat-total uses dd element', async () => {
    const body = await html();
    expect(body).toContain('<dd id="stat-total">');
  });

  test('stat-active uses dd element', async () => {
    const body = await html();
    expect(body).toContain('<dd id="stat-active">');
  });

  test('Total Events label is dt element', async () => {
    expect(await html()).toContain('<dt>Total Events</dt>');
  });

  test('Active label is dt element', async () => {
    expect(await html()).toContain('<dt>Active</dt>');
  });
});

describe('A11Y-3 L1 Static: events table has scope=col headers', () => {
  async function html(): Promise<string> {
    return handleSharedReportPage({} as never).then((r) => r.text());
  }

  test('report-table class present in JS template', async () => {
    expect(await html()).toContain('report-table');
  });

  test('scope="col" present in JS template string', async () => {
    expect(await html()).toContain('scope="col"');
  });

  test('caption.sr-only present in JS template string', async () => {
    expect(await html()).toContain('sr-only');
    expect(await html()).toContain('Events list');
  });

  test('.sr-only CSS class defined', async () => {
    expect(await html()).toContain('.sr-only');
  });
});

// ─── L2 Integration ─────────────────────────────────────────────────────────

interface TestEnv {
  FORMS_DB: D1Database;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

describe('A11Y-3 L2 Integration: /sharedReport serves accessible report markup', () => {
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
    await tenv.FORMS_DB.prepare(
      `INSERT OR REPLACE INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
       VALUES ('a11y3-test-gate', 'global', '', 'analytics.shared-report', 1, datetime('now'))`
    ).run();
  });

  test('GET /sharedReport returns 200', async () => {
    const res = await SELF.fetch('https://t.test/sharedReport');
    expect(res.status).toBe(200);
  });

  test('response has h2 section headings', async () => {
    const res = await SELF.fetch('https://t.test/sharedReport');
    const body = await res.text();
    expect(body).toContain('id="section-stats"');
    expect(body).toContain('id="section-events"');
    expect(body).toContain('id="section-sponsors"');
  });

  test('response has aria-labelledby on sections', async () => {
    const res = await SELF.fetch('https://t.test/sharedReport');
    const body = await res.text();
    expect(body).toContain('aria-labelledby="section-stats"');
    expect(body).toContain('aria-labelledby="section-events"');
    expect(body).toContain('aria-labelledby="section-sponsors"');
  });

  test('response has dl/dt/dd stat cards', async () => {
    const res = await SELF.fetch('https://t.test/sharedReport');
    const body = await res.text();
    expect(body).toContain('class="stat-dl"');
    expect(body).toContain('<dd id="stat-total">');
    expect(body).toContain('<dd id="stat-active">');
  });

  test('response has scope="col" in JS template', async () => {
    const res = await SELF.fetch('https://t.test/sharedReport');
    const body = await res.text();
    expect(body).toContain('scope="col"');
  });
});
