/**
 * The words for a withheld count: "Fewer than 5" (AGENTS.md invariant 2).
 *
 * A count under the floor leaves the worker as `{ count: null, suppressed:
 * true }`. Every page then has to say the same thing for it, in words: never
 * 0, never "<5", never "Held", never a blank. Before this file each page wrote
 * its own string and three of them drifted (a "<5" tile, two "Held" tiles).
 *
 * One phrase, two readers of it:
 *
 *   - `fewerThan()` for pages the worker renders (sponsor home, the recap);
 *   - `WITHHELD_WORDS_CLIENT_JS`, the same function for pages that draw counts
 *     in the browser. It declares `oseFewerThan` at the top level of a script
 *     (so every script on the page sees it). The Live page puts it
 *     into its script; `admin.html` and `shared-report.html` are static files,
 *     so each carries the text between `@ose-fewer-than` markers and
 *     `tests/withheld-count-words.spec.ts` fails when a copy differs from this.
 *
 * The tail says what the count is of, in the house style: "Fewer than 5 scans
 * in any hour", "fewer than 5 taps on any one link". A figure that is a sum of
 * floored parts (scans by poster-hour, taps by link) needs its tail: withheld
 * there means no part reached 5, not fewer than 5 in all.
 *
 * English only. The public recap is translated, and reads the catalog key
 * `stats.fewerThan`; the same spec holds its English to this phrase.
 */
import { CORRIDOR_MAP_MIN_COUNT } from './shared-report';

/** The phrase. `{floor}` is the floor the count was held to. */
export const WITHHELD_PHRASE = 'Fewer than {floor}';

/**
 * A withheld count, in words.
 *
 * @param floor the floor the route applied (a bad value reads as the K floor)
 * @param tail  what the count is of ("scans in any hour"); may be empty
 * @param lower true inside a sentence ("fewer than 5 …")
 */
export function fewerThan(
  floor: number = CORRIDOR_MAP_MIN_COUNT,
  tail: string = '',
  lower: boolean = false
): string {
  const n = Number(floor);
  const k = Number.isFinite(n) && n >= 1 ? Math.floor(n) : CORRIDOR_MAP_MIN_COUNT;
  let s = WITHHELD_PHRASE.replace('{floor}', String(k));
  if (lower) s = s.charAt(0).toLowerCase() + s.slice(1);
  return tail ? `${s} ${tail}` : s;
}

/**
 * `fewerThan` for a page script. No backslash, backtick or `${` in it, so it
 * can sit inside a template literal as it is.
 */
export const WITHHELD_WORDS_CLIENT_JS = [
  '// @ose-fewer-than:begin (generated from src/lib/withheld-words.ts; do not edit here)',
  'function oseFewerThan(floor, tail, lower) {',
  '  var n = Number(floor);',
  `  var k = isFinite(n) && n >= 1 ? Math.floor(n) : ${CORRIDOR_MAP_MIN_COUNT};`,
  `  var s = ${JSON.stringify(WITHHELD_PHRASE)}.replace('{floor}', String(k));`,
  '  if (lower) s = s.charAt(0).toLowerCase() + s.slice(1);',
  "  return tail ? s + ' ' + tail : s;",
  '}',
  'window.oseFewerThan = oseFewerThan;',
  '// @ose-fewer-than:end',
].join('\n');
