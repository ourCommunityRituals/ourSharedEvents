/**
 * Stamp passport, pure layer (owner 2026-11-28, src/lib/passport.ts).
 *
 * Held here:
 *   1. the `passport` setting is opt-in: only a JSON `true` turns it on, a write
 *      takes only true or false, and the SQL test agrees with the reader;
 *   2. a stop's code lands on the stop's page with #stamp, the stop number
 *      encoded;
 *   3. the card escapes every organizer value and carries the stop list;
 *   4. the page script makes no request of any kind, sets no cookie and reads
 *      only its own storage key (privacy: the Worker never learns a path);
 *   5. every passport word is in every catalog.
 *
 * The script's behaviour in a real browser is the component spec
 * tests/e2e/2-pages/passport.component.spec.ts; the routes are
 * tests/passport-route.spec.ts (workers pool).
 *
 * @born-red owner 2026-11-28 | method: three faults one at a time, each
 * restored: the parser keeping a truthy string ("yes") as on (1 red);
 * a `fetch('/x')` added to the script (1 red); the escaper taken off the stop
 * number in the card (1 red). | date: 2026-11-28
 */
import { describe, test, expect } from 'vitest';
import {
  PASSPORT_KEY,
  parseEventSettings,
  passportOnSql,
  usesPassport,
  validateSettingsPatch,
} from '../src/lib/event-settings';
import {
  PASSPORT_STORAGE_PREFIX,
  passportScript,
  renderPassportCard,
  renderPassportMark,
  stampTarget,
} from '../src/lib/passport';
import { CATALOG, type MessageKey } from '../src/lib/i18n/catalog';
import { LANGUAGES } from '../src/lib/i18n/languages';

describe('the passport setting is opt-in', () => {
  test('absent, false, a string or a number read as off; only true is on', () => {
    expect(usesPassport(parseEventSettings('{}'))).toBe(false);
    expect(usesPassport(parseEventSettings('{"passport":false}'))).toBe(false);
    expect(usesPassport(parseEventSettings('{"passport":"yes"}'))).toBe(false);
    expect(usesPassport(parseEventSettings('{"passport":1}'))).toBe(false);
    expect(usesPassport(parseEventSettings('not json'))).toBe(false);
    expect(usesPassport(parseEventSettings('{"passport":true}'))).toBe(true);
  });

  test('a write takes true or false and refuses anything else', () => {
    expect(validateSettingsPatch({ passport: true })).toEqual({
      ok: true,
      value: { passport: true },
    });
    expect(validateSettingsPatch({ passport: false })).toEqual({
      ok: true,
      value: { passport: false },
    });
    const bad = validateSettingsPatch({ passport: 'yes' });
    expect(bad.ok).toBe(false);
  });

  test('the SQL test reads the same key and guards bad JSON', () => {
    const sql = passportOnSql('e');
    expect(sql).toContain(`'$.${PASSPORT_KEY}'`);
    expect(sql).toContain("= 'true'");
    expect(sql).toContain('json_valid(e.settings_json)');
  });
});

describe('a stop code lands on the stop page', () => {
  test('with #stamp and the number encoded', () => {
    expect(stampTarget('https://x.test', 'evt 1', 'A/1')).toBe(
      'https://x.test/events/evt%201/booths/A%2F1#stamp'
    );
  });
});

describe('the card', () => {
  const hostile = `<img src=x onerror=alert(1)>`;

  test('escapes the event id and every stop, and keeps the stop list as data', () => {
    const html = renderPassportCard({ eventId: 'evt-1', stops: ['1', hostile], stop: hostile });
    expect(html).not.toContain('<img');
    expect(html).toContain('data-testid="passport"');
    expect(html).toContain('data-passport-stop="&lt;img');
    const stops = /data-passport-stops="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(stops).toContain('&quot;1&quot;');
  });

  test('a stop page says how to collect; the list does not', () => {
    const onStop = renderPassportCard({ eventId: 'e', stops: ['1'], stop: '1' });
    const onList = renderPassportCard({ eventId: 'e', stops: ['1'], stop: null });
    expect(onStop).toContain('Scan this stop&#39;s code to collect its stamp.');
    expect(onList).not.toContain('data-passport-stop=');
  });

  test('without JavaScript it says how to keep stamps and shows no count', () => {
    const html = renderPassportCard({ eventId: 'e', stops: ['1', '2'], stop: null });
    expect(html).toContain('<noscript>');
    expect(html).toMatch(/data-testid="passport-count" hidden/);
  });

  test('a mark is hidden until the script shows it', () => {
    expect(renderPassportMark('B2')).toMatch(/data-passport-mark="B2" hidden/);
  });
});

describe('the script never reports a visitor', () => {
  const js = passportScript();

  test.each([
    ['fetch(', /\bfetch\s*\(/],
    ['XMLHttpRequest', /XMLHttpRequest/],
    ['sendBeacon', /sendBeacon/],
    ['document.cookie', /document\.cookie/],
    ['new Image', /new\s+Image/],
    ['a form submit', /\.submit\s*\(/],
    ['WebSocket', /WebSocket/],
    ['EventSource', /EventSource/],
    ['window.open', /window\.open/],
    [
      'location assignment',
      /location\s*=(?!=)|location\.href\s*=(?!=)|location\.assign|location\.replace/,
    ],
    ['sessionStorage or indexedDB', /sessionStorage|indexedDB/],
  ])('has no %s', (_name, re) => {
    expect(js).not.toMatch(re);
  });

  test('reads and writes only its own storage key', () => {
    const keys = [...js.matchAll(/localStorage\.(\w+)\(([^,)]*)/g)].map((m) => [m[1], m[2].trim()]);
    expect(keys.length).toBeGreaterThan(0);
    for (const [, arg] of keys) expect(arg).toBe('key');
    expect(js).toContain(`var key = '${PASSPORT_STORAGE_PREFIX}' + eventId;`);
  });

  test('stamps only with #stamp, then takes the fragment off', () => {
    expect(js).toContain("window.location.hash === '#stamp'");
    expect(js).toContain('history.replaceState');
  });
});

describe('every passport word is in every language', () => {
  const keys = Object.keys(CATALOG.en).filter((k) => k.startsWith('passport.')) as MessageKey[];

  test('there are passport words', () => {
    expect(keys.length).toBeGreaterThanOrEqual(9);
  });

  test.each(LANGUAGES.map((l) => [l]))('%s has each one', (lang) => {
    for (const k of keys) {
      const v = CATALOG[lang][k];
      expect(v, `${lang} ${k}`).toBeTruthy();
      if (k === 'passport.count') {
        expect(v).toContain('{have}');
        expect(v).toContain('{total}');
      }
    }
  });
});
