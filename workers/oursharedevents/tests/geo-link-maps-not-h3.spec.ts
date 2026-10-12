/**
 * OSE-660 — Directions links: behavior + wall guard (maps != H3).
 *
 * Directly exercises the pure renderGeoLink (src/lib/geo-link.ts). The human
 * wayfinding links carry real coordinates/address ONLY — never an H3 cell
 * (H3 is the analytical substrate, never the wayfinding link). Link-out only,
 * never an embed. This is the born-red seed for OSE-662 attack #8.
 *
 * Owner 2026-10-11: one "Directions" button with two choices, Google Maps and
 * Apple Maps, built like the "Add to calendar" control. It replaced the single
 * `geo:` link, which an iPhone does not open.
 *
 * @born-red directions choice | method: the "one button, two choices" tests
 *   were run against geo-link.ts on main at c49b5647 (a single geo: / Apple
 *   link) and failed | date: 2026-10-11
 */

import { describe, it, expect } from 'vitest';
import { renderGeoLink, directionsUrls } from '../src/lib/geo-link';

const H3_TOKEN = /h3|res7|res9|[0-9a-f]{15}fff/i; // h3 cell shape / precision hints

const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

describe('OSE-660 | maps != H3 — coordinates only, never an H3 cell', () => {
  it('one Directions button opens two choices: Google Maps and Apple Maps', () => {
    const a = renderGeoLink(40.7128, -74.006, 'The Bar', '123 Main St', 'Directions');
    expect(a).toMatch(/^<details [^>]*data-testid="geo-link"/);
    expect(a).toContain('>Directions</summary>');
    expect(a).toContain('>Google Maps</a>');
    expect(a).toContain('>Apple Maps</a>');
    expect(hrefs(a)).toEqual([
      'https://www.google.com/maps/search/?api=1&amp;query=40.7128%2C-74.006',
      'https://maps.apple.com/?ll=40.7128,-74.006&amp;q=The%20Bar',
    ]);
  });

  it('it is built like the calendar control, so the two look the same', () => {
    const a = renderGeoLink(1, 2, 'V', 'A', 'Directions');
    expect(a).toContain('class="ose-calendar-menu ose-directions-menu"');
    expect(a).toContain('class="ose-calendar-link ose-calendar-summary"');
    expect(a.match(/class="ose-calendar-option"/g)).toHaveLength(2);
  });

  // @born-red TL-069 | method: design-time-negative-assertion | date: 2026-08-22
  it('the produced link NEVER contains an H3 cell / precision token', () => {
    const a = renderGeoLink(40.7128, -74.006, '89283082e73ffff', 'cell 89283082e73ffff', 'Go');
    // even if garbage is passed as a name, both hrefs point at lat/lon
    for (const href of hrefs(a)) {
      expect(href).toMatch(/40\.7128(,|%2C)-74\.006/);
      expect(href).not.toMatch(H3_TOKEN);
    }
  });

  it('without coordinates both choices search the address, else the venue name', () => {
    expect(directionsUrls(null, null, 'The Bar', '123 Main St, Anytown')).toEqual({
      google: 'https://www.google.com/maps/search/?api=1&query=123%20Main%20St%2C%20Anytown',
      apple: 'https://maps.apple.com/?q=123%20Main%20St%2C%20Anytown',
    });
    expect(directionsUrls(null, null, 'The Bar', null)?.google).toBe(
      'https://www.google.com/maps/search/?api=1&query=The%20Bar'
    );
  });

  it('renders nothing (no broken button) when neither coordinates nor address exist', () => {
    expect(renderGeoLink(null, null, null, null, 'Directions')).toBe('');
    expect(renderGeoLink(null, null, '', '  ', 'Directions')).toBe('');
  });

  it('is link-out only: anchors with no referrer leak, never an embed or a geo: link', () => {
    const a = renderGeoLink(1, 2, 'V', 'A', 'Go');
    expect(a).not.toMatch(/<iframe/i);
    expect(a).not.toMatch(/googleapis|staticmap|geo:/i);
    expect(a.match(/rel="noopener noreferrer"/g)).toHaveLength(2);
    expect(a.match(/target="_blank"/g)).toHaveLength(2);
  });

  it('a venue name cannot break out of the link', () => {
    const a = renderGeoLink(null, null, '"><script>x</script>', null, 'Go');
    expect(a).not.toContain('<script>');
    expect(a).not.toMatch(/href="[^"]*"[^>]*"><script/);
  });

  it('carries the given data-testid on the button and on each choice', () => {
    const a = renderGeoLink(1, 2, 'V', 'A', 'Go', 'geo-link-live');
    expect(a).toContain('data-testid="geo-link-live"');
    expect(a).toContain('data-testid="geo-link-live-google"');
    expect(a).toContain('data-testid="geo-link-live-apple"');
  });
});
