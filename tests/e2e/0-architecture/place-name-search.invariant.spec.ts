/**
 * INVARIANT: the front door searches by place name first, and one name can be
 * many places (owner 2026-11-06). STRUCTURAL code-shape lock (L0).
 *
 * The landing page is the front door and the most likely way people search.
 * Its box takes a town or city name first and a zip second. A name like
 * "Springfield" is many places: the search brings every match together for the
 * person to choose from, labelled by town and state. It never errors on a
 * common name and never picks one match silently.
 *
 * Behaviour is tested in the worker suite (tests/place-search.spec.ts, node;
 * tests/landing-where.spec.ts, workers pool, over HTTP) and in a browser
 * (tests/playwright/landing-page.spec.ts). This spec reads the source with
 * node:fs and locks the shape those tests rely on, so a refactor that brings
 * back a single-match lookup fails on every PR in the T0 `invariants` shard.
 *
 * Also locked: place, not person (AGENTS.md invariant 3). The name lookup reads
 * no request, header or location, and text with a digit (a zip, a pair of
 * coordinates) is never read as a name.
 *
 * @born-red place-name-search | method: each assertion run against a planted
 *   fault: readTyped taking matches[0] whenever there is a match, the 'choose'
 *   state removed, the handler filtering by matches[0] only, the zip read before
 *   the name, the digit refusal removed, a headers read added to place-search.ts,
 *   the town table cut to one Springfield; each turned this spec red | date: 2026-11-06
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const LIB = join(__dirname, '..', '..', '..', 'workers', 'oursharedevents', 'src', 'lib');
const HANDLERS = join(LIB, '..', 'handlers');
const read = (...p: string[]) => readFileSync(join(...p), 'utf8').replace(/\r\n/g, '\n');

/** The body of a named function: from its declaration to the next top-level line. */
function fnBody(src: string, name: string): string {
  const start = src.search(new RegExp(`function ${name}\\(`));
  expect(start, `function ${name} must exist`).toBeGreaterThanOrEqual(0);
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end > start ? end : undefined);
}

test.describe('Invariant: place name first; one name, many places', () => {
  test('the town table holds one name in many states', () => {
    const data = read(LIB, 'place-names-data.ts');
    const springfields = data.split('\n').filter((l) => l.startsWith('Springfield|'));
    const states = new Set(springfields.map((l) => l.split('|')[1]));
    expect(states.size, 'the table must keep every Springfield, one per state').toBeGreaterThan(10);
  });

  test('the lookup returns every match, never only the first', () => {
    const src = read(LIB, 'place-search.ts');
    const find = fnBody(src, 'findPlaces');
    expect(find, 'findPlaces must answer with a list of places').toMatch(/\): PlaceMatch\[\] \{/);
    expect(find, 'findPlaces must not cut its answer to one').not.toMatch(
      /\.slice\(0,\s*1\)|\[0\]|\.find\(/
    );
    expect(fnBody(src, 'lookUp'), 'lookUp must keep one place per state').toMatch(/byState/);
  });

  test('the landing offers a choice for many matches and takes one only when there is one', () => {
    const src = read(LIB, 'landing-where.ts');
    expect(src, "WhereState must carry a 'choose' state with every match").toMatch(
      /kind: 'choose'; typed: string; matches: PlaceMatch\[\]/
    );
    const typed = fnBody(src, 'readTyped');
    expect(typed, 'one place only when exactly one matched').toMatch(
      /if \(matches\.length === 1\) return \{ kind: 'place', place: matches\[0\] \};/
    );
    expect(typed, 'many matches are a choice, all of them').toMatch(
      /if \(matches\.length > 1\) return \{ kind: 'choose', typed, matches \};/
    );
    expect(fnBody(src, 'renderChoices'), 'every match is offered').toMatch(
      /matches\s*\n?\s*\.map\(/
    );
  });

  test('the name is read before the zip', () => {
    const typed = fnBody(read(LIB, 'landing-where.ts'), 'readTyped');
    const name = typed.indexOf('findPlaces(');
    const zip = typed.indexOf('findZipArea(');
    expect(name, 'readTyped must look the name up').toBeGreaterThan(0);
    expect(zip, 'readTyped must look the zip up').toBeGreaterThan(0);
    expect(name, 'the name comes first, the zip second').toBeLessThan(zip);
  });

  test('the landing lists the events of every match while the person chooses', () => {
    const pages = read(HANDLERS, 'pages.ts');
    expect(pages).toMatch(
      /where\.kind === 'choose'\) \{[\s\S]{0,200}inPlaceMatches\(where\.matches\)/
    );
  });

  test('place, not person: the lookup reads no request, and no text with a digit', () => {
    const src = read(LIB, 'place-search.ts');
    // Code only: the file's comments may name what it does not do.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bRequest\b|headers|CF-IP|\.cf\b|geolocation|lat=|lon=/i);
    expect(fnBody(src, 'findPlaces'), 'text with a digit is never a name').toMatch(
      /\/\\d\/\.test\(typed\)/
    );
  });
});
