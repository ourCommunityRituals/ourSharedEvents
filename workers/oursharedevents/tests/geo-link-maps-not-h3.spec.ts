/**
 * OSE-660 — Maps / universal geo link: behavior + wall guard (maps != H3).
 *
 * Directly exercises the pure renderGeoLink (src/lib/geo-link.ts). The human
 * wayfinding link carries real coordinates/address ONLY — never an H3 cell
 * (H3 is the analytical substrate, never the wayfinding link). Link-out only,
 * never an embed. This is the born-red seed for OSE-662 attack #8.
 */

import { describe, it, expect } from 'vitest';
import { renderGeoLink } from '../src/lib/geo-link';

const H3_TOKEN = /h3|res7|res9|[0-9a-f]{15}fff/i; // h3 cell shape / precision hints

describe('OSE-660 | maps != H3 — coordinates only, never an H3 cell', () => {
  it('builds a geo: link to the native maps app from lat/lon', () => {
    const a = renderGeoLink(40.7128, -74.006, 'The Bar', '123 Main St', 'Get directions');
    expect(a).toContain('href="geo:40.7128,-74.006?q=40.7128,-74.006');
    expect(a).toContain('The%20Bar'); // venue label, url-encoded
  });

  // @born-red TL-069 | method: design-time-negative-assertion | date: 2026-08-22
  it('the produced link NEVER contains an H3 cell / precision token', () => {
    const a = renderGeoLink(40.7128, -74.006, '89283082e73ffff', 'cell 89283082e73ffff', 'Go');
    // even if garbage is passed as a name, the href geo coords are lat/lon only
    const href = a.match(/href="([^"]+)"/)![1];
    expect(href).toMatch(/^geo:40\.7128,-74\.006/);
    expect(href).not.toMatch(H3_TOKEN);
  });

  it('degrades to an address-only Apple Maps search when coordinates are absent', () => {
    const a = renderGeoLink(null, null, 'The Bar', '123 Main St, Anytown', 'Get directions');
    expect(a).toContain('href="https://maps.apple.com/?q=123%20Main%20St');
    expect(a).not.toContain('geo:');
  });

  it('renders nothing (no broken <a>) when neither coordinates nor address exist', () => {
    expect(renderGeoLink(null, null, null, null, 'Get directions')).toBe('');
    expect(renderGeoLink(null, null, '', '', 'Get directions')).toBe('');
  });

  it('is link-out only — an anchor with no referrer leak, never an embed', () => {
    const a = renderGeoLink(1, 2, 'V', 'A', 'Go');
    expect(a).toMatch(/^<a /);
    expect(a).not.toMatch(/<iframe/i);
    expect(a).not.toMatch(/googleapis|staticmap/i);
    expect(a).toContain('rel="noopener noreferrer"');
    expect(a).toContain('target="_blank"');
  });

  it('carries the given data-testid (design = test contract)', () => {
    expect(renderGeoLink(1, 2, 'V', 'A', 'Go', 'geo-link-pre')).toContain(
      'data-testid="geo-link-pre"'
    );
  });
});
