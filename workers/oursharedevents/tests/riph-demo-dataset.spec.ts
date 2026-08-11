/**
 * riph-demo-dataset.spec.ts — OSE-608 acceptance.
 *
 * Locks the RIPH multi-league demo dataset against the ticket's criteria:
 *   - roster composition makes the tiers visible (Premium exactly 2, Mid 2-3, Local 4-6)
 *   - campaign-grouped sponsors at all three tiers (Premium = 2 campaigns, a class)
 *   - 2-3 recurring leagues, each a series across a season (depth to show states)
 *   - at least one VISIBLE ladder fallback bucket with its label (honesty feature)
 *   - every row data_class='demo'; dataset regenerable (deterministic) from one call
 */
import { describe, it, expect } from 'vitest';
import {
  getRiphDataset,
  getRiphLeagues,
  getRiphCampaigns,
  getRiphSponsors,
  getRiphSeasonEvents,
  getRiphSponsorImpressions,
  getRiphLadderBuckets,
} from '../src/lib/mock-data';

describe('OSE-608: RIPH sponsor roster makes the tiers visible', () => {
  const sponsors = getRiphSponsors();
  const byTier = (t: string) => sponsors.filter((s) => s.tier === t);

  it('Premium is exactly 2 (renders as a class, not a lone example)', () => {
    expect(byTier('premium')).toHaveLength(2);
  });
  it('Mid is 2-3', () => {
    const n = byTier('mid').length;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(3);
  });
  it('Local is 4-6 (the neighborhood texture / covenant floor crowd)', () => {
    const n = byTier('local').length;
    expect(n).toBeGreaterThanOrEqual(4);
    expect(n).toBeLessThanOrEqual(6);
  });
  it('every sponsor carries a campaign', () => {
    expect(sponsors.every((s) => s.campaign_id.length > 0)).toBe(true);
  });
});

describe('OSE-608: campaigns grouped by tier class', () => {
  const campaigns = getRiphCampaigns();
  it('Premium has exactly 2 campaigns (the class comparison needs ≥2 members)', () => {
    expect(campaigns.filter((c) => c.tier === 'premium')).toHaveLength(2);
  });
  it('Mid has multiple campaigns for placement/attribution variety', () => {
    expect(campaigns.filter((c) => c.tier === 'mid').length).toBeGreaterThanOrEqual(2);
  });
  it('every sponsor campaign_id resolves to a real campaign', () => {
    const ids = new Set(campaigns.map((c) => c.id));
    expect(getRiphSponsors().every((s) => ids.has(s.campaign_id))).toBe(true);
  });
});

describe('OSE-608: multi-league season with depth', () => {
  const leagues = getRiphLeagues();
  const events = getRiphSeasonEvents();

  it('has 2-3 recurring leagues', () => {
    expect(leagues.length).toBeGreaterThanOrEqual(2);
    expect(leagues.length).toBeLessThanOrEqual(3);
  });
  it('each league is a SERIES (≥2 instances across the season)', () => {
    for (const lg of leagues) {
      const instances = events.filter((e) => e.league_id === lg.id);
      expect(instances.length, `${lg.id} must be a series`).toBeGreaterThanOrEqual(2);
    }
  });
  it('headcounts vary across the season so ladder states are interesting', () => {
    const counts = events.map((e) => e.headcount);
    expect(new Set(counts).size).toBeGreaterThan(1);
  });
});

describe('OSE-608: honesty feature — a visible ladder fallback with its label', () => {
  const buckets = getRiphLadderBuckets();
  it('at least one bucket is suppressed below the K-anon floor and carries a label', () => {
    const suppressed = buckets.filter((b) => b.suppressed);
    expect(suppressed.length).toBeGreaterThanOrEqual(1);
    expect(suppressed[0].count).toBeLessThan(5);
    expect(suppressed[0].label).toMatch(/too small alone/i);
  });
  it('the same event still renders cleared buckets (only the fine grain is suppressed)', () => {
    const suppressedEvent = buckets.find((b) => b.suppressed)!.event_id;
    const cleared = buckets.filter((b) => b.event_id === suppressedEvent && !b.suppressed);
    expect(cleared.length).toBeGreaterThanOrEqual(1);
  });
});

describe('OSE-608: data_class + regenerability', () => {
  it('every event and sponsor is data_class="demo"', () => {
    expect(getRiphSeasonEvents().every((e) => e.data_class === 'demo')).toBe(true);
    expect(getRiphSponsors().every((s) => s.data_class === 'demo')).toBe(true);
    expect(getRiphDataset().data_class).toBe('demo');
  });
  it('sponsor impressions clear K≥5 at the event grain (locals are served, not suppressed)', () => {
    expect(getRiphSponsorImpressions().every((r) => r.count >= 5)).toBe(true);
  });
  it('is deterministic — one call restores canonical state byte-identically', () => {
    expect(getRiphDataset()).toEqual(getRiphDataset());
  });
});
