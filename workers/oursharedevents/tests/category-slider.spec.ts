/**
 * The icon slider (OSE-2207; owner 2026-11-22): one component, our own icon per
 * category, and its first use, the landing's category choice.
 *
 * Born red: run against main dde4cd6 (no src/lib/category-slider.ts, the landing
 * still on word chips); every test here failed. The browser checks and their
 * mutation tests are tests/e2e/2-pages/wcag-slider.component.spec.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  CATEGORY_ICONS,
  ICON_SLIDER_SCRIPT,
  iconSvg,
  renderIconSlider,
} from '../src/lib/category-slider';
import { renderLandingArea, type LandingAreaItem } from '../src/lib/landing-area';
import type { TypeCategory } from '../src/lib/event-type-catalog';

const MIGRATION = readFileSync(
  new URL('../migrations/0076_event_type_categories.sql', import.meta.url),
  'utf8'
);
const SEEDED = [...MIGRATION.matchAll(/\('([A-Z]{3})',\s*'[^']+',\s*\d+\)/g)].map((m) => m[1]);
const BUCKET_MIGRATION = readFileSync(
  new URL('../migrations/0127_event_type_buckets.sql', import.meta.url),
  'utf8'
);
const BUCKETS = [
  ...BUCKET_MIGRATION.matchAll(/\('([A-Z]{3})',\s*'[^']+',\s*'[^']+',\s*\d+\)/g),
].map((m) => m[1]);

describe('the icon set', () => {
  it('reads the 15 seeded categories from migration 0076', () => {
    expect(SEEDED).toHaveLength(15);
  });

  it('reads the 9 buckets from migration 0127', () => {
    expect(BUCKETS).toHaveLength(9);
  });

  it('every seeded category and bucket has a drawing of its own, and no two drawings are the same', () => {
    for (const code of [...SEEDED, ...BUCKETS]) expect(CATEGORY_ICONS[code], code).toBeTruthy();
    const drawings = Object.values(CATEGORY_ICONS);
    expect(new Set(drawings).size).toBe(drawings.length);
    expect(CATEGORY_ICONS.ALL).toBeTruthy();
    expect(CATEGORY_ICONS.OTHER).toBeTruthy();
  });

  it('draws in currentColor only: no hex, rgb or named colour, no script, no outside link', () => {
    for (const [code, d] of Object.entries(CATEGORY_ICONS)) {
      expect(d, code).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|<script|href|url\(/i);
      for (const f of d.matchAll(/(?:fill|stroke)="([^"]*)"/g)) {
        expect(f[1], code).toMatch(/^(currentColor|none)$/);
      }
    }
  });

  it('an icon is decorative (its item names it) and never takes focus', () => {
    const svg = iconSvg('REC');
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('focusable="false"');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('class="icon-slider-icon"');
  });

  it('an unknown code falls back to the general tag, never to nothing', () => {
    const tag = iconSvg('ZZZ');
    expect(tag).toMatch(/<path d="M3\.5 12\.5v-8/);
    expect(tag).not.toBe(iconSvg('REC'));
  });
});

describe('renderIconSlider', () => {
  const base = {
    label: 'Kinds of events',
    prevLabel: 'Show earlier choices',
    nextLabel: 'Show more choices',
    testid: 'kinds',
  };

  it('label items name their radio; the group is named by its heading', () => {
    const html = renderIconSlider({
      ...base,
      showLabel: true,
      items: [{ icon: 'ALL', text: 'All types', forId: 'type-all', testid: 'k-all' }],
    });
    expect(html).toContain('<div class="icon-slider" data-icon-slider data-testid="kinds">');
    expect(html).toContain('<p class="icon-slider-heading" id="kinds-label">Kinds of events</p>');
    // Labels take no focus, so the track is the keyboard's stop for scrolling.
    expect(html).toContain('role="group" aria-labelledby="kinds-label" tabindex="0"');
    expect(html).toMatch(
      /<label class="icon-slider-item" for="type-all" data-testid="k-all"><svg[^>]*>.*<\/svg><span class="icon-slider-text">All types<\/span><\/label>/
    );
  });

  it('without the heading shown, the name is still there for a screen reader', () => {
    const html = renderIconSlider({ ...base, items: [] });
    expect(html).toContain('<p class="sr-only" id="kinds-label">Kinds of events</p>');
  });

  it('the arrows are named buttons, hidden until the script finds the row wider than the screen', () => {
    const html = renderIconSlider({ ...base, items: [] });
    expect(html).toContain('<div class="icon-slider-nav" hidden>');
    // Track and arrows share one row box, so the tuned row can lay the arrows over it.
    expect(html).toMatch(
      /<div class="icon-slider-row"><div class="icon-slider-track"[\s\S]*<div class="icon-slider-nav" hidden>/
    );
    expect(html).toContain('aria-label="Show earlier choices" data-testid="kinds-prev"');
    expect(html).toContain('aria-label="Show more choices" data-testid="kinds-next"');
    expect(html.match(/<button type="button" class="icon-slider-arrow"/g)).toHaveLength(2);
  });

  it('escapes every text it is given', () => {
    const html = renderIconSlider({
      ...base,
      label: '<b>x</b>',
      items: [{ icon: 'REC', text: 'A & "B" <i>', forId: 'a"b' }],
    });
    expect(html).not.toContain('<b>x</b>');
    expect(html).not.toContain('<i>');
    expect(html).toContain('A &amp; &quot;B&quot; &lt;i&gt;');
    expect(html).toContain('for="a&quot;b"');
  });

  it('button items mark the chosen one and carry the value in a hidden field', () => {
    const html = renderIconSlider({
      ...base,
      name: 'business_type',
      selected: 'bar',
      items: [
        { icon: 'SOC', text: 'Restaurant', value: 'restaurant' },
        { icon: 'ENT', text: 'Bar', value: 'bar' },
      ],
    });
    expect(html).toContain('data-value="restaurant" aria-pressed="false"');
    expect(html).toContain('data-value="bar" aria-pressed="true"');
    expect(html).toContain(
      '<input type="hidden" name="business_type" value="bar" data-icon-slider-value />'
    );
    // Buttons are their own tab stops: the track is not one.
    expect(html).not.toContain('tabindex="0"');
  });
});

describe('the wiring script', () => {
  const src = ICON_SLIDER_SCRIPT;

  it('makes no request and keeps nothing: no fetch, beacon, cookie or storage', () => {
    expect(src).not.toMatch(
      /fetch\(|XMLHttpRequest|sendBeacon|document\.cookie|localStorage|sessionStorage|indexedDB/
    );
  });

  function page(items: string) {
    const dom = new JSDOM(
      `<!doctype html><body><input type="radio" name="type" id="r1" class="toggle-radio" />${items}${src}</body>`,
      { runScripts: 'dangerously' }
    );
    return dom.window;
  }

  it('leaves the arrows hidden when the row fits', () => {
    const w = page(
      renderIconSlider({
        label: 'K',
        prevLabel: 'P',
        nextLabel: 'N',
        testid: 'k',
        items: [{ icon: 'REC', text: 'One', forId: 'r1' }],
      })
    );
    expect(w.document.querySelector('.icon-slider-nav')!.hasAttribute('hidden')).toBe(true);
  });

  it('a radio that takes focus brings its label into view', () => {
    const html = renderIconSlider({
      label: 'K',
      prevLabel: 'P',
      nextLabel: 'N',
      testid: 'k',
      items: [{ icon: 'REC', text: 'One', forId: 'r1' }],
    });
    const dom = new JSDOM(
      `<!doctype html><body><input type="radio" name="type" id="r1" />${html}</body>`,
      {
        runScripts: 'outside-only',
      }
    );
    const spy = vi.fn();
    (dom.window.HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
      spy;
    // Our own constant: it opens with <script> and closes with </script>; run what is between.
    expect(src.startsWith('<script>') && src.endsWith('</script>')).toBe(true);
    dom.window.eval(src.slice('<script>'.length, -'</script>'.length));
    (dom.window.document.getElementById('r1') as HTMLInputElement).focus();
    expect(spy).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  });

  it('a tapped button item becomes the one chosen and its value goes in the field', () => {
    const w = page(
      renderIconSlider({
        label: 'K',
        prevLabel: 'P',
        nextLabel: 'N',
        testid: 'k',
        name: 'kind',
        selected: 'a',
        items: [
          { icon: 'REC', text: 'A', value: 'a' },
          { icon: 'SOC', text: 'B', value: 'b' },
        ],
      })
    );
    const b = w.document.querySelector('[data-value="b"]') as HTMLButtonElement;
    let changed = 0;
    w.document.addEventListener('change', () => (changed += 1));
    b.click();
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(w.document.querySelector('[data-value="a"]')!.getAttribute('aria-pressed')).toBe(
      'false'
    );
    expect((w.document.querySelector('[data-icon-slider-value]') as HTMLInputElement).value).toBe(
      'b'
    );
    expect(changed).toBe(1);
    // A tap on the chosen one clears the choice.
    b.click();
    expect(b.getAttribute('aria-pressed')).toBe('false');
    expect((w.document.querySelector('[data-icon-slider-value]') as HTMLInputElement).value).toBe(
      ''
    );
    expect(changed).toBe(2);
  });
});

describe('the landing category choice is the icon slider', () => {
  const NOW = Date.parse('2026-11-22T12:00:00Z');
  const cats = new Map<string, TypeCategory>([
    ['etr-rec-bocce', { code: 'REC', name: 'Sports & Recreation', order: 10 }],
    ['etr-lit-club', { code: 'LIT', name: 'Literary & Book Clubs', order: 140 }],
  ]);
  const ev = (id: string, type: string): LandingAreaItem =>
    ({
      id,
      slug: id,
      name: `Event ${id}`,
      status: 'published',
      starts_at: '2026-11-23T18:00:00Z',
      ends_at: '2026-11-23T20:00:00Z',
      venue: 'Hall',
      event_type_id: type,
    }) as unknown as LandingAreaItem;
  // Rendered inside each test, never at describe level: a render outside a test
  // makes every landing-area.ts mutant "static" for Stryker, which then runs the
  // whole landing group's specs against each one (the mutation job ran past its
  // 15 minutes that way on 2026-11-23).
  const render = (): string =>
    renderLandingArea([ev('a', 'etr-rec-bocce'), ev('b', 'etr-lit-club'), ev('c', 'etr-none')], {
      now: NOW,
      typeCategories: cats,
    }).html;

  it('shows one item per category present, each with its own icon, All first and Other last', () => {
    const html = render();
    const items = [
      ...html.matchAll(/<label class="icon-slider-item" for="([^"]+)"[^>]*>(<svg[\s\S]*?<\/svg>)/g),
    ];
    expect(items.map((m) => m[1])).toEqual(['type-all', 'cat-rec', 'cat-lit', 'cat-other']);
    expect(items[0][2]).toBe(iconSvg('ALL'));
    expect(items[1][2]).toBe(iconSvg('REC'));
    expect(items[2][2]).toBe(iconSvg('LIT'));
    expect(items[3][2]).toBe(iconSvg('OTHER'));
  });

  it('sits above the List / Map row and outside the Filters fold, so it is always on screen', () => {
    const html = render();
    const slider = html.indexOf('data-testid="toggle-type"');
    expect(slider).toBeGreaterThan(-1);
    expect(slider).toBeLessThan(html.indexOf('data-testid="area-toggles"'));
    expect(html.indexOf('data-testid="area-filters"')).toBeGreaterThan(slider);
    expect(html).not.toContain('data-tab="type"');
    expect(html).toContain('#filters-open:not(:checked)~.toggle-radio:not([name=type])');
  });

  it('a chosen item takes the accent, a tick and a focus ring, from tokens; the radio still hides other cards', () => {
    const html = render();
    expect(html).toContain(
      "#cat-rec:checked ~ .icon-slider label[for='cat-rec']{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}"
    );
    expect(html).toContain(
      "#cat-rec:checked ~ .icon-slider label[for='cat-rec'] .icon-slider-text::before{content:'\\2713\\00a0'}"
    );
    expect(html).toContain(
      "#cat-rec:focus-visible ~ .icon-slider label[for='cat-rec']{outline:3px solid var(--accent)"
    );
    expect(html).toContain('#cat-rec:checked ~ .area .event-card:not(.cat-rec)');
    expect(html).toContain(
      "#type-all:checked ~ .icon-slider label[for='type-all']{background:var(--accent)"
    );
  });

  it('ships the wiring script once, after the slider', () => {
    const html = render();
    expect(html.split(ICON_SLIDER_SCRIPT)).toHaveLength(2);
    expect(html.indexOf(ICON_SLIDER_SCRIPT)).toBeGreaterThan(
      html.indexOf('data-testid="toggle-type"')
    );
  });

  it('one category only: no slider and no script (nothing to choose)', () => {
    const one = renderLandingArea([ev('a', 'etr-rec-bocce')], {
      now: NOW,
      typeCategories: cats,
    }).html;
    expect(one).not.toContain('data-icon-slider');
    expect(one).not.toContain(ICON_SLIDER_SCRIPT);
  });
});
