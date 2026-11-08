/**
 * Search by place name first, then by zip (owner 2026-11-06).
 *
 * The landing page is the front door, and a town is how most people think of
 * where they are; many do not know or think of a zip. So the landing's one box
 * takes a town or city name first and a zip second (lib/landing-where.ts).
 *
 * One name can be many places: "Springfield" is in 24 states, "Beverly" is a
 * Chicago neighbourhood and a town in seven states. findPlaces answers with
 * EVERY match, one per state, labelled "Springfield, IL", in state order, so the
 * person chooses. It never errors on a common name and never picks one for them.
 * A state after the name ("Springfield, IL", "Springfield Illinois") narrows it.
 *
 * The names come from two lists, joined:
 *   - the owner's neighbourhoods and towns (lib/place-names.ts PLACES), with
 *     the owner's zips; and
 *   - every US town and city in the GeoNames postal code file
 *     (lib/place-names-data.ts, CC BY 4.0), with its zips.
 * The same name in the same state from both is one place with the zips of both.
 *
 * Place, not person: a name becomes a set of zips, and a zip's events are found
 * by the landing's own rule (zip-areas.ts inZipsOwnArea). Nothing here reads
 * where the searcher is. Only a whole name is a place ("Spring" is not), and
 * text with a digit is never a name, so a zip or a pair of coordinates typed
 * into the box never reaches this lookup.
 */
import { PLACE_NAMES } from './place-names-data';
import { PLACES } from './place-names';
import {
  addressZip,
  findZipArea,
  inZipsOwnArea,
  type PlacedEvent,
  type ZipArea,
} from './zip-areas';
import { placeKey, STATE_BY_KEY } from './place-key';

export { placeKey };

/** One place a name can mean. */
export interface PlaceMatch {
  /** The town's name as the page shows it. */
  name: string;
  /** Its state's postal code. */
  state: string;
  /** How the page names it: "Springfield, IL". */
  label: string;
  /** Its zips, sorted. */
  zips: readonly string[];
}

/** The longest box value read as a name (as /events caps its search). */
export const PLACE_QUERY_MAX = 60;

// The town table, split into lines the first time a name is searched, then kept
// for the life of the isolate.
let lines: string[] | null = null;
function tableLines(): string[] {
  lines ??= PLACE_NAMES.split('\n').filter(Boolean);
  return lines;
}
const lineName = (l: string) => l.slice(0, l.indexOf('|'));

/** Every place the table and the owner's list have under one key, by state. */
function lookUp(key: string): PlaceMatch[] {
  const byState = new Map<string, { name: string; zips: Set<string> }>();
  const t = tableLines();
  // The first line whose key is not below the one asked for (lines are sorted by key).
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (placeKey(lineName(t[mid])) < key) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < t.length && placeKey(lineName(t[i])) === key; i++) {
    const [name, state, zips] = t[i].split('|');
    byState.set(state, { name, zips: new Set(zips.split(' ')) });
  }
  // The owner's places: their name wins, their zips join the table's.
  for (const p of PLACES) {
    if (placeKey(p.name) !== key && !p.aliases.some((a) => placeKey(a) === key)) continue;
    const had = byState.get(p.state);
    byState.set(p.state, { name: p.name, zips: new Set([...(had?.zips ?? []), ...p.zips]) });
  }
  return [...byState.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([state, { name, zips }]) => ({
      name,
      state,
      label: `${name}, ${state}`,
      zips: [...zips].sort(),
    }));
}

/**
 * Every place a typed name means: none, one, or many (one per state). A state
 * after the name, with or without a comma, by code or by name, keeps the place
 * in that state only.
 */
export function findPlaces(raw: unknown): PlaceMatch[] {
  if (typeof raw !== 'string') return [];
  const typed = raw.trim();
  if (!typed || typed.length > PLACE_QUERY_MAX || /\d/.test(typed)) return [];
  // "Name, State": the part after the last comma must be a state.
  const comma = typed.lastIndexOf(',');
  if (comma >= 0) {
    const state = STATE_BY_KEY.get(placeKey(typed.slice(comma + 1)));
    const name = placeKey(typed.slice(0, comma));
    if (!state || !name) return [];
    return lookUp(name).filter((p) => p.state === state);
  }
  const key = placeKey(typed);
  const whole = lookUp(key);
  if (whole.length > 0) return whole;
  // "Name State": the last one, two or three words as a state ("New York",
  // "District of Columbia").
  const words = key.split(' ');
  for (let n = Math.min(3, words.length - 1); n >= 1; n--) {
    const state = STATE_BY_KEY.get(words.slice(-n).join(' '));
    if (!state) continue;
    const found = lookUp(words.slice(0, -n).join(' ')).filter((p) => p.state === state);
    if (found.length > 0) return found;
  }
  return [];
}

/**
 * A test for "is this event in any of these places?". A place's events are its
 * zips' own-area events (zip-areas.ts); a zip the Census table does not have (a
 * PO box zip) matches only an event whose address ends with it. Build it once
 * per request.
 */
export function inPlaceMatches(matches: readonly PlaceMatch[]): (event: PlacedEvent) => boolean {
  const tests = matches.map((m) => {
    const areas: ZipArea[] = [];
    const byAddress = new Set<string>();
    for (const zip of m.zips) {
      const area = findZipArea(zip);
      if (area) areas.push(area);
      else byAddress.add(zip);
    }
    const inAreas = inZipsOwnArea(areas);
    return (event: PlacedEvent) => {
      if (byAddress.size > 0) {
        const said = addressZip(event.where_address);
        if (said && byAddress.has(said)) return true;
      }
      return inAreas(event);
    };
  });
  return (event) => tests.some((t) => t(event));
}
