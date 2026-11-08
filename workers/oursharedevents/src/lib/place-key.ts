/**
 * How a typed place name is compared, and the states a name may carry after it
 * ("Oak Lawn, IL", "Springfield Illinois"). Shared by the landing's town search
 * (place-search.ts) and the /events place search (place-names.ts), so both read
 * a name the same way (CCR 2026-11-07 L3-04). Its own module so neither imports
 * the other.
 */
const WORDS: Record<string, string> = { saint: 'st', mount: 'mt', fort: 'ft' };

/**
 * A name as compared: no accents, lower case, no dots or apostrophes, hyphens
 * and runs of spaces as one space, and saint/mount/fort as st/mt/ft. Keep in
 * step with scripts/gen-place-names.mjs, which sorts the town table by it (a
 * unit test checks the table's order with this function).
 */
export function placeKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.']/g, '')
    .replace(/[\s-]+/g, ' ')
    .trim()
    .replace(/\b(saint|mount|fort)\b/g, (w) => WORDS[w]);
}

/** States and territories by postal code and by name: a typed state (code or name, as placeKey has it) to its code. */
// prettier-ignore
const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  PR: 'Puerto Rico', GU: 'Guam', VI: 'Virgin Islands', AS: 'American Samoa',
  MP: 'Northern Mariana Islands', MH: 'Marshall Islands',
};

export const STATE_BY_KEY: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [code, name] of Object.entries(STATE_NAMES)) {
    m.set(code.toLowerCase(), code);
    m.set(placeKey(name), code);
  }
  return m;
})();
