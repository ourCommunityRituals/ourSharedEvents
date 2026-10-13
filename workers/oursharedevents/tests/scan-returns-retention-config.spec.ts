import { describe, test, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { resolveScanReturnsRetentionDays } from '../src/lib/scan-returns-retention';

/**
 * OSE-1659 — the scan return-signal retention window is on in every env.
 *
 * `runScanReturnsRetention` is a no-op unless `SCAN_RETURNS_RETENTION_DAYS` is
 * set, and named Cloudflare envs do not inherit top-level `[vars]`. Before this,
 * no env set it, so `scan_node_returns` and `anon_id_returns` kept every row
 * forever, including the rows of scan-only visitors, who have no erasure path.
 *
 * The floor: `aggregateScanBuckets` re-counts every event that started in the
 * last 90 days from `scan_node_returns`, and a poster can be scanned months
 * before its event. A window shorter than 180 days could delete scans of an
 * event that is still re-counted, and shrink a published aggregate.
 */

const MIN_DAYS = 180;

function varsSection(toml: string, envName: string | null): string {
  const name = envName ? `env\\.${envName}\\.vars` : 'vars';
  // Anchor to a header on its own line: comments elsewhere mention the name.
  const header = new RegExp(`^\\[${name}\\][ \\t]*\\r?$`, 'm');
  const match = header.exec(toml);
  if (!match) return '';
  const rest = toml.slice(match.index + match[0].length);
  const next = rest.search(/^\s*\[/m);
  return next === -1 ? rest : rest.slice(0, next);
}

/** The value a section sets for a key (ignores comments), or undefined. */
function setValue(section: string, key: string): string | undefined {
  for (const raw of section.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1 || line.slice(0, eq).trim() !== key) continue;
    return line
      .slice(eq + 1)
      .trim()
      .replace(/^"(.*)"$/, '$1');
  }
  return undefined;
}

describe('OSE-1659 | SCAN_RETURNS_RETENTION_DAYS is set in every env', () => {
  const toml = (env as Record<string, unknown>).TEST_WRANGLER_TOML as string;

  test.each([
    ['local / dev ([vars])', null],
    ['staging', 'staging'],
    ['production', 'production'],
  ])('%s sets a window of at least 180 days', (_label, envName) => {
    const section = varsSection(toml, envName as string | null);
    expect(section, 'vars section found').not.toBe('');
    const raw = setValue(section, 'SCAN_RETURNS_RETENTION_DAYS');
    expect(raw, 'SCAN_RETURNS_RETENTION_DAYS is set').toBeDefined();
    const days = resolveScanReturnsRetentionDays(raw);
    expect(days, 'the sweep is on').toBeGreaterThan(0);
    expect(days).toBeGreaterThanOrEqual(MIN_DAYS);
  });

  test('the parser reads a value it should (sanity)', () => {
    expect(setValue(varsSection(toml, 'production'), 'WORKER_ENV')).toBe('production');
  });
});
