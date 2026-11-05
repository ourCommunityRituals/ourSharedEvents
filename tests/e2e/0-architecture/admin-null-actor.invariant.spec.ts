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
 *   CCR 2026-11-04 (R1-03), comments stripped and every null-test form matched:
 *   `actor == null` with the bypass named only in a comment, the event-create
 *   ternary granting `mode: 'all'` without the bypass in its condition, an
 *   `extractAdminActor(…) ?? 'key:admin'` default, and a `!actor ||` branch in
 *   the write guard (cede-to-auth) each failed.
 *   PR #1107 review (2026-11-05), the scan now runs to the end of the actor's
 *   scope and the log exemption is the standalone line only: the write guard's
 *   content-type rule flipped to `actor === null` (17 lines below the read),
 *   `if (actor === null) return logNullAdminActorDenied(…), null;` in
 *   requireKeyActor, and the event list's `deny` return removed each failed
 *   check 2.
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

/**
 * Source with comments blanked (line count kept), so prose that mentions
 * `actor === null` or `isDevOpenAdmin(env)` can neither satisfy nor trip a check
 * (CCR 2026-11-04 R1-03). String contents are kept; a `//` inside a quoted URL
 * is not a comment start because it follows a quote or colon.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/** Every way the code can branch on `v` being null (or falsy), not only `=== null`. */
function nullTests(v: string): RegExp {
  // Escape every regex metacharacter (backslash included), not only `$`.
  const id = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    [
      `\\b${id}\\s*[!=]==?\\s*null\\b`,
      `\\bnull\\s*[!=]==?\\s*${id}\\b`,
      `\\b${id}\\s*[!=]==?\\s*undefined\\b`,
      `!\\s*${id}\\b(?!\\s*[.[(])`,
      `\\bif\\s*\\(\\s*${id}\\s*\\)`,
      `\\b${id}\\s*(?:\\?\\?|\\|\\||&&|\\?\\.)`,
      `\\b${id}\\s*\\?(?!\\?|\\.)`,
    ].join('|')
  );
}

/**
 * The last line of the block the call sits in: the actor's scope (a `const` is
 * block-scoped), so every later use of it is judged, not a fixed window (a
 * 16-line window missed the write guard's content-type rule; PR #1107 review).
 * Braces are counted on comment-stripped text; a brace inside a string can only
 * move the end, and the planted-fault cases below would show a scan cut short.
 */
function scopeEnd(lines: string[], from: number): number {
  let depth = 0;
  for (let j = from; j < lines.length; j++) {
    for (const ch of lines[j]!) {
      if (ch === '{') depth++;
      else if (ch === '}' && --depth < 0) return j;
    }
  }
  return lines.length - 1;
}

