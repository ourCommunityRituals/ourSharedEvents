/**
 * /poster — two kinds of poster, the event's title on top, the brand at the
 * bottom, and a picker scoped to the event being configured.
 *
 * Dogfooding (2026-09-29):
 *   1. PRINT needs a larger art viewport (it keeps its QR codes).
 *   2. DIGITAL: no QR codes (it's already on a screen — the short links are the
 *      taps), so the art takes more room; the date adds to a calendar and the
 *      venue opens a map.
 *   3. The picker should only offer the event being configured, not every
 *      event on the platform.
 *   4. "OurSharedEvents" belongs at the bottom only; the title is the event's.
 *
 * Layer: API (the served /poster HTML + its script). The rendered behaviour
 * (both kinds, scoped picker, Back keeps ?kind=) was verified in a browser.
 *
 * @born-red poster kinds | method: every assertion below fails against the
 * pre-change template (no ?kind, brand h1 on top, unscoped picker, no digital
 * branch) | date: 2026-09-29
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { SELF } from 'cloudflare:test';

let html = '';
beforeAll(async () => {
  const res = await SELF.fetch('https://t.test/poster');
  expect(res.status).toBe(200);
  // Normalize line endings: a CRLF (Windows) checkout bundles the template
  // with \r\n, and multi-line selector matches below are written with \n.
  html = (await res.text()).replace(/\r\n/g, '\n');
});

function rule(selector: string): string {
  const i = html.indexOf(`${selector} {`);
  expect(i, selector).toBeGreaterThan(-1);
  return html.slice(i, html.indexOf('}', i));
}

describe('title is the event’s; the brand lives at the bottom', () => {
  test('exactly one h1, visually hidden, filled with the event name', () => {
    expect(html.match(/<h1\b/g)?.length).toBe(1);
    expect(html).toContain('<h1 class="sr-only" id="poster-page-title"');
    expect(html).toContain("title.textContent = event.name + (KIND === 'digital'");
    expect(rule('.sr-only')).toMatch(/clip:\s*rect\(0 0 0 0\)/);
  });

  test('no OurSharedEvents heading above the poster; the brand is in the footer', () => {
    expect(html).not.toContain('data-testid="poster-home-link"');
    expect(html).not.toContain('<div class="org" data-testid="poster-org">');
    expect(html).toContain(
      '<div class="poster-footer" data-testid="poster-footer"><span data-testid="poster-org">OurSharedEvents</span>'
    );
  });
});

describe('Print | Digital — the URL is the state', () => {
  test('the switch is two links carrying ?kind=, current one marked', () => {
    expect(html).toContain('data-testid="poster-kind-print"');
    expect(html).toContain('data-testid="poster-kind-digital"');
    expect(html).toContain(
      "const KIND = new URLSearchParams(location.search).get('kind') === 'digital' ? 'digital' : 'print';"
    );
    // replaceState keeps ?event + ?kind in the URL so Back and a shared link keep the choice.
    expect(html).toMatch(/params\.set\('kind', KIND\);[\s\S]{0,80}history\.replaceState/);
    expect(html).toContain("a.setAttribute('aria-current', 'page')");
  });

  test('Print keeps its QR codes and a bigger art area; Print controls hide on Digital', () => {
    expect(html).toContain('max-height: min(88vh, 1100px)');
    expect(html).toContain('max-height: 7in');
    // The whole artwork shows on screen and on paper: contain, never a crop.
    expect(html).not.toMatch(/\.poster-art-img\s*\{[^}]*object-fit:\s*cover/);
    expect(html.match(/\.poster-art-img\s*\{[^}]*object-fit:\s*contain/g)?.length).toBe(2);
    expect(html).toContain("controls.hidden = KIND === 'digital'");
    // …and the hide actually applies: .print-controls is display:inline-flex,
    // which beats the UA [hidden] rule unless restored (caught in the browser).
    expect(rule('.print-controls[hidden]')).toMatch(/display:\s*none/);
  });

  test('Digital: no QR images, bigger art, the short link is the tap', () => {
    expect(rule('.poster--digital .qr-img,\n.poster--digital .qr-loading')).toMatch(
      /display:\s*none/
    );
    expect(html).toContain('max-height: min(92vh, 1200px)');
    // In the digital branch the slot renders as a tappable short link, no <img>.
    const i = html.indexOf('? \'<a class="qr-slot-code" href="');
    expect(i).toBeGreaterThan(-1);
    const digitalBranch = html.slice(i, html.indexOf(': \'<a class="qr-link"', i));
    expect(digitalBranch).toContain('<a class="qr-slot-code" href="');
    expect(digitalBranch).not.toContain('<img');
  });

  test('Digital: the date adds to a calendar, the place opens a map (buttons, escaped, new tab)', () => {
    // OSE-1825: each is an @ocr/ui button, not an inline text link. Both
    // addresses are a fixed start with one encoded value written straight
    // after it (what the links come out as, for a venue or an id holding quote
    // marks, is run in poster-attribute-escaping.spec.ts).
    expect(html).toContain(
      '<a class="btn btn-outline" href="/events/\' + encodeURIComponent(event.id) + \'/calendar.ics" download data-testid="poster-add-to-calendar">Add to calendar</a>'
    );
    expect(html).toContain(
      '\'<a class="btn btn-outline" href="https://www.google.com/maps/search/?api=1&amp;query=\' + encodeURIComponent(where) + \'" target="_blank" rel="noopener noreferrer"'
    );
    // OSE-1991: print draws the same cards, its buttons as <span> pictures
    // (nothing to tap on paper), after the art; the old one plain line is gone.
    expect(html).toContain(
      "'<span class=\"btn btn-outline btn-static\" data-testid=\"' + esc(testid) + '\">' + esc(label) + '</span>'"
    );
    expect(html).toContain("staticBtn('Add to calendar', 'poster-add-to-calendar')");
    expect(html).not.toContain('<div class="poster-meta" data-testid="poster-meta">');
    expect(html.indexOf('data-testid="poster-stage"')).toBeLessThan(html.indexOf('detailsHtml +'));
    // The old inline-text forms are gone.
    expect(html).not.toContain('&middot; Add to calendar');
    expect(html).not.toContain('&middot; Directions');
  });
});

describe('the picker only offers the event being configured', () => {
  test('?event= shows only that event: the picker is hidden and no list is fetched', () => {
    // OSE-867: the scoped poster is one poster-bundle call — there is no list
    // to narrow, so no other event can ever be offered.
    expect(html).toContain("document.getElementById('poster-event-select').hidden = true;");
    const scoped = html.slice(html.indexOf('if (wanted) {'), html.indexOf('// No event named'));
    expect(scoped).toContain('loadPosterBundle(wanted, true)');
    expect(scoped).not.toContain("fetch('/api/v2/events')");
  });
});
