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
    expect(html).toContain('max-height: min(64vh, 720px)');
    expect(html).toContain('max-height: 7in');
    expect(html).toContain("controls.hidden = KIND === 'digital'");
    // …and the hide actually applies: .print-controls is display:inline-flex,
    // which beats the UA [hidden] rule unless restored (caught in the browser).
    expect(rule('.print-controls[hidden]')).toMatch(/display:\s*none/);
  });

  test('Digital: no QR images, bigger art, the short link is the tap', () => {
    expect(rule('.poster--digital .qr-img,\n      .poster--digital .qr-loading')).toMatch(
      /display:\s*none/
    );
    expect(html).toContain('max-height: min(80vh, 960px)');
    // In the digital branch the slot renders as a tappable short link, no <img>.
    const i = html.indexOf('? \'<a class="qr-slot-code" href="');
    expect(i).toBeGreaterThan(-1);
    const digitalBranch = html.slice(i, html.indexOf(': \'<a class="qr-link"', i));
    expect(digitalBranch).toContain('<a class="qr-slot-code" href="');
    expect(digitalBranch).not.toContain('<img');
  });

  test('Digital: the date adds to a calendar, the venue opens a map (escaped, new tab)', () => {
    expect(html).toContain(
      '\'<a href="/events/\' + id + \'/calendar.ics" download data-testid="poster-add-to-calendar">\''
    );
    expect(html).toContain(
      "'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(venue)"
    );
    expect(html).toMatch(/esc\(mapHref\) \+ '" target="_blank" rel="noopener noreferrer"/);
    // Print stays plain text — nothing to tap on paper.
    expect(html).toContain('const whenHtml = digital && id');
  });
});

describe('the picker only offers the event being configured', () => {
  test('?event= narrows the list to that event and hides the picker', () => {
    expect(html).toContain('if (scoped >= 0) items = [items[scoped]];');
    expect(html).toContain("document.getElementById('poster-event-select').hidden = scoped >= 0;");
  });
});
