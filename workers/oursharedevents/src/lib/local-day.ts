// The calendar day of an instant in an event's zone. Shared by the pre-event
// card and the scan cells (lib/scan-cells.ts), so a day means the same thing
// on both.

const HOME_TZ = 'America/Chicago';

/** YYYY-MM-DD of an instant in `tz` (falls back to HOME_TZ, then UTC). */
export function localDay(instant: Date, tz: string | null | undefined): string {
  for (const zone of [tz, HOME_TZ, 'UTC']) {
    if (!zone) continue;
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(instant);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
      return `${get('year')}-${get('month')}-${get('day')}`;
    } catch {
      // unknown zone → next fallback
    }
  }
  return instant.toISOString().slice(0, 10);
}
