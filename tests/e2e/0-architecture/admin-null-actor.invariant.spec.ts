/**
 * INVARIANT 9 (tenant isolation), admin actor: a null actor allows nothing.
 *
 * OSE-1801. Three admin handlers once read a null admin actor as "the local-dev
 * bypass, allow", and a token that expired mid-request turned a brand admin into
 * an admin of every brand. The fix denies a null actor everywhere unless the
 * DEV_OPEN_ADMIN bypass is really on (isDevOpenAdmin), re-tested at the site.
 *
 * This gate keeps it that way, structurally:
 *   1. Every call of extractAdminActor under workers/oursharedevents/src is
 *      classified below, keyed by file and the call's own line text, with a
 *      count. A new call site fails until someone classifies it, and a
 *      classification that no longer matches a call fails as an orphan.
 *   2. Each class carries a check on the code after the call:
 *        scope-denies-null   the actor goes to resolveAdminBrandScopeAsync,
 *                            which denies a null actor
 *        dev-open-retest     a null branch re-tests isDevOpenAdmin(env)
 *        attribution-only    the value is only recorded (audit, created_by)
 *        cede-to-auth        a pre-auth guard that hands a null actor to
 *                            requireAdmin (which answers 401)
 *        route-entry         route()'s first read, which fixes the actor
 *   3. No `mode: 'all'` scope literal is built outside lib/admin-brand-scope.ts
 *      unless an isDevOpenAdmin test sits right above it.
 *
 * L0 structural (readFileSync), T0 invariants shard.
 *
 * @born-red TL-084 | method: deliberate-fixture-break | date: 2026-11-04 |
 *   verified: a planted `actor === null ? ({ mode: 'all' } as const)` in
 *   handlers/events.ts failed check 3, a planted unclassified extractAdminActor
 *   call failed check 1, and a null branch in sponsors-draft.ts with its
 *   isDevOpenAdmin test removed failed check 2.
 */
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SRC = join(REPO_ROOT, 'workers', 'oursharedevents', 'src');

type Kind =
  'scope-denies-null' | 'dev-open-retest' | 'attribution-only' | 'cede-to-auth' | 'route-entry';

