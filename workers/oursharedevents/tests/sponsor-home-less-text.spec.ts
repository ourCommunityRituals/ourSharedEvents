/**
 * Less text on the sponsor page (owner 2026-10-11): each line says only what a
 * sponsor needs, and each consent promise is said once.
 *
 * Kept, because they are what a sponsor agrees to: accepting puts their name on
 * the event's page, poster and TV screen; asking to join shows their name only
 * if the organizer says yes; reports show counts, never who; the link is
 * private and has an end date.
 *
 * @born-red sponsor less text | method: run against the page before the change
 *   (the intro line, a consent line on every "could back" card, the long
 *   footer) | date: 2026-10-11
 */
import { describe, expect, test } from 'vitest';
import { renderSponsorHomePage, type PlacementRow } from '../src/lib/sponsor-home-render';
import TEMPLATE from '../src/templates/sponsor-home.html';

const placement = (over: Partial<PlacementRow> = {}): PlacementRow => ({
  placement_id: 'p1',
  event_id: 'e1',
  tier: 'gold',
  locality_band: 0,
  organizer_accepted: 1,
  sponsor_accepted: null,
  placement_active: 1,
  title: 'Bocce Night',
  status: 'active',
  start_date: '2099-10-01',
  end_date: null,
  location: 'Eagles Hall',
  is_published: 1,
  ...over,
});

const page = (over: Partial<Parameters<typeof renderSponsorHomePage>[0]> = {}) =>
  renderSponsorHomePage({
    sponsor: { id: 'sb1', name: 'Corner Bakery' },
    placements: [placement()],
    expiresIso: '2099-11-10T12:00:00Z',
    discoverable: [
      { id: 'e2', title: 'Trivia', start_date: '2099-10-02', location: 'Eagles Hall', near: 0 },
      { id: 'e3', title: 'Fish Fry', start_date: '2099-10-03', location: 'Eagles Hall', near: 0 },
    ],
    requests: [],
    ...over,
  });

const textOf = (html: string, testid: string) =>
  html
    .match(new RegExp(`data-testid="${testid}"[^>]*>([\\s\\S]*?)</`))?.[1]
    .replace(/\s+/g, ' ')
    .trim();

describe('sponsor page: less text', () => {
  test('no intro line under the name', () => {
    const html = page();
    expect(html).not.toContain('data-testid="sponsor-home-sub"');
    expect(html).not.toContain("Everything you're backing");
  });

  test('a placement waiting for an answer says once what accepting does', () => {
    expect(textOf(page(), 'placement-why')).toBe(
      "Accepting puts your name on this event's page, poster and TV screen."
    );
  });

  test('"Events you could back" says its promise once, not on every card', () => {
    const html = page();
    expect(html.match(/data-testid="discover-why"/g)?.length).toBe(1);
    expect(textOf(html, 'discover-why')).toBe('Your name shows only if the organizer says yes.');
    expect(html).not.toContain('Asking tells the organizer');
    expect(html.match(/data-testid="discover-card"/g)?.length).toBe(2);
  });

  test('empty lists say so in a few words', () => {
    const html = page({ placements: [], discoverable: [] });
    expect(textOf(html, 'sponsor-home-empty')).toBe('No placements yet.');
    expect(textOf(html, 'sponsor-home-discover-empty')).toBe('Nothing new right now.');
  });

  test('the footer keeps the private link, its end date and never-who, in two short lines', () => {
    const foot = textOf(page(), 'sponsor-home-foot') ?? '';
    expect(foot).toMatch(/^Your private link, good until .+\. Reports show counts, never who\.$/);
    expect(foot).not.toContain('If it stops working');
  });

  test('the page script says a request was sent in a few words', () => {
    expect(TEMPLATE).toContain("'Asked. Your name shows only if they say yes.'");
    expect(TEMPLATE).not.toContain('The organizer will see your request');
  });
});
