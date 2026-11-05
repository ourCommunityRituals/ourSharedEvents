/**
 * INVARIANT 9 (tenant isolation), admin guard order in route().
 *
 * OSE-1801 (CCR 2026-11-04). The admin actor is read once, at route() entry,
 * and kept for the request. Workers advance Date.now only after I/O, so every
 * guard that reads a token's time claims must see the same clock as that first
 * read, and every guard that scopes by brand must run after the forged-token
 * check. The order in route() is therefore load-bearing:
 *
 *   1. the actor read (`const _actor = extractAdminActor(request, env)`) comes
 *      before the first `await` in route(), so no I/O moves the clock first;
 *   2. the Access JWT pre-flight (verifyCfAccessJWT) comes next;
 *   3. then the admin rate limit (checkRateLimit … adminKey);
 *   4. then the admin write guard (adminWriteRefusal);
 *   5. then the object-scope guard (guardAdminObjectScope);
 *   6. and no requireAdmin call sits above the object-scope guard.
 *
 * requireAdmin also refuses an identity that is not the pinned actor, so a
 * wrong order is a second failure, not the only one; this gate keeps the first
 * line of defence where it is.
 *
 * L0 structural (readFileSync, comments stripped), T0 invariants shard.
 *
 * @born-red TL-084 | method: deliberate-fixture-break | date: 2026-11-04 |
 *   verified: moving the rate-limit block above the JWT pre-flight failed check 3,
 *   an `await` planted above the actor read failed check 1, and moving
 *   guardAdminObjectScope above adminWriteRefusal failed check 5.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTER = join(__dirname, '..', '..', '..', 'workers', 'oursharedevents', 'src', 'router.ts');

/** route()'s body with line and block comments removed (string contents kept). */
function routeBody(): string {
  const src = readFileSync(ROUTER, 'utf8').replace(/\r\n/g, '\n');
  const start = src.indexOf('export async function route(');
  expect(start, 'route() not found in router.ts').toBeGreaterThan(-1);
  return src
    .slice(start)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line.replace(/\s\/\/\s.*$/, '')))
    .join('\n');
}

function at(body: string, needle: string | RegExp, what: string): number {
  const i = typeof needle === 'string' ? body.indexOf(needle) : body.search(needle);
  expect(i, `${what} not found in route()`).toBeGreaterThan(-1);
  return i;
}

test.describe('admin guard order in route() (OSE-1801)', () => {
  test('the actor is read before the first await in route()', () => {
    const body = routeBody();
    const actor = at(body, 'const _actor = extractAdminActor(request, env);', 'the actor read');
    const firstAwait = at(body, /\bawait\b/, 'an await');
    expect(actor, 'an await runs before the actor read, so the clock can move first').toBeLessThan(
      firstAwait
    );
  });

  test('pre-flight, rate limit, write guard, object scope run in that order', () => {
    const body = routeBody();
    const order: Array<[string, number]> = [
      ['actor read', at(body, 'const _actor = extractAdminActor(request, env);', 'the actor read')],
      ['JWT pre-flight', at(body, /await\s+verifyCfAccessJWT\(/, 'the JWT pre-flight')],
      [
        'admin rate limit',
        at(body, /checkRateLimit\(\s*env,\s*adminKey\b/, 'the admin rate limit'),
      ],
      ['admin write guard', at(body, /adminWriteRefusal\(\s*request\b/, 'the admin write guard')],
      ['object scope', at(body, /await\s+guardAdminObjectScope\(/, 'the object-scope guard')],
    ];
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1][1], `${order[i - 1][0]} must come before ${order[i][0]}`).toBeLessThan(
        order[i][1]
      );
    }
  });

  test('each guard appears once in route()', () => {
    const body = routeBody();
    for (const [what, re] of [
      ['JWT pre-flight', /await\s+verifyCfAccessJWT\(/g],
      ['object scope', /await\s+guardAdminObjectScope\(/g],
      ['admin write guard', /adminWriteRefusal\(\s*request\b/g],
    ] as const) {
      expect(body.match(re)?.length ?? 0, `${what} should appear exactly once`).toBe(1);
    }
  });

  test('no requireAdmin call sits above the object-scope guard', () => {
    const body = routeBody();
    const scope = at(body, /await\s+guardAdminObjectScope\(/, 'the object-scope guard');
    const firstRequireAdmin = at(body, /\brequireAdmin\(/, 'a requireAdmin call');
    expect(firstRequireAdmin).toBeGreaterThan(scope);
  });
});
