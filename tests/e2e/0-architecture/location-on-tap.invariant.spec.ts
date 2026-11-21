/**
 * INVARIANT: the phone's position is read only when the person asks for it, and
 * the scripts that read it keep nothing and send nothing (OSE-2198 Part C).
 *
 * Owner ruling, 2026-11-19: "the user need to tap and save purposely by
 * choice." AGENTS.md invariants 3 and 4: geolocation picks what to show and is
 * never stored; no cookies on public surfaces. And the ruling of 2026-11-16,
 * "zip finds, tap places": the position never leaves the phone.
 *
 * Two scripts read the position, and only these two may:
 *   - the map's script, workers/oursharedevents/src/lib/map-pan-script.ts: on
 *     the tap of "Show where I am", even where location is already allowed;
 *   - the landing's "Near me", workers/oursharedevents/src/lib/area-tabs-script.ts:
 *     when the person chooses a distance.
 *
 * Pyramid coverage:
 *   L0 STATIC (this file): reads both scripts' source and fails on
 *     - any storage, cookie, request, logging or address write ("keeps nothing");
 *     - a position read anywhere but the one place the person's act calls it
 *       ("read on ask"), or any script under src/ other than these two that
 *       reads a position.
 *   Behaviour, in jsdom: workers/oursharedevents/tests/location-on-tap.spec.ts
 *   (the browser says `granted`, and nothing is read until the tap).
 *
 * WHEN A SAVE IS BUILT (OSE-2198 Part C2, design only today): a place the person
 * chooses to save is written by the Save tap handler alone. This file's
 * "keeps nothing" rule then becomes "storage is written only from the Save tap
 * handler", reviewed with the owner's amendment of invariant 4. Until then, no
 * storage anywhere.
 *
 * Born red (kept in this file, permanent): the pure scan is run on planted
 * sources: a localStorage write, a cookie, a fetch, the map reading on a
 * `granted` permission at load, and "Near me" reading on load; each is caught.
 * Born red by hand (2026-11-19): a getCurrentPosition call added to another
 * file under src/ turned "no other source under src/ reads a position" red;
 * the `granted` read on load put back in map-pan-script.ts and a
 * localStorage.setItem added to it each turned the first test red; each put back.
 */

import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '..', '..', '..', 'workers', 'oursharedevents', 'src');
const MAP = 'lib/map-pan-script.ts';
const TABS = 'lib/area-tabs-script.ts';
/**
 * The one other script that reads a position, which this rule does not yet
 * cover: the landing's "Use my location" (owner, 2026-10-10). Where location is
 * already allowed it reads on load, without a tap, and sends a 5-character
 * geohash box (about 5 km) to POST /near, pinned by
 * workers/oursharedevents/tests/landing-where-unit.spec.ts. That predates the
 * 2026-11-19 "tap ... by choice" ruling and is reported to the owner under
 * OSE-2198 Part C; it is not changed here. Any other reader fails.
 */
const KNOWN_ELSEWHERE = 'templates/landing.html';

