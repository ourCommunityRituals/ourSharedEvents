/**
 * Helpers for tests/count-floor-publication.derived.spec.ts (OSE-1782).
 */

/** Words that make a field name count-shaped once it is split into words. */
const COUNT_WORDS: ReadonlySet<string> = new Set([
  'count',
  'counts',
  'total',
  'totals',
  'num',
  'sum',
  'people',
  'person',
  'attendee',
  'attendees',
  'rsvp',
  'rsvps',
  'registration',
  'registrations',
  'registered',
  'checkin',
  'checkins',
  'scan',
  'scans',
  'visitor',
  'visitors',
  'walkin',
  'walkins',
  'capacity',
  'headcount',
  'returned',
]);

function words(field: string): string[] {
  return field
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Fields whose name reads as a number of people. A name heuristic, so it leans
 * wide: a false positive is one declaration; a false negative is a leak.
 */
export function countShapedFields(fields: readonly string[]): string[] {
  return fields.filter((f) => {
    const w = words(f);
    // "walk_in" arrives as two words; read it as one.
    const joined = w.join('');
    return w.some((x) => COUNT_WORDS.has(x)) || /walkins?/.test(joined);
  });
}

/** True when `text` defines (not merely calls or imports) a function called `name`. */
export function definesFunction(text: string, name: string): boolean {
  const fn = new RegExp(`\\bfunction\\s+${name}\\b`);
  const arrow = new RegExp(
    `\\b(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?(?:\\(|[A-Za-z_$][\\w$]*\\s*=>)`
  );
  return fn.test(text) || arrow.test(text);
}
