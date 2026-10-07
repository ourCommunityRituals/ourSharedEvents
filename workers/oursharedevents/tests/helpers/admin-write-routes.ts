/**
 * Read the admin routes out of the router source (pure module, no runtime).
 *
 * Used by tests/admin-write-guard.derived.spec.ts. An "admin route" is a route
 * block that calls requireAdmin: that call is what turns the Access cookie into
 * permission, so those are the routes a cross-site request could abuse. For each
 * call site this finds the path its route condition matches and turns it into a
 * concrete path that can be requested.
 *
 * It fails closed: a requireAdmin whose path cannot be worked out is returned
 * with `unresolved: true`, and the gate fails on it instead of skipping it.
 */

export interface AdminRouteSite {
  /** 1-based line of the requireAdmin call in the router source. */
  line: number;
  /** Concrete, requestable paths the governing route condition matches. */
  paths: string[];
  /** True when no path could be derived for this call site. */
  unresolved: boolean;
}

/** Stands in for an id segment. No object has this id, so nothing real is touched. */
export const SAMPLE_ID = 'awg-sample-id';

/**
 * Turn the body of a router regex literal (the text between `/^` and `$/`) into
 * one path it matches, or null when the result does not match its own regex.
 */
export function samplePathFor(regexBody: string): string | null {
  const sample = regexBody
    .split('\\/')
    .join('/')
    .split('([^/]+)')
    .join(SAMPLE_ID)
    .split('(.+)')
    .join(SAMPLE_ID)
    // an alternation group, e.g. (registrations|checkin-count) -> its first branch
    .replace(/\(([^()|]+)\|[^()]*\)/g, '$1');
  let re: RegExp;
  try {
    re = new RegExp(`^${regexBody}$`);
  } catch {
    return null;
  }
  return re.test(sample) ? sample : null;
}

/** Bodies of every `/^...$/` regex literal in a piece of source. */
function regexBodiesIn(text: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const i = text.indexOf('/^\\/', from);
    if (i === -1) break;
    const end = text.indexOf('$/', i);
    if (end === -1) break;
    out.push(text.slice(i + 2, end));
    from = end + 2;
  }
  return out;
}

/** `pathname === '/x'` literals in a piece of source. */
function literalPathsIn(text: string): string[] {
  return [...text.matchAll(/pathname === '(\/[^']*)'/g)].map((m) => m[1]);
}

function pathsIn(text: string): { paths: string[]; bad: boolean } {
  const paths = literalPathsIn(text);
  let bad = false;
  for (const body of regexBodiesIn(text)) {
    const sample = samplePathFor(body);
    if (sample === null) bad = true;
    else paths.push(sample);
  }
  return { paths, bad };
}

/**
 * Every requireAdmin call site with the paths of the route that governs it.
 *
 * The router is a chain of top-level `if (...) {` blocks (two-space indent). From
 * each call, walk up to that `if`. Its condition either names the path itself
 * (`pathname === '/x'`, or an inline `/^...$/.test(pathname)`), or tests a match
 * variable, in which case the path is the regex in that variable's
 * `const name = pathname.match(...)`.
 */
export function deriveAdminRouteSites(routerSource: string): AdminRouteSite[] {
  const lines = routerSource.split(/\r?\n/);
  const sites: AdminRouteSite[] = [];

  lines.forEach((text, i) => {
    if (!/\brequireAdmin\(/.test(text) || /^\s*import\b/.test(text)) return;
    if (/^\s*(\/\/|\*)/.test(text)) return; // prose in a comment

    let start = -1;
    for (let j = i; j >= 0; j--) {
      if (/^ {2}(?:\} else )?if \(/.test(lines[j])) {
        start = j;
        break;
      }
      if (j < i && /^ {2}\}\s*$/.test(lines[j])) break; // ran into the previous block
    }
    if (start === -1) {
      sites.push({ line: i + 1, paths: [], unresolved: true });
      return;
    }

    const header = lines.slice(start, i + 1).join('\n');
    const direct = pathsIn(header);
    let paths = direct.paths;
    let bad = direct.bad;

    if (paths.length === 0) {
      // The condition tests match variables: resolve each to its regex.
      const condition = header.slice(
        0,
        header.indexOf('{') === -1 ? undefined : header.indexOf('{')
      );
      const before = lines.slice(0, start).join('\n');
      for (const id of new Set(condition.match(/[A-Za-z_]\w*/g) ?? [])) {
        const decl = before.lastIndexOf(`const ${id} = pathname.match(`);
        if (decl === -1) continue;
        const end = before.indexOf(');', decl);
        const found = pathsIn(before.slice(decl, end === -1 ? undefined : end));
        paths = paths.concat(found.paths);
        bad = bad || found.bad;
      }
    }

    sites.push({ line: i + 1, paths: [...new Set(paths)], unresolved: bad || paths.length === 0 });
  });

  return sites;
}

/**
 * Every `/api/v2/admin...` path the router matches anywhere, whether or not the
 * block calls requireAdmin. A route under the admin prefix that forgot its auth
 * call is still an admin route.
 */
export function adminPrefixedPaths(routerSource: string): string[] {
  const literals = literalPathsIn(routerSource).filter((p) => p.startsWith('/api/v2/admin'));
  const samples = regexBodiesIn(routerSource)
    .filter((b) => b.startsWith('\\/api\\/v2\\/admin'))
    .map((b) => samplePathFor(b))
    .filter((p): p is string => p !== null);
  return [...new Set([...literals, ...samples])].sort();
}

/** Every distinct requestable admin path in the router: both derivations together. */
export function adminRoutePaths(routerSource: string): string[] {
  return [
    ...new Set([
      ...deriveAdminRouteSites(routerSource).flatMap((s) => s.paths),
      ...adminPrefixedPaths(routerSource),
    ]),
  ].sort();
}
