import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

// Never-who, log side: the Worker's own log lines may carry events, counts and
// ids, never the caller's network address, user agent or request headers.
// Cloudflare's edge sees the IP in transit; that is outside this gate. This
// gate covers what OUR code writes to logs, so a published claim of "we do not
// log who you are" cannot drift unnoticed.

const SRC = join(__dirname, '..', 'src');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Every console.* call, from its opening paren to its matching close. */
export function logCalls(source: string): string[] {
  const out: string[] = [];
  const re = /console\.(?:log|info|warn|error|debug)\s*\(/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') depth--;
    }
    out.push(source.slice(m.index, i));
  }
  return out;
}

const FORBIDDEN =
  /CF-Connecting-IP|X-Forwarded-For|clientIp|\buser-?agent\b|\bremoteip\b|request\.headers|\bheaders\.get\(|\.ip\b/i;

describe('log lines carry no network identity', () => {
  test('no console call in src/ names an IP, user agent or request headers', () => {
    const offenders: string[] = [];
    for (const file of tsFiles(SRC)) {
      for (const call of logCalls(readFileSync(file, 'utf8'))) {
        if (FORBIDDEN.test(call)) offenders.push(`${file}: ${call.slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the scanner sees a violating call (gate is not vacuous)', () => {
    const bad = `console.warn(JSON.stringify({ ip: request.headers.get('CF-Connecting-IP') }))`;
    expect(logCalls(bad).some((c) => FORBIDDEN.test(c))).toBe(true);
    expect(logCalls(`console.warn('ok', { id })`).some((c) => FORBIDDEN.test(c))).toBe(false);
  });

  test('the scanner finds log calls in src/ at all', () => {
    const total = tsFiles(SRC).reduce((n, f) => n + logCalls(readFileSync(f, 'utf8')).length, 0);
    expect(total).toBeGreaterThan(20);
  });
});

describe('the audit log keeps the network, not the machine', () => {
  test('maskIp is idempotent, so a masked value masks to itself', async () => {
    const { maskIp } = await import('../src/lib/ip-mask');
    for (const raw of ['203.0.113.77', '2001:db8:abcd:1::9', '::ffff:192.0.2.5']) {
      const once = maskIp(raw);
      expect(once).not.toBeNull();
      expect(maskIp(once)).toBe(once);
    }
    expect(maskIp('not an ip')).toBeNull();
  });
});
