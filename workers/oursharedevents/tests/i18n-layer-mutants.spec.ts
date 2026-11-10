/**
 * The language layer's edges that the older specs left open (OSE-1970, epic
 * OSE-1959). Putting `resolve-language.ts`, `path-prefix.ts` and `template.ts`
 * on Stryker for Polish and Arabic showed mutants that survived every existing
 * test; each case below names the mutant it kills.
 *
 * Node-clean, pure functions.
 */
import { describe, it, expect } from 'vitest';
import { resolveLanguage } from '../src/lib/i18n/resolve-language';
import { matchLanguagePage, parseLangPrefix } from '../src/lib/i18n/path-prefix';
import { fillTemplate } from '../src/lib/i18n/template';

describe('resolveLanguage | the q parameter, exactly', () => {
  it('a parameter that is not q leaves the quality at 1 (kills `if (false) continue`)', () => {
    expect(resolveLanguage('ar;level=1')).toBe('ar');
    expect(resolveLanguage('pl;foo=bar, en;q=0.9')).toBe('pl');
  });

  it('only a parameter named q is the quality (kills /q\\s*=/ unanchored, /^q\\S*=/)', () => {
    expect(resolveLanguage('ar;aq=0')).toBe('ar');
    expect(resolveLanguage('ar;qx=0.1, en;q=0.5')).toBe('ar');
  });

  it('spaces around the parameter are trimmed (kills dropping .trim())', () => {
    expect(resolveLanguage('en;q=0.9, ar; q=0.5')).toBe('en');
    expect(resolveLanguage('en;q=0.4, pl; q=0.5')).toBe('pl');
  });

  it('a space before = is still q (kills /^q\\S*=/ in the value match)', () => {
    expect(resolveLanguage('ar;q =0.5, en;q=0.4')).toBe('ar');
  });

  it('every number form RFC 9110 allows is read, and only those', () => {
    // Two decimals (kills `\.[0-9]` for `\.[0-9]*`).
    expect(resolveLanguage('ar;q=0.55, en;q=0.5')).toBe('ar');
    // A whole number with no point (kills the point made required).
    expect(resolveLanguage('pl;q=1, en;q=0.5')).toBe('pl');
    // A leading zero before the point (kills `[0-9]` for `[0-9]+`).
    expect(resolveLanguage('ar;q=00.9, en;q=0.5')).toBe('ar');
    // A bare fraction, one and two digits (kills `\.[0-9]` and `\.[^0-9]+`).
    expect(resolveLanguage('pl;q=.5, en;q=0.4')).toBe('pl');
    expect(resolveLanguage('pl;q=.55, en;q=0.5')).toBe('pl');
    // Trailing junk makes it invalid, so the entry is skipped (kills a dropped `$`).
    expect(resolveLanguage('ar;q=0.5x, en;q=0.4')).toBe('en');
    // Junk before a later "q=" is invalid too (kills a dropped `^` in the value match).
    expect(resolveLanguage('ar;q=xq=0.5, en;q=0.4')).toBe('en');
  });
});

describe('parseLangPrefix | only a path that starts with /', () => {
  it('a path with no leading slash is not prefixed (kills `if (false)` and startsWith(""))', () => {
    expect(parseLangPrefix('x/ar/events')).toBeNull();
    expect(parseLangPrefix('ar/events')).toBeNull();
    expect(parseLangPrefix('')).toBeNull();
  });
});

describe('matchLanguagePage | a named event page is matched from the start', () => {
  it('a path with something before /events is not an event page (kills a dropped `^`)', () => {
    expect(matchLanguagePage('/x/events/abc/spring')).toBeNull();
    expect(matchLanguagePage('/ar/events/abc/spring')).toBeNull();
  });
});

describe('fillTemplate | slots', () => {
  it('a {{js:key}} slot is escaped for a single-quoted script string, a {{t:key}} slot is not', () => {
    // "See what's coming up": the apostrophe must be escaped only in script.
    expect(fillTemplate("'{{js:next.browse}}'", 'en')).toBe("'See what\\'s coming up'");
    expect(fillTemplate('<p>{{t:next.browse}}</p>', 'en')).toBe("<p>See what's coming up</p>");
  });

  it('a slot naming no catalog key throws, naming the key', () => {
    expect(() => fillTemplate('{{t:no.such.key}}', 'ar')).toThrow(
      'No catalog key "no.such.key" for a page slot'
    );
  });
});
