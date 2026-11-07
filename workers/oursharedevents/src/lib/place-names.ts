/**
 * Search by place name or zip on /events (owner 2026-11-05).
 *
 * A person types a town or neighbourhood ("Oak Lawn") or a zip ("60453") into
 * the /events search box and sees every event in that place. A place is a group
 * of zips, and the owner chose the zips: PLACES below is the owner's list,
 * as given, overlaps included (60620 and 60643 are both Beverly and Auburn
 * Gresham; 60655 is both Beverly and Mount Greenwood), so one event can show
 * under two names.
 *
 * An event belongs to a zip by the landing page's rule (zip-areas.ts
 * inZipOwnArea): the zip its address ends with, else the nearest zip center,
 * within 8 rings. A place lists the events of any of its zips. A zip the Census
 * table does not have (60454, PO boxes) matches only an event whose address
 * ends with it. Place, not person: nothing here reads where the searcher is.
 *
 * Only the names below are places; any other text stays a name/venue search.
 */
import { addressZip, findZipArea, inZipOwnArea, normalizeZip } from './zip-areas';
import type { PlacedEvent } from './zip-areas';

export interface Place {
  /** How the page names the place. */
  name: string;
  /** Other spellings that mean the same place, lower case. */
  aliases: readonly string[];
  /** The owner's zips for this place. */
  zips: readonly string[];
  /** Its state's postal code, so the landing's town search can label it ("Beverly, IL"). */
  state: string;
}

/** The owner's list (2026-11-05). Change it only on the owner's word. */
export const PLACES: readonly Place[] = [
  { name: 'Beverly', aliases: [], zips: ['60643', '60655', '60620'], state: 'IL' },
  { name: 'Blue Island', aliases: [], zips: ['60406', '60472', '60827'], state: 'IL' },
  { name: 'Mount Greenwood', aliases: ['mt greenwood'], zips: ['60655'], state: 'IL' },
  { name: 'Evergreen Park', aliases: [], zips: ['60805'], state: 'IL' },
  {
    name: 'Oak Lawn',
    aliases: [],
    zips: ['60453', '60454', '60455', '60457', '60458'],
    state: 'IL',
  },
  {
    name: 'Auburn Gresham',
    aliases: [],
    zips: ['60620', '60621', '60636', '60643', '60652'],
    state: 'IL',
  },
];

/** What a search box value resolved to: a named place, or one zip. */
export interface SearchPlace {
  /** The page's words for it: the place's name, or the zip. */
  label: string;
  zips: readonly string[];
}

/** Lower case, dots dropped ("Mt." → "mt"), whitespace collapsed. */
function key(raw: string): string {
  return raw.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

const BY_KEY = new Map<string, Place>();
for (const p of PLACES) {
  BY_KEY.set(key(p.name), p);
  for (const a of p.aliases) BY_KEY.set(key(a), p);
}

/**
 * The place a search means, or null when it is ordinary text. A whole place name
 * (any case) is a place; a 5-digit zip is that zip. "Oak" alone is text.
 */
export function findSearchPlace(q: unknown): SearchPlace | null {
  if (typeof q !== 'string') return null;
  const place = BY_KEY.get(key(q));
  if (place) return { label: place.name, zips: place.zips };
  const zip = normalizeZip(q);
  return zip ? { label: zip, zips: [zip] } : null;
}

/** A test for "is this event in the place?". Build it once per request. */
export function inSearchPlace(place: SearchPlace): (event: PlacedEvent) => boolean {
  const tests = place.zips.map((zip) => {
    const area = findZipArea(zip);
    if (area) return inZipOwnArea(area);
    // Not a Census zip area: only an address that ends with it.
    return (event: PlacedEvent) => addressZip(event.where_address) === zip;
  });
  return (event) => tests.some((t) => t(event));
}
