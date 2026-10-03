/**
 * Access coverage meta-gate (OSE-1353, CCR 2026-10-01 step-1 checklist F1/F8).
 *
 * Every path the Worker guards with requireAdmin must sit behind the host's
 * Cloudflare Access app. A guarded path that Access does not cover reaches the
 * Worker with no Cf-Access-Jwt-Assertion and answers 401, so the admin UI breaks
 * on it, and the CF Access Canary used to probe only two of eight path groups,
 * so it could stay green over the gap (on 2026-10-01 staging left /dashboard,
 * /create, /briefing, /overview and /summary outside Access).
 *
 * Property-asserting (tests/e2e/0-architecture/README.md): the subject list is
 * derived from workers/oursharedevents/src/router.ts, not named here.
 *
 *   1. Every requireAdmin call site resolves to a path group, and every group
 *      is covered by a line of scripts/ci/access-protected-paths.txt.
 *   2. cf-access-canary.yml probes that file (not a hand-kept list).
 *
 * The detector is proven against synthetic negative controls first.
 */

const { readFileSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..', '..');
const ROUTER = join(ROOT, 'workers', 'oursharedevents', 'src', 'router.ts');
const PATHS_FILE = join(ROOT, 'scripts', 'ci', 'access-protected-paths.txt');
const CANARY = join(ROOT, '.github', 'workflows', 'cf-access-canary.yml');

/** '/api/v2/admin/...' → '/api/v2/admin'; anything else → its first segment. */
function groupOf(path) {
  return path.startsWith('/api/v2/admin') ? '/api/v2/admin' : '/' + path.split('/')[1];
}

/** Path literals in a code fragment: quoted strings and regex sources. */
function pathsIn(text) {
  const unescaped = text.replace(/\\\//g, '/');
  return [...unescaped.matchAll(/(?:['"`]|\^)(\/[a-z][a-z0-9\-/]*)/g)].map((m) => m[1]);
}

/**
 * For each requireAdmin( call, the path groups of the route condition that
 * governs it: walk up to the nearest top-level `if (`, and if that condition
 * names no path (a `fooMatch &&` guard), keep walking to the `pathname.match`
 * that defines it. Returns [{ line, groups }]; groups is [] when unresolved.
 */
function guardedSites(source) {
  const lines = source.split('\n');
  const sites = [];
  lines.forEach((l, i) => {
    if (!/\brequireAdmin\(/.test(l) || /^\s*import\b/.test(l)) return;
    let text = '';
    let sawIf = false;
    for (let j = i; j >= 0 && j > i - 40; j--) {
      if (j < i && /^\s{2}\}\s*$/.test(lines[j])) break; // previous route block
      text = lines[j] + '\n' + text;
      if (/^\s{2}(\}\s*else\s+)?if\s*\(/.test(lines[j])) sawIf = true;
      if (sawIf && pathsIn(text).length) break;
    }
    const groups = [...new Set(pathsIn(text).map(groupOf))];
    sites.push({ line: i + 1, groups });
  });
  return sites;
}

function listedGroups(fileText) {
  return new Set(
    fileText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map(groupOf)
  );
}

function uncovered(source, fileText) {
  const listed = listedGroups(fileText);
  const problems = [];
  for (const { line, groups } of guardedSites(source)) {
    if (groups.length === 0) {
      problems.push(`router.ts:${line} requireAdmin with no resolvable path`);
    }
    for (const g of groups) {
      if (!listed.has(g)) problems.push(`router.ts:${line} guards ${g}, not listed`);
    }
  }
  return problems;
}

describe('access-protected-paths detector (negative controls)', () => {
  const list = '/admin\n/api/v2/admin/sponsors\n';

  test('flags a guarded literal path that the list does not cover', () => {
    const src = [
      "  if (pathname === '/secret-console' && method === 'GET') {",
      '    const deny = await requireAdmin(request, env, id);',
      '  }',
    ].join('\n');
    expect(uncovered(src, list)).toEqual(['router.ts:2 guards /secret-console, not listed']);
  });

  test('resolves a match-variable guard to its regex and accepts a covered group', () => {
    const src = [
      '  const m = pathname.match(/^\\/api\\/v2\\/admin\\/things\\/([^/]+)$/);',
      "  if (m && method === 'PUT') {",
      '    const deny = await requireAdmin(request, env, id);',
      '  }',
    ].join('\n');
    expect(guardedSites(src)).toEqual([{ line: 3, groups: ['/api/v2/admin'] }]);
    expect(uncovered(src, list)).toEqual([]);
  });

  test('flags a requireAdmin whose route condition names no path', () => {
    const src = [
      '  if (flag) {',
      '    const deny = await requireAdmin(request, env, id);',
      '  }',
    ].join('\n');
    expect(uncovered(src, list)).toEqual(['router.ts:2 requireAdmin with no resolvable path']);
  });

  test('ignores comment lines in the list', () => {
    expect([...listedGroups('# /briefing\n\n/admin\n')]).toEqual(['/admin']);
  });
});

describe('every requireAdmin path group is behind Access (OSE-1353)', () => {
  const router = readFileSync(ROUTER, 'utf8');
  const list = readFileSync(PATHS_FILE, 'utf8');

  test('the router has guarded sites to check (not vacuous)', () => {
    expect(guardedSites(router).length).toBeGreaterThanOrEqual(40);
  });

  test('access-protected-paths.txt covers every group the router guards', () => {
    expect(uncovered(router, list)).toEqual([]);
  });

  test('access-protected-paths.txt lists no group the router does not guard', () => {
    const guarded = new Set(guardedSites(router).flatMap((s) => s.groups));
    expect([...listedGroups(list)].filter((g) => !guarded.has(g))).toEqual([]);
  });

  test('cf-access-canary.yml probes the file, not a hand-kept list', () => {
    const canary = readFileSync(CANARY, 'utf8');
    expect(canary).toMatch(/scripts\/ci\/access-protected-paths\.txt/);
    expect(canary).not.toMatch(/for path in \/admin/);
  });
});