function findCalls(): Call[] {
  const calls: Call[] = [];
  for (const path of walk(SRC)) {
    const rel = relative(SRC, path).replace(/\\/g, '/');
    if (rel === 'auth/admin.ts') continue; // the definition itself
    const lines = stripComments(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).split('\n');
    lines.forEach((text, i) => {
      if (!/\bextractAdminActor\(/.test(text)) return;
      if (/^\s*(\*|\/\/)/.test(text)) return; // prose
      calls.push({
        key: `${rel}: ${text.trim()}`,
        file: rel,
        line: i + 1,
        after: lines.slice(i, scopeEnd(lines, i) + 1).join('\n'),
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
        case 'dev-open-retest': {
          // Every branch on a null actor carries the isDevOpenAdmin test in the
          // same condition (same line), or is the `if (v !== null) { … } else if
          // (!isDevOpenAdmin(env))` shape, or only logs the denial. With no null
          // branch at all, the actor must go straight to the scope resolver.
          const v = /const\s+(\w+)\s*=\s*extractAdminActor\(/.exec(c.key)?.[1];
          if (!v) {
            bad.push(`${where} is dev-open-retest but does not bind the actor to a name`);
            break;
          }
          const lines = c.after.split('\n').slice(1);
          // A condition can span lines (a wrapped ternary); judge the whole
          // statement, up to the line that ends it with `;` or opens a block.
          const statementAt = (i: number): string => {
            const end = lines.findIndex((l, j) => j >= i && /;|\{\s*$/.test(l));
            return lines.slice(i, end === -1 ? lines.length : end + 1).join(' ');
          };
          // Once the actor has gone to the scope resolver and a `deny` scope has
          // returned, a null actor is already refused; later uses of it only
          // narrow what an allowed caller sees ("only mine"). Judge the branches
          // before that point.
          const resolvedAt = lines.findIndex((l) =>
            new RegExp(`resolveAdminBrandScopeAsync\\(\\s*${v}\\b`).test(l)
          );
          const deniedAfter =
            resolvedAt !== -1 &&
            /\.mode\s*===\s*'deny'\)\s*\{?\s*(return\b|$)/m.test(
              lines.slice(resolvedAt, resolvedAt + 3).join('\n')
            );
          const judged = deniedAfter ? lines.slice(0, resolvedAt) : lines;
          const tests = judged.flatMap((l, i) => (nullTests(v).test(l) ? [statementAt(i)] : []));
          if (tests.length === 0) {
            if (!new RegExp(`resolveAdminBrandScopeAsync\\(\\s*${v}\\b`).test(c.after))
              bad.push(`${where} never handles a null actor and does not scope it`);
            break;
          }
          const elseRetest = /\belse\s+if\s*\(\s*!\s*isDevOpenAdmin\(env\)\s*\)/.test(c.after);
          for (const l of tests) {
            const ok =
              /isDevOpenAdmin\(env\)/.test(l) ||
              // Only the standalone log line: no return, no comma expression, no
              // other statement (logging does not prove denial; PR #1107 review).
              new RegExp(
                `^\\s*if\\s*\\(\\s*${v}\\s*===?\\s*null\\s*\\)\\s*logNullAdminActorDenied\\([^;()]*\\);\\s*$`
              ).test(l) ||
              (elseRetest &&
                new RegExp(`\\b${v}\\s*!==?\\s*null\\b|\\bif\\s*\\(\\s*${v}\\s*\\)`).test(l));
            if (!ok)
              bad.push(
                `${where} branches on a null actor without isDevOpenAdmin(env) in the same condition: ${l.trim()}`
              );
          }
          break;
        }
        case 'attribution-only':
          if (!/^\s*(actor:|const createdBy =)/.test(c.key.split(': ').slice(1).join(': ')))
            bad.push(`${where} is attribution-only but is not a plain recorded value`);
          break;
        case 'cede-to-auth': {
          // A pre-auth guard may only defer a null actor to requireAdmin (return
          // null = "not mine to decide") or act on a non-null one. It never opens
          // anything for a null actor and never consults the dev bypass.
          const v = /const\s+(\w+)\s*=\s*extractAdminActor\(/.exec(c.key)?.[1];
          if (/isDevOpenAdmin\(|mode:\s*'all'/.test(c.after))
            bad.push(`${where} is cede-to-auth but consults the dev bypass or grants all`);
          if (!v) {
            if (!/extractAdminActor\(request, env\)\s*===\s*null\)\s*return null;/.test(c.key))
              bad.push(`${where} is cede-to-auth but is neither a bound actor nor a null-defer`);
            break;
          }
          for (const l of c.after
            .split('\n')
            .slice(1)
            .filter((x) => nullTests(v).test(x))) {
            if (!new RegExp(`\\b${v}\\s*!==\\s*null\\s*&&`).test(l))
              bad.push(`${where} is cede-to-auth but branches on a null actor: ${l.trim()}`);
          }
          break;
        }
        case 'route-entry':
          // The order around it is pinned by admin-guard-order.invariant.spec.ts.
          if (
            c.file !== 'router.ts' ||
            !/const _actor = extractAdminActor\(request, env\);$/.test(c.key)
          )
            bad.push(`${where} is route-entry but is not route()'s first read`);
          break;
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  test('OSE-1801 | no call defaults or short-circuits the actor in place', () => {
    // `extractAdminActor(…) ?? 'x'`, `|| 'x'`, `&& …` or `?.` turn a null actor
    // into something else before any class check sees it (R1-03).
    const bad = calls
      .filter((c) => /extractAdminActor\([^)]*\)\s*(?:\?\?|\|\||&&|\?\.)/.test(c.key))
      .map((c) => `${c.file}:${c.line}: ${c.key}`);
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
