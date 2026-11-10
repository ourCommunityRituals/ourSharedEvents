/**
 * The links a place panel offers for each event (owner, 2026-11-09; OSE-1897).
 *
 * Map taps are never counted, and never touch tracking (merged decision 4, epic
 * OSE-1880). So a panel button goes straight to its destination:
 *   - never a `/q/` poster scan (a physical placement's tracking);
 *   - never `/s/`, `/e/`, `/r/` or `/c/` (they count taps and share opens);
 *   - never check-in (a check-in from the map would poison attendance).
 *
 * The destinations are the event's own poster codes (`shortlinks`, OSE-1357)
 * that the organizer put on the poster (`poster_position` not NULL), resolved
 * here the way `/s/` would resolve them, without the count:
 *   - the event page and its registration form are built from the event id by
 *     the card itself, so those kinds are left out here;
 *   - an external kind uses its saved https target, re-checked here as https.
 *
 * Also the event's share code (`event_codes`), for the Share button: the same
 * `/e/<code>` the event page shares.
 *
 * Reads only; fails to empty. A card without its extra buttons is correct, a
 * landing that errors because of them is not.
 */
import { isValidHttpsTarget } from './shortlinks.js';

/** One button for one event: the kind (its label) and where it goes. */
export interface PlaceLink {
  kind: string;
  href: string;
}

export interface PlaceLinks {
  /** The event's share code, for `/e/<code>`; null when none was minted. */
  shareCode: string | null;
  /** The organizer's own links, in poster order. */
  links: PlaceLink[];
}

/** Kinds the card already covers, or that must never be offered from the map. */
const LEFT_OUT = new Set(['public', 'register', 'checkin']);

/** D1 binds at most 100 values per statement; keep well under it. */
const CHUNK = 80;

export interface ShortlinkRow {
  event_id: string;
  kind: string | null;
  target_url: string | null;
  poster_position: number | null;
}

/** Pure: shortlink rows → each event's map links. Exported for the unit tests. */
export function placeLinksFromRows(
  rows: readonly ShortlinkRow[],
  codes: readonly { event_id: string; code: string | null }[] = []
): Map<string, PlaceLinks> {
  const out = new Map<string, PlaceLinks>();
  const entry = (id: string): PlaceLinks => {
    let e = out.get(id);
    if (!e) {
      e = { shareCode: null, links: [] };
      out.set(id, e);
    }
    return e;
  };
  const ordered = [...rows].sort(
    (a, b) =>
      a.event_id.localeCompare(b.event_id) || (a.poster_position ?? 0) - (b.poster_position ?? 0)
  );
  for (const r of ordered) {
    if (r.poster_position == null) continue; // taken off the poster
    const kind = r.kind ?? 'public';
    if (LEFT_OUT.has(kind)) continue;
    if (!isValidHttpsTarget(r.target_url)) continue;
    const e = entry(r.event_id);
    if (e.links.some((l) => l.kind === kind)) continue;
    e.links.push({ kind, href: r.target_url });
  }
  for (const c of codes) {
    if (c.code) entry(c.event_id).shareCode = c.code;
  }
  return out;
}

/** Read the panel links for these events. Never throws. */
export async function fetchPlaceLinks(
  db: D1Database | undefined | null,
  eventIds: readonly string[]
): Promise<Map<string, PlaceLinks>> {
  const ids = [...new Set(eventIds.filter((id) => typeof id === 'string' && id))];
  if (!db || ids.length === 0) return new Map();
  const rows: ShortlinkRow[] = [];
  const codes: { event_id: string; code: string | null }[] = [];
  try {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const part = ids.slice(i, i + CHUNK);
      const marks = part.map(() => '?').join(',');
      const [links, shares] = await Promise.all([
        db
          .prepare(
            `SELECT event_id, kind, target_url, poster_position FROM shortlinks
              WHERE event_id IN (${marks}) AND poster_position IS NOT NULL`
          )
          .bind(...part)
          .all<ShortlinkRow>(),
        db
          .prepare(`SELECT event_id, code FROM event_codes WHERE event_id IN (${marks})`)
          .bind(...part)
          .all<{ event_id: string; code: string | null }>(),
      ]);
      rows.push(...(links.results ?? []));
      codes.push(...(shares.results ?? []));
    }
  } catch {
    return new Map();
  }
  return placeLinksFromRows(rows, codes);
}
