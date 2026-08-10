/**
 * demo-registry.ts — canonical demo link registry (OSE-610).
 *
 * The single source of truth for every published demo URL. All outward material
 * (RIPH follow-up, church one-pager, README, memos) references these paths, and
 * the CI gate (OSE-609) checks these same paths — one list by construction,
 * never two. Slug permanence (Invariant #18 spirit): once published, a demo
 * path never changes. The demo front door renders its trio from this registry,
 * so the published UI and the registry can never drift.
 */

export const DEMO_REGISTRY_VERSION = '1.0.0';

export interface DemoLink {
  /** Stable key — never reused for a different destination. */
  key: string;
  /** Canonical path (slug-permanent). */
  path: string;
  title: string;
  description: string;
  /** Present on the three tier sites; absent on the index. */
  tier?: 'free' | 'mid' | 'premium';
}

export const DEMO_LINKS: readonly DemoLink[] = [
  {
    key: 'demo-index',
    path: '/demo',
    title: 'Demo front door',
    description: 'The three sites + the four-flow script — the demo giving itself.',
  },
  {
    key: 'demo-free',
    path: '/demo/free',
    title: 'Free · Local',
    description: 'Smoke test — headcount + your own logo impressions.',
    tier: 'free',
  },
  {
    key: 'demo-mid',
    path: '/demo/mid',
    title: 'Mid',
    description: 'The map + utilization — placement, timing, campaigns.',
    tier: 'mid',
  },
  {
    key: 'demo-premium',
    path: '/demo/premium',
    title: 'Premium · Enterprise',
    description: 'Reach furthest + top governance share (floored, never exclusionary).',
    tier: 'premium',
  },
] as const;

/** Every canonical demo path — the list the CI gate checks and the docs cite. */
export function demoPaths(): string[] {
  return DEMO_LINKS.map((l) => l.path);
}

/** A registry link known to be one of the three tier sites (tier is present). */
export type DemoTierLink = DemoLink & { tier: NonNullable<DemoLink['tier']> };

/** The three tier sites (index excluded). */
export function demoTierLinks(): DemoTierLink[] {
  return DEMO_LINKS.filter((l): l is DemoTierLink => Boolean(l.tier));
}

export function demoLinkByKey(key: string): DemoLink | undefined {
  return DEMO_LINKS.find((l) => l.key === key);
}
