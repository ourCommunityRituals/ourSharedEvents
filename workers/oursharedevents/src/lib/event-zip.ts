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
import { findZipArea, normalizeZip } from './zip-areas';

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
