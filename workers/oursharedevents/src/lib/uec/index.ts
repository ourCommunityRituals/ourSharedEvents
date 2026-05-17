/**
 * UEC public API — the ONLY sanctioned way for OSE code to read UEC values.
 *
 * Per OSE-322 (substrate static gate, future): hex literals for UEC colors
 * must appear ONLY in `uec-codes.ts` (the canonical data). All other OSE
 * code reads through this module — `getCode()`, `allCodes()`, etc.
 *
 * Lookup contract (per OSE-320 AC):
 *   - Case-insensitive — "GREEN", "green", "Green" all resolve to ENTER
 *   - Whitespace-trimmed — " green " resolves cleanly
 *   - Identifier may be either the `id` (e.g., "ENTER") or the `label`
 *     (e.g., "Green"). ID lookup takes precedence on collision.
 *   - Returns `null` on no match (caller decides what to return to user)
 *   - Returns `null` on null/empty identifier
 */

import { CODES, VERSION, VERTICALS } from './uec-codes';
import type { UECCode, WcagGrade, UecStatus, UecPhase, ExtensionPriority } from './uec-codes';

export { CODES, VERSION, VERTICALS };
export type { UECCode, WcagGrade, UecStatus, UecPhase, ExtensionPriority };

/**
 * Normalize an identifier for case-insensitive, whitespace-tolerant lookup.
 * Returns null if the input is null/undefined/empty-after-trim.
 */
function normalize(identifier: unknown): string | null {
  if (identifier === null || identifier === undefined) return null;
  if (typeof identifier !== 'string') return null;
  const trimmed = identifier.trim();
  if (trimmed.length === 0) return null;
  return trimmed.toUpperCase();
}

/**
 * Look up a UEC code by id OR label, case-insensitive, whitespace-tolerant.
 *
 * @example
 *   getCode('green')   // → ENTER (matched by label)
 *   getCode('ENTER')   // → ENTER (matched by id)
 *   getCode(' ENTER ') // → ENTER (whitespace trimmed)
 *   getCode('xyz')     // → null  (no match)
 *   getCode(null)      // → null  (invalid input)
 *   getCode('')        // → null  (empty after trim)
 */
export function getCode(identifier: unknown): UECCode | null {
  const key = normalize(identifier);
  if (key === null) return null;

  // ID lookup takes precedence (semantic name beats color name on collision).
  // No current collisions exist between id and label across the 11 codes,
  // but this rule is documented for forward safety.
  const byId = CODES.find((c) => c.id.toUpperCase() === key);
  if (byId) return byId;

  const byLabel = CODES.find((c) => c.label.toUpperCase() === key);
  if (byLabel) return byLabel;

  return null;
}

/**
 * Return all UEC codes (core + extensions), preserving canonical order
 * (01-07 core, then 08-11 extensions in source-file order).
 */
export function allCodes(): ReadonlyArray<UECCode> {
  return CODES;
}

/**
 * Return all canonical ID strings (e.g., ["ENTER", "LIVE", ...]).
 * Useful for building "valid identifiers" lists in error responses.
 */
export function allCodeIds(): ReadonlyArray<string> {
  return CODES.map((c) => c.id);
}

/**
 * Return all canonical label strings (e.g., ["Green", "Coral", ...]).
 * Useful for documentation surfaces + sponsor-facing displays.
 */
export function allCodeLabels(): ReadonlyArray<string> {
  return CODES.map((c) => c.label);
}

/**
 * Return all valid identifiers (ids + labels) for error responses + docs.
 * Order: all ids first (canonical order), then all labels (same order).
 */
export function allValidIdentifiers(): ReadonlyArray<string> {
  return [...allCodeIds(), ...allCodeLabels()];
}
