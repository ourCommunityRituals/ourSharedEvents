/**
 * INVARIANT 15: CORS Allowlist Immutability
 *
 * Brain Invariant #15 (cors_allowlist_immutability):
 *   - status: live (structural gate is the enforcement mechanism)
 *   - brain canonical: OCR-docs/ocr-docs-brain/architectural-invariants.yaml
 *
 * The CORS origin allowlist in src/lib/cors.ts controls which origins can
 * make credentialed cross-origin requests to the OSE Worker. A wildcard ('*')
 * or true unconditional passthrough would allow any origin — including
 * adversarial ones — to make requests to the admin API and read/write event
 * data. The allowlist must remain an explicit set of OCR-owned domains.
 *
 * What this spec locks:
 *   - cors.ts exists at the canonical path
 *   - No wildcard ('*') appears anywhere in cors.ts
 *   - corsOrigin returns null for non-allowlisted origins (no unconditional true)
 *   - corsHeaders returns empty object for blocked origins (no ACAO on all)
 *   - ALLOWED_ORIGINS is a Set (not a plain array, not a regex, not a boolean)
 *   - Every domain in ALLOWED_ORIGINS is an oursharedevents.com subdomain
 *
 * Pattern reference: monetization-inert.invariant.spec.ts (same L0 structural
 * approach using readFileSync via node:fs).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const CORS_LIB = join(REPO_ROOT, 'workers', 'oursharedevents', 'src', 'lib', 'cors.ts');

test.describe('Invariant 15: CORS Allowlist Immutability — structural code-shape lock', () => {
  test('OSE-INV15 | security | cors | cors.ts exists at canonical path', () => {
    expect(
      existsSync(CORS_LIB),
      'workers/oursharedevents/src/lib/cors.ts must exist — ' +
        'CORS origin control lives here; if it moves, this gate must be updated'
    ).toBe(true);
  });

  test('OSE-INV15 | security | cors | no wildcard (*) origin appears in cors.ts', () => {
    const src = readFileSync(CORS_LIB, 'utf8');
    // A wildcard CORS policy allows ANY origin — including adversarial clients —
    // to make credentialed requests. This is the highest-impact single-char change
    // that can silently open the admin API to every origin on the internet.
    expect(
      src,
      'cors.ts must not contain a wildcard origin (*) — ' +
        "a '*' CORS policy lets any origin query the admin API"
    ).not.toMatch(/'[*]'|"[*]"/);
  });

  test('OSE-INV15 | security | cors | ALLOWED_ORIGINS is declared as a Set (not open passthrough)', () => {
    const src = readFileSync(CORS_LIB, 'utf8');
    // Set<string> with explicit members is the correct pattern — it requires
    // every allowed origin to be enumerated. A boolean true, a regex, or a
    // missing allowlist check would bypass the gate silently.
    expect(
      src,
      'cors.ts must declare ALLOWED_ORIGINS as a Set — ' +
        'Set.has() is the O(1) exact-match gate; a regex or boolean would be an open door'
    ).toMatch(/new\s+Set\s*\(/);
    expect(src, 'cors.ts must call ALLOWED_ORIGINS.has() to enforce the allowlist').toMatch(
      /ALLOWED_ORIGINS\.has\s*\(/
    );
  });

  test('OSE-INV15 | security | cors | corsOrigin returns null for blocked origins (no unconditional return)', () => {
    const src = readFileSync(CORS_LIB, 'utf8');
    // corsOrigin must return null when the origin is not in the allowlist.
    // An unconditional `return origin` or `return request.headers.get('Origin')`
    // would pass any origin through without allowlist check.
    expect(src, 'cors.ts must export a corsOrigin function').toMatch(
      /export\s+function\s+corsOrigin/
    );
    expect(
      src,
      'corsOrigin must return null on failure — ' +
        'the null guard is what prevents unauthorized origins from receiving ACAO headers'
    ).toMatch(/return\s+null/);
  });

  test('OSE-INV15 | security | cors | corsHeaders returns empty object for non-allowlisted origins', () => {
    const src = readFileSync(CORS_LIB, 'utf8');
    // corsHeaders must return {} when the origin is not allowed. If it returns
    // a populated ACAO header unconditionally, every response carries the header
    // regardless of allowlist state.
    expect(src, 'cors.ts must export a corsHeaders function').toMatch(
      /export\s+function\s+corsHeaders/
    );
    expect(
      src,
      'corsHeaders must return {} (empty headers) for blocked origins — ' +
        'returning an ACAO header unconditionally negates the allowlist check'
    ).toMatch(/return\s+\{\s*\}/);
  });

  test('OSE-INV15 | security | cors | every allowed origin is an OCR-owned domain', () => {
    const src = readFileSync(CORS_LIB, 'utf8');
    // Extract all string literals from ALLOWED_ORIGINS. Each must be a domain
    // under oursharedevents.com. A developer adding a personal domain, a
    // localhost:*, or a competitor's domain would break this assertion.
    //
    // The pattern captures: 'https://...', "https://..."
    const originMatches = [...src.matchAll(/['"]https?:\/\/([^'"]+)['"]/g)];
    const domains = originMatches.map((m) => m[1]);
    // Filter to only those inside the ALLOWED_ORIGINS block
    const inAllowedBlock = src.indexOf('ALLOWED_ORIGINS');
    const afterAllowed = src.slice(inAllowedBlock, inAllowedBlock + 500);
    const allowedDomains = [...afterAllowed.matchAll(/['"]https?:\/\/([^'"]+)['"]/g)].map(
      (m) => m[1]
    );
    for (const domain of allowedDomains) {
      expect(
        domain,
        `CORS allowlist contains '${domain}' which is not an OCR-owned oursharedevents.com domain — ` +
          'only oursharedevents.com and its subdomains may be in the CORS allowlist'
      ).toMatch(/^(?:www\.|stg\.)?oursharedevents\.com$/);
    }
    expect(allowedDomains.length, 'CORS allowlist must contain at least 1 domain').toBeGreaterThan(
      0
    );
  });

  test('OSE-INV15 | security | cors | production set excludes the staging origin (OSE-1417)', () => {
    const src = readFileSync(CORS_LIB, 'utf8');
    // The production Worker must not trust stg.oursharedevents.com: staging runs
    // looser admin fallbacks. The staging origin may appear only in the
    // staging-only set, and that set may only be consulted when
    // WORKER_ENV === 'staging'.
    const prodBlock = src.match(
      /const\s+ALLOWED_ORIGINS\s*=\s*new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)/
    );
    expect(prodBlock, 'ALLOWED_ORIGINS must be declared as new Set([...])').not.toBeNull();
    expect(
      prodBlock![1],
      'stg.oursharedevents.com must not be in ALLOWED_ORIGINS (the production set) — ' +
        'put it in STAGING_ONLY_ORIGINS, gated on WORKER_ENV === staging'
    ).not.toMatch(/stg\.oursharedevents\.com/);
    expect(src, 'STAGING_ONLY_ORIGINS may only be consulted behind a staging-env check').toMatch(
      /isStaging\([^)]*\)\s*&&\s*STAGING_ONLY_ORIGINS\.has\s*\(/
    );
    expect(src, "isStaging must compare WORKER_ENV to 'staging'").toMatch(
      /WORKER_ENV\s*===\s*'staging'/
    );
  });
});