/** `<path under src>: <the call's line, trimmed>` → its class and how many such calls. */
const SITES: Record<string, { kind: Kind; count: number; why: string }> = {
  'router.ts: const _actor = extractAdminActor(request, env);': {
    kind: 'route-entry',
    count: 1,
    why: 'First read at route() entry; the memo keeps this answer for the request.',
  },
  'router.ts: actor: extractAdminActor(request, env),': {
    kind: 'attribution-only',
    count: 1,
    why: 'Audit attribution after requireAdmin.',
  },
  'lib/admin-write-guard.ts: const actor = extractAdminActor(request, env);': {
    kind: 'cede-to-auth',
    count: 1,
    why: 'Pre-auth write guard: a null actor is left to requireAdmin, which answers 401.',
  },
  'lib/admin-object-scope.ts: if (extractAdminActor(request, env) === null) return null;': {
    kind: 'cede-to-auth',
    count: 1,
    why: 'guardAdminObjectScope runs before requireAdmin; a null actor gets 401 there.',
  },
  'lib/admin-object-scope.ts: const scope = await resolveAdminBrandScopeAsync(extractAdminActor(request, env), env);':
    { kind: 'scope-denies-null', count: 2, why: 'isAdminObjectInScope and isPlatformActor.' },
  'lib/admin-object-scope.ts: const actor = extractAdminActor(request, env);': {
    kind: 'dev-open-retest',
    count: 1,
    why: 'requireKeyActor: a null actor passes only under isDevOpenAdmin.',
  },
  'handlers/events.ts: const actor = extractAdminActor(request, env);': {
    kind: 'dev-open-retest',
    count: 2,
    why: 'Event create (deny unless isDevOpenAdmin) and the "only mine" list (scope).',
  },
  'handlers/events.ts: const createdBy = extractAdminActor(request, env);': {
    kind: 'attribution-only',
    count: 1,
    why: 'created_by on the new row.',
  },
  'handlers/sponsors.ts: const scope = await resolveAdminBrandScopeAsync(extractAdminActor(request, env), env);':
    { kind: 'scope-denies-null', count: 3, why: 'Sponsor list, pool brand, sponsor reads.' },
  'handlers/sponsors.ts: const actor = extractAdminActor(request, env);': {
    kind: 'dev-open-retest',
    count: 1,
    why: 'Sponsor create on an event: a null actor gets EVENT_NOT_FOUND unless isDevOpenAdmin.',
  },
  'handlers/sponsors.ts: actor: extractAdminActor(request, env),': {
    kind: 'attribution-only',
    count: 2,
    why: 'Audit attribution.',
  },
  'handlers/sponsors-draft.ts: const actor = extractAdminActor(request, env);': {
    kind: 'dev-open-retest',
    count: 1,
    why: 'Draft promote: a null actor is out of scope unless isDevOpenAdmin.',
  },
  'handlers/sponsors-draft.ts: actor: extractAdminActor(request, env),': {
    kind: 'attribution-only',
    count: 1,
    why: 'Eligibility-decision audit.',
  },
  'handlers/dashboards.ts: const scope = await resolveAdminBrandScopeAsync(extractAdminActor(request, env), env);':
    { kind: 'scope-denies-null', count: 1, why: 'Dashboard brand scope.' },
  'handlers/portfolio-rollup.ts: extractAdminActor(request, env),': {
    kind: 'scope-denies-null',
    count: 1,
    why: 'Argument to resolveAdminBrandScopeAsync on the line above.',
  },
  'handlers/sponsor-home.ts: const actor = extractAdminActor(request, env);': {
    kind: 'scope-denies-null',
    count: 2,
    why: 'Sponsor home admin views, scoped by resolveAdminBrandScopeAsync.',
  },
  'handlers/bigquery.ts: actor: extractAdminActor(request, env),': {
    kind: 'attribution-only',
    count: 1,
    why: 'Backup attribution.',
  },
  'handlers/subscribers.ts: actor: extractAdminActor(request, env),': {
    kind: 'attribution-only',
    count: 2,
    why: 'PII-read audit attribution.',
  },
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

interface Call {
  key: string;
  file: string;
  line: number;
  after: string;
  before: string;
}

function findCalls(): Call[] {
  const calls: Call[] = [];
  for (const path of walk(SRC)) {
    const rel = relative(SRC, path).replace(/\\/g, '/');
    if (rel === 'auth/admin.ts') continue; // the definition itself
    const lines = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').split('\n');
    lines.forEach((text, i) => {
      if (!/\bextractAdminActor\(/.test(text)) return;
      if (/^\s*(\*|\/\/)/.test(text)) return; // prose
      calls.push({
        key: `${rel}: ${text.trim()}`,
        file: rel,
        line: i + 1,
        after: lines.slice(i, i + 16).join('\n'),
        before: lines.slice(Math.max(0, i - 3), i + 1).join('\n'),
      });
    });
  }
  return calls;
}

test.describe('Invariant 9: a null admin actor allows nothing (OSE-1801)', () => {
  const calls = findCalls();

  test('OSE-1801 | every extractAdminActor call is classified, with the right count', () => {
    expect(calls.length, 'the scan found no calls; the path or pattern is wrong').toBeGreaterThan(
      10
    );
    const counts = new Map<string, number>();
    for (const c of calls) counts.set(c.key, (counts.get(c.key) ?? 0) + 1);

    const unclassified = [...counts.keys()].filter((k) => !SITES[k]);
    expect(
      unclassified,
      'A new extractAdminActor call must be classified in SITES (and its null branch must ' +
        'deny unless isDevOpenAdmin, or the actor must go to resolveAdminBrandScopeAsync):\n' +
        unclassified.join('\n')
    ).toEqual([]);

    const wrongCount = Object.entries(SITES)
      .filter(([k, v]) => (counts.get(k) ?? 0) !== v.count)
      .map(([k, v]) => `${k}: expected ${v.count}, found ${counts.get(k) ?? 0}`);
    expect(
      wrongCount,
      'SITES counts no longer match the code (orphans or new copies):\n' + wrongCount.join('\n')
    ).toEqual([]);
  });

  test('OSE-1801 | each class does what its class says', () => {
    const bad: string[] = [];
    for (const c of calls) {
      const site = SITES[c.key];
      if (!site) continue; // reported by the test above
      const where = `${c.file}:${c.line}`;
      switch (site.kind) {
        case 'scope-denies-null':
          if (!/resolveAdminBrandScopeAsync\(/.test(c.before + c.after))
            bad.push(`${where} is scope-denies-null but no resolveAdminBrandScopeAsync follows`);
          break;
        case 'dev-open-retest':
          if (
            /actor\s*===\s*null|actor\s*!==\s*null|!actor\b/.test(c.after) &&
            !/isDevOpenAdmin\(env\)/.test(c.after)
          )
            bad.push(`${where} branches on a null actor without re-testing isDevOpenAdmin(env)`);
          break;
        case 'attribution-only':
          if (!/^\s*(actor:|const createdBy =)/.test(c.key.split(': ').slice(1).join(': ')))
            bad.push(`${where} is attribution-only but is not a plain recorded value`);
          break;
        case 'cede-to-auth':
        case 'route-entry':
          break;
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  test("OSE-1801 | no handler builds a `mode: 'all'` scope without an isDevOpenAdmin test right above it", () => {
    const bad: string[] = [];
    for (const path of walk(SRC)) {
      const rel = relative(SRC, path).replace(/\\/g, '/');
      if (rel === 'lib/admin-brand-scope.ts') continue; // the scope resolver itself
      const lines = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').split('\n');
      lines.forEach((text, i) => {
        if (!/mode:\s*'all'/.test(text) || /^\s*(\*|\/\/)/.test(text)) return;
        if (/scope\.mode === 'all'|mode === 'all'/.test(text)) return; // a comparison, not a grant
        const above = lines.slice(Math.max(0, i - 14), i + 1).join('\n');
        if (!/isDevOpenAdmin\(env\)/.test(above)) bad.push(`${rel}:${i + 1}: ${text.trim()}`);
      });
    }
    expect(
      bad,
      "A `{ mode: 'all' }` scope outside lib/admin-brand-scope.ts must sit under an " +
        'isDevOpenAdmin(env) test (OSE-1801):\n' +
        bad.join('\n')
    ).toEqual([]);
  });
});
