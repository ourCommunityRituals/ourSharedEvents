/**
 * Reads every address the router answers out of the text of `src/router.ts`.
 *
 * Pure functions over a string, so a node-project spec can hand them the file
 * and a negative control can hand them a router with a planted route. Used by
 * `event-address-route-table.spec.ts` (one event, one folder) and
 * `page-surfaces-route-table.spec.ts` (every page is in the page-rules list).
 *
 * It finds `pathname === '…'`, `pathname === CONSTANT`,
 * `pathname.startsWith('…')` and every `/^\/…$/` path pattern.
 */

/** Lines that are comments carry route-looking text that is not a route. */
export function codeOnly(src: string): string {
  return src
    .split('\n')
    .map((line) => (/^\s*(\/\/|\/\*|\*)/.test(line) ? '' : line))
    .join('\n');
}

/** `^\/events\/([^/]+)\/(tv|poster)$` → `/events/:param/(tv|poster)` */
export function shapeOfPattern(body: string): string {
  return body
    .replace(/^\^/, '')
    .replace(/\$$/, '')
    .replace(/\(([^()]*)\)/g, (_m, inner: string) =>
      /^[a-z0-9-]+(\|[a-z0-9-]+)+$/.test(inner) ? `(${inner})` : ':param'
    )
    .replace(/\\(.)/g, '$1');
}

/** Every address the router answers, as a readable shape. */
export function routeShapes(src: string): Set<string> {
  const code = codeOnly(src);
  const out = new Set<string>();
  for (const m of code.matchAll(/pathname\s*===\s*'([^']*)'/g)) out.add(m[1]);
  for (const m of code.matchAll(/pathname\s*===\s*([A-Z][A-Z0-9_]*)\b/g)) out.add(`const:${m[1]}`);
  for (const m of code.matchAll(/pathname\.startsWith\(\s*'([^']*)'\s*\)/g)) {
    out.add(`${m[1]}*`);
  }
  for (const m of code.matchAll(/\/(\^\\\/[^\n]*?\$)\//g)) out.add(shapeOfPattern(m[1]));
  return out;
}

export const isApi = (shape: string): boolean => shape.startsWith('/api/');
