/**
 * PAGINATION SHAPE INVARIANT
 *
 * OSE-212 (admin audit log) and OSE-207 (admin subscribers) both ship the
 * same paginated-list response shape:
 *
 *   {
 *     ok: true,
 *     items: T[],
 *     pagination: { limit, hasMore, nextCursor }
 *   }
 *
 * — cursor-based on `created_at` DESC. The original OSE-206 AC predated
 * this and asked for offset-pagination with `{ total, limit, offset, hasMore }`.
 * Shipping two competing schemes is a maintenance liability and would force
 * FE clients to write per-endpoint pagination glue. This gate locks in the
 * cursor shape as the single canonical contract.
 *
 * What this gate enforces (static analysis over src/handlers/*.ts):
 *
 *   1. Any object-literal `pagination: { ... }` declared inside a handler
 *      MUST contain the keys `limit`, `hasMore`, `nextCursor`.
 *   2. That object-literal MUST NOT contain the offset-pagination keys
 *      `total` or `offset`. Those are an anti-pattern at scale (COUNT(*)
 *      is wasteful + racy; offset is unstable under concurrent inserts).
 *
 * If a future endpoint legitimately needs offset semantics (e.g. an admin
 * "jump to page N" UI), the right fix is to introduce a separately-named
 * type (e.g. `offset_pagination:`), not to weaken this gate. Or revisit
 * the architecture before shipping the second scheme.
 */

import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}

const tenv = () => env as unknown as TestEnv;

const REQUIRED_KEYS = ['limit', 'hasMore', 'nextCursor'] as const;
const FORBIDDEN_KEYS = ['total', 'offset'] as const;

/**
 * Extract every `pagination: { ... }` object-literal body from the given
 * source content. We track brace depth instead of using a regex so nested
 * structures parse correctly.
 *
 * Returns the body text of each pagination object (the content between
 * the outer `{` and matching `}`), one per occurrence.
 */
function extractPaginationBodies(content: string): string[] {
  const bodies: string[] = [];
  const marker = 'pagination:';
  let pos = 0;
  while (pos < content.length) {
    const i = content.indexOf(marker, pos);
    if (i === -1) break;
    // Find the next `{` after the marker (skipping whitespace)
    let braceStart = i + marker.length;
    while (
      braceStart < content.length &&
      content[braceStart] !== '{' &&
      content[braceStart] !== '\n'
    ) {
      braceStart++;
    }
    if (content[braceStart] !== '{') {
      // Not a `pagination: { ... }` literal (might be a destructure or type ref).
      pos = i + marker.length;
      continue;
    }
    // Walk braces to find the matching close
    let depth = 0;
    let end = braceStart;
    for (; end < content.length; end++) {
      if (content[end] === '{') depth++;
      else if (content[end] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) {
      // Unbalanced — give up rather than infinite loop
      pos = braceStart + 1;
      continue;
    }
    bodies.push(content.slice(braceStart + 1, end));
    pos = end + 1;
  }
  return bodies;
}

function hasKey(body: string, key: string): boolean {
  // Match the key with word-boundary semantics on both sides. The body we
  // pass is the INNER content of `{ ... }` so the final shorthand key has
  // no trailing punctuation — we accept end-of-string or whitespace as a
  // valid terminator too. Avoid `\b` because property names can contain
  // characters `\b` treats as word boundaries (none today, but defensive).
  const re = new RegExp(`(?:^|[\\s,{])${key}(?=\\s*[:,}]|\\s*$)`, 'm');
  return re.test(body);
}

describe('Pagination shape invariant: canonical cursor pattern across handlers', () => {
  test('every pagination: { ... } literal in src/handlers contains limit, hasMore, nextCursor', () => {
    const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);

    const handlerFiles = Object.entries(sources).filter(([path]) => {
      const norm = path.replace(/\\/g, '/');
      return norm.includes('/src/handlers/') && norm.endsWith('.ts');
    });

    expect(handlerFiles.length, 'no handler files found in TEST_SOURCE_FILES_JSON').toBeGreaterThan(
      0
    );

    const offenders: string[] = [];
    let totalChecked = 0;
    for (const [path, content] of handlerFiles) {
      const bodies = extractPaginationBodies(content);
      for (const body of bodies) {
        totalChecked++;
        for (const required of REQUIRED_KEYS) {
          if (!hasKey(body, required)) {
            offenders.push(
              `${path}: pagination literal missing required key '${required}': ${body.trim().slice(0, 140)}`
            );
          }
        }
        for (const forbidden of FORBIDDEN_KEYS) {
          if (hasKey(body, forbidden)) {
            offenders.push(
              `${path}: pagination literal contains forbidden offset-pagination key '${forbidden}': ${body.trim().slice(0, 140)}`
            );
          }
        }
      }
    }

    // Locked-in expectation: at least two handlers ship this shape today
    // (audit.ts and subscribers.ts). If this count drops, somebody removed
    // the canonical pattern's call site.
    expect(
      totalChecked,
      'expected at least 2 pagination literals (audit + subscribers)'
    ).toBeGreaterThanOrEqual(2);

    expect(
      offenders,
      `Pagination shape drift detected. Canonical shape is ` +
        `{ limit, hasMore, nextCursor } (cursor-based, per OSE-212 / OSE-207). ` +
        `Offenders:\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });

  test('explicit list of handlers using cursor pagination today', () => {
    // Sentinel: if either of these handlers stops returning a pagination
    // object literal, the canonical pattern's reference implementations
    // have moved and this gate's premise is suspect — re-evaluate.
    const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
    const auditEntry = Object.entries(sources).find(([p]) =>
      p.replace(/\\/g, '/').endsWith('src/handlers/audit.ts')
    );
    const subsEntry = Object.entries(sources).find(([p]) =>
      p.replace(/\\/g, '/').endsWith('src/handlers/subscribers.ts')
    );
    expect(auditEntry, 'src/handlers/audit.ts not in sources').toBeDefined();
    expect(subsEntry, 'src/handlers/subscribers.ts not in sources').toBeDefined();
    expect(
      extractPaginationBodies(auditEntry![1]).length,
      'audit.ts has no pagination literal'
    ).toBeGreaterThan(0);
    expect(
      extractPaginationBodies(subsEntry![1]).length,
      'subscribers.ts has no pagination literal'
    ).toBeGreaterThan(0);
  });
});
