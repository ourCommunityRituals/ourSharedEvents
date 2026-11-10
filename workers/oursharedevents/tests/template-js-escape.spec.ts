/**
 * A `{{js:key}}` slot is safe inside a single-quoted script string whatever the
 * catalog text holds (OSE-1970, epic OSE-1959). No catalog value has a
 * backslash, an angle bracket, a line break or U+2028 today, so the escape was
 * never exercised and its mutants survived. This file swaps in one crafted
 * value and checks each escape.
 *
 * Its own file: `vi.mock` replaces the catalog lookup for the whole file.
 */
import { describe, it, expect, vi } from 'vitest';

const NASTY = `a\\b'c<d>e\r\nf\ng${String.fromCharCode(0x2028)}h${String.fromCharCode(0x2029)}i`;

vi.mock('../src/lib/i18n/catalog', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/i18n/catalog')>();
  return { ...real, msg: () => NASTY };
});

const { fillTemplate } = await import('../src/lib/i18n/template');

describe('fillTemplate | {{js:key}} escapes for a single-quoted script string', () => {
  it('escapes backslash, quote, angle brackets, line breaks, U+2028 and U+2029', () => {
    expect(fillTemplate('{{js:back.label}}', 'ar')).toBe(
      "a\\\\b\\'c\\u003Cd\\u003Ee\\nf\\ng\\u2028h\\u2029i"
    );
  });

  it('a {{t:key}} slot gives the text as it is', () => {
    expect(fillTemplate('{{t:back.label}}', 'pl')).toBe(NASTY);
  });
});
