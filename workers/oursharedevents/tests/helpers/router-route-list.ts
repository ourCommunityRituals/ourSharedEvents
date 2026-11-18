/**
 * Compare the route table in the header comment of `src/router.ts` with the paths
 * the router code matches (pure module, no runtime).
 *
 * Used by tests/e2e/0-architecture/router-route-list.invariant.spec.ts. AGENTS.md
 * calls that header the canonical route list, so it has to list what the code
 * matches. The reading of the code is the one the admin write guard's gate already
 * uses (`literalPathsIn`, `regexBodiesIn` in ./admin-write-routes): this adds no
 * second parser for it, only the `pathname.startsWith('/x/')` prefixes.
 *
 * Both sides are turned into the same "shape": `:p` for one path segment that
 * varies, `*` for a tail of any length. `/api/v2/admin/events/:id/booths/:boothId`
 * in the header and `\/api\/v2\/admin\/events\/([^/]+)\/booths\/([^/]+)` in the
 * code are both `/api/v2/admin/events/:p/booths/:p`.
 *
 * What it does not see: the HTTP method, a path matched outside router.ts (a
 * handler that looks at the path itself), and a path compared to a constant
 * instead of a string literal. It compares paths, not what a route does.
 */

import { literalPathsIn, regexBodiesIn } from './admin-write-routes';

const METHODS = 'GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS';

/** The header comment (the first block comment) and the code after it. */
export function splitRouterSource(routerSource: string): { header: string; code: string } {
  const end = routerSource.indexOf('*/');
  if (end === -1) return { header: '', code: routerSource };
  return { header: routerSource.slice(0, end), code: routerSource.slice(end + 2) };
}

/** Replace the first group `re` finds with each of its `a|b|c` branches, recursively. */
function expandAlternation(text: string, re: RegExp): string[] {
  const m = re.exec(text);
  if (!m) return [text];
  const before = text.slice(0, m.index);
  const after = text.slice(m.index + m[0].length);
  return m[1].split('|').flatMap((branch) => expandAlternation(before + branch + after, re));
}

/**
 * Shapes of one router regex body (the text between `/^` and `$/`). A group of
 * literal branches, `(tv|poster)`, gives one shape per branch, so each branch has
 * to be listed.
 */
export function shapesOfRegexBody(body: string): string[] {
  const path = body
    .split('\\/')
    .join('/')
    .replace(/\/\?$/, '') // an optional trailing slash
    .replace(/\\\./g, '.');
  return expandAlternation(path, /\(([a-z0-9-]+(?:\|[a-z0-9-]+)+)\)/).map((variant) =>
    variant.replace(/\(\.\+\)/g, '*').replace(/\(\[[^\]]+\](?:\+|\{\d+,\d+\})\)/g, ':p')
  );
}

/** True when a shape still holds regex syntax this helper did not understand. */
export function isUnreadShape(shape: string): boolean {
  return /[()[\]\\{}+?^$|]/.test(shape);
}

/** Every path shape the router code matches. */
export function routerMatchedShapes(routerSource: string): string[] {
  const { code } = splitRouterSource(routerSource);
  const prefixes = [...code.matchAll(/pathname\.startsWith\('(\/[^']*\/)'\)/g)].map(
    (m) => `${m[1]}*`
  );
  return [
    ...new Set([
      ...literalPathsIn(code),
      ...regexBodiesIn(code).flatMap(shapesOfRegexBody),
      ...prefixes,
    ]),
  ].sort();
}

/**
 * Every path shape the header lists. A route line is ` *   METHOD /path … → …`;
 * a line may name several paths (`GET /e/:code /p/:code`), a path may carry
 * `a|b|c` in a segment, an optional `[...]` part, a `?query` and a `*tail`.
 */
export function headerListedShapes(routerSource: string): string[] {
  const { header } = splitRouterSource(routerSource);
  const routeLine = new RegExp(`^ \\* {3}(?:${METHODS})\\s+(.*?)(?:\\s+→.*)?$`);
  const shapes = new Set<string>();
  for (const line of header.split(/\r?\n/)) {
    const m = routeLine.exec(line);
    if (!m) continue;
    for (const token of m[1].split(/\s+/)) {
      if (!token.startsWith('/')) continue;
      const path = token
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\?.*$/, '')
        .replace(/\*\w*/g, '*')
        .replace(/:[A-Za-z]+/g, ':p');
      for (const shape of expandAlternation(path, /(?<=\/)([a-z0-9-]+(?:\|[a-z0-9-]+)+)(?=\/|$)/)) {
        shapes.add(shape);
      }
    }
  }
  return [...shapes].sort();
}

/** True when `shape` is in `others`, or one side is a `*` tail that takes in the other. */
export function shapeCovered(shape: string, others: readonly string[]): boolean {
  if (others.includes(shape)) return true;
  if (shape.endsWith('/*') && others.some((o) => o.startsWith(shape.slice(0, -1)))) return true;
  return others.some((o) => o.endsWith('/*') && shape.startsWith(o.slice(0, -1)));
}

/** Shapes the router matches that the header does not list. */
export function unlistedRoutes(routerSource: string): string[] {
  const listed = headerListedShapes(routerSource);
  return routerMatchedShapes(routerSource).filter((s) => !shapeCovered(s, listed));
}

/**
 * Shapes the header lists that the router does not match. A path under a
 * language prefix (`/es/...`) is checked without it: the router takes the prefix
 * off before it matches (lib/i18n/path-prefix.ts).
 */
export function unmatchedHeaderRoutes(routerSource: string, languagePrefix = '/es'): string[] {
  const matched = routerMatchedShapes(routerSource);
  return headerListedShapes(routerSource).filter((s) => {
    const bare = s.startsWith(`${languagePrefix}/`) ? s.slice(languagePrefix.length) : s;
    return !shapeCovered(bare, matched);
  });
}