/** Ways a page script keeps, sends, logs or publishes something. */
const KEEPS_OR_SENDS: Array<[string, RegExp]> = [
  ['localStorage', /\blocalStorage\b/],
  ['sessionStorage', /\bsessionStorage\b/],
  ['indexedDB', /\bindexedDB\b/],
  ['Cache API', /\bcaches\b/],
  ['cookie', /\bcookie(Store)?\b/i],
  ['fetch', /\bfetch\s*\(/],
  ['XMLHttpRequest', /XMLHttpRequest/],
  ['sendBeacon', /sendBeacon/],
  ['WebSocket', /WebSocket/],
  ['EventSource', /EventSource/],
  ['image request', /\bnew\s+Image\b|\.src\s*=/],
  ['dynamic import', /\bimport\s*\(/],
  ['service worker', /serviceWorker/],
  ['form submit', /\.submit\s*\(|<form/],
  ['postMessage', /postMessage/],
  ['window.open', /\bwindow\.open\b/],
  ['address or history', /\blocation\s*[.=]|\bhistory\./],
  ['logging', /\bconsole\./],
  ['watching the position', /watchPosition/],
];

/** The script a module ships, the text between String.raw` and its closing backtick. */
function scriptOf(source: string): string {
  const start = source.indexOf('String.raw`');
  const end = source.indexOf('})();`', start);
  return start < 0 || end < 0 ? '' : source.slice(start, end + 5);
}

const count = (s: string, re: RegExp) => (s.match(new RegExp(re.source, 'g')) ?? []).length;

/** What is wrong with one script: an empty list when it keeps the rules. */
function breaches(script: string, which: 'map' | 'tabs'): string[] {
  const out: string[] = [];
  if (!script) return ['no script found'];
  for (const [name, re] of KEEPS_OR_SENDS) if (re.test(script)) out.push(`keeps or sends: ${name}`);
  if (count(script, /getCurrentPosition\(/) !== 1)
    out.push('reads the position in more than one place');
  if (which === 'map') {
    // `find` reads the position; it is defined once and handed to the click
    // listener of "Show where I am", and named nowhere else.
    if (!/function find\(\) \{[^}]*getCurrentPosition\(/.test(script))
      out.push('the position is read outside find()');
    if (count(script, /\bfind\b/) !== 2 || !script.includes("me.addEventListener('click', find);"))
      out.push('find() is called other than by the tap');
    if (/granted/.test(script)) out.push('reads on a granted permission, without a tap');
  } else {
    // `locate` reads the position; it is called once, from the distance choice.
    if (!/function locate\(\) \{[\s\S]*?getCurrentPosition\(/.test(script))
      out.push('the position is read outside locate()');
    if (count(script, /\blocate\(\)/) !== 2)
      out.push('locate() is called other than by the choice');
    if (
      !/addEventListener\('change', function \(\) \{\s*if \(radius\(\) > 0 && !here\) locate\(\)/.test(
        script
      )
    )
      out.push('locate() is not called from the distance choice');
    if (/permissions/.test(script)) out.push('reads the permission state');
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(ts|js|html)$/.test(name) ? [p] : [];
  });
}

test.describe('location is read on ask and kept nowhere (OSE-2198 Part C)', () => {
  test('the map script keeps nothing, sends nothing, and reads the position only on the tap', () => {
    const script = scriptOf(readFileSync(join(SRC, MAP), 'utf8'));
    expect(script.length).toBeGreaterThan(1000);
    expect(breaches(script, 'map')).toEqual([]);
  });

  test('"Near me" keeps nothing, sends nothing, and reads the position only on a distance choice', () => {
    const script = scriptOf(readFileSync(join(SRC, TABS), 'utf8'));
    expect(script.length).toBeGreaterThan(1000);
    expect(breaches(script, 'tabs')).toEqual([]);
  });

  test('no other source under src/ reads a position (but the one named above)', () => {
    const readers = sourceFiles(SRC)
      .filter((f) => /getCurrentPosition|watchPosition/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f).split(sep).join('/'))
      .sort();
    expect(readers).toEqual([TABS, MAP, KNOWN_ELSEWHERE].sort());
  });

  test('born red: the scan catches each planted fault', () => {
    const map = scriptOf(readFileSync(join(SRC, MAP), 'utf8'));
    const tabs = scriptOf(readFileSync(join(SRC, TABS), 'utf8'));
    const plant = (s: string, after: string, add: string) => {
      expect(s.includes(after), after).toBe(true);
      return s.replace(after, after + add);
    };
    const faults: Array<[string, string, 'map' | 'tabs', RegExp]> = [
      [
        'a localStorage write',
        plant(map, 'here = [lat, lng];', "localStorage.setItem('p', here);"),
        'map',
        /localStorage/,
      ],
      [
        'a cookie',
        plant(
          tabs,
          'here = [p.coords.latitude, p.coords.longitude];',
          "document.cookie = 'p=' + here;"
        ),
        'tabs',
        /cookie/,
      ],
      ['a fetch', plant(map, 'here = [lat, lng];', "fetch('/p?' + here);"), 'map', /fetch/],
      [
        'the map reading on a granted permission at load',
        map.replace(
          "if (s.state === 'denied') me.hidden = true;",
          "if (s.state === 'granted') find(); else if (s.state === 'denied') me.hidden = true;"
        ),
        'map',
        /granted|tap/,
      ],
      [
        '"Near me" reading on load',
        plant(tabs, '  select(0, false);', '\n  locate();'),
        'tabs',
        /choice/,
      ],
    ];
    for (const [name, src, which, want] of faults) {
      expect(src, name).not.toBe(which === 'map' ? map : tabs);
      const found = breaches(src, which);
      expect(
        found.some((b) => want.test(b)),
        `${name}: ${found.join('; ')}`
      ).toBe(true);
    }
  });
});
