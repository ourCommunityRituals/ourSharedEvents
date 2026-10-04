// ─── Per-event section settings ────────────────────────────────────────────────
//
// OSE-869 (PO-4), first slice of OSE-851 (X-14). GAS let an organiser turn
// sections of an event's surfaces on and off; the Worker port dropped every one
// of those switches. PO decision (2026-09-30): the switches live PER EVENT, in
// `events.settings_json` (migration 0085), read through THIS module and nowhere
// else. X-14's other toggles (showSchedule, showSponsors, …) and the template
// `default_sections` fallback extend this file — they do not get a second home.
//
// The first key (OSE-869):
//
//   showQRSection — the poster's QR grid. A walk-up event has nothing to scan,
//                   so the organiser can print a poster with no codes on it.
//
// ABSENT MEANS ON. Every event created before this column existed has `{}`, and
// its poster must stay exactly as it was. The only value that turns a section
// off is an explicit `false`; anything unreadable fails toward showing it,
// because a missing section is a worse surprise than an extra one.
//
// Suppressing a section is a VISIBILITY decision, never a rendering one: the
// codes are still minted and coloured exactly as before (Invariant #3); the
// poster simply does not print them.

// OSE-851 (X-14), second slice (2026-10-01) — the TV display. GAS kept a
// per-event display order in /admin (AdminDisplay.html); PO decision: it lives
// HERE, in the same settings object, not in new columns. Three keys:
//
//   displayPanes        — which TV screens rotate, in order. Allowlisted names;
//                         absent means the default order.
//   displayDwellSeconds — seconds per screen, an integer 5..120; absent → 15.
//   leagueLinks         — { schedule, standings, bracket }: https links to
//                         where the league already keeps them (PO: "links out").
//
// Unlike showQRSection these are not on/off switches, so the reader still
// never throws and drops anything it cannot trust, and a write may send `null`
// for any of them to go back to the default. PUT merges with SQLite
// json_patch (RFC 7396): a null member deletes the stored key, and inside
// leagueLinks a null link deletes just that link.

// OSE-1560 — the one server-managed key. `mapDefault: true` means "this event's
// map setting is still the default (off); the organizer has not chosen it". It is
// written at create when no map choice was sent, removed by any explicit map
// write and by the sponsor flip (lib/map-default.ts), and never client-writable:
// validateSettingsPatch rejects it. Its SQL lives here with the rest of the
// settings_json readers so the column keeps one home.
export const MAP_DEFAULT_KEY = 'mapDefault';

/** SQL (on the events table, optional alias): the map setting is still the default. */
export function mapStillDefaultSql(alias = ''): string {
  const col = alias ? `${alias}.settings_json` : 'settings_json';
  return `json_extract(COALESCE(${col}, '{}'), '$.${MAP_DEFAULT_KEY}') = 1`;
}

/** SQL SET expression: `inner` (default: the stored settings) without the default marker. */
export function clearMapDefaultSql(inner = "COALESCE(settings_json, '{}')"): string {
  return `json_remove(${inner}, '$.${MAP_DEFAULT_KEY}')`;
}

/** `settingsJson` (a serialised settings object) with the default marker added. */
export function withMapDefaultMarker(settingsJson: string): string {
  return JSON.stringify({ ...JSON.parse(settingsJson), [MAP_DEFAULT_KEY]: true });
}

/** The boolean section switches. Additions are decisions. */
export const EVENT_SETTING_KEYS = ['showQRSection'] as const;
export type EventSettingKey = (typeof EVENT_SETTING_KEYS)[number];

/** The TV screens the display can rotate through, in default order. */
export const DISPLAY_PANES = ['event', 'upcoming', 'sponsors', 'league'] as const;
export type DisplayPane = (typeof DISPLAY_PANES)[number];

export const LEAGUE_LINK_KINDS = ['schedule', 'standings', 'bracket'] as const;
export type LeagueLinkKind = (typeof LEAGUE_LINK_KINDS)[number];
export type LeagueLinks = Partial<Record<LeagueLinkKind, string>>;

export const DWELL_MIN_SECONDS = 5;
export const DWELL_MAX_SECONDS = 120;
export const DWELL_DEFAULT_SECONDS = 15;
// A league link is shown on the TV as a scan-to-open QR. The QR encoder
// (lib/qr.ts) holds at most 154 bytes (version 7, error correction L), so a
// longer link would be accepted but could never be scanned. The cap is that
// capacity, measured in UTF-8 bytes of the normalised URL.
export const MAX_LINK_BYTES = 154;

export type EventSettings = Partial<Record<EventSettingKey, boolean>> & {
  /** Server-managed (OSE-1560): the map setting is still the default. */
  mapDefault?: true;
  displayPanes?: DisplayPane[];
  displayDwellSeconds?: number;
  leagueLinks?: LeagueLinks;
};

/** A stored settings write: like EventSettings, but null clears a key. */
export type EventSettingsPatch = Partial<Record<EventSettingKey, boolean>> & {
  displayPanes?: DisplayPane[] | null;
  displayDwellSeconds?: number | null;
  leagueLinks?: Partial<Record<LeagueLinkKind, string | null>> | null;
};

const KNOWN = new Set<string>(EVENT_SETTING_KEYS);
const PANES = new Set<string>(DISPLAY_PANES);
const LINK_KINDS = new Set<string>(LEAGUE_LINK_KINDS);

/** An https URL with a host and no credentials, or null. */
function cleanLink(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_LINK_BYTES * 4) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return null;
  const href = u.toString();
  return new TextEncoder().encode(href).length <= MAX_LINK_BYTES ? href : null;
}

