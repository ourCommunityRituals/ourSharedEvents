// ─── Canonical event enrichment ────────────────────────────────────────────────
//
// Extracted from handlers/events.ts by OSE-1243. It was private there, which
// was fine while the JSON API was the only consumer — every surface reached
// events through `GET /api/v2/events` and got the enrichment for free.
//
// Server-rendering the public list (OSE-1243) created the first consumer that
// reads the DataProvider directly, and the first chance to skip this. Skipping
// it is not a subtle failure: `listEvents` returns raw D1 rows, whose columns
// are `title` / `start_date` / `location`, while every surface reads
// `name` / `startDateISO` / `venue`. A page that reads the rows without this
// renders cards with empty names and no dates, and — because `phase` is
// computed here — offers a registration form for an event that already
// happened.
//
// The original comment on this function said it plainly and is worth keeping:
// "Wiring here = single point of injection; surfaces don't re-derive phase
// locally." This module is what makes that true for a second caller.
//
// Per OSE-242 (rescoped 2026-04-26 to the canonical matrix-wide resolver).
// Brain contract: OCR-docs/ocr-docs-brain/event-phase-contract.yaml

import { computeEventPhase, type EventPhase } from '../domain/event-phase';
import { phaseTimesFor } from './event-datetime';

/**
 * The one phase rule for a stored event row: the canonical resolver over the
 * row's status and its phase times (OSE-1313: a timed event pivots at
 * starts_at; a date-only day runs local midnight to local midnight in the
 * event's zone). The public event page, the JSON API (via enrichWithPhase) and
 * the TV's display-config all call this, so no surface can drift (OSE-475).
 * Tolerates loosely typed rows: a non-string field reads as absent.
 */
export function eventPhaseOf(
  row: {
    status?: unknown;
    start_date?: unknown;
    end_date?: unknown;
    starts_at?: unknown;
    timezone?: unknown;
  },
  now?: Date
): EventPhase {
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return computeEventPhase(
    {
      status: str(row.status) ?? '',
      ...phaseTimesFor({
        start_date: str(row.start_date),
        end_date: str(row.end_date),
        starts_at: str(row.starts_at),
        timezone: str(row.timezone),
      }),
    },
    now
  );
}

export function enrichWithPhase(
  row: Record<string, unknown>
): Record<string, unknown> & { phase: EventPhase } {
  return {
    ...row,
    // OSE-844 (X-10) — canonical field-name mapping. The DB SELECT projects the
    // column names `title`/`start_date`/`location`; every surface template
    // reads `name`/`startDateISO`/`venue`. Map ONCE here — the single
    // enrichment seam feeding list, detail, admin-list and the server-rendered
    // public page — instead of `||` fallbacks scattered across the surfaces
    // (which taught every future surface author that two names per value is
    // normal). The DB columns stay in the payload (additive; #16 is a floor, so
    // this never breaks the snapshot). ADR-016. Decision: PO + backend lead
    // chose Option A (map in the API, one name per value out).
    name: typeof row.title === 'string' ? row.title : (row.name ?? null),
    startDateISO: typeof row.start_date === 'string' ? row.start_date : (row.startDateISO ?? null),
    venue: typeof row.location === 'string' ? row.location : (row.venue ?? null),
    // OSE-1313 — timed events pivot at starts_at (see phaseTimesFor).
    phase: eventPhaseOf(row),
  };
}
