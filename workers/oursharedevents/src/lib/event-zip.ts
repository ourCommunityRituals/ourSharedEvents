/**
 * The ZIP code an organizer gives at the Where step (W1, OSE-2095; owner
 * 2026-11-16: "the zip finds an event, the organizer's tap on our own map
 * places it").
 *
 * Stored in `events.zip_code` (migration 0021; nothing wrote it before W1) as
 * five digits. It is words, like the place name and the address: zip and town
 * search read it (lib/zip-areas.ts eventZip), and nothing else reads it as a
 * place. It is never turned into a cell or a point, never published (the public
 * projection is an allowlist without it) and never exported (the runtime guard
 * in lib/export-geography.ts refuses the name).
 *
 * Asked for, not required: automation may omit it. A malformed one is refused
 * with its own code; a well-formed one the Census table lacks (a PO-box zip)
 * still saves, and the answer says so.
 */
import { addressZip, findZipArea, normalizeZip } from './zip-areas';
import { findPlaces } from './place-search';

export const INVALID_ZIP_CODE = 'INVALID_ZIP_CODE';
export const INVALID_ZIP_CODE_MESSAGE =
  'zip_code must be a 5-digit US ZIP code ("60406", or "60406-1234" which keeps the first five), or empty to clear it';

/** What a body's `zip_code` asks for. */
export type ZipField =
  | { kind: 'absent' }
  | { kind: 'clear' }
  | { kind: 'set'; zip: string; known: boolean }
  | { kind: 'invalid' };

/**
 * Read `zip_code` from a create or update body. Absent: nothing to write. Null
 * or blank: clear it. Text of five digits (ZIP+4 and surrounding spaces are
 * fine): that zip. Anything else, including a JSON number, is invalid.
 */
export function readZipField(body: Record<string, unknown>): ZipField {
  if (!('zip_code' in body) || body.zip_code === undefined) return { kind: 'absent' };
  const v = body.zip_code;
  if (v === null) return { kind: 'clear' };
  if (typeof v !== 'string') return { kind: 'invalid' };
  if (v.trim() === '') return { kind: 'clear' };
  const zip = normalizeZip(v);
  if (!zip) return { kind: 'invalid' };
  return { kind: 'set', zip, known: findZipArea(zip) !== null };
}

export interface ZipWarning {
  code: string;
  message: string;
}

/** The note for a zip the Census zip-area table does not have. */
export function zipNotInTableWarning(zip: string): ZipWarning {
  return {
    code: 'ZIP_NOT_IN_TABLE',
    message: `ZIP ${zip} was saved, but it is not in the zip-area table (a PO-box ZIP, or a typo). A search for it finds this event only by the ZIP itself.`,
  };
}

/** The note for a zip sent with an online event, which has no place. */
export const ZIP_NOT_STORED_ONLINE: ZipWarning = {
  code: 'ZIP_NOT_STORED_ONLINE',
  message: 'An online event has no place, so the ZIP code was not stored.',
};

/** What the wizard may fill the ZIP box with, and why. */
export interface ZipSuggestion {
  zip: string | null;
  /** 'address': the address ends with it; 'town': a town with exactly one zip. */
  from: 'address' | 'town' | null;
  /** The town it came from ("Evergreen Park, IL"), when from is 'town'. */
  town?: string;
}

/** The longest text read for a suggestion (the address box's own limit). */
export const SUGGEST_TEXT_MAX = 500;

/**
 * The town names a text may give: "…, Blue Island, IL" gives "Blue Island, IL"
 * and "IL"; a place name typed with its town ("Rock Island Public House, Blue
 * Island") gives "Blue Island". The whole text is tried for the place name only
 * (an address is never a town by itself).
 */
function townCandidates(text: string, whole: boolean): string[] {
  const parts = text
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  if (parts.length >= 2) out.push(`${parts[parts.length - 2]}, ${parts[parts.length - 1]}`);
  if (parts.length >= 2) out.push(parts[parts.length - 1]);
  if (whole) out.push(text.trim());
  return out;
}

/**
 * The ZIP the wizard fills in (W1, owner 2026-11-16), the server's own rules:
 * the zip the address ends with (zip-areas.ts addressZip), else a town named in
 * the address or the place name that is exactly one place with exactly one zip
 * (place-search.ts findPlaces). A town with many zips, or a name that is many
 * places, fills nothing: the organizer types it. A suggestion only; the
 * organizer can change it, and nothing here is stored.
 */
export function suggestZip(address: unknown, place: unknown): ZipSuggestion {
  const a = typeof address === 'string' ? address.slice(0, SUGGEST_TEXT_MAX) : '';
  const p = typeof place === 'string' ? place.slice(0, SUGGEST_TEXT_MAX) : '';
  const fromAddress = addressZip(a);
  if (fromAddress) return { zip: fromAddress, from: 'address' };
  const tried = new Set<string>();
  for (const [text, whole] of [
    [a, false],
    [p, true],
  ] as const) {
    if (!text.trim()) continue;
    for (const c of townCandidates(text, whole)) {
      if (tried.has(c)) continue;
      tried.add(c);
      const matches = findPlaces(c);
      if (matches.length === 0) continue;
      // A name that is many places, or a place of many zips: the organizer says.
      if (matches.length > 1 || matches[0].zips.length !== 1) return { zip: null, from: null };
      return { zip: matches[0].zips[0], from: 'town', town: matches[0].label };
    }
  }
  return { zip: null, from: null };
}