function isDwell(v: unknown): v is number {
  return (
    typeof v === 'number' && Number.isInteger(v) && v >= DWELL_MIN_SECONDS && v <= DWELL_MAX_SECONDS
  );
}

/** Unique allowlisted pane names, in the order given; null if anything else. */
function cleanPanes(v: unknown): DisplayPane[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > DISPLAY_PANES.length) return null;
  const out: DisplayPane[] = [];
  for (const p of v) {
    if (typeof p !== 'string' || !PANES.has(p) || out.includes(p as DisplayPane)) return null;
    out.push(p as DisplayPane);
  }
  return out;
}

/**
 * Parse the stored `settings_json` column. Never throws: a malformed value
 * reads as `{}` (every section on, default display), and unknown or
 * ill-typed keys are dropped rather than trusted.
 */
export function parseEventSettings(raw: unknown): EventSettings {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out: EventSettings = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (KNOWN.has(k) && typeof v === 'boolean') out[k as EventSettingKey] = v;
    else if (k === MAP_DEFAULT_KEY) {
      if (v === true) out.mapDefault = true;
    } else if (k === 'displayPanes') {
      const panes = cleanPanes(v);
      if (panes) out.displayPanes = panes;
    } else if (k === 'displayDwellSeconds' && isDwell(v)) out.displayDwellSeconds = v;
    else if (k === 'leagueLinks' && v && typeof v === 'object' && !Array.isArray(v)) {
      const links: LeagueLinks = {};
      for (const [kind, url] of Object.entries(v as Record<string, unknown>)) {
        const clean = LINK_KINDS.has(kind) ? cleanLink(url) : null;
        if (clean) links[kind as LeagueLinkKind] = clean;
      }
      if (Object.keys(links).length) out.leagueLinks = links;
    }
  }
  return out;
}

/** Is the poster's QR grid shown? Absent or unreadable → yes. */
export function showQRSection(settings: EventSettings): boolean {
  return settings.showQRSection !== false;
}

/** The resolved (absent → on) section switches a surface renders from. */
export function resolveEventSettings(settings: EventSettings): Record<EventSettingKey, boolean> {
  return { showQRSection: showQRSection(settings) };
}

export interface DisplaySettings {
  panes: DisplayPane[];
  dwellSeconds: number;
  leagueLinks: LeagueLinks;
}

/** The resolved TV display config: defaults filled, never undefined. */
export function resolveDisplaySettings(settings: EventSettings): DisplaySettings {
  return {
    panes: settings.displayPanes ? [...settings.displayPanes] : [...DISPLAY_PANES],
    dwellSeconds: settings.displayDwellSeconds ?? DWELL_DEFAULT_SECONDS,
    leagueLinks: { ...(settings.leagueLinks ?? {}) },
  };
}

/**
 * Validate a client-supplied `settings` patch (create or update body).
 * Strict, unlike the reader: a write with an unknown key or a bad value is a
 * client bug worth a 400, not something to store and ignore. `null` clears a
 * display key (or one league link) back to its default.
 */
export function validateSettingsPatch(
  patch: unknown
): { ok: true; value: EventSettingsPatch } | { ok: false; error: string } {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, error: 'settings must be an object' };
  }
  const out: EventSettingsPatch = {};
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (KNOWN.has(k)) {
      if (typeof v !== 'boolean')
        return { ok: false, error: `settings.${k} must be true or false` };
      out[k as EventSettingKey] = v;
    } else if (k === 'displayPanes') {
      if (v === null) {
        out.displayPanes = null;
        continue;
      }
      const panes = cleanPanes(v);
      if (!panes) {
        return {
          ok: false,
          error: `settings.displayPanes must list 1-${DISPLAY_PANES.length} of ${DISPLAY_PANES.join(', ')}, each once`,
        };
      }
      out.displayPanes = panes;
    } else if (k === 'displayDwellSeconds') {
      if (v !== null && !isDwell(v)) {
        return {
          ok: false,
          error: `settings.displayDwellSeconds must be a whole number from ${DWELL_MIN_SECONDS} to ${DWELL_MAX_SECONDS}`,
        };
      }
      out.displayDwellSeconds = v as number | null;
    } else if (k === 'leagueLinks') {
      if (v === null) {
        out.leagueLinks = null;
        continue;
      }
      if (typeof v !== 'object' || Array.isArray(v)) {
        return { ok: false, error: 'settings.leagueLinks must be an object' };
      }
      const links: Partial<Record<LeagueLinkKind, string | null>> = {};
      for (const [kind, url] of Object.entries(v as Record<string, unknown>)) {
        if (!LINK_KINDS.has(kind)) {
          return { ok: false, error: `settings.leagueLinks.${kind} is not a known link` };
        }
        if (url === null || url === '') {
          links[kind as LeagueLinkKind] = null;
          continue;
        }
        const clean = cleanLink(url);
        if (!clean) {
          return {
            ok: false,
            error: `settings.leagueLinks.${kind} must be an https:// link with no username or password, of at most ${MAX_LINK_BYTES} bytes once encoded, so it fits in a QR code (plain letters and digits are 1 byte each; spaces and accented letters count for more). Try the sheet's share link or a short link`,
          };
        }
        links[kind as LeagueLinkKind] = clean;
      }
      out.leagueLinks = links;
    } else {
      return { ok: false, error: `settings.${k} is not a known setting` };
    }
  }
  return { ok: true, value: out };
}
