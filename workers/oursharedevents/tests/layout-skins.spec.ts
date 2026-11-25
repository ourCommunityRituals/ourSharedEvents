/**
 * Layout skins (OSE-2232; OSE-2226 for the vote screen).
 *
 * Rules held here, each named after the fault it was watched failing on:
 *   1. every ready-made skin passes the same check a save does, and the first
 *      skin of the report is today's order in one column [standard skin reordered];
 *   2. a layout must list every region once, so a skin can never hide a part
 *      [the "every region" check removed];
 *   3. a layout names regions only: an unknown key, region, skin or column
 *      count is refused [key allowlist removed];
 *   4. the settings reader drops a bad stored layout and the surface takes its
 *      standard skin; the writer refuses it in words [lenient write];
 *   5. a skin file (.md) reads to the same layout a save holds, one block per
 *      page; another product's block is passed over; a written file reads
 *      back to what it was written from [list parse broken];
 *   6. the browser mover moves regions in the DOM, keeps a part the layout does
 *      not name, ignores a name that is not a region, and marks the wide ones
 *      [mover takes a name that is not an allowed region];
 *   7. the report page's parts and the region list agree, and the layout CSS
 *      holds no color [a data-region removed from the report];
 *   8. a layout that names a ready-made skin matches it exactly, or must say
 *      custom; a color or count key is refused in the words the ourWKRP
 *      editor uses too (ourWKRP#139) [skin match check removed].
 *
 * Placement: node project. Pure logic over imports and the template source.
 *
 * @born-red OSE-2232 | method: injected-fault, each removed after; listed in
 * the PR body | date: 2026-11-25
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  LAYOUT_CLIENT_JS,
  LAYOUT_CSS,
  LAYOUT_SURFACES,
  SKINS,
  SURFACE_REGIONS,
  checkLayout,
  defaultLayout,
  layoutSkinsHead,
  skinLayout,
} from '../src/lib/layout-skins';
import { parseSkinFile, skinFile, skinMarkdown } from '../src/lib/layout-skin-md';
import {
  parseEventSettings,
  resolveLayout,
  validateSettingsPatch,
} from '../src/lib/event-settings';

const SRC = join(__dirname, '..', 'src');

describe('OSE-2232 | layout skins', () => {
  test('1. every ready-made skin passes the save check; standard is today', () => {
    for (const surface of LAYOUT_SURFACES) {
      for (const name of Object.keys(SKINS[surface])) {
        const r = checkLayout(surface, skinLayout(surface, name));
        expect(r.ok, `${surface}/${name}`).toBe(true);
      }
    }
    expect(defaultLayout('report')).toEqual({
      skin: 'standard',
      columns: 1,
      order: ['stats', 'map', 'sponsors', 'classes', 'posters', 'trend', 'locked'],
      wide: [],
    });
    expect(defaultLayout('vote_screen').order).toEqual(['line', 'code']);
  });

  test('2. a layout lists every region once: nothing can be hidden', () => {
    const base = defaultLayout('report');
    const missing = { ...base, order: base.order.slice(1) };
    const twice = { ...base, order: [...base.order.slice(1), 'map'] };
    for (const bad of [missing, twice]) {
      const r = checkLayout('report', bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/must list each of stats, map/);
    }
  });

  test('3. a layout names regions only', () => {
    const base = defaultLayout('report');
    const cases: [unknown, RegExp][] = [
      [
        { ...base, color: 'red' },
        /color is not taken: colors, fonts and sizes come from the design system/,
      ],
      [
        { ...base, votes: 3 },
        /votes is not taken: a skin carries no numbers; counts keep the count floor/,
      ],
      [{ ...base, extra: 1 }, /extra is not part of a layout/],
      [{ ...base, skin: 'loud' }, /skin must be one of standard/],
      [{ ...base, columns: 3 }, /columns must be 1 or 2/],
      [{ ...base, wide: ['map', 'map'] }, /wide must list some of/],
      [{ ...base, wide: ['<img>'] }, /wide must list some of/],
      [{ ...base, order: [...base.order.slice(1), 'person'] }, /order must list/],
      ['standard', /must be an object/],
    ];
    for (const [v, words] of cases) {
      const r = checkLayout('report', v);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(words);
    }
    const custom = checkLayout('report', { ...base, skin: 'custom', wide: ['trend', 'map'] });
    expect(custom.ok && custom.value.wide).toEqual(['map', 'trend']);
  });

  test('4. reader drops a bad stored layout; writer refuses it in words', () => {
    const good = skinLayout('report', 'map_first')!;
    const stored = JSON.stringify({ layouts: { report: good, vote_screen: { skin: 'x' } } });
    const read = parseEventSettings(stored);
    expect(read.layouts).toEqual({ report: good });
    expect(resolveLayout(read, 'vote_screen')).toEqual(defaultLayout('vote_screen'));
    expect(resolveLayout(read, 'report')).toEqual(good);

    expect(validateSettingsPatch({ layouts: { report: good } })).toEqual({
      ok: true,
      value: { layouts: { report: good } },
    });
    expect(validateSettingsPatch({ layouts: null })).toEqual({
      ok: true,
      value: { layouts: null },
    });
    const bad = validateSettingsPatch({ layouts: { poster: good } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/not a page that takes a layout/);
    const broken = validateSettingsPatch({ layouts: { report: { ...good, columns: 0 } } });
    expect(broken.ok).toBe(false);
  });

  test('5. a skin file reads to the layout a save holds, and round-trips', () => {
    const md = [
      '---',
      'surface: report',
      'skin: custom',
      'columns: 2',
      'order: [trend, map, stats, sponsors, classes, posters, locked]',
      'wide: map, trend',
      '---',
      '',
      'Notes: the trend leads, for the series sponsor.',
      '---',
      'A rule in the notes is still notes.',
      '',
      '---',
      'surface: profile',
      'skin: side_by_side',
      '---',
      '',
      '---',
      'surface: vote_screen',
      'skin: side_by_side',
      'columns: 2',
      'order: code, line',
      'wide:',
      '---',
    ].join('\n');
    expect(parseSkinFile(md)).toEqual({
      ok: true,
      layouts: {
        report: {
          skin: 'custom',
          columns: 2,
          order: ['trend', 'map', 'stats', 'sponsors', 'classes', 'posters', 'locked'],
          wide: ['map', 'trend'],
        },
        vote_screen: skinLayout('vote_screen', 'side_by_side'),
      },
      skipped: ['profile'],
    });
    for (const surface of LAYOUT_SURFACES) {
      for (const name of Object.keys(SKINS[surface])) {
        const layout = skinLayout(surface, name)!;
        expect(parseSkinFile(skinMarkdown(surface, layout))).toEqual({
          ok: true,
          layouts: { [surface]: layout },
          skipped: [],
        });
      }
    }
    const both = {
      report: skinLayout('report', 'map_first')!,
      vote_screen: defaultLayout('vote_screen'),
    };
    expect(parseSkinFile(skinFile(both))).toEqual({ ok: true, layouts: both, skipped: [] });
    // One name on every page: standard and side_by_side exist on each surface.
    for (const surface of LAYOUT_SURFACES) {
      expect(Object.keys(SKINS[surface])).toEqual(
        expect.arrayContaining(['standard', 'side_by_side'])
      );
    }

    const refusals: [string, RegExp][] = [
      ['surface: report', /names no page this product arranges/],
      ['---\nsurface: report\n', /block at line 1 must end with a line of three dashes/],
      ['---\nsurface: poster\nskin: x\n---', /names no page this product arranges/],
      [
        '---\nsurface: report\ncolor: red\n---',
        /line 3: color is not taken: colors, fonts and sizes/,
      ],
      [
        '---\nsurface: report\nfloor: 1\n---',
        /line 3: floor is not taken: a skin carries no numbers/,
      ],
      ['---\nsurface: vote_screen\nskin: code_first\nskin: standard\n---', /skin is given twice/],
      [
        '---\nsurface: vote_screen\nskin: code_first\ncolumns: 1\n---',
        /vote_screen: order is missing/,
      ],
      [
        '---\nsurface: vote_screen\nskin: code_first\ncolumns: 1\norder: code\n---',
        /vote_screen: order must list each of line, code once/,
      ],
      [
        '---\nsurface: vote_screen\nskin: standard\ncolumns: 1\norder: code, line\n---',
        /vote_screen: differs from the standard skin; set skin to custom/,
      ],
      [
        skinMarkdown('vote_screen', defaultLayout('vote_screen')) +
          '\n' +
          skinMarkdown('vote_screen', defaultLayout('vote_screen')),
        /surface vote_screen is given twice/,
      ],
      ['---\nsurface: report\n<script>\n---', /line 3 must read key: value/],
      ['x'.repeat(9000), /at most 8192 bytes/],
    ];
    for (const [text, words] of refusals) {
      const p = parseSkinFile(text);
      expect(p.ok, text.slice(0, 40)).toBe(false);
      if (!p.ok) expect(p.error).toMatch(words);
    }
  });

  test('6. the browser mover moves regions in the DOM and nothing else', () => {
    // A tiny stand-in for a container: children with attributes, appendChild moves.
    type El = {
      attrs: Record<string, string>;
      getAttribute(n: string): string | null;
      setAttribute(n: string, v: string): void;
      removeAttribute(n: string): void;
    };
    const el = (attrs: Record<string, string>): El => ({
      attrs,
      getAttribute: (n) => (n in attrs ? attrs[n]! : null),
      setAttribute: (n, v) => void (attrs[n] = v),
      removeAttribute: (n) => void delete attrs[n],
    });
    const box = el({}) as El & { children: El[]; appendChild(c: El): void };
    box.children = [
      el({ id: 'header' }),
      el({ 'data-region': 'person' }),
      el({ 'data-region': 'stats' }),
      el({ 'data-region': 'map' }),
      el({ 'data-region': 'trend' }),
    ];
    box.appendChild = (c) => {
      box.children = box.children.filter((x) => x !== c);
      box.children.push(c);
    };
    const win: Record<string, unknown> = {};
    new Function('window', LAYOUT_CLIENT_JS)(win);
    const apply = win.OSE_applyLayout as (c: unknown, l: unknown, r: string[]) => boolean;
    const ok = apply(
      box,
      { skin: 'custom', columns: 2, order: ['person', 'map', 'stats'], wide: ['map', 'person'] },
      ['stats', 'map', 'trend']
    );
    expect(ok).toBe(true);
    const names = box.children.map((c) => c.attrs['data-region'] ?? c.attrs.id);
    expect(names).toEqual(['header', 'person', 'map', 'stats', 'trend']);
    expect(box.children.find((c) => c.attrs['data-region'] === 'map')!.attrs['data-wide']).toBe(
      '1'
    );
    expect(
      box.children.find((c) => c.attrs['data-region'] === 'stats')!.attrs['data-wide']
    ).toBeUndefined();
    expect(
      box.children.find((c) => c.attrs['data-region'] === 'person')!.attrs['data-wide']
    ).toBeUndefined();
    expect(box.attrs['data-layout-columns']).toBe('2');
    expect(apply(box, null, ['stats'])).toBe(false);
  });

  test('7. the report page and the region list agree; the layout CSS has no color', () => {
    const page = readFileSync(join(SRC, 'templates', 'shared-report.html'), 'utf8');
    const found = new Set([...page.matchAll(/data-region=\\?"([a-z_]+)\\?"/g)].map((m) => m[1]));
    expect([...found].sort()).toEqual([...SURFACE_REGIONS.report].sort());
    expect(page).toContain('<!-- OSE_LAYOUT_SKINS -->');
    expect(page).toContain(
      'window.OSE_applyLayout(article, body.layout, window.OSE_LAYOUT_REGIONS'
    );
    expect(LAYOUT_CSS).not.toMatch(/#[0-9a-f]{3,8}\b|rgb|hsl|color/i);
    expect(layoutSkinsHead('report')).toContain(JSON.stringify(SURFACE_REGIONS.report));
  });

  test('8. a named skin is that skin exactly; once moved it is custom', () => {
    const moved = { ...skinLayout('report', 'map_first')!, columns: 1 };
    const r = checkLayout('report', moved);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/differs from the map_first skin; set skin to custom/);
    expect(checkLayout('report', { ...moved, skin: 'custom' }).ok).toBe(true);
    const swapped = skinLayout('vote_screen', 'standard')!;
    swapped.order.reverse();
    expect(checkLayout('vote_screen', swapped).ok).toBe(false);
    expect(parseEventSettings({ layouts: { vote_screen: swapped } }).layouts).toBeUndefined();
  });
});
