/**
 * Sheets Dependency Elimination Gate
 *
 * Verifies the Phase 2 D1 worker has zero Google Sheets dependencies.
 * This test exists because a stale deployment once served GAS-era code
 * that returned 503 SHEETS_DB_ID_MISSING in staging.
 *
 * Gates:
 *   SHEETS-1. No SHEETS_SPREADSHEET_ID or SHEETS_DB_ID in source code
 *   SHEETS-2. No Google Sheets API imports or URLs in source code
 *   SHEETS-3. No SHEETS env vars in wrangler.toml
 *   SHEETS-4. Events endpoint handler uses D1, not Sheets
 *   SHEETS-5. No googleapis or google-spreadsheet dependencies
 */

import { env } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
  TEST_WRANGLER_TOML: string;
}

function getSourceFiles(): Record<string, string> {
  return JSON.parse((env as unknown as TestEnv).TEST_SOURCE_FILES_JSON);
}

function getWranglerToml(): string {
  return (env as unknown as TestEnv).TEST_WRANGLER_TOML;
}

// ── SHEETS-1: No SHEETS_SPREADSHEET_ID or SHEETS_DB_ID in source ────────────

describe('SHEETS-1: No Sheets ID references in source code', () => {
  test('no file references SHEETS_SPREADSHEET_ID', () => {
    const files = getSourceFiles();
    const violations: string[] = [];

    for (const [path, content] of Object.entries(files)) {
      if (path.replace(/\\/g, '/').includes('/tests/')) continue;
      if (content.includes('SHEETS_SPREADSHEET_ID')) {
        violations.push(path);
      }
    }

    expect(violations, `SHEETS_SPREADSHEET_ID found in: ${violations.join(', ')}`).toHaveLength(0);
  });

  test('no file references SHEETS_DB_ID', () => {
    const files = getSourceFiles();
    const violations: string[] = [];

    for (const [path, content] of Object.entries(files)) {
      if (path.replace(/\\/g, '/').includes('/tests/')) continue;
      if (content.includes('SHEETS_DB_ID')) {
        violations.push(path);
      }
    }

    expect(violations, `SHEETS_DB_ID found in: ${violations.join(', ')}`).toHaveLength(0);
  });

  test('no file returns SHEETS_DB_ID_MISSING error code', () => {
    const files = getSourceFiles();
    const violations: string[] = [];

    for (const [path, content] of Object.entries(files)) {
      if (path.replace(/\\/g, '/').includes('/tests/')) continue;
      if (content.includes('SHEETS_DB_ID_MISSING')) {
        violations.push(path);
      }
    }

    expect(
      violations,
      `SHEETS_DB_ID_MISSING error code found in: ${violations.join(', ')}`
    ).toHaveLength(0);
  });
});

// ── SHEETS-2: No Google Sheets API imports or URLs ──────────────────────────

describe('SHEETS-2: No Google Sheets API usage in source code', () => {
  test('no file imports or references googleapis/sheets', () => {
    const files = getSourceFiles();
    const sheetsPatterns = [
      'googleapis.com/v4/spreadsheets',
      'sheets.googleapis.com',
      'google-spreadsheet',
      'sheetsGetValues',
      'sheetsAppendRow',
      'SheetsReadError',
    ];
    const violations: { path: string; pattern: string }[] = [];

    for (const [path, content] of Object.entries(files)) {
      if (path.replace(/\\/g, '/').includes('/tests/')) continue;
      for (const pattern of sheetsPatterns) {
        if (content.includes(pattern)) {
          violations.push({ path, pattern });
        }
      }
    }

    expect(
      violations,
      `Google Sheets patterns found:\n${violations.map((v) => `  ${v.pattern} in ${v.path}`).join('\n')}`
    ).toHaveLength(0);
  });
});

// ── SHEETS-3: No SHEETS env vars in wrangler.toml ───────────────────────────

describe('SHEETS-3: No Sheets configuration in wrangler.toml', () => {
  test('wrangler.toml has no active SHEETS_ env vars', () => {
    const toml = getWranglerToml();
    const activeLines = toml
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');

    expect(activeLines).not.toMatch(/SHEETS_SPREADSHEET_ID/);
    expect(activeLines).not.toMatch(/SHEETS_DB_ID/);
  });

  test('wrangler.toml has no active GOOGLE_SA_ secrets', () => {
    const toml = getWranglerToml();
    const activeLines = toml
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');

    expect(activeLines).not.toMatch(/GOOGLE_SA_CLIENT_EMAIL/);
    expect(activeLines).not.toMatch(/GOOGLE_SA_PRIVATE_KEY/);
  });
});

// ── SHEETS-4: Events handler uses D1 ────────────────────────────────────────

describe('SHEETS-4: Events endpoint uses D1, not Sheets', () => {
  test('events handler references env.DB (D1 binding)', () => {
    const files = getSourceFiles();
    const eventsHandler = Object.entries(files).find(([p]) => {
      const name = p.replace(/\\/g, '/').split('/').pop() ?? '';
      return name === 'events.ts' && p.replace(/\\/g, '/').includes('/handlers/');
    });

    expect(eventsHandler, 'handlers/events.ts not found in source').toBeDefined();
    const [, content] = eventsHandler!;
    expect(content).toContain('env.DB');
  });

  test('events handler does not reference Sheets or spreadsheet in executable code', () => {
    const files = getSourceFiles();
    const eventsHandler = Object.entries(files).find(([p]) => {
      const name = p.replace(/\\/g, '/').split('/').pop() ?? '';
      return name === 'events.ts' && p.replace(/\\/g, '/').includes('/handlers/');
    });

    expect(eventsHandler, 'handlers/events.ts not found in source').toBeDefined();
    const [, content] = eventsHandler!;

    // Strip comments (single-line and multi-line) before checking
    const codeOnly = content
      .replace(/\/\*[\s\S]*?\*\//g, '') // multi-line comments
      .replace(/\/\/.*$/gm, ''); // single-line comments

    expect(codeOnly).not.toMatch(/sheets/i);
    expect(codeOnly).not.toMatch(/spreadsheet/i);
    expect(codeOnly).not.toMatch(/SHEETS_SPREADSHEET_ID/);
  });
});

// ── SHEETS-5: No Sheets packages in dependencies ───────────────────────────

describe('SHEETS-5: No Google Sheets packages', () => {
  test('no googleapis or google-spreadsheet in source imports', () => {
    const files = getSourceFiles();
    const violations: string[] = [];

    for (const [path, content] of Object.entries(files)) {
      if (
        content.match(/from\s+['"]googleapis['"]/) ||
        content.match(/from\s+['"]google-spreadsheet['"]/) ||
        content.match(/require\s*\(\s*['"]googleapis['"]/) ||
        content.match(/require\s*\(\s*['"]google-spreadsheet['"]/)
      ) {
        violations.push(path);
      }
    }

    expect(violations, `Sheets package imports found in: ${violations.join(', ')}`).toHaveLength(0);
  });
});
