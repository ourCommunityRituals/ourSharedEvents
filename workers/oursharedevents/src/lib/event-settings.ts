// ─── Per-event section settings ────────────────────────────────────────────────
//
// OSE-869 (PO-4), first slice of OSE-851 (X-14). GAS let an organiser turn
// sections of an event's surfaces on and off; the Worker port dropped every one
// of those switches. PO decision (2026-09-30): the switches live PER EVENT, in
// `events.settings_json` (migration 0083), read through THIS module and nowhere
// else. X-14's other toggles (showSchedule, showSponsors, …) and the template
// `default_sections` fallback extend this file — they do not get a second home.
//
// Only one key ships today:
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

/** The keys an event's settings object may carry. Additions are decisions. */
export const EVENT_SETTING_KEYS = ['showQRSection'] as const;
export type EventSettingKey = (typeof EVENT_SETTING_KEYS)[number];

export type EventSettings = Partial<Record<EventSettingKey, boolean>>;

const KNOWN = new Set<string>(EVENT_SETTING_KEYS);

/**
 * Parse the stored `settings_json` column. Never throws: a malformed value
 * reads as `{}` (every section on), and unknown or non-boolean keys are
 * dropped rather than trusted.
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
  }
  return out;
}

/** Is the poster's QR grid shown? Absent or unreadable → yes. */
export function showQRSection(settings: EventSettings): boolean {
  return settings.showQRSection !== false;
}

/** The resolved (absent → on) view a surface renders from. */
export function resolveEventSettings(settings: EventSettings): Record<EventSettingKey, boolean> {
  return { showQRSection: showQRSection(settings) };
}

/**
 * Validate a client-supplied `settings` patch (create or update body).
 * Strict, unlike the reader: a write with an unknown key or a non-boolean
 * value is a client bug worth a 400, not something to store and ignore.
 */
export function validateSettingsPatch(
  patch: unknown
): { ok: true; value: EventSettings } | { ok: false; error: string } {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, error: 'settings must be an object' };
  }
  const out: EventSettings = {};
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (!KNOWN.has(k)) {
      return { ok: false, error: `settings.${k} is not a known setting` };
    }
    if (typeof v !== 'boolean') {
      return { ok: false, error: `settings.${k} must be true or false` };
    }
    out[k as EventSettingKey] = v;
  }
  return { ok: true, value: out };
}
