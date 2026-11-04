import { describe, test, expect } from 'vitest';
import { env } from 'cloudflare:test';

/**
 * OSE-1415 — production admin visibility comes only from brand membership.
 *
 * `ADMIN_SCOPE_ALL=true` lets key/automation actors read every brand unscoped
 * (lib/admin-brand-scope.ts). It is a staging/CI opt-in. Production must never
 * carry it: there, the founder sees the root brand because of one
 * `admin_brand_memberships` row (a runbook data step), not because of a flag.
 * Nothing pinned this before, so one line in wrangler.toml could have widened
 * production admin to every brand.
 */

function envVarsSection(toml: string, envName: string): string {
  // Anchor to a header on its own line: comments elsewhere mention the name.
  const header = new RegExp(`^\\[env\\.${envName}\\.vars\\][ \\t]*\\r?$`, 'm');
  const match = header.exec(toml);
  if (!match) return '';
  const rest = toml.slice(match.index + match[0].length);
  const next = rest.search(/^\s*\[/m);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Keys actually set in a section (ignores comments). */
function setKeys(section: string): string[] {
  return section
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('=')[0].trim());
}

describe('OSE-1415 | production admin scope config', () => {
  const toml = (env as Record<string, unknown>).TEST_WRANGLER_TOML as string;

  test('[env.production.vars] exists and is parsed', () => {
    const prod = setKeys(envVarsSection(toml, 'production'));
    expect(prod).toContain('WORKER_ENV');
    expect(prod).toContain('ALLOWED_ADMIN_EMAILS');
  });

  test('ADMIN_SCOPE_ALL is NOT set in [env.production.vars]', () => {
    const prod = setKeys(envVarsSection(toml, 'production'));
    expect(prod).not.toContain('ADMIN_SCOPE_ALL');
  });

  // ADR-012 gate R2 (OSE-1467): a static X-OCR-Internal header is a `key:` actor
  // that passes requireKeyActor, so it could write production global flags and
  // run erasure. Production admin is CF Access only.
  test.each(['ALLOW_OCR_INTERNAL', 'ALLOW_ADMIN_KEY_FALLBACK', 'STAGING_VARIANT'])(
    '%s is NOT set in [env.production.vars]',
    (key) => {
      const prod = setKeys(envVarsSection(toml, 'production'));
      expect(prod).not.toContain(key);
    }
  );

  test('the staging opt-in is still where it belongs (parser sanity)', () => {
    const stg = setKeys(envVarsSection(toml, 'staging'));
    expect(stg).toContain('ADMIN_SCOPE_ALL');
  });
});
